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

function Get-JsoncTokens([string]$Text) {
    $pattern = '"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|//[^\r\n]*|/\*[\s\S]*?\*/|\s+|[{}\[\]:,]|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null'
    $position = 0
    $tokens = New-Object 'System.Collections.Generic.List[object]'
    foreach ($token in [regex]::Matches($Text, $pattern)) {
        if ($token.Index -ne $position) { throw 'Invalid user settings JSON. No files were changed.' }
        $position = $token.Index + $token.Length
        if ($token.Value -match '^\s|^//|^/\*') { continue }
        $tokens.Add($token)
    }
    if ($position -ne $Text.Length -or $tokens.Count -lt 2 -or $tokens[0].Value -ne '{' -or $tokens[$tokens.Count-1].Value -ne '}') {
        throw 'User settings must contain one JSON object. No files were changed.'
    }
    $normalized = New-Object Text.StringBuilder
    for ($i = 0; $i -lt $tokens.Count; $i++) {
        if ($tokens[$i].Value -eq ',' -and $i+1 -lt $tokens.Count -and $tokens[$i+1].Value -in @('}', ']')) { continue }
        $null = $normalized.Append($tokens[$i].Value)
    }
    $null = $normalized.ToString() | ConvertFrom-Json
    return ,$tokens
}

function Set-FontSettingsText([string]$Text) {
    $prefix = ''
    if ($Text.Length -gt 0 -and $Text[0] -eq [char]0xFEFF) { $prefix = [string][char]0xFEFF; $Text = $Text.Substring(1) }
    $tokens = Get-JsoncTokens $Text
    $desired = [ordered]@{
        'editor.fontFamily' = "'Vazirmatn', Consolas, 'Courier New', monospace"
        'chat.fontFamily' = 'Vazirmatn'
        'chat.editor.fontFamily' = "'Vazirmatn', Consolas, 'Courier New', monospace"
    }
    $found = @{}
    $edits = New-Object 'System.Collections.Generic.List[object]'
    $depth = 0
    for ($i = 0; $i -lt $tokens.Count; $i++) {
        $token = $tokens[$i]
        if ($token.Value -in @('{', '[')) { $depth++; continue }
        if ($token.Value -in @('}', ']')) { $depth--; continue }
        if ($depth -ne 1 -or -not $token.Value.StartsWith('"') -or $i+2 -ge $tokens.Count -or $tokens[$i+1].Value -ne ':') { continue }
        $key = $token.Value | ConvertFrom-Json
        if (-not $desired.Contains($key)) { continue }
        if ($found.ContainsKey($key)) { throw ('Duplicate font setting: ' + $key) }
        $found[$key] = $true
        $valueStart = $i+2
        $valueEnd = $valueStart
        if ($tokens[$valueStart].Value -in @('{', '[')) {
            $valueDepth = 0
            for ($j = $valueStart; $j -lt $tokens.Count; $j++) {
                if ($tokens[$j].Value -in @('{', '[')) { $valueDepth++ }
                if ($tokens[$j].Value -in @('}', ']')) { $valueDepth-- }
                if ($valueDepth -eq 0) { $valueEnd = $j; break }
            }
        }
        $start = $tokens[$valueStart].Index
        $length = $tokens[$valueEnd].Index + $tokens[$valueEnd].Length - $start
        $currentValue = $Text.Substring($start, $length)
        if ($tokens[$valueStart].Value.StartsWith('"') -and ($currentValue | ConvertFrom-Json) -eq $desired[$key]) { continue }
        $replacement = ConvertTo-Json -InputObject $desired[$key] -Compress
        $edits.Add([pscustomobject]@{ start=$start; length=$length; text=$replacement })
    }
    $missing = @($desired.Keys | Where-Object { -not $found.ContainsKey($_) })
    if ($missing.Count -gt 0) {
        $newline = "`n"
        if ($Text.Contains("`r`n")) { $newline = "`r`n" }
        $previous = $tokens[$tokens.Count-2]
        $leadingComma = ''
        if ($previous.Value -notin @('{', ',')) {
            if ($previous.Index+$previous.Length -eq $tokens[$tokens.Count-1].Index) { $leadingComma = ',' }
            else { $edits.Add([pscustomobject]@{ start=($previous.Index+$previous.Length); length=0; text=',' }) }
        }
        $lines = @($missing | ForEach-Object {
            '    ' + (ConvertTo-Json -InputObject $_ -Compress) + ': ' + (ConvertTo-Json -InputObject $desired[$_] -Compress)
        })
        $edits.Add([pscustomobject]@{ start=$tokens[$tokens.Count-1].Index; length=0; text=($leadingComma+$newline+($lines -join (','+$newline))+$newline) })
    }
    foreach ($edit in @($edits | Sort-Object start, length -Descending)) {
        $Text = $Text.Substring(0, $edit.start) + $edit.text + $Text.Substring($edit.start+$edit.length)
    }
    $null = Get-JsoncTokens $Text
    return $prefix + $Text
}

function Get-ChangeTarget($Change) {
    if ($Change.scope -eq 'settings') { return $settingsPath }
    return Get-SafePath $AppRoot $Change.relative_path
}

try {
    if (-not $AppRoot) { $AppRoot = Find-AppRoot }
    $AppRoot = [IO.Path]::GetFullPath($AppRoot)
    $productPath = Join-Path $AppRoot 'product.json'
    $productBytes = [IO.File]::ReadAllBytes($productPath)
    $productText = $utf8.GetString($productBytes)
    $product = $productText | ConvertFrom-Json
    $backupBase = Join-Path $env:APPDATA 'Code/User/font-backups'
    $settingsPath = Join-Path $env:APPDATA 'Code/User/settings.json'
    Write-Host ('VS Code: ' + $AppRoot)
    Write-Host ('Mode: ' + $Mode)
    $changes = New-Object 'System.Collections.Generic.List[object]'

    if ($Mode -eq 'restore') {
        $restoreEntries = @{}
        foreach ($folder in @(Get-ChildItem -LiteralPath $backupBase -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)) {
            $manifestPath = Join-Path $folder.FullName 'manifest.json'
            if (-not (Test-Path -LiteralPath $manifestPath)) { continue }
            $manifest = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
            if ([string]::Equals($manifest.install_root, $AppRoot, [StringComparison]::OrdinalIgnoreCase)) {
                foreach ($entry in $manifest.files) {
                    if ($entry.scope -eq 'settings' -and -not [string]::Equals($manifest.settings_path, $settingsPath, [StringComparison]::OrdinalIgnoreCase)) { continue }
                    $entryKey = [string]$entry.scope + ':' + $entry.relative_path
                    if (-not $entry.scope) { $entryKey = 'app:' + $entry.relative_path }
                    if (-not $restoreEntries.ContainsKey($entryKey)) {
                        $restoreEntries[$entryKey] = [pscustomobject]@{ entry=$entry; folder=$folder.FullName }
                    }
                }
            }
        }
        if ($restoreEntries.Count -eq 0) { throw 'No backup was found for this exact VS Code installation.' }
        foreach ($record in $restoreEntries.Values) {
            $entry = $record.entry
            $target = Get-ChangeTarget $entry
            $backupFile = Get-SafePath $record.folder $entry.relative_path
            $current = [IO.File]::ReadAllBytes($target)
            $original = [IO.File]::ReadAllBytes($backupFile)
            if ((Get-HashHex $original) -ne $entry.original_sha256) { throw ('Damaged backup: ' + $entry.relative_path) }
            if ((Get-HashHex $current) -eq $entry.original_sha256) { continue }
            if ((Get-HashHex $current) -ne $entry.modified_sha256) { throw ('File changed since the patch; refusing to overwrite: ' + $entry.relative_path) }
            $changes.Add([pscustomobject]@{ relative_path=$entry.relative_path; scope=$entry.scope; original=$current; changed=$original; existed=$true })
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
        $settingsExisted = Test-Path -LiteralPath $settingsPath
        if ($settingsExisted) { $settingsOriginal = [IO.File]::ReadAllBytes($settingsPath) }
        else { $settingsOriginal = $utf8.GetBytes('{}') }
        $settingsText = $utf8.GetString($settingsOriginal)
        $settingsUpdated = Set-FontSettingsText $settingsText
        if ($settingsText -cne $settingsUpdated) {
            $changes.Add([pscustomobject]@{ relative_path='settings/user-settings.json'; scope='settings'; original=$settingsOriginal; changed=$utf8.GetBytes($settingsUpdated); existed=$settingsExisted })
        }
    }

    if ($changes.Count -eq 0) {
        if ($Mode -eq 'restore') { Write-Host 'Original files are already restored.' -ForegroundColor Green }
        else { Write-Host 'Vazirmatn is already applied to the UI, input box, chat, editor and chat code blocks.' -ForegroundColor Green }
        exit 0
    }
    foreach ($change in $changes) { Write-Host ('  ' + $change.relative_path) }
    if ($Mode -eq 'check') { Write-Host 'Patch is supported. Check completed without changing files.'; exit 0 }
    foreach ($change in $changes) {
        $target = Get-ChangeTarget $change
        if ($change.scope -eq 'settings' -and -not $change.existed) { continue }
        $stream = [IO.File]::Open($target, 'Open', 'ReadWrite', 'ReadWrite')
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
            $scope = 'app'
            if ($change.scope -eq 'settings') { $scope = 'settings' }
            $entries += [ordered]@{ relative_path=$change.relative_path; scope=$scope; original_sha256=(Get-HashHex $change.original); modified_sha256=(Get-HashHex $change.changed) }
        }
        $manifestText = [ordered]@{ font='Vazirmatn'; install_root=$AppRoot; settings_path=$settingsPath; files=$entries } | ConvertTo-Json -Depth 5
        [IO.File]::WriteAllText((Join-Path $backup 'manifest.json'), $manifestText, $utf8)
        Write-Host ('Backup: ' + $backup)
    }

    $written = New-Object 'System.Collections.Generic.List[object]'
    try {
        foreach ($change in $changes) {
            $target = Get-ChangeTarget $change
            if ($change.scope -eq 'settings' -and -not $change.existed) {
                if (Test-Path -LiteralPath $target) { throw 'User settings were created by another process. Run this BAT again.' }
                $null = New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force
            } elseif ((Get-HashHex ([IO.File]::ReadAllBytes($target))) -ne (Get-HashHex $change.original)) { throw ('File changed during patch: ' + $change.relative_path) }
            $written.Add($change)
            [IO.File]::WriteAllBytes($target, $change.changed)
            if ((Get-HashHex ([IO.File]::ReadAllBytes($target))) -ne (Get-HashHex $change.changed)) { throw 'Write verification failed.' }
        }
    } catch {
        foreach ($change in $written) {
            $target = Get-ChangeTarget $change
            if ($change.scope -eq 'settings' -and -not $change.existed) { [IO.File]::Delete($target) }
            else { [IO.File]::WriteAllBytes($target, $change.original) }
        }
        throw
    }
    Write-Host 'Success. UI, input, chat and editor font settings updated. In VS Code run: Developer: Reload Window' -ForegroundColor Green
    Write-Host 'Reapply this BAT after a VS Code update. To undo: run this BAT with restore.'
    exit 0
} catch {
    Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
    if ($_.Exception -is [UnauthorizedAccessException] -or $_.Exception.InnerException -is [UnauthorizedAccessException]) {
        Write-Host 'Right-click this BAT and choose Run as administrator.'
    }
    exit 1
}
