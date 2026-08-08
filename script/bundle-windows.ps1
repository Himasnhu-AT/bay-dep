# Build a distributable bay for Windows.
#
#   .\script\bundle-windows.ps1              -> rust\target\release\bundle\windows\bay\
#   .\script\bundle-windows.ps1 -Zip         -> ...and bay-<version>-windows-x64.zip
#   .\script\bundle-windows.ps1 -SignThumbprint <sha1>
#
# Must run ON Windows. GPUI's Windows backend needs the Windows SDK and DirectX headers, so
# cross-compiling from macOS or Linux does not work — the release workflow uses a windows
# runner for exactly this reason.
#
# The output is a single bay.exe. The MCP server is the same binary (`bay --mcp`) and the
# Kokoro sidecar is compiled into it, so there is nothing to keep alongside it and nothing to
# lose in a copy. No installer on purpose: an .exe you can run has no failure modes, and an MSI
# is worth building only once there is something to install *into* (file associations, a
# per-user update channel). See todo.pending.md.
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
$Stage = Join-Path $Out "bay"

Write-Host "-- building bay $Version for x86_64-pc-windows-msvc --"
Push-Location rust
cargo build --release --target x86_64-pc-windows-msvc -p bay-desktop
Pop-Location

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

Copy-Item "rust\target\x86_64-pc-windows-msvc\release\bay.exe" $Stage

@"
bay — a native video editor, and the same engine as an MCP server.

  bay.exe              the editor
  bay.exe --mcp        the same engine headless, for agents
  bay.exe --help       every flag

YOU DO NOT NEED TO INSTALL ANYTHING ELSE.
  bay fetches what it needs itself, when you ask it to, from builds pinned and
  hash-verified inside the exe:

    video tools (ffmpeg, ~57 MB)   needed to decode, probe and export
    narration (Python + Kokoro)    optional, ~1.2 GB, only for spoken narration

  Start bay and it will tell you what is missing and offer to install it. Nothing
  downloads unless you ask. If you already have a recent ffmpeg on PATH, bay uses
  that instead and offers nothing.

REQUIREMENTS
  a GPU            the compositor (Direct3D 12). The one thing bay cannot install.

Version $Version
"@ | Set-Content -Path (Join-Path $Stage "README.txt") -Encoding UTF8

if ($SignThumbprint) {
    Write-Host "-- signing --"
    # Timestamped so the signature stays valid after the certificate expires.
    & signtool sign /sha1 $SignThumbprint /fd SHA256 /tr http://timestamp.digicert.com `
        /td SHA256 (Join-Path $Stage "bay.exe")
    if ($LASTEXITCODE -ne 0) { throw "signtool failed" }
} else {
    Write-Host "  (unsigned - SmartScreen will warn on first run; pass -SignThumbprint to sign)"
}

Write-Host "-- $Stage --"
Get-ChildItem $Stage | Format-Table Name, Length

if ($Zip) {
    $ZipPath = Join-Path $Out "bay-$Version-windows-x64.zip"
    if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
    Compress-Archive -Path $Stage -DestinationPath $ZipPath
    Write-Host "-- $ZipPath --"
}
