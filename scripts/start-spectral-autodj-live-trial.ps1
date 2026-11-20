# Starts a separate, development-only Spectral AutoDJ test profile.
# Does not alter installed Psysonic app settings, database or user 10-band EQ.
# Close any other Psysonic dev server before starting this app (Vite port 1420).
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ExpectedHead,
    [ValidateSet("baseline", "spectral")][string]$Variant = "baseline"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Push-Location $root

$oldValue = [Environment]::GetEnvironmentVariable(
    "PSYSONIC_SPECTRAL_AUTODJ_TRIAL", "Process"
)
try {
    if ((git branch --show-current).Trim() -ne "feat/spectral-autodj") {
        throw "Wrong branch: requires feat/spectral-autodj."
    }
    if ((git rev-parse HEAD).Trim() -ne $ExpectedHead) {
        throw "Unexpected SHA: stop and review before launching."
    }
    if (git status --porcelain=v1) {
        throw "Working tree must be clean before a listening trial."
    }
    if (!(Test-Path "src-tauri/tauri.spectral-trial.conf.json")) {
        throw "Missing isolated Tauri trial configuration."
    }

    if ($Variant -eq "spectral") {
        $value = "1"
    } else {
        $value = "0"
    }
    [Environment]::SetEnvironmentVariable(
        "PSYSONIC_SPECTRAL_AUTODJ_TRIAL", $value, "Process"
    )
    Write-Host "Launching isolated Psysonic Spectral Trial app profile." -ForegroundColor Cyan
    Write-Host "Mode: $Variant (process-only, not persisted)." -ForegroundColor Cyan
    Write-Host "Use matching track pair, queue order and volume for the two sessions."
    Write-Host "Spectral uses both current source spectra or falls back to normal AutoDJ."
    Write-Host "Do not open the normal app's existing profile/database in this test."
    & npm run tauri -- dev --config src-tauri/tauri.spectral-trial.conf.json
    if ($LASTEXITCODE -ne 0) {
        throw "Isolated Tauri dev session exited with code $LASTEXITCODE."
    }
}
finally {
    [Environment]::SetEnvironmentVariable(
        "PSYSONIC_SPECTRAL_AUTODJ_TRIAL", $oldValue, "Process"
    )
    Pop-Location
}
