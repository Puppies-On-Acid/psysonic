# Unified owner Windows verification for the experimental Spectral AutoDJ
# integration candidate. No checkout, git writes, private media, downloads,
# Tauri startup, live database, branch mutation or PR operations occur here.
param(
    [Parameter(Mandatory = $true)]
    [string]$ExpectedHead,

    [switch]$IncludeBenchmarks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$failures = New-Object 'System.Collections.Generic.List[string]'

Set-Location $repo
$branch = (git branch --show-current).Trim()
$head = (git rev-parse HEAD).Trim()
if ($branch -ne "feat/spectral-autodj") {
    throw "Wrong branch: $branch"
}
if ($head -ne $ExpectedHead) {
    throw "Wrong SHA: $head (expected $ExpectedHead)"
}
if (git status --porcelain=v1) {
    throw "Working tree is not clean. Stop before running commands."
}

function Run-Check {
    param(
        [string]$Name,
        [scriptblock]$Command
    )
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    & $Command
    $exit = $LASTEXITCODE
    if ($exit -ne 0) {
        Write-Host "FAILED: $Name ($exit)" -ForegroundColor Yellow
        $script:failures.Add("$Name ($exit)")
    } else {
        Write-Host "PASSED: $Name" -ForegroundColor Green
    }
}

Push-Location "src-tauri"
try {
    Run-Check "Rustfmt workspace" {
        cargo fmt --all --check
    }
    Run-Check "Rust analysis library" {
        cargo test -p psysonic-analysis --lib --quiet
    }
    Run-Check "Rust audio library" {
        cargo test -p psysonic-audio --lib --quiet
    }
    Run-Check "Strict analysis and audio Clippy" {
        cargo clippy -p psysonic-analysis -p psysonic-audio --all-targets -- -D warnings
    }
    if ($IncludeBenchmarks) {
        Run-Check "Release decode + spectral FFT and working-set probe" {
            cargo test -p psysonic-analysis --release --lib spectral_autodj_existing_codec_end_to_end_probe -- --ignored --nocapture --test-threads=1
        }
        Run-Check "Release PCM-only FFT baseline characterization" {
            cargo test -p psysonic-analysis --release --lib spectral_autodj_offline_cpu_probe -- --ignored --nocapture --test-threads=1
        }
    }
}
finally {
    Pop-Location
}

Run-Check "TypeScript type check" {
    npx tsc --noEmit
}
Run-Check "Frontend tests and graph checks" {
    npm test
}
Run-Check "Frontend lint" {
    npm run lint
}
Run-Check "Dependency architecture" {
    npm run dep:check
}

if (git status --porcelain=v1) {
    $failures.Add("Working tree changed during verification")
}
if ((git rev-parse HEAD).Trim() -ne $ExpectedHead) {
    $failures.Add("HEAD changed during verification")
}

Write-Host "`n=== PSY-016 CONSOLIDATED RESULT ===" -ForegroundColor Cyan
Write-Host "HEAD: $((git rev-parse HEAD).Trim())"
git status -sb
if ($failures.Count -gt 0) {
    $failures | ForEach-Object { Write-Host "FAILED: $_" -ForegroundColor Yellow }
    throw "$($failures.Count) verification gate(s) failed; send the full output."
}
Write-Host "ALL SELECTED CHECKS PASSED" -ForegroundColor Green
