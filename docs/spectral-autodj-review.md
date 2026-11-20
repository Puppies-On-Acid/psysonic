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

Review the complete experimental Spectral AutoDJ source-to-worker-to-result package against the base, upstream engineering rules and project requirements. **Do not edit or format files in write mode**, create commits/branches, open PRs, merge, deploy, access real music libraries, live databases or credentials, or make network requests. Report every finding with severity (Critical/High/Medium/Low), exact file/line, scenario, impact, fix and targeted regression. Distinguish actually run checks from inferred correctness. If no findings, summarize residual risks and unrun gates.

Investigate these risks in particular:

- Unarmed hot path must not copy audio buffers, fetch, decode, create a queue, change playback, write cache, alter settings, or add IPC.
- Trusted original provenance: the first-16KiB MD5 and supplied total byte count are **not** whole-file authentication. Check remote/original/transcoded, cached/preloaded bytes, positive local-original verification, partial spills, offline dual library/server and source revision changes.
- Race/cancellation: ordinary CPU and HTTP activity epoch, idle probing, speculative RAII slot, panics and detached JoinHandles, deadlines, A->B->A, server collisions, trusted generation replacement and one-time result use.
- Codec behavior: intro/outro seek, stereo anti-phase, 5.1/8-channel, Hi-Res, corrupt/silent audio, AAC PNS-on/off, VBR MP3 and missing Xing/LAME gapless metadata. Do not relax strict PCM policy.
- Rust audio-to-analysis crate public API, Tauri architecture, no realtime-thread blocking and protected playback-clock/normalization/crossfade behavior.
- Timings, queue contention and memory: raw process high-water working set is not isolated decoder allocation; require owner-hardware same-profile baseline comparisons.

Main paths: analysis crate spectral_autodj/{integration,owned_source,scheduling,executor,lifecycle}.rs, analysis_runtime/{spectral_priority,trusted_revision,enqueue/offline}.rs, audio crate analysis_dispatch{,/file_dispatch}.rs, spectral_autodj_perf.rs and scripts/verify-spectral-autodj.ps1.

## Consolidated owner QA (pending)

```powershell
.\scripts\verify-spectral-autodj.ps1 -ExpectedHead $head -IncludeBenchmarks
```

The script checks both Rust crates, strict Clippy, Rustfmt, TypeScript, frontend tests, ESLint/dependencies and synthetic/checked-in release decoder/FFT worker benchmarks. A Windows host without a usable POSIX Bash may explicitly add `-SkipBashDependentFlatpakTests` to execute all platform-applicable checks, but **four Flatpak Bash execution cases remain blocked** until Linux CI runs them; do not describe the full `npm test` gate as passed. It is not evidence of listening quality, real CPU contention or independent review. No private server or library details may be published.
