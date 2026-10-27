#requires -Version 7.0
param(
    [Parameter(Mandatory)][string]$PackagePath,
    [Parameter(Mandatory)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$filename = "rtl-cursor-$version.vsix"
if ((Split-Path $PackagePath -Leaf) -ne $filename) { throw 'Package filename and version differ' }

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $PackagePath))
try {
    foreach ($entry in $archive.Entries) {
        if ($entry.FullName -match '^extension/(\.github|\.git|tests|scripts|src|node_modules|releases)/|\.(map|vsix)$') {
            throw "Development or old installer file included: $($entry.FullName)"
        }
    }
    foreach ($file in @('package.json', 'readme.md', 'dist/extension.js', 'dist/uninstall.js',
        'resources/rtl.js', 'resources/rtl-cursor-loader.cjs', 'resources/rtl-vscode-native.cjs',
        'resources/rtl-cursor-watch.ps1', 'resources/rtl-cursor-watch.vbs',
        'resources/markdown-preview-rtl.css', 'resources/icon.png', 'LICENSE.txt', 'NOTICE',
        'resources/fonts/OFL.txt', 'resources/fonts/Vazirmatn-Regular.ttf', 'resources/fonts/Vazirmatn-Bold.ttf')) {
        $entry = $archive.GetEntry("extension/$file")
        if (-not $entry) { throw "Required package file missing: $file" }
        $stream = $entry.Open()
        $hash = [System.Security.Cryptography.SHA256]::Create()
        try { $actual = [Convert]::ToHexString($hash.ComputeHash($stream)) }
        finally { $stream.Dispose(); $hash.Dispose() }
        if ($actual -ne (Get-FileHash (Join-Path $root $file) -Algorithm SHA256).Hash) {
            throw "Packaged bytes differ from the release source: $file"
        }
    }
} finally { $archive.Dispose() }

$localizedVersion = -join ($version.ToCharArray() | ForEach-Object {
    if ($_ -match '[0-9]') { [char](0x06F0 + [int]::Parse([string]$_)) } else { $_ }
})
$readme = Get-Content (Join-Path $root 'readme.md') -Raw -Encoding utf8
$pattern = '(?ms)^## تغییرات نسخه (?:' + [regex]::Escape($version) + '|' + [regex]::Escape($localizedVersion) + ')\r?\n(?<notes>.*?)(?=^## |\z)'
$notes = [regex]::Match($readme, $pattern)
if (-not $notes.Success -or -not $notes.Groups['notes'].Value.Trim()) { throw "Release notes missing for $version" }

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
Copy-Item -LiteralPath $PackagePath -Destination (Join-Path $OutputDirectory $filename)
Copy-Item -LiteralPath (Join-Path $root 'scripts/update-agent-watcher.ps1') -Destination $OutputDirectory
$sums = foreach ($file in @($filename, 'update-agent-watcher.ps1')) {
    $digest = (Get-FileHash (Join-Path $OutputDirectory $file) -Algorithm SHA256).Hash.ToLowerInvariant()
    "$digest  $file"
}
$sums | Set-Content (Join-Path $OutputDirectory 'SHA256SUMS.txt') -Encoding utf8NoBOM
$validation = @"

Built and validated by GitHub Actions from commit $env:GITHUB_SHA.

Validation: JavaScript regression tests, Windows watcher and migration checks, real Chromium/Monaco tests with official VS Code Agents CSS, and VSIX content/license verification.

Install $filename, then completely exit every VS Code/Agents window and reopen. Reload Window alone does not refresh the Electron loader. Existing same-version installations need an explicit reinstall. The migration helper is for existing Cursor Agent-only users. Font preferences are preserved.

[Build and validation run](https://github.com/$env:GITHUB_REPOSITORY/actions/runs/$env:GITHUB_RUN_ID)
"@
($notes.Groups['notes'].Value.Trim() + "`n" + $validation) | Set-Content (Join-Path $OutputDirectory 'release-notes.md') -Encoding utf8NoBOM
Write-Output "Verified $filename and prepared release assets."
