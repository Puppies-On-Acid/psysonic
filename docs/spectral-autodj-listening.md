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
WAVs and a private answer key. The renderer refuses to replace existing
Sample_1.wav, Sample_2.wav or ANSWER_KEY.txt files; choose a new output folder
for another rendering rather than overwriting a prior listening study. The root BLIND_RATINGS.csv contains empty
rating columns. Fill it out **before** looking at any answer key.

Recommended scoring: 1–5 for tonal/musical quality per anonymous sample;
choose "1", "2" or "tie" as the preferred version. Log clipping, clicks,
phase issues and poor crossfade alignment separately from subjective bass
clarity. Prefer multiple listeners and repeat pairs on different days.

**Interpretation:** Do not judge a neutral-control tie as a failure.
Summarize win/loss/tie by genre and bass-conflict type, loudness delta and
artifacts. Share only anonymized aggregate ratings; not private filenames,
library addresses or copyrighted audio.

## Opt-in live AutoDJ listening in a separate test profile

**New experimental candidate, not yet Windows compiled or app-smoke verified.**
A session-only flag enables the live capture-to-EQ handoff. The code uses
already-acquired verified remote originals and already-read verified offline
originals; it waits up to 20 seconds for ordinary analysis to become idle,
analyzes both six-second boundaries away from the audio thread and retains at
most eight ephemeral source-bound summaries. It requires BOTH A-outro and
B-intro measurements to be available, current and sufficiently bass-heavy.
Any missing original, incompatible codec, stale revision, busy queue,
expired data or incomplete preloading means **ordinary AutoDJ unchanged**.
No duplicate network fetch or persisted spectral cache is created.

The incoming deck receives a smoothly restored low-band cut of at most
4 dB using a per-source EQ separate from the user's existing ten-band EQ.
The existing outgoing source, crossfade fader curves, natural silence
planning, normalization, playback sample counter and sink-swap scheduling
are not intentionally modified. The source wrapper is neutral when off.
The trial applies only to **automatic content-driven AutoDJ overlaps**
that provide the existing dynamic fade overrides: not manual next/previous,
gapless, paused starts, radio, or plain fixed crossfades. A user seek during
an active handoff disables spectral coloration.

There is **no new persisted setting, Tauri command or in-app toggle**.
The trial must be explicitly enabled before app startup using the included
launcher. That launcher selects a different Tauri app identifier
(dev.psysonic.player.spectraltrial), intended to keep development profile
files separate. First confirm the new profile is empty on your Windows
machine; do not import/copy the regular app database or credentials, and
do not use a production test account without authorizing that yourself.
Close other Psysonic dev instances before using port 1420.

Only AFTER the consolidated exact-SHA Windows checks pass, launch one
variant at a time in PowerShell from a clean feature checkout:

~~~powershell
Set-Location "D:\Projects\psysonic-spectral-autodj"
$sha = (git rev-parse HEAD).Trim()
.\scripts\start-spectral-autodj-live-trial.ps1 -ExpectedHead $sha -Variant baseline
~~~

Play a representative queue with **crossfade enabled, silence-aware AutoDJ
enabled, and gapless OFF**; allow the next track to preload and advance
automatically. Do not trigger manual next/previous for this particular test.
Close the test app and start the identical test profile/queue again with:

~~~powershell
.\scripts\start-spectral-autodj-live-trial.ps1 -ExpectedHead $sha -Variant spectral
~~~

The launcher sets PSYSONIC_SPECTRAL_AUTODJ_TRIAL to 0 or 1 only for its child
process and restores the original PowerShell environment afterward.
In developer logs, a successful handoff announces
[spectral-trial] incoming deck low-band cut armed db=... without logging
server, track or content identifiers. If that message is absent, the
experimental path may have fallen back to ordinary AutoDJ: **a null
difference is not evidence the EQ algorithm is ineffective**. No log of
private file names is required in public issues.

This live exercise is **not blind** because the launcher mode is known. Use
the private anonymized WAV pairs above for blinded EQ-preference evaluation.
Live tests instead check real silence-aware timing, clipping, seeks,
playback clocks, device changes and natural fades. A failure or unexpected
sound should end the session and return to baseline mode.

## Additional readiness gates (separate from this A/B)

- The offline WAV renderer never arms the live player. The **separate**
  session-only trial now has a candidate paired-source/automatic-AutoDJ
  handoff, but is uncompiled and must pass regression and disposable-profile
  listening smoke before its safety/performance can be accepted.
- Native Windows compile, formatting, unit/full audio-analysis tests,
  standalone renderer smoke and strict Clippy at the **new SHA** are pending.
- Full cross-platform CI, four Linux Bash-only checks, complete repo build,
  realistic CPU/peak-memory comparisons, codec calibration, independent
  read-only Claude Code review and owner-controlled in-app listening remain
  pending.
- No PR, merge, daily-drive branch change, persistent setting, database
  write or deployment is authorized by the listening harness.
