# Audio — half of perceived picture quality

The cheapest way to make a mediocre motion graphic feel professional is to put the right sound
under it. The cheapest way to make a beautiful one feel amateur is to ship it silent or with a
flat mix.

---

## 1. Sound effects under motion

**Every significant move should have a sound.** Not a soundtrack — a *sound*, attached to the
move. Whooshes under fast cuts and type flying in; impacts on landings; clicks on state
changes; risers into reveals.

### The three rules that separate real sound design from dropped-in SFX

1. **Pre-cue the visual.** Start the whoosh *slightly before* the visual movement begins. The
   brain processes audio faster than picture, so the sound leading the move makes the move feel
   responsive and intentional. A sound that starts on the frame the move starts reads as late.

2. **Layer, don't drop.** A convincing whoosh is a stack: a broadband high sweep plus a
   textured low-end rumble. One sample alone reads as a stock effect.

3. **Separate the frequencies.** When several sounds overlap, put them in different ranges —
   fast sharp whooshes in the highs, broader sweeps in the mids, rumbles in the lows. Two
   sounds fighting for the same band is what "muddy" means.

**The duration problem.** A downloaded 0.6 s whoosh under a 0.35 s dissolve is either cut off
or trailing, and the only fixes are to retime the edit around the asset or to stretch the asset
and change its pitch. **A whoosh must be as long as the move it accompanies.** This is the
strongest argument for *synthesising* motion-graphics SFX rather than shipping a sample library
— a whoosh genuinely *is* filtered noise with an envelope, and a riser genuinely *is* a noise
sweep. bay already does this (`bay-audio/src/sfx.rs`), which is a real advantage.

Recorded sound — a door, footsteps, room tone — is a different problem and does want a real
library.

### The palette

| Sound | Under |
|---|---|
| Whoosh | a fast cut, a wipe, type flying in |
| Reverse whoosh | *into* a cut — swells and stops dead; put the END on the landing frame |
| Riser | the build into a reveal |
| Impact / boom | a landing, a slam, a hard cut to a hero frame |
| Click / tick | a state change, a counter step, a UI action |
| Sub drop | a scale change or a register shift |
| Chime / bell | a resolution, a payoff, a positive confirmation |

---

## 2. Music

- **Pick the bed before cutting**, and cut to it. Retro-fitting music to a finished picture is
  how "synced" videos end up unsynced.
- **Compute the grid.** BPM → bar length → beat times. At 111 BPM a bar is 2.143 s.
- **Land reveals on the beat, don't start them on one.** An entrance of duration `d` landing on
  beat `b` starts at `b − d`. (Repeated from §02 and §04 because it is the most common
  beat-sync bug and it is invisible in a still frame.)
- **Don't beat-snap everything.** A reading floor of ~1.1 s per line of sequential text outranks
  the grid.
- **Cut the picture to the drop.** This requires being able to start a music file anywhere other
  than its head — trimming into the bed is what makes "the drop lands at 0:07" possible.
- **Music is structural.** Use its own sections: the intro is the hook, the build is the body,
  the drop is the payoff, the outro is the CTA. If the track's structure and the video's
  structure disagree, one of them is wrong.

---

## 3. The mix

The most common complaint — "the music drowns out the narrator" — is almost never a music
choice. It is a **flat mix**: music and dialogue at the same level for the whole duration with
no automation.

### Levels

| Element | Target |
|---|---|
| Narration | −12 to −6 dB peak |
| Music bed under narration | ducked 15–25 dB below its un-ducked level |
| Music bed with no narration | −12 to −14 dB (let it breathe in intros, outros, b-roll) |
| SFX | audible under the move, never above the voice |

### Ducking

Automatic ducking lowers the bed whenever speech is present and restores it after:

- **Duck depth:** 15–25 dB
- **Attack:** 10–30 ms (fast enough to catch the onset of a word)
- **Release:** 200–500 ms (slow enough that the bed doesn't pump between words)

Properly ducked audio also makes hitting a loudness target far easier, because the dynamic
range is controlled throughout instead of only at the end.

### Loudness targets

| Platform | Target |
|---|---|
| YouTube | ≈ −14 LUFS |
| Instagram / TikTok | ≈ −12 to −10 LUFS (they prefer louder) |
| Conservative general delivery | −14 LUFS with ≈ −1 dBTP ceiling |

Platforms normalise on playback, so a mix delivered far below target gets turned *up* along
with its noise floor, and one delivered far above gets turned down — either way the mix you
approved is not the mix that plays. Deliver at target.

### Fades

Every audio edit without a fade is a **click**. Even 10–20 ms at each end removes it. A
cross-fade between two beds is two overlapping fades, and it must not dip through silence in
the middle — which is why an overlap with an incoming fade-in reads better than two
complementary fades.

---

## 4. Audio-driven motion

Driving visuals from the audio makes motion feel locked to the track in a way hand-authored
tweens cannot.

**Method:** pre-extract per-frame frequency-band amplitudes into data, then drive properties
per frame. It must be *per-frame sampling* — a single long tween does not react to anything.
And it must be pre-extracted and deterministic: no runtime analysis, so two renders match.

**Mapping:**

| Signal | Property | Effect |
|---|---|---|
| Bass | scale | pulse on the beat |
| Treble | glow / shadow intensity | sparkle on cymbals |
| Overall amplitude | opacity, y, background colour | breathe, lift, shift |
| Mid-range | radius, width | shape morphing |

**Restraint is the whole game:** ≤ 5% scale and ≤ 30% glow on text and logos — anything more
reads as jitter and hurts legibility. Backgrounds and large shapes can take 10–30%.

**Never build:** equaliser bars, spectrum analysers, waveform displays, musical-note clip art,
generic particle systems, rainbow cycling, strobing white on beats. The audio supplies
*timing and intensity*; the visual vocabulary still comes from the content.

**When to use it:** anything with music or dramatic narration — brand reels, launches, hype
edits. Skip it for calm or tutorial pacing.

---

## 5. Silence

Silence is a tool, not an absence. The beat of silence before a reveal is what makes the reveal
land. A drone that cuts out, one clean chime, then the hero frame — that is a structure, and it
costs nothing.

---

## Sources

- [Best Whoosh Sound Effects for Film, Trailers, and UI — SoundMorph](https://soundmorph.com/blogs/news/best-whoosh-sound-effects-for-film-trailers-and-ui-a-designer-s-guide)
- [Creating Animated Sound Effects That Pop — SFX Engine](https://sfxengine.com/blog/animated-sound-effects)
- [Cinematic Whoosh Sound Effects for Transitions — Pixflow](https://pixflow.net/blog/cinematic-whoosh-sound-effects/)
- [Music Is Too Loud in Video — How to Fix Your Audio Mix](https://vidpros.com/fix-background-music-too-loud-video/)
- [Audio Ducking: Lower Music Automatically Under Voice — OpenClip](https://openclip.app/learn/audio-ducking)
- [Social Media (TikTok/Reels) Loudness Target — APU Software](https://apu.software/tiktok-instagram-reels-loudness/)
- [LUFS Loudness Standards for Every Platform (2026)](https://videovolumebooster.com/tools/lufs-standards)
- Encoded practice: `~/.claude/skills/hyperframes-creative/references/audio-reactive.md`,
  `vii/rust/crates/bay-audio/src/sfx.rs`
