@echo off
setlocal
set "VSCODE_FONT_PATCH_FILE=%~f0"
set "VSCODE_FONT_PATCH_MODE=apply"
if /i "%~1"=="check" set "VSCODE_FONT_PATCH_MODE=check"
if /i "%~1"=="restore" set "VSCODE_FONT_PATCH_MODE=restore"
if not "%~1"=="" if /i not "%~1"=="check" if /i not "%~1"=="restore" (
  echo Usage: "%~nx0" [check^|restore]
  exit /b 2
)
powershell.exe -NoLogo -NoProfile -Command "$parts=[regex]::Split([IO.File]::ReadAllText($env:VSCODE_FONT_PATCH_FILE),'(?m)^# POWERSHELL_PAYLOAD\r?\n',2); if($parts.Length -ne 2){exit 2}; & ([scriptblock]::Create($parts[1])) -Mode $env:VSCODE_FONT_PATCH_MODE"
set "VSCODE_FONT_PATCH_RESULT=%ERRORLEVEL%"
echo.
if /i not "%~1"=="check" pause
exit /b %VSCODE_FONT_PATCH_RESULT%
# POWERSHELL_PAYLOAD
param([ValidateSet('apply','check','restore')][string]$Mode='apply', [string]$AppRoot)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false, $true)

function Get-HashHex([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Get-Checksum([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($sha.ComputeHash($Bytes)).TrimEnd('=') }
    finally { $sha.Dispose() }
}

function Find-AppRoot {
    $roots = New-Object 'System.Collections.Generic.List[string]'
    $command = Get-Command code.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { $roots.Add((Split-Path (Split-Path $command.Source -Parent) -Parent)) }
    foreach ($process in @(Get-Process Code -ErrorAction SilentlyContinue)) {
        if ($process.Path) { $roots.Add((Split-Path $process.Path -Parent)) }
    }
    $roots.Add((Join-Path $env:LOCALAPPDATA 'Programs/Microsoft VS Code'))
    $roots.Add((Join-Path $env:ProgramFiles 'Microsoft VS Code'))
    if (${env:ProgramFiles(x86)}) { $roots.Add((Join-Path ${env:ProgramFiles(x86)} 'Microsoft VS Code')) }
    foreach ($install in @($roots | Select-Object -Unique)) {
        $launcher = Join-Path $install 'bin/code.cmd'
        if (Test-Path -LiteralPath $launcher) {
            $match = [regex]::Match([IO.File]::ReadAllText($launcher), '\.\.\\(?<middle>[^"\r\n]*?)resources\\app\\out\\cli\.js')
            if ($match.Success) {
                $candidate = Join-Path $install ($match.Groups['middle'].Value + 'resources/app')
                if (Test-Path -LiteralPath (Join-Path $candidate 'product.json')) { return [IO.Path]::GetFullPath($candidate) }
            }
        }
        $candidate = Join-Path $install 'resources/app'
        if (Test-Path -LiteralPath (Join-Path $candidate 'product.json')) { return [IO.Path]::GetFullPath($candidate) }
    }
    throw 'VS Code Stable was not found. Run this BAT on the computer where VS Code is installed.'
}

function Get-SafePath([string]$Root, [string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative)) { throw 'Invalid backup path.' }
    $full = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup path escapes its folder.' }
    return $full
}

try {
    if (-not $AppRoot) { $AppRoot = Find-AppRoot }
    $AppRoot = [IO.Path]::GetFullPath($AppRoot)
    $productPath = Join-Path $AppRoot 'product.json'
    $productBytes = [IO.File]::ReadAllBytes($productPath)
    $productText = $utf8.GetString($productBytes)
    $product = $productText | ConvertFrom-Json
    $backupBase = Join-Path $env:APPDATA 'Code/User/font-backups'
    Write-Host ('VS Code: ' + $AppRoot)
    Write-Host ('Mode: ' + $Mode)
    $changes = New-Object 'System.Collections.Generic.List[object]'

    if ($Mode -eq 'restore') {
        $selected = $null
        foreach ($folder in @(Get-ChildItem -LiteralPath $backupBase -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
            $manifestPath = Join-Path $folder.FullName 'manifest.json'
            if (-not (Test-Path -LiteralPath $manifestPath)) { continue }
            $manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
            if ([string]::Equals($manifest.install_root, $AppRoot, [StringComparison]::OrdinalIgnoreCase)) {
                $selected = $folder.FullName
                break
            }
        }
        if (-not $selected) { throw 'No backup was found for this exact VS Code installation.' }
        foreach ($entry in $manifest.files) {
            $target = Get-SafePath $AppRoot $entry.relative_path
            $backupFile = Get-SafePath $selected $entry.relative_path
            $current = [IO.File]::ReadAllBytes($target)
            $original = [IO.File]::ReadAllBytes($backupFile)
            if ((Get-HashHex $original) -ne $entry.original_sha256) { throw ('Damaged backup: ' + $entry.relative_path) }
            if ((Get-HashHex $current) -eq $entry.original_sha256) { continue }
            if ((Get-HashHex $current) -ne $entry.modified_sha256) { throw ('File changed since the patch; refusing to overwrite: ' + $entry.relative_path) }
            $changes.Add([pscustomobject]@{ relative_path=$entry.relative_path; original=$current; changed=$original })
        }
    } else {
        $fontFound = $false
        foreach ($hive in @('HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts', 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts')) {
            if (Test-Path -LiteralPath $hive) {
                $names = (Get-Item -LiteralPath $hive).GetValueNames()
                if ($names -match '^Vazirmatn(?:\s|\()') { $fontFound = $true }
            }
        }
        if (-not $fontFound) { throw 'Install the Vazirmatn font in Windows first, then run this BAT again.' }
        foreach ($area in @('workbench', 'sessions')) {
            $areaFolder = Join-Path $AppRoot ('out/vs/' + $area)
            if ($area -eq 'sessions' -and -not (Test-Path -LiteralPath $areaFolder)) { continue }
            foreach ($extension in @('js', 'css')) {
                $relative = 'out/vs/' + $area + '/' + $area + '.desktop.main.' + $extension
                $path = Join-Path $AppRoot $relative
                $original = [IO.File]::ReadAllBytes($path)
                $text = $utf8.GetString($original)
                $checksumKey = $relative.Substring(4)
                $checksumProperty = $product.checksums.PSObject.Properties[$checksumKey]
                if (-not $checksumProperty -or (Get-Checksum $original) -ne $checksumProperty.Value) {
                    throw ('Existing file checksum differs from VS Code metadata: ' + $relative)
                }
                if ($extension -eq 'js') {
                    $old = '''"Segoe WPC", "Segoe UI", sans-serif'''
                    $new = '''"Vazirmatn", "Segoe WPC", "Segoe UI", sans-serif'''
                    if ([regex]::Matches($text, [regex]::Escape($new)).Count -eq 1) { continue }
                    if ([regex]::Matches($text, [regex]::Escape($old)).Count -ne 1) {
                        throw ('This VS Code version changed its font implementation. No files were changed: ' + $relative)
                    }
                    $updated = $text.Replace($old, $new)
                } else {
                    $pattern = '(\.monaco-workbench\.windows\{font-family:)([^;}]+)'
                    $matches = [regex]::Matches($text, $pattern)
                    if ($matches.Count -ne 1) { throw ('Unsupported CSS structure. No files were changed: ' + $relative) }
                    $match = $matches[0]
                    if ($match.Groups[2].Value -match '^(?:"?Vazirmatn"?),') { continue }
                    $replacement = $match.Groups[1].Value + 'Vazirmatn,' + $match.Groups[2].Value
                    $updated = $text.Substring(0, $match.Index) + $replacement + $text.Substring($match.Index + $match.Length)
                }
                $changed = $utf8.GetBytes($updated)
                $oldHash = '"' + $checksumProperty.Value + '"'
                $newHash = '"' + (Get-Checksum $changed) + '"'
                if ([regex]::Matches($productText, [regex]::Escape($oldHash)).Count -ne 1) { throw 'Ambiguous checksum entry.' }
                $productText = $productText.Replace($oldHash, $newHash)
                $changes.Add([pscustomobject]@{ relative_path=$relative; original=$original; changed=$changed })
            }
        }
        if ($changes.Count -gt 0) {
            $null = $productText | ConvertFrom-Json
            $changes.Add([pscustomobject]@{ relative_path='product.json'; original=$productBytes; changed=$utf8.GetBytes($productText) })
        }
    }

    if ($changes.Count -eq 0) {
        if ($Mode -eq 'restore') { Write-Host 'Original files are already restored.' -ForegroundColor Green }
        else { Write-Host 'Vazirmatn is already applied to the input box and sidebar.' -ForegroundColor Green }
        exit 0
    }
    foreach ($change in $changes) { Write-Host ('  ' + $change.relative_path) }
    if ($Mode -eq 'check') { Write-Host 'Patch is supported. Check completed without changing files.'; exit 0 }
    foreach ($change in $changes) {
        $stream = [IO.File]::Open((Join-Path $AppRoot $change.relative_path), 'Open', 'ReadWrite', 'ReadWrite')
        $stream.Dispose()
    }

    if ($Mode -eq 'apply') {
        $version = Split-Path (Split-Path (Split-Path $AppRoot -Parent) -Parent) -Leaf
        $backup = Join-Path $backupBase ($version + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
        $null = New-Item -ItemType Directory -Path $backup
        $entries = @()
        foreach ($change in $changes) {
            $destination = Get-SafePath $backup $change.relative_path
            $null = New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force
            [IO.File]::WriteAllBytes($destination, $change.original)
            if ((Get-HashHex ([IO.File]::ReadAllBytes($destination))) -ne (Get-HashHex $change.original)) { throw 'Backup verification failed.' }
            $entries += [ordered]@{ relative_path=$change.relative_path; original_sha256=(Get-HashHex $change.original); modified_sha256=(Get-HashHex $change.changed) }
        }
        $manifestText = [ordered]@{ font='Vazirmatn'; install_root=$AppRoot; files=$entries } | ConvertTo-Json -Depth 5
        [IO.File]::WriteAllText((Join-Path $backup 'manifest.json'), $manifestText, $utf8)
        Write-Host ('Backup: ' + $backup)
    }

    $written = New-Object 'System.Collections.Generic.List[object]'
    try {
        foreach ($change in $changes) {
            $target = Join-Path $AppRoot $change.relative_path
            if ((Get-HashHex ([IO.File]::ReadAllBytes($target))) -ne (Get-HashHex $change.original)) { throw ('File changed during patch: ' + $change.relative_path) }
            $written.Add($change)
            [IO.File]::WriteAllBytes($target, $change.changed)
            if ((Get-HashHex ([IO.File]::ReadAllBytes($target))) -ne (Get-HashHex $change.changed)) { throw 'Write verification failed.' }
        }
    } catch {
        foreach ($change in $written) { [IO.File]::WriteAllBytes((Join-Path $AppRoot $change.relative_path), $change.original) }
        throw
    }
    Write-Host 'Success. In VS Code run: Developer: Reload Window' -ForegroundColor Green
    Write-Host 'Reapply this BAT after a VS Code update. To undo: run this BAT with restore.'
    exit 0
} catch {
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    if ($_.Exception -is [UnauthorizedAccessException] -or $_.Exception.InnerException -is [UnauthorizedAccessException]) {
        Write-Host 'Right-click this BAT and choose Run as administrator.'
    }
    exit 1
}
