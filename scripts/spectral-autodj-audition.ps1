# Local blind A/B listening-test batch. No playback, network or database changes.
# Music is read from explicit owner-selected files. Rendered WAVs stay outside
# the public Psysonic checkout. Do not publish your local source filenames.
[CmdletBinding()]
param(
    [string]$Outgoing,
    [string]$Incoming,
    [string]$PairsCsv,
    [Parameter(Mandatory = $true)][string]$OutputDir,
    [Parameter(Mandatory = $true)][string]$ExpectedHead,
    [ValidateRange(1.0, 5.0)][double]$OverlapSec = 3.5
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$destination = [IO.Path]::GetFullPath($OutputDir)
$separator = [IO.Path]::DirectorySeparatorChar
if ($destination.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
    $destination.StartsWith("$root$separator", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Audition output must be OUTSIDE the public Git repository."
}
if ([bool]$PairsCsv -eq ([bool]$Outgoing -and [bool]$Incoming)) {
    throw "Provide either -PairsCsv, or both -Outgoing and -Incoming (not both)."
}
if ($PairsCsv -and ($Outgoing -or $Incoming)) {
    throw "Cannot combine CSV and individual file arguments."
}

Push-Location $root
try {
    if ((git branch --show-current).Trim() -ne "feat/spectral-autodj") {
        throw "Wrong feature branch."
    }
    if ((git rev-parse HEAD).Trim() -ne $ExpectedHead) {
        throw "Unexpected HEAD. Verify the feature branch before the audition."
    }
    if (git status --porcelain=v1) {
        throw "Working tree is not clean."
    }

    Push-Location "src-tauri"
    try {
        cargo build --release -p psysonic-audio --bin spectral_audition
        if ($LASTEXITCODE -ne 0) { throw "Audition renderer failed to build." }
    }
    finally {
        Pop-Location
    }

    $extension = if ($env:OS -eq "Windows_NT") { ".exe" } else { "" }
    $binary = Join-Path $root "src-tauri\target\release\spectral_audition$extension"
    if (!(Test-Path -LiteralPath $binary)) { throw "Renderer binary was not found." }

    [void][IO.Directory]::CreateDirectory($destination)
    if ($PairsCsv) {
        $rows = @(Import-Csv -LiteralPath $PairsCsv)
        if ($rows.Count -eq 0) { throw "CSV contains no listening pairs." }
        if ($rows.Count -gt 100) { throw "Batch is limited to 100 pairs." }

        $template = New-Object 'System.Collections.Generic.List[object]'
        $index = 0
        foreach ($row in $rows) {
            $index++
            $pairName = "Pair_{0:D3}" -f $index
            $folder = Join-Path $destination $pairName
            if (!(Test-Path -LiteralPath $row.Outgoing) -or
                !(Test-Path -LiteralPath $row.Incoming)) {
                throw "Pair #$index contains a missing source file."
            }
            $duration = $OverlapSec
            if ($row.PSObject.Properties.Name -contains "OverlapSec" -and $row.OverlapSec) {
                $duration = [double]::Parse($row.OverlapSec, [Globalization.CultureInfo]::InvariantCulture)
            }
            $randomSeed = Get-Random -Minimum 1 -Maximum 2147483646
            & $binary --outgoing $row.Outgoing --incoming $row.Incoming --output $folder --overlap $duration --seed $randomSeed
            if ($LASTEXITCODE -ne 0) { throw "Rendering failed for pair #$index." }

            $template.Add([PSCustomObject]@{
                Pair = $pairName
                Genre = ""
                Sample1Rating = ""
                Sample2Rating = ""
                Preferred = ""
                ClicksOrArtifacts = ""
                Comments = ""
            })
            Write-Host "Rendered $pairName" -ForegroundColor Green
        }
        $template | Export-Csv -LiteralPath (Join-Path $destination "BLIND_RATINGS.csv") -NoTypeInformation -Encoding UTF8
        Write-Host "Rendered $index pairs. Rate Sample_1 vs Sample_2 before opening any answer key."
    }
    else {
        $seed = Get-Random -Minimum 1 -Maximum 2147483646
        & $binary --outgoing $Outgoing --incoming $Incoming --output $destination --overlap $OverlapSec --seed $seed
        if ($LASTEXITCODE -ne 0) { throw "Rendering failed." }
        Write-Host "Rate both WAV files before opening ANSWER_KEY.txt."
    }
    Write-Host "All output is local and outside the Git checkout." -ForegroundColor Green
}
finally {
    Pop-Location
}
