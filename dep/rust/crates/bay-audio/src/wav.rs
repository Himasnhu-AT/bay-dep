//! Reading a WAV back into samples, without a decoder.
//!
//! # Why this is here and not left to ffmpeg
//!
//! Every sound bay makes itself is a WAV: `sfx_add` writes one, Kokoro writes one per line of
//! narration, and the bundled sound library ships them. Those files arrive on a machine that may
//! have no ffmpeg at all — Kokoro does not need it — and an audio asset that reaches the
//! timeline without a measured loudness makes the *whole* mix envelope unmeasurable, not just
//! its own clip. So "bay could not measure the file it just wrote" is a real state, and it turns
//! the mix gate off for the project.
//!
//! A RIFF header is a length and a format tag, and the samples after it are integers. Reading
//! them is forty lines; shelling out to a decoder to recover numbers that are sitting in a file
//! bay wrote is not the cheaper option.
//!
//! **Deliberately narrow.** Uncompressed PCM and IEEE float only — the formats bay and Kokoro
//! actually write. Anything else (ADPCM, an MP3 in a RIFF wrapper, a 64-bit float) is refused by
//! name rather than guessed at, because a wrong level is worse than a missing one: a missing one
//! says so.

use crate::AudioPcm;

/// The most this will read into memory. R128's gating is over the whole signal, so measuring
/// means holding it — and a caller that hands over an hour of audio wants a streaming decoder,
/// not this. About 12 minutes of 48 kHz 16-bit stereo.
pub const MAX_BYTES: u64 = 128 * 1024 * 1024;

/// Read a WAV file into interleaved f32 samples.
///
/// The twelve-byte header is read and checked **before** the file is: callers reach for this
/// after every import that could not be measured any other way, and most of those are a video or
/// a still. Reading 100 MB of h264 into memory to reject it on its first four bytes would be a
/// silent tax on every import.
///
/// The error is a sentence, because every caller of this puts it in front of a person: it is the
/// reason a level could not be measured.
pub fn read(path: &std::path::Path) -> Result<AudioPcm, String> {
    use std::io::Read;

    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("could not open {}: {error}", path.display()))?;
    let mut header = [0u8; 12];
    file.read_exact(&mut header)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    if &header[0..4] != b"RIFF" || &header[8..12] != b"WAVE" {
        return Err(format!("{} is not a RIFF/WAVE file", path.display()));
    }

    let size = file
        .metadata()
        .map_err(|error| format!("could not read {}: {error}", path.display()))?
        .len();
    if size > MAX_BYTES {
        return Err(format!(
            "{} is {size} bytes, past the {MAX_BYTES} this reads without streaming",
            path.display()
        ));
    }
    let mut bytes = Vec::with_capacity(size as usize);
    bytes.extend_from_slice(&header);
    file.read_to_end(&mut bytes)
        .map_err(|error| format!("could not read {}: {error}", path.display()))?;
    decode(&bytes).map_err(|reason| format!("{}: {reason}", path.display()))
}

/// Decode the bytes of a WAV file.
///
/// Split from [`read`] so every format branch is testable on bytes built in the test, with no
/// file and no ffmpeg.
pub fn decode(bytes: &[u8]) -> Result<AudioPcm, String> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a RIFF/WAVE file".into());
    }

    let mut format: Option<(u16, u16, u32, u16)> = None; // tag, channels, rate, bits
    let mut data: Option<&[u8]> = None;
    let mut at = 12;
    while at + 8 <= bytes.len() {
        let id = &bytes[at..at + 4];
        let size = u32::from_le_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]])
            as usize;
        let body = at + 8;
        // A truncated final chunk is taken for what is actually there: a file cut off mid-write
        // still has samples in it, and refusing to measure them would be refusing the only
        // evidence available.
        let end = body.saturating_add(size).min(bytes.len());
        match id {
            b"fmt " if end - body >= 16 => {
                let u16_at = |offset: usize| {
                    u16::from_le_bytes([bytes[body + offset], bytes[body + offset + 1]])
                };
                let mut tag = u16_at(0);
                let channels = u16_at(2);
                let rate = u32::from_le_bytes([
                    bytes[body + 4],
                    bytes[body + 5],
                    bytes[body + 6],
                    bytes[body + 7],
                ]);
                let bits = u16_at(14);
                // WAVE_FORMAT_EXTENSIBLE says nothing itself; the real tag is the first two
                // bytes of the sub-format GUID that follows the extension size.
                if tag == 0xFFFE && end - body >= 26 {
                    tag = u16_at(24);
                }
                format = Some((tag, channels, rate, bits));
            }
            b"data" => data = Some(&bytes[body..end]),
            _ => {}
        }
        // Chunks are word-aligned: an odd size is followed by one pad byte.
        at = body + size + (size & 1);
    }

    let (tag, channels, rate, bits) = format.ok_or("no fmt chunk")?;
    let data = data.ok_or("no data chunk")?;
    if channels == 0 || rate == 0 {
        return Err(format!("{channels} channels at {rate} Hz is not a sound"));
    }

    let samples: Vec<f32> = match (tag, bits) {
        // Unsigned bytes, centred on 128 — the one PCM width that is not signed.
        (1, 8) => data
            .iter()
            .map(|byte| (f32::from(*byte) - 128.0) / 128.0)
            .collect(),
        (1, 16) => data
            .chunks_exact(2)
            .map(|pair| f32::from(i16::from_le_bytes([pair[0], pair[1]])) / 32_768.0)
            .collect(),
        (1, 24) => data
            .chunks_exact(3)
            .map(|triple| {
                // Sign-extend by putting the three bytes in the top of an i32.
                let value = i32::from_le_bytes([0, triple[0], triple[1], triple[2]]) >> 8;
                value as f32 / 8_388_608.0
            })
            .collect(),
        (1, 32) => data
            .chunks_exact(4)
            .map(|quad| {
                i32::from_le_bytes([quad[0], quad[1], quad[2], quad[3]]) as f32 / 2_147_483_648.0
            })
            .collect(),
        (3, 32) => data
            .chunks_exact(4)
            .map(|quad| f32::from_le_bytes([quad[0], quad[1], quad[2], quad[3]]))
            .collect(),
        (tag, bits) => {
            return Err(format!(
                "format {tag} at {bits} bits is not uncompressed PCM — this reads what bay and \
                 Kokoro write, and refuses the rest rather than guessing at a level"
            ));
        }
    };
    if samples.is_empty() {
        return Err("the data chunk is empty".into());
    }

    Ok(AudioPcm {
        sample_rate: rate,
        channels,
        samples,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::loudness;

    /// What bay itself writes, read back: the samples that went in come out, to within the
    /// 16-bit step they were written at.
    #[test]
    fn a_wav_bay_wrote_reads_back_as_the_samples_that_went_in() {
        let effect = crate::sfx::Sfx::by_id("chime").expect("a known effect");
        let pcm = effect.render(crate::sfx::SfxParams {
            seconds: 1.0,
            ..Default::default()
        });
        let decoded = decode(&crate::sfx::encode_wav(&pcm)).expect("bay's own wav");

        assert_eq!(decoded.sample_rate, pcm.sample_rate);
        assert_eq!(decoded.channels, pcm.channels);
        assert_eq!(decoded.samples.len(), pcm.samples.len());
        let worst = pcm
            .samples
            .iter()
            .zip(&decoded.samples)
            .fold(0.0f32, |worst, (a, b)| worst.max((a - b).abs()));
        assert!(worst < 1.0 / 16_384.0, "worst sample differs by {worst}");

        // …and the level measured either side of the file is the same level, which is the only
        // property that matters to the mix.
        let before = loudness::measure(&pcm);
        let after = loudness::measure(&decoded);
        assert!(
            (before.lufs - after.lufs).abs() < 0.05,
            "{before:?} vs {after:?}"
        );
    }

    /// From a file, which is how every caller reaches it: what bay wrote comes back, and a file
    /// that is not a WAV is turned away at its header rather than read.
    #[test]
    fn a_file_that_is_not_a_wav_is_turned_away_at_the_header() {
        let root = std::env::temp_dir().join(format!("bay-wav-read-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("a scratch directory");

        let effect = crate::sfx::Sfx::by_id("pop").expect("a known effect");
        let pcm = effect.render(crate::sfx::SfxParams {
            seconds: 0.5,
            ..Default::default()
        });
        let good = root.join("pop.wav");
        std::fs::write(&good, crate::sfx::encode_wav(&pcm)).expect("write");
        assert_eq!(
            read(&good).map(|read| read.samples.len()).ok(),
            Some(pcm.samples.len())
        );

        // Named `.wav`, and not one: an extension is a claim, not a format.
        let liar = root.join("liar.wav");
        std::fs::write(&liar, b"\x89PNG\r\n\x1a\n and then some").expect("write");
        match read(&liar) {
            Ok(_) => panic!("a PNG is not a WAV"),
            Err(error) => assert!(error.contains("not a RIFF/WAVE"), "{error}"),
        }
        match read(&root.join("nothing-here.wav")) {
            Ok(_) => panic!("there is no file"),
            Err(error) => assert!(error.contains("could not open"), "{error}"),
        }
    }

    /// A header this cannot honour is named, not guessed at. A wrong level is worse than a
    /// missing one, because the missing one says so.
    #[test]
    fn a_format_this_cannot_read_is_refused_by_name() {
        let mut bytes = b"RIFF\x00\x00\x00\x00WAVE".to_vec();
        bytes.extend_from_slice(b"fmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&17u16.to_le_bytes()); // ADPCM
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&48_000u32.to_le_bytes());
        bytes.extend_from_slice(&48_000u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&4u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&4u32.to_le_bytes());
        bytes.extend_from_slice(&[0, 0, 0, 0]);

        // `AudioPcm` has no `Debug` on purpose — it holds every sample — so the error comes out
        // of a match rather than `expect_err`.
        match decode(&bytes) {
            Ok(_) => panic!("ADPCM is not PCM"),
            Err(error) => assert!(error.contains("format 17"), "{error}"),
        }
    }

    #[test]
    fn something_that_is_not_a_wav_is_not_a_wav() {
        assert!(decode(b"this is not a wav file").is_err());
        assert!(decode(&[]).is_err());
    }

    /// A chunk between `fmt ` and `data` — `LIST`, which is where a tool writes its name — must
    /// not be read as audio. Walking the chunk table rather than assuming an offset is what
    /// makes that true.
    #[test]
    fn a_chunk_in_the_middle_is_walked_past() {
        let effect = crate::sfx::Sfx::by_id("beep").expect("a known effect");
        let pcm = effect.render(crate::sfx::SfxParams {
            seconds: 0.5,
            ..Default::default()
        });
        let plain = crate::sfx::encode_wav(&pcm);

        // Splice a 7-byte LIST chunk (odd, so it is padded) in front of `data`.
        let data_at = plain
            .windows(4)
            .position(|window| window == b"data")
            .expect("bay writes a data chunk");
        let mut spliced = plain[..data_at].to_vec();
        spliced.extend_from_slice(b"LIST");
        spliced.extend_from_slice(&7u32.to_le_bytes());
        spliced.extend_from_slice(b"INFObay");
        spliced.push(0);
        spliced.extend_from_slice(&plain[data_at..]);

        let decoded = decode(&spliced).expect("a wav with a LIST chunk");
        assert_eq!(decoded.samples.len(), pcm.samples.len());
    }
}
