//! Getting bytes from the network, and refusing to keep the wrong ones.
//!
//! The digest in the manifest — not TLS, not the hostname — is what makes a download
//! trustworthy. Everything here is arranged so that a byte which fails that check cannot reach
//! a path bay will later execute: the download streams into a `.part` file, is hashed as it
//! streams, and is only renamed into place once the digest matches. A mismatch deletes the
//! partial file and reports what was expected against what arrived.
//!
//! [`Fetch`] is a trait so the whole verification path is testable without a network: the
//! tests below serve bytes from memory, including deliberately corrupt ones, and assert that
//! nothing lands.

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::ProvisionError;
use crate::manifest::Need;

/// How many bytes to move per read. Large enough that a 170 MB archive is not 170 000 syscalls,
/// small enough that progress updates stay smooth.
const CHUNK: usize = 256 * 1024;

/// Somewhere bytes come from.
pub trait Fetch: Send + Sync {
    /// Stream `url` into `sink`, calling `on_chunk` with the running total.
    ///
    /// `total` from the response is deliberately not returned: the manifest already states the
    /// size, and a server that disagrees with the manifest is a reason to distrust the server,
    /// not to revise the expectation.
    fn get(
        &self,
        url: &str,
        sink: &mut dyn Write,
        on_chunk: &mut dyn FnMut(u64),
    ) -> Result<(), ProvisionError>;
}

/// The real one.
pub struct Http {
    agent: ureq::Agent,
}

impl Default for Http {
    fn default() -> Self {
        Self::new()
    }
}

impl Http {
    pub fn new() -> Self {
        // A generous read timeout rather than none: a stalled connection on a 1 GB download
        // would otherwise hang the install thread forever with no way to report it. There is
        // deliberately no *total* timeout — a slow connection is not an error.
        let config = ureq::Agent::config_builder()
            .timeout_connect(Some(std::time::Duration::from_secs(30)))
            .timeout_recv_body(None)
            .user_agent(concat!("bay/", env!("CARGO_PKG_VERSION")))
            .build();
        Self {
            agent: config.into(),
        }
    }
}

impl Fetch for Http {
    fn get(
        &self,
        url: &str,
        sink: &mut dyn Write,
        on_chunk: &mut dyn FnMut(u64),
    ) -> Result<(), ProvisionError> {
        let response = self
            .agent
            .get(url)
            .call()
            .map_err(|error| ProvisionError::Network {
                url: url.to_string(),
                detail: error.to_string(),
            })?;
        let mut reader = response.into_body().into_reader();
        copy_with_progress(&mut reader, sink, on_chunk).map_err(|error| ProvisionError::Network {
            url: url.to_string(),
            detail: error.to_string(),
        })
    }
}

fn copy_with_progress(
    reader: &mut dyn Read,
    sink: &mut dyn Write,
    on_chunk: &mut dyn FnMut(u64),
) -> io::Result<()> {
    let mut buffer = vec![0u8; CHUNK];
    let mut total = 0u64;
    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            return Ok(());
        }
        sink.write_all(&buffer[..read])?;
        total += read as u64;
        on_chunk(total);
    }
}

/// A writer that hashes everything passing through it.
struct Hashing<'a> {
    inner: &'a mut dyn Write,
    hasher: Sha256,
}

impl Write for Hashing<'_> {
    /// Hash exactly what was written, and report exactly that many bytes.
    ///
    /// The order matters. Hashing the whole buffer and returning `buffer.len()` regardless —
    /// the obvious version — silently corrupts a short write: the caller believes every byte
    /// landed, so `write_all` does not retry the remainder, and the digest covers bytes that
    /// are not in the file. The result is a file that fails verification for no visible reason,
    /// or worse, one that passes while being wrong.
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let written = self.inner.write(buffer)?;
        self.hasher.update(&buffer[..written]);
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

/// The SHA-256 of a file already on disk, lowercase hex.
pub fn digest_of(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; CHUNK];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Fetch `need` into `cache`, verify it, and return the path to the verified archive.
///
/// Content-addressed by digest, so an interrupted install re-uses whatever already arrived
/// intact and a partial file can never masquerade as a complete one. A cached file is re-hashed
/// rather than trusted by name: it costs about a tenth of a second, and it means a truncated
/// file left by a full disk heals itself instead of failing extraction with a baffling error.
pub fn download_verified(
    fetch: &dyn Fetch,
    need: &Need,
    cache: &Path,
    on_progress: &mut dyn FnMut(u64),
) -> Result<PathBuf, ProvisionError> {
    fs::create_dir_all(cache).map_err(|e| ProvisionError::at(cache, e))?;
    let final_path = cache.join(&need.sha256);

    if final_path.is_file() {
        match digest_of(&final_path) {
            Ok(digest) if digest == need.sha256 => {
                on_progress(need.bytes);
                return Ok(final_path);
            }
            // Wrong or unreadable: drop it and fetch again rather than reasoning about why.
            _ => {
                let _ = fs::remove_file(&final_path);
            }
        }
    }

    // The pid keeps two bay processes provisioning at once from writing the same partial file.
    let staging = cache.join(format!("{}.{}.part", need.sha256, std::process::id()));
    let outcome = (|| -> Result<String, ProvisionError> {
        let mut file = File::create(&staging).map_err(|e| ProvisionError::at(&staging, e))?;
        let mut hashing = Hashing {
            inner: &mut file,
            hasher: Sha256::new(),
        };
        fetch.get(&need.url, &mut hashing, on_progress)?;
        let digest = hex(&hashing.hasher.finalize());
        file.sync_all()
            .map_err(|e| ProvisionError::at(&staging, e))?;
        Ok(digest)
    })();

    let digest = match outcome {
        Ok(digest) => digest,
        Err(error) => {
            let _ = fs::remove_file(&staging);
            return Err(error);
        }
    };

    if digest != need.sha256 {
        let _ = fs::remove_file(&staging);
        return Err(ProvisionError::DigestMismatch {
            artifact: need.artifact.clone(),
            url: need.url.clone(),
            expected: need.sha256.clone(),
            actual: digest,
        });
    }

    fs::rename(&staging, &final_path).map_err(|e| ProvisionError::at(&final_path, e))?;
    Ok(final_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Serves fixed bytes, and counts how often it was asked.
    struct Canned {
        bytes: Vec<u8>,
        calls: AtomicUsize,
    }

    impl Canned {
        fn new(bytes: &[u8]) -> Self {
            Self {
                bytes: bytes.to_vec(),
                calls: AtomicUsize::new(0),
            }
        }
    }

    impl Fetch for Canned {
        fn get(
            &self,
            _url: &str,
            sink: &mut dyn Write,
            on_chunk: &mut dyn FnMut(u64),
        ) -> Result<(), ProvisionError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            sink.write_all(&self.bytes).unwrap();
            on_chunk(self.bytes.len() as u64);
            Ok(())
        }
    }

    struct Broken;

    impl Fetch for Broken {
        fn get(
            &self,
            url: &str,
            _sink: &mut dyn Write,
            _on_chunk: &mut dyn FnMut(u64),
        ) -> Result<(), ProvisionError> {
            Err(ProvisionError::Network {
                url: url.to_string(),
                detail: "connection reset".into(),
            })
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bay-fetch-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn need_for(bytes: &[u8]) -> Need {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        Need {
            artifact: "test".into(),
            name: "Test artifact".into(),
            url: "https://example.invalid/a.zip".into(),
            sha256: hex(&hasher.finalize()),
            bytes: bytes.len() as u64,
            license: "MIT".into(),
            source: "https://example.invalid".into(),
        }
    }

    #[test]
    fn a_matching_download_lands_under_its_digest() {
        let dir = temp_dir("ok");
        let payload = b"the archive bytes";
        let need = need_for(payload);
        let path =
            download_verified(&Canned::new(payload), &need, &dir, &mut |_| {}).expect("verified");
        assert_eq!(path.file_name().unwrap().to_string_lossy(), need.sha256);
        assert_eq!(fs::read(&path).unwrap(), payload);
        fs::remove_dir_all(&dir).ok();
    }

    /// The one that matters. Corrupt bytes must not reach a path bay will later execute, and
    /// the error must name both digests so a re-pin is a copy-paste rather than a guess.
    #[test]
    fn corrupt_bytes_are_refused_and_nothing_is_left_behind() {
        let dir = temp_dir("corrupt");
        let need = need_for(b"what the manifest pinned");
        let error = download_verified(
            &Canned::new(b"what the server sent"),
            &need,
            &dir,
            &mut |_| {},
        )
        .expect_err("a digest mismatch must fail");
        match error {
            ProvisionError::DigestMismatch {
                expected, actual, ..
            } => {
                assert_eq!(expected, need.sha256);
                assert_ne!(actual, need.sha256);
            }
            other => panic!("wrong error: {other}"),
        }
        let leftovers: Vec<_> = fs::read_dir(&dir).unwrap().filter_map(Result::ok).collect();
        assert!(
            leftovers.is_empty(),
            "a rejected download must leave nothing: {:?}",
            leftovers.iter().map(|e| e.path()).collect::<Vec<_>>()
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// A dropped connection must not leave a truncated file that a later run mistakes for a
    /// complete one.
    #[test]
    fn a_failed_transfer_leaves_no_partial_file() {
        let dir = temp_dir("dropped");
        let need = need_for(b"never arrives");
        assert!(download_verified(&Broken, &need, &dir, &mut |_| {}).is_err());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_already_verified_archive_is_not_downloaded_again() {
        let dir = temp_dir("cached");
        let payload = b"cache me";
        let need = need_for(payload);
        let fetch = Canned::new(payload);
        download_verified(&fetch, &need, &dir, &mut |_| {}).unwrap();
        download_verified(&fetch, &need, &dir, &mut |_| {}).unwrap();
        assert_eq!(
            fetch.calls.load(Ordering::SeqCst),
            1,
            "the second call should have been served from the cache"
        );
        fs::remove_dir_all(&dir).ok();
    }

    /// A cached file is trusted for its contents, never for its name. A truncated file left by
    /// a full disk has the right name and the wrong bytes.
    #[test]
    fn a_cached_file_with_the_wrong_contents_is_refetched() {
        let dir = temp_dir("tampered");
        let payload = b"the real archive";
        let need = need_for(payload);
        fs::write(dir.join(&need.sha256), b"not the real archive").unwrap();
        let fetch = Canned::new(payload);
        let path = download_verified(&fetch, &need, &dir, &mut |_| {}).unwrap();
        assert_eq!(fs::read(&path).unwrap(), payload);
        assert_eq!(fetch.calls.load(Ordering::SeqCst), 1);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn progress_reports_the_running_total() {
        let dir = temp_dir("progress");
        let payload = vec![7u8; 4096];
        let need = need_for(&payload);
        let mut seen = Vec::new();
        download_verified(&Canned::new(&payload), &need, &dir, &mut |done| {
            seen.push(done)
        })
        .unwrap();
        assert_eq!(seen.last().copied(), Some(4096));
        fs::remove_dir_all(&dir).ok();
    }

    /// A `Write` that accepts at most 7 bytes at a time — what a pipe or a nearly-full disk
    /// does, and what an earlier version of `Hashing` mishandled by reporting the whole buffer
    /// as written. Every byte must still reach the sink, and the digest must cover them once.
    struct ShortWriter {
        written: Vec<u8>,
    }

    impl Write for ShortWriter {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            let take = buffer.len().min(7);
            self.written.extend_from_slice(&buffer[..take]);
            Ok(take)
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_sink_that_accepts_partial_writes_still_gets_every_byte_and_one_digest() {
        let payload: Vec<u8> = (0..=255u8).cycle().take(5000).collect();
        let mut sink = ShortWriter {
            written: Vec::new(),
        };
        let mut hashing = Hashing {
            inner: &mut sink,
            hasher: Sha256::new(),
        };
        hashing.write_all(&payload).expect("write_all must retry");
        let digest = hex(&hashing.hasher.finalize());

        assert_eq!(sink.written, payload, "bytes were dropped by a short write");
        let mut expected = Sha256::new();
        expected.update(&payload);
        assert_eq!(
            digest,
            hex(&expected.finalize()),
            "the digest must cover the payload exactly once"
        );
    }

    #[test]
    fn digest_of_matches_a_known_vector() {
        let dir = temp_dir("digest");
        let file = dir.join("abc");
        fs::write(&file, b"abc").unwrap();
        assert_eq!(
            digest_of(&file).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        fs::remove_dir_all(&dir).ok();
    }
}
