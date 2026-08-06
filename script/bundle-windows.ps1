# Build a distributable vii for Windows.
#
#   .\script\bundle-windows.ps1              -> rust\target\release\bundle\windows\vii\
#   .\script\bundle-windows.ps1 -Zip         -> ...and vii-<version>-windows-x64.zip
#   .\script\bundle-windows.ps1 -SignThumbprint <sha1>
#
# Must run ON Windows. GPUI's Windows backend needs the Windows SDK and DirectX headers, so
# cross-compiling from macOS or Linux does not work — the release workflow uses a windows
# runner for exactly this reason.
#
# There is no installer here on purpose: a folder you can unzip and run has no failure modes,
# and an MSI is worth building only once there is something to install *into* (file
# associations, a per-user update channel). See todo.md.
param(
    [switch]$Zip,
    [string]$SignThumbprint = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Version = (Select-String -Path "rust\desktop\Cargo.toml" -Pattern '^version' |
    Select-Object -First 1).Line.Split('"')[1]
$Out = "rust\target\release\bundle\windows"
$Stage = Join-Path $Out "vii"

Write-Host "-- building vii $Version for x86_64-pc-windows-msvc --"
Push-Location rust
cargo build --release --target x86_64-pc-windows-msvc -p vii-desktop -p vii-mcp
Pop-Location

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

Copy-Item "rust\target\x86_64-pc-windows-msvc\release\vii.exe" $Stage
Copy-Item "rust\target\x86_64-pc-windows-msvc\release\vii-mcp.exe" $Stage

# The speech sidecar sits next to the executable; vii-speech looks there at runtime, because a
# path compiled in from the build machine means nothing on someone else's computer.
Copy-Item "script\vii-kokoro.py" $Stage

@"
vii — a native video editor, and the same engine as an MCP server.

  vii.exe          the editor
  vii-mcp.exe      the engine headless, for agents (see README)
  vii-kokoro.py    the text-to-speech sidecar

REQUIREMENTS
  ffmpeg on PATH   decode, probing, MP4 export.  https://ffmpeg.org/download.html
  a GPU            the compositor (Direct3D 12)

Narration additionally needs Python 3.12 with the `kokoro` package. vii reports what is
missing rather than failing silently, so start it and see what it says.

Version $Version
"@ | Set-Content -Path (Join-Path $Stage "README.txt") -Encoding UTF8

if ($SignThumbprint) {
    Write-Host "-- signing --"
    # Timestamped so the signature stays valid after the certificate expires.
    foreach ($exe in @("vii.exe", "vii-mcp.exe")) {
        & signtool sign /sha1 $SignThumbprint /fd SHA256 /tr http://timestamp.digicert.com `
            /td SHA256 (Join-Path $Stage $exe)
        if ($LASTEXITCODE -ne 0) { throw "signtool failed for $exe" }
    }
} else {
    Write-Host "  (unsigned - SmartScreen will warn on first run; pass -SignThumbprint to sign)"
}

Write-Host "-- $Stage --"
Get-ChildItem $Stage | Format-Table Name, Length

if ($Zip) {
    $ZipPath = Join-Path $Out "vii-$Version-windows-x64.zip"
    if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
    Compress-Archive -Path $Stage -DestinationPath $ZipPath
    Write-Host "-- $ZipPath --"
}
