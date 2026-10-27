#requires -Version 7.0
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$monaco = (Resolve-Path .github/ci/node_modules/monaco-editor).Path
$chromium = @(Get-ChildItem $env:PLAYWRIGHT_BROWSERS_PATH -Recurse -File -Filter chrome-headless-shell.exe)
if ($chromium.Count -ne 1) { throw 'Expected exactly one installed Chromium headless shell' }

# Read the actual workbench CSS from Microsoft's archive without installing or
# launching VS Code. These test dependencies never enter the shipped VSIX.
$metadata = Invoke-RestMethod 'https://update.code.visualstudio.com/api/update/win32-x64-archive/stable/latest'
$zipPath = Join-Path $env:RUNNER_TEMP 'vscode-test.zip'
Invoke-WebRequest $metadata.url -OutFile $zipPath
if ($metadata.sha256hash -and (Get-FileHash $zipPath -Algorithm SHA256).Hash -ne $metadata.sha256hash) {
    throw 'VS Code archive checksum mismatch'
}
$cssPath = Join-Path $env:RUNNER_TEMP 'sessions.desktop.main.css'
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entries = @($archive.Entries | Where-Object { $_.FullName -match '(^|/)resources/app/out/vs/sessions/sessions\.desktop\.main\.css$' })
    if ($entries.Count -ne 1) { throw 'The official VS Code archive must contain the Agents workbench CSS' }
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $cssPath, $true)
} finally { $archive.Dispose() }

"MONACO_TEST_DIR=$monaco" >> $env:GITHUB_ENV
"CHROMIUM_PATH=$($chromium[0].FullName)" >> $env:GITHUB_ENV
"RTL_VSCODE_CSS_PATH=$cssPath" >> $env:GITHUB_ENV
"Browser tests use official Monaco 0.57.0 and VS Code $($metadata.productVersion) Agents CSS." >> $env:GITHUB_STEP_SUMMARY
