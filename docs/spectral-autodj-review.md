# PSY-016 — independent read-only review handoff

**Not an independent review or approval.** The owner has deferred Claude Code due to usage limits. Do not waive the requirement.

## Exact-SHA review setup (owner Windows)

```powershell
Set-Location "D:\Projects\psysonic-spectral-autodj"
if ((git branch --show-current).Trim() -ne "feat/spectral-autodj") { throw "Wrong branch." }
if (git status --porcelain=v1) { throw "Working tree must be clean." }
$base = "cd3c445637143eb0f05bb150e57f0544222fc84c"
$head = (git rev-parse HEAD).Trim()
"Review base: $base"
"Review HEAD: $head"
git diff --stat $base $head
```

Independent reviewer: name the **exact HEAD SHA** in every finding and use the above verified baseline. Prior reviews do not approve a new SHA.

## Request for Claude Code (READ-ONLY)

Review the complete experimental Spectral AutoDJ source-to-worker-to-result package AND the added per-source three-band DSP and local real-music blind A/B audition renderer against the base, upstream engineering rules and project requirements. **Do not edit or format files in write mode**, create commits/branches, open PRs, merge, deploy, access real music libraries, live databases or credentials, or make network requests. Report every finding with severity (Critical/High/Medium/Low), exact file/line, scenario, impact, fix and targeted regression. Distinguish actually run checks from inferred correctness. If no findings, summarize residual risks and unrun gates.

Investigate these risks in particular:

- Unarmed hot path must not copy audio buffers, fetch, decode, create a queue, change playback, write cache, alter settings, or add IPC.
- Trusted original provenance: the first-16KiB MD5 and supplied total byte count are **not** whole-file authentication. Check remote/original/transcoded, cached/preloaded bytes, positive local-original verification, partial spills, offline dual library/server and source revision changes.
- Race/cancellation: ordinary CPU and HTTP activity epoch, idle probing, speculative RAII slot, panics and detached JoinHandles, deadlines, A->B->A, server collisions, trusted generation replacement and one-time result use.
- Codec behavior: intro/outro seek, stereo anti-phase, 5.1/8-channel, Hi-Res, corrupt/silent audio, AAC PNS-on/off, VBR MP3 and missing Xing/LAME gapless metadata. Do not relax strict PCM policy.
- Rust audio-to-analysis crate public API, Tauri architecture, no realtime-thread blocking and protected playback-clock/normalization/crossfade behavior.
- Per-deck DSP correctness: complementary 180 Hz/3 kHz bands, 0 dB identity (bit-exact), smooth -4 to 0 dB bass restoration, filter-channel independence, no allocations/locks per sample, stream seek state, format/rate/channel stability, clips/denormals/NaNs and headroom. No existing user 10-band EQ or equal-power faders may be replaced.
- Local blind renderer: stereo/mono handling, simple resampling versus production SRC, original intro/outro accuracy, matching RMS loudness (not true LUFS), sampling/quantization, peak safety, silent/invalid inputs, randomized label/answer key, no overwrites or private paths, output directory separation and test-pair privacy.
- Scope honesty: the offline A/B renderer is intended for meaningful first listening trials on real local songs; live AutoDJ source hooks, a two-deck plan and per-transition player activation remain NOT implemented. Do not report production live audible activation as complete.
- Timings, queue contention and memory: raw process high-water working set is not isolated decoder allocation; require owner-hardware same-profile baseline comparisons.

Main paths: analysis crate spectral_autodj.rs and spectral_autodj/{integration,owned_source,scheduling,executor,lifecycle}.rs, analysis_runtime/{spectral_priority,trusted_revision,enqueue/offline}.rs; audio crate sources/spectral_eq.rs, spectral_audition.rs, bin/spectral_audition.rs, analysis_dispatch{,/file_dispatch}.rs, spectral_autodj_perf.rs; scripts/spectral-autodj-audition.ps1 and scripts/verify-spectral-autodj.ps1. Refer also to docs/spectral-autodj-listening.md.

## Consolidated owner QA (pending)

```powershell
.\scripts\verify-spectral-autodj.ps1 -ExpectedHead $head -IncludeBenchmarks
```

The script checks both Rust crates, strict Clippy, Rustfmt, TypeScript, frontend tests, ESLint/dependencies and synthetic/checked-in release decoder/FFT worker benchmarks. A Windows host without a usable POSIX Bash may explicitly add `-SkipBashDependentFlatpakTests` to execute all platform-applicable checks, but **four Flatpak Bash execution cases remain blocked** until Linux CI runs them; do not describe the full `npm test` gate as passed. It is not evidence of listening quality, real CPU contention or independent review. No private server or library details may be published.
