# Spectral AutoDJ — phased development roadmap

**Branch:** `feat/spectral-autodj`  
**Initial baseline:** official upstream `Psysonic/psysonic:main` at `76ace706441387f74bfa11802546fa3faceba27f` (2026-11-19).  
**Status:** Experimental, staged implementation begun; **not audible, not accepted, not PR-ready**.  
**Authority:** [Psysonic Project Hub](https://github.com/Puppies-On-Acid/psysonic/blob/meta/project-hub/AGENTS.md); [living issue #1](https://github.com/Puppies-On-Acid/psysonic/issues/1). Owner requested branch creation and phased implementation. No permission inferred for any PR, merge, release, integration branch change, persisted setting or database migration.

## Goal

Make AutoDJ transitions less muddy and more musical with **independent per-track low/mid/high-frequency automation and separate faders**, preserving existing content-driven silence trimming, natural outro fades, overlap durations, preloading, playback-clock correctness, normalization, seek/pause, and offline/multi-server behavior. Ordinary AutoDJ must remain the default and a reliable fallback. The feature should serve diverse genres, **not indiscriminately sound like EDM mixing**.

## Evidence and hypotheses

- Kim, Yang, Nam, *Reverse-Engineering The Transition Regions of Real-World DJ Mixes using Sub-band Analysis with Convex Optimization* (NIME). [Source/illustration](https://github.com/mir-aidj/transition-analysis).
- Kim, Yang, Nam, *Joint Estimation of Fader and Equalizer Gains of DJ Mixers Using Convex Optimization* (DAFx 2022). [Paper](https://www.dafx.de/paper-archive/2022/papers/DAFx20in22_paper_33.pdf). Main result: separating overall fader and frequency-band adjustments improves **reconstruction of existing DJ mixes**. It does **not** directly determine ideal transitions for arbitrary pairs without a reference DJ mix.
- Chen et al., *Automatic DJ Transitions with Differentiable Audio Effects and Generative Adversarial Networks* (ICASSP 2022). [Research implementation](https://github.com/ChenPaulYu/DJtransGAN). An optional offline research baseline; **do not** add heavy ML inference or reuse redistributability-restricted audio/weights in the app.

The initial **bass-handoff heuristic is a Psysonic experiment, not a validated result of those papers**. Compare it against the current AutoDJ in blind listening tests.

## Protected existing architecture

- [waveformSilence.ts](https://github.com/Psysonic/psysonic/blob/76ace706441387f74bfa11802546fa3faceba27f/src/lib/waveform/waveformSilence.ts): natural intro/outro and overlap scheduling.
- [crossfadePreload.ts](https://github.com/Psysonic/psysonic/blob/76ace706441387f74bfa11802546fa3faceba27f/src/features/playback/store/crossfadePreload.ts): readiness gating; never start blending an unavailable stream.
- [audioEventHandlers.ts](https://github.com/Psysonic/psysonic/blob/76ace706441387f74bfa11802546fa3faceba27f/src/features/playback/store/audioEventHandlers.ts): existing A-tail and auto-advance rules.
- [decode/builders.rs](https://github.com/Psysonic/psysonic/blob/76ace706441387f74bfa11802546fa3faceba27f/src-tauri/crates/psysonic-audio/src/decode/builders.rs): decoding, per-track shared user EQ, equal-power fades, progress counting. Do not abuse the shared 10-band EQ controls as independent deck EQ.
- [sink_swap.rs](https://github.com/Psysonic/psysonic/blob/76ace706441387f74bfa11802546fa3faceba27f/src-tauri/crates/psysonic-audio/src/sink_swap.rs) and [upstream PR #1826](https://github.com/Psysonic/psysonic/pull/1826): outgoing source cannot advance incoming audio clock. No new progress clock; preserve seekbar and timed lyrics alignment.

## Phase 0 — establish branch and roadmap

**Checkpoint:** branch created at current upstream main; roadmap committed; `personal/integration`, fork `main` and `meta/project-hub` kept separate. No existing branch rewritten/deleted.

**Exit:** exact initial base and branch head recorded, roadmap includes requirements, tests, approval boundaries, rollback and research references.

## Phase 1 — isolated control planner

**Checkpoint:** initial candidate implemented in `src/lib/audio/spectralAutodj.ts` with `src/lib/audio/spectralAutodj.test.ts`. **Not wired to playback.** Pure TypeScript:
- Versioned ephemeral transition plan; independent equal-power fader envelopes and per-track EQ decibel targets.
- Conservative trial: if BOTH input boundary spectra are reliably low-heavy, attenuate incoming low band by **at most 4 dB**, smoothly restore low-band EQ to 0 dB before completion. Outgoing and incoming mid/high EQ remain neutral.
- Invalid/missing/silent spectra -> neutral EQ; invalid overlap length -> no plan. No persisted settings, IPC, decoding, analysis requests or audio changes.
- Units for the proposed input are **nonnegative linear RMS in three comparable frequency bands**. A waveform peak envelope alone is not a frequency spectrum. Thresholds 0.42/0.64 are **provisional** until measured; RMS aggregation may need to be revised to power/energy fractions after analysis calibration.

**Exit:** exact-SHA targeted Vitest, TypeScript, lint, dependency checks, full relevant frontend suite and coverage. Verify mathematical invariants, neutral behavior, bound constraints and smoothness. A standalone TypeScript compile and small custom Node smoke are **not a substitute** for project Vitest and tests on Windows.

## Phase 2 — bounded boundary spectral analysis

**Status:** in progress. Phase 2A targeted Rust correctness and offline compute characterization passed at owner-verified `23dc7c66`; Phase 2B.1 isolated decoding/token candidate pushed but untested; actual source scheduling, end-to-end performance and independent review remain pending.
- Provide comparable and appropriately normalized three-band spectra for the end of outgoing track A and start of incoming track B. Candidate frequency splits around **180 Hz and 3 kHz**; validate against the actual sample rate.
- Use existing analysis infrastructure when suitable; do not confuse existing waveform bins with spectral-band data. Investigate reuse of already-decoded PCM to avoid duplicate downloads or expensive decoding.
- Analyze off the realtime audio thread with strict time/CPU/memory bounds; default to neutral when analysis is missing, stale, incompatible or unreliable.
- First attempt uses **ephemeral** results. A new persisted cache/schema needs explicit owner approval.
- **Tests:** tones within/outside all three bands, silence, noise, mono/stereo, common and Hi-Res sample rates, short tracks, corrupt streams, natural fades, concurrent requests, cancellation, incorrect identity and offline/remote fallback.

**Exit:** deterministic fixture correctness, finite outputs, bounded latency and measured CPU/memory against current analysis baseline.

**Phase 2A code checkpoint (candidate, pending Windows verification):** A standalone, off-thread-only Rust analyzer has been added at `src-tauri/crates/psysonic-analysis/src/spectral_autodj.rs` and exported from the analysis crate. It accepts predecoded interleaved PCM with explicit rate/channels and intro/outro selection. Work is bounded to up to six boundary seconds, at most eight FFT windows per channel and FFT sizes no greater than 8192; it uses Hann-windowed three-band RMS energy, preserving stereo energy even for inverted-phase material. Inputs below 8 kHz, above 192 kHz, too short, silent or malformed safely return no analysis. No new dependencies, persistence, streams, IPC, live calls or changes to the existing sound path. Eight new synthetic Rust unit tests cover tones across rates, RMS units, boundary selection, stereo, invalid data and determinism. **Owner Windows checks passed on `2bd8740d` (2026-11-19): `cargo fmt --all --check` exit 0, all eight new spectral tests passed, strict analysis crate Clippy passed, and the full 206/206 analysis library tests passed. Phase 2A's measured performance and independent review remain pending.** The FFT math was independently cross-checked with NumPy sample spectra only, not as Rust-execution evidence.

**Phase 2A offline performance probe (owner Windows measured on `23dc7c66`):** A separately invoked ignored Rust test (`src-tauri/crates/psysonic-analysis/src/spectral_autodj_perf.rs`) synthesizes deterministic interleaved PCM **outside timing** and measures the exact analyzer for 25 consecutive, warmed runs. Cases: a six-second stereo 48 kHz clip and a six-second eight-channel 192 kHz clip (stress case). The probe reports median/p95/max wall time and generated PCM bytes; it does **not** write files or send audio over IPC. Run release mode, with Psysonic and CPU-heavy work closed, on the clean, pinned Windows feature HEAD:

```powershell
Set-Location "D:\Projects\psysonic-spectral-autodj\src-tauri"
cargo test -p psysonic-analysis --release --lib spectral_autodj_offline_cpu_probe -- --ignored --nocapture --test-threads=1
```

Perform at least two complete invocations under the same idle conditions, capture every `spectral-perf` line and exit code, and interpret dispersion rather than imposing an arbitrary threshold. This measures **spectral compute only**: it excludes decoding, memory allocation of source PCM, network acquisition, scheduling, song lookup, cancellation and live mixing. Until those are designed and measured, no app-runtime CPU budget can be accepted. **Owner-reported exact-SHA results (2026-11-19):** `cargo fmt --all --check` passed, `cargo test -p psysonic-analysis --lib` reported **206 pass / 1 intentionally ignored**, and `cargo clippy -p psysonic-analysis --all-targets -- -D warnings` passed. Two release-mode benchmark invocations each ran 25 warmed measurements per case. All commands succeeded; worktree clean at `23dc7c6658e225b696d8bb23dd42ae897884a1b2`.

| Scenario (six-second synthetic PCM) | Input bytes (created outside timing) | Run 1 p50 / p95 / max (ms) | Run 2 p50 / p95 / max (ms) |
| --- | ---: | ---: | ---: |
| 48 kHz, stereo | 2,304,000 | 0.374 / 0.408 / 0.520 | 0.370 / 0.386 / 0.398 |
| 192 kHz, eight-channel | 36,864,000 | 6.792 / 6.886 / 6.907 | 6.826 / 7.223 / 7.575 |

**Interpretation:** on the owner's Windows machine, the standalone analyzer is fast in these controlled synthetic scenarios, with consistent p50 across runs. The high-rate stress case has a larger input and substantially higher compute time. No pre-feature spectral baseline exists to compare like for like; this characterization does **not** measure PCM acquisition/decode, private-library usage, network, on-demand scheduling, cache-hit behavior, crossfade latency, allocation of input PCM or playback. Avoid stating a production CPU budget passed until these factors and a workload-relative threshold are measured. The ignored probe remains excluded from regular tests.

**Phase 2B design investigation / proposed small next slice (not implemented):**
1. The existing `analysis_cache/compute/decoder.rs` helper `decode_mono_pcm_window` **averages channels**. It is not suitable for spectral results because inverted-phase stereo content can cancel; retain separately accumulated channel powers by decoding interleaved PCM or streaming channel-aware spectra.
2. `analysis_cache/compute/planning.rs` can skip CPU decoding for fully cached waveform/loudness tracks; opportunistic analysis during a seed is useful but **cannot** be the only solution for cached-library tracks. Prefer reusing validated, already-available source bytes, with no playback-thread work or unconditional new download. If bytes cannot be obtained safely by a pre-transition deadline, fall back to unmodified AutoDJ.
3. Require a source-specific identity including server/library scope, track identity, verified content revision, and generation; stale, superseded or cross-server work must never contribute to a transition. Never publish private identifiers in logs or public issues.
4. Use an explicit analysis window matched to the planned intro/outro overlap; a fixed six-second boundary summary may not cover longer overlap schedules or early fade tails. Preserve the existing clock, silence detection and prebuffer rules.
5. Start with test-only, isolated window extraction and revision/cancellation regression fixtures before any new IPC, in-memory result store, cache schema or user-facing switch. A persisted data format or public Tauri contract needs owner design approval.

**Phase 2B acceptance tests to add:** channel-phase-safe WAV/M4A boundary extraction, short/long/unknown-duration tracks, corrupt/VBR/seek failures, stereo/8-channel/Hi-Res, intro/outro selection, waveform cache hits, source revision replacement, stale async completion, two servers with equal track IDs, cancellation and queue churn; benchmark paired decoding plus spectral computation separately from the existing CPU-seed baseline.

**Phase 2B.1 isolated decode + identity guard — owner Windows-verified at `9e3c7ac2`:** Existing `open_decode_session` from the `psysonic-analysis` crate is reused for a new **channel-preserving**, offline-only bounded decode path, `analysis_cache/compute/spectral_decode.rs`. The entry point `spectral_autodj::analyze_verified_boundary_bytes` accepts *already acquired and caller-trusted* media bytes, an explicit intro/outro and 0.1–6-second window, a source token (server scope, library scope, track ID, content revision and nonzero generation) and a callback that supplies the current token. It checks for an exact match before decoding, per packet, before FFT and after FFT. Any scope/revision/generation mismatch, cancellation, unsupported layout/rate, seek failure, non-finite sample, truncated window or missing duration for an outro **returns no result**, which leaves ordinary AutoDJ unchanged. Each end-of-track request requires reliable container frame metadata; unknown duration is a neutral fallback, **never** a full-track scan.

**Bounded-resource limitations:** the input must be a fully available encoded buffer no larger than 64 MiB (the existing Symphonia setup makes one copy); the extracted PCM is at most six seconds × 192 kHz × eight channels × f32 (36,864,000 bytes) and at most 4,096 decoded packets. This path does **not** download media, use SQLite, enqueue work, change playback, modify Tauri IPC, or add a user-facing control. Container duration and codec-seek placement still require real-file calibration: seeking into MP3/M4A may require codec-specific gapless/seek-trim validation before any real-world use. Results remain uncached and may be unavailable for already-analyzed tracks or for full streams that are not already in memory.

**New regression tests:** eight additional synthetic and existing-fixture tests in `spectral_autodj/boundary_tests.rs` cover anti-phase stereo bass, distinct synthetic intro/outro, wrong server/library/track/revision/generation, malformed/missing tokens, cancellation while decoding, short tracks, bad window/corrupt bytes and baseline M4A intro extraction. They complement the original eight FFT tests. **Owner Windows checks at `9e3c7ac252b1ae884f5d8ff0e8f1ca172bb3fc10` passed:** formatting, 17/17 Spectral tests (plus one intentionally ignored CPU probe), 215/215 analysis-crate tests (plus one ignored), and strict Clippy with warnings denied; local worktree was clean. The newest regression verifies exact samples from an unaligned synthetic WAV tail. These results **do not prove M4A/MP3 compressed-tail accuracy** and do not establish end-to-end CPU or worker integration. The earlier isolated FFT CPU measurements apply to `23dc7c66` only.

**Phase 2B.1 completed Windows gate at `9e3c7ac2`:** `cargo fmt --all --check`; `cargo test -p psysonic-analysis --lib spectral_autodj -- --nocapture`; `cargo test -p psysonic-analysis --lib`; and `cargo clippy -p psysonic-analysis --all-targets -- -D warnings`. Also record exact HEAD, source diff and clean worktree. Follow-up tests: M4A/MP3 accurate outro-seek position, channel layouts beyond stereo, VBR/missing duration and deliberately truncated samples, decoder CPU and memory under realistic acquisition, and cancellation during long seek.

**Phase 2B compressed-seek calibration candidate (untested):** `spectral_autodj/boundary_tests.rs` now has a separate M4A regression using the existing checked-in `isomp4_seek_normal.m4a` fixture. The test decodes the complete short fixture from its start, seeks to an unaligned 0.213-second outro and compares the decoded samples directly with the full-reference suffix. This is an experimental **test-only** change; it may reveal a true seek/gapless failure, an unsupported fixture metadata assumption or decoder offset. **It has not run**. If it fails, inspect the failure and distinguish fixture limitations from algorithm correctness; do not silently skip or adjust tolerance. It cannot by itself validate every MP3/M4A, VBR, large file, codec priming/padding or truncated track scenario. Run targeted spectral tests, full analysis library suite, rustfmt and strict Clippy on the new exact commit before modifying the worker.

**Phase 2B.2 worker lifecycle assessment:** current upstream `analysis_runtime/cpu_seed.rs` already uses a bounded `spawn_blocking` pool and receives full bytes with trusted `md5_16kb` and generation when available; `cpu_seed/queue.rs` deduplicates (server, track, revision). However an in-flight worker can skip cached waveform/loudness rows and existing fetch/backfill may not run at all for already-complete tracks. Never automatically add another download or full-track decode simply to force Spectral AutoDJ coverage, nor unconditionally analyze every backfill job while this feature is disabled. First define an ephemeral, optional, bounded job/response path for *already-available* verified source bytes, a final current-generation check and a neutral fallback when they are unavailable; assess duplicated encoded-byte memory and the 64-MiB/6-second limits. A stored cache, new Tauri contract or user-facing switch is a separate owner approval decision.

**Phase 2B.2 remaining:** map source token and bytes to the existing **off-thread** CPU seed/backfill lifecycle without unconditional downloads, leakage across server/library scope or duplication for already-cached tracks; define bounded deadlines/concurrency and final generation check. Determine whether a separate ephemeral result transport is necessary and seek owner approval before any new Tauri IPC shape, persisted cache/schema or user-facing switch. Connect the frontend planner only after Phase 2B's matching analysis results and safety tests are verified.

## Phase 3 — isolated Rust per-source DSP and offline renderer

**Status:** not started.
- Independent three-band processing state per source **in addition to**, not replacing, the user's 10-band EQ; preserve the existing equal-power faders and sample-clock wrappers.
- Prototype low/high shelving and mid peaking biquads with smoothed, bounded control coefficients. Avoid allocations, locks, blocking and expensive coefficient rebuilds per audio sample.
- Verify multichannel folding, stereo channel isolation, 44.1/48/88.2/96 kHz and device rates, seeks, gapless/Hi-Res resampling, pause/resume, normalization, recovery and no clipping/popping.
- First validate an **offline PCM renderer** using generated synthetic fixtures; no changes to live default AutoDJ.
- **Tests:** independent A/B deck controls, filter frequency responses, smooth automation, neutral pass-through, seek reset, sample-count invariants, bounded rendering cost and bad inputs.

**Exit:** exact-SHA Rust fmt, tests, Clippy, relevant coverage, offline renders and read-only independent review. Live integration is a later separately reviewable gate.

## Phase 4 — opt-in live AutoDJ integration

**Status:** proposed, requires approval of specific user-facing settings/API design before changing persisted settings or Tauri payloads.
- Add an **opt-in, disabled-by-default** experiment path with a versioned transition-plan handoff, preserving separate source generations and cancellation safety. Prefer non-persistent/internal experimental enablement first.
- Plan generated **before** the existing AutoDJ overlap; do not alter existing trigger, next-track readiness, natural fade or backend sink swap scheduling.
- Disabled/invalid/underrun/cold/unsupported -> use ordinary AutoDJ. Keep radio, previews and gapless unaffected.
- **Tests:** manual/automatic next/previous, seeking mid-transition, high-resolution crossfade, clocks/lyrics, end-of-track, local/remote/cold stream, replaygain/LUFS, device loss/recovery, quick repeated handoffs, concurrent queue changes, song identity collisions and no leaks.
- Manual app smoke requires a **disposable Tauri profile**, not the daily-drive database. No remote writes without permission.

**Exit:** owner Windows listening smoke, no playback-clock regression, exact-SHA frontend/Rust quality gates and independent review.

## Phase 5 — blind listening, calibration and upstream decision

**Status:** proposed, not accepted.
- At least **40 representative transition pairs** across electronic, metal, rock, acoustic, ambient, vocal-heavy tracks; include bass clashes, quiet intros and hard-ending/naturally fading material. Use legally obtained local samples; keep private filenames, server/library/track information out of public GitHub.
- Loudness-matched randomized blind A/B: current AutoDJ vs spectral; evaluate preferences and specific glitches over multiple listeners if available, not only spectrogram reconstruction error.
- Set CPU/latency/allocations budgets based on paired clean baseline measurements; document actual sample-rate/format/machine controls. Existing Psysonic **page** benchmark does not substitute for real-time DSP measurements.
- To ship by default, require repeatable audible improvement **and** no clipping, clicks, underruns, clock drift or compatibility regressions.
- Exact-HEAD CI/coverage, read-only Claude Code review via owner workflow, owner app test, PR scope and upstream contribution requirements apply. **Ask before creating a PR, merging or releasing.**

## Windows verification checkpoint

From a separate checked-out `feat/spectral-autodj` worktree with a clean tree and verified HEAD, Node >=24.15:

```powershell
npx vitest run src/lib/audio/spectralAutodj.test.ts
npm run prebuild:release-notes
npx tsc --noEmit
npm run lint
npm run dep:check
npm test
npm run test:coverage
```

For later Rust changes in `src-tauri`:

```powershell
cargo fmt --all --check
cargo test --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
```

Record exact SHA and command outputs. If Rust `play_session` tests require process-scoped `TZ=UTC`, document this as an environment qualification, restore the variable, and do not silently waive failures. Do not claim unrun tests passed.

## Decision and rollback boundaries

**Already authorized:** feature branch, roadmap, small isolated phase implementation/test work.  
**Need owner decision:** persisted UI setting or different playback mode; IPC shape; on-disk analysis caching/schema; wider scope into beat/key/tempo matching or ML; performance/subjective acceptance thresholds after baseline measurement; any PR, merge, release or destructive operation.

Phase 1 is completely inert and can be reverted without migrations. Later experiments must remain disableable without breaking original playback. Stop a rollout on any progress/lyrics drift, queue regression, underrun, clipping or filter click. Preserve all outstanding gates and test evidence.

**Next:** run exact-HEAD Phase 1 frontend checks on Windows, then design Phase 2 spectral feature extraction with explicit sample units and CPU budget.
