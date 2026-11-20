# Spectral AutoDJ — blind listening laboratory

**Purpose:** Audition the sound of the original conservative bass-handoff
heuristic on your own music, before enabling it in the live playback engine.
This is a real audio comparison: two complete PCM16 WAV transitions, sourced
from the same decoded files. It is NOT a simulation of a live Psysonic session.

## What is being compared

- **Ordinary:** outgoing and incoming excerpts mixed with existing
  equal-power cosine/sine fades, no spectral attenuation.
- **Spectral:** identical source PCM, excerpt start, overlap, resampling
  and fader curves, with an independent incoming-deck three-band processor.
  When both boundary spectra are bass-heavy the low band receives a smooth
  attack-free attenuation up to -4 dB and returns to neutral before overlap
  completion. Mid/high controls and outgoing EQ stay neutral.
- **Matched listening level:** both files are integrated-RMS matched using a
  shared peak-safe scale; no compressor, limiter or post-mix EQ. This is a
  broadband-RMS match, not ITU-R BS.1770/EBU R128 loudness certification.
- **Blind order:** the output files are Sample_1.wav and Sample_2.wav.
  ANSWER_KEY.txt records which is which and the chosen bass cut. Do not open
  that file until both clips have been rated.

The filter uses complementary low/mid/high sections at approximately 180 Hz
and 3 kHz. Every channel maintains independent state; no stereo averaging
or phase cancellation is introduced. No new sample clock is created.

**Important comparison boundary:** The offline renderer fixes a 6-second
outgoing tail and a 6-second incoming intro with a user-selected 1–5 second
overlap, downconverts/resamples both inputs to 48 kHz stereo and applies the
same equal-power faders to both. It DOES NOT reproduce the in-app content
silence-trimming algorithm, replaygain, gapless chain, custom playback rate,
sinks or hardware. It assesses audible EQ differences, **not** whether live
AutoDJ timing and device behavior are production-ready.

## Safety, supported files and exclusions

The harness reads only two local paths you specify, without touching a live
database, player, remote server or private music metadata index. It never
downloads audio or writes to the repository. Use an output directory OUTSIDE
your public Git checkout. The PowerShell wrapper enforces this separation.

Inputs must be complete, already owned original mono/stereo files no larger
than 64 MiB. The decoder uses Psysonic's existing strictly bounded
intro/outro extractor. Insufficient timeline data, unreliable seeking,
corruption, mismatched duration, unsupported audio layout and incomplete
content produce an error instead of guessed alignment. The path does not
relax known AAC PNS-on exact-PCM or unverified metadata-free MP3 gapless
policy. Do not publish private song filenames or recorded music with GitHub
issues or CI artifacts.

For the first sessions, use known-complete WAV, FLAC and correctly tagged
stereo files. A neutral control is expected when either boundary has little
bass or missing valid analysis; the WAV results can then be identical.

## First private test on Windows

From your clean, checked out feature branch, after its exact-HEAD Windows
verification passes, run the following PowerShell example. Substitute two
private, legally obtained audio paths and the SHA provided with the
verification handoff.

~~~powershell
Set-Location "D:\Projects\psysonic-spectral-autodj"
$sha = (git rev-parse HEAD).Trim()
.\scripts\spectral-autodj-audition.ps1 -ExpectedHead $sha -Outgoing "C:\Music\TrackA.flac" -Incoming "C:\Music\TrackB.flac" -OverlapSec 3.5 -OutputDir "$env:USERPROFILE\Music\SpectralBlindAB\Pair001"
~~~

The first run builds one release binary; subsequent audition runs reuse the
build unless source files have changed. Listen to Sample_1.wav and
Sample_2.wav in the same player and volume, without looking at the answer
key. Record artifacts, tonal clarity, musical preference and any obvious
bass clash. Then open ANSWER_KEY.txt to reveal the assignment.

## A representative 40-pair study

Use a **private** UTF-8 CSV with columns exactly:

~~~csv
Outgoing,Incoming,OverlapSec
C:\Music\TrackA.flac,C:\Music\TrackB.flac,3.5
C:\Music\TrackC.wav,C:\Music\TrackD.wav,4.0
~~~

Prepare at least 40 *distinct* pairs across electronic, metal, rock,
acoustic, ambient and vocal-heavy music, with deliberate bass collisions,
quiet intros, natural fades and hard endings. A shuffled order and several
zero-cut neutral controls reduce expectancy bias.

~~~powershell
Set-Location "D:\Projects\psysonic-spectral-autodj"
$sha = (git rev-parse HEAD).Trim()
.\scripts\spectral-autodj-audition.ps1 -ExpectedHead $sha -PairsCsv "$env:USERPROFILE\Music\private_pairs.csv" -OutputDir "$env:USERPROFILE\Music\SpectralBlindAB"
~~~

Each private Pair_001, Pair_002, etc directory receives two level-matched
WAVs and a private answer key. The root BLIND_RATINGS.csv contains empty
rating columns. Fill it out **before** looking at any answer key.

Recommended scoring: 1–5 for tonal/musical quality per anonymous sample;
choose "1", "2" or "tie" as the preferred version. Log clipping, clicks,
phase issues and poor crossfade alignment separately from subjective bass
clarity. Prefer multiple listeners and repeat pairs on different days.

**Interpretation:** Do not judge a neutral-control tie as a failure.
Summarize win/loss/tie by genre and bass-conflict type, loudness delta and
artifacts. Share only anonymized aggregate ratings; not private filenames,
library addresses or copyrighted audio.

## Additional readiness gates (separate from this A/B)

- No live player is armed by the audition tool. An opt-in in-app AutoDJ EQ
  mode still needs a source-pair plan and a separately authorized
  transition-safe control handoff before real-time listening.
- Native Windows compile, formatting, unit/full audio-analysis tests,
  standalone renderer smoke and strict Clippy at the **new SHA** are pending.
- Full cross-platform CI, four Linux Bash-only checks, complete repo build,
  realistic CPU/peak-memory comparisons, codec calibration, independent
  read-only Claude Code review and owner-controlled in-app listening remain
  pending.
- No PR, merge, daily-drive branch change, persistent setting, database
  write or deployment is authorized by the listening harness.
