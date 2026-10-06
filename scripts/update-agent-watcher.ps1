<#
One-time upgrade for an already enabled RTL Cursor background watcher.
Run AFTER installing rtl-cursor 1.0.13 or later. No full IDE is required.
The helper preserves RTL preferences and never controls Cursor itself.
#>
[CmdletBinding()]
param([string]$ExtensionPath)
$ErrorActionPreference = "Stop"

function Get-InstalledWatcherPackage([string]$candidatePath) {
    $resolved = [System.IO.Path]::GetFullPath($candidatePath).TrimEnd('\')
    if ((Split-Path -Leaf $resolved) -notmatch '^fusoft\.rtl-cursor-\d+\.\d+\.\d+(?:-|$)') {
        throw "ExtensionPath must be an installed fusoft.rtl-cursor-* extension directory."
    }
    $manifest = [System.IO.File]::ReadAllText((Join-Path $resolved "package.json")) | ConvertFrom-Json -ErrorAction Stop
    if ($manifest.name -ne "rtl-cursor" -or $manifest.publisher -ne "fusoft" -or
        $manifest.version -notmatch '^\d+\.\d+\.\d+$') {
        throw "The installed extension package identity is invalid."
    }
    $version = [version]$manifest.version
    if ($version -lt [version]"1.0.13") { throw "Install RTL Cursor 1.0.13 or later before upgrading the watcher." }
    $files = @{}
    foreach ($name in @("rtl-cursor-watch.ps1", "rtl-cursor-watch.vbs", "rtl-cursor-loader.cjs")) {
        $sourcePath = Join-Path $resolved ("resources\" + $name)
        $bytes = [System.IO.File]::ReadAllBytes($sourcePath)
        if ($bytes.Length -eq 0) { throw "The installed extension resource is empty: $name" }
        $files[$name] = $bytes
    }
    $parseErrors = $null
    $tokens = $null
    [void][System.Management.Automation.Language.Parser]::ParseInput(
        [System.Text.Encoding]::UTF8.GetString($files["rtl-cursor-watch.ps1"]), [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0) { throw "The installed watcher script is invalid." }
    return [pscustomobject]@{ Path = $resolved; Version = $version; Files = $files }
}

function Find-InstalledWatcherPackage([string]$homeDirectory, [string]$requestedPath) {
    if ($requestedPath) { return Get-InstalledWatcherPackage $requestedPath }
    $extensionsDirectory = Join-Path $homeDirectory ".cursor\extensions"
    $best = $null
    foreach ($directory in @(Get-ChildItem -LiteralPath $extensionsDirectory -Directory -ErrorAction SilentlyContinue)) {
        if ($directory.Name -notmatch '^fusoft\.rtl-cursor-\d+\.\d+\.\d+(?:-|$)') { continue }
        try {
            $candidate = Get-InstalledWatcherPackage $directory.FullName
            if (-not $best -or $candidate.Version -gt $best.Version) { $best = $candidate }
        } catch {}
    }
    if (-not $best) { throw "No installed RTL Cursor 1.0.13 or later was found. Install the new VSIX first." }
    return $best
}

function Test-ManagedWatcherProcess($process, [string]$scriptPath) {
    if (-not $process -or $process.Name -ine "powershell.exe" -or
        -not $process.CreationDate -or [int]$process.ProcessId -le 0) { return $false }
    $escapedPath = [regex]::Escape($scriptPath)
    $pattern = '(?i)(?:^|\s)-File\s+(?:"' + $escapedPath + '"|' + $escapedPath + ')(?:\s|$)'
    return ([string]$process.CommandLine -match $pattern)
}

function Get-ManagedWatcherProcesses([string]$scriptPath) {
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction Stop |
        Where-Object { Test-ManagedWatcherProcess $_ $scriptPath }
}

function Stop-ManagedWatcher([string]$scriptPath) {
    foreach ($watcher in @(Get-ManagedWatcherProcesses $scriptPath)) {
        $current = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $watcher.ProcessId) -ErrorAction Stop
        if (-not (Test-ManagedWatcherProcess $current $scriptPath) -or
            $current.CreationDate -ne $watcher.CreationDate) { continue }
        $helper = Get-Process -Id $watcher.ProcessId -ErrorAction SilentlyContinue
        if ($helper) {
            # Only the verified managed PowerShell helper is stopped. Cursor
            # processes and unrelated PowerShell sessions are never selected.
            Stop-Process -Id $watcher.ProcessId -Force -ErrorAction Stop
            if (-not $helper.WaitForExit(10000)) { throw "The previous RTL watcher did not exit. Upgrade cancelled." }
        }
    }
    if (@(Get-ManagedWatcherProcesses $scriptPath).Count -gt 0) {
        throw "A managed RTL watcher is still running. Upgrade cancelled."
    }
}

function New-WatcherFileStage([string]$destination, [byte[]]$bytes) {
    $temporary = $destination + ".upgrade-" + [guid]::NewGuid().ToString("N")
    try { [System.IO.File]::WriteAllBytes($temporary, $bytes) }
    catch {
        if ([System.IO.File]::Exists($temporary)) { Remove-Item -LiteralPath $temporary -Force }
        throw
    }
    return [pscustomobject]@{
        Destination = $destination
        Temporary = $temporary
        Backup = $temporary + ".previous"
        Published = $false
        HadOriginal = [System.IO.File]::Exists($destination)
        PreserveIfAppeared = $false
    }
}

function Publish-WatcherFileStage($stage) {
    if ($stage.PreserveIfAppeared -and [System.IO.File]::Exists($stage.Destination)) { return }
    if ([System.IO.File]::Exists($stage.Destination)) {
        [System.IO.File]::Replace($stage.Temporary, $stage.Destination, $stage.Backup)
    } else {
        [System.IO.File]::Move($stage.Temporary, $stage.Destination)
    }
    $stage.Published = $true
}

function Restore-WatcherFileStage($stage) {
    if (-not $stage.Published) { return }
    if ($stage.HadOriginal -and [System.IO.File]::Exists($stage.Backup)) {
        [System.IO.File]::Replace($stage.Backup, $stage.Destination, [System.Management.Automation.Language.NullString]::Value)
    } elseif (-not $stage.HadOriginal -and [System.IO.File]::Exists($stage.Destination)) {
        Remove-Item -LiteralPath $stage.Destination -Force
    }
    $stage.Published = $false
}

function Update-ExistingWatcherStartup([string]$vbsPath) {
    $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    $existing = Get-ItemProperty -LiteralPath $runKey -Name "RtlCursorWatch" -ErrorAction SilentlyContinue
    # Preserve a missing/disabled startup entry and Windows StartupApproved.
    if (-not $existing -or -not $existing.PSObject.Properties["RtlCursorWatch"]) { return }
    $command = 'wscript.exe //nologo //B "' + $vbsPath + '"'
    if ($existing.RtlCursorWatch -ne $command) {
        Set-ItemProperty -LiteralPath $runKey -Name "RtlCursorWatch" -Value $command -ErrorAction Stop
    }
}

function Get-MigrationUtcNow { return [datetime]::UtcNow }

function Wait-NewManagedWatcher([string]$scriptPath, [datetime]$launchRequested) {
    $deadline = $launchRequested.AddSeconds(15)
    while ($true) {
        foreach ($process in @(Get-ManagedWatcherProcesses $scriptPath)) {
            if (([datetime]$process.CreationDate).ToUniversalTime() -ge $launchRequested.ToUniversalTime()) {
                return
            }
        }
        if ((Get-MigrationUtcNow) -ge $deadline) {
            throw "The new RTL watcher failed to start within 15 seconds. Cursor was left untouched."
        }
        Start-Sleep -Milliseconds 500
    }
}

function Read-CursorUserWatchPreferences([string]$roamingDirectory) {
    $preferences = @{ autoReapply = $true; autoRelaunch = $true }
    $userSettingsPath = Join-Path $roamingDirectory "Cursor\User\settings.json"
    if (-not (Test-Path -LiteralPath $userSettingsPath -PathType Leaf)) { return $preferences }
    $text = [System.IO.File]::ReadAllText($userSettingsPath)
    # Match complete JSON string tokens first so comment markers, URLs and
    # trailing-comma-looking text inside quoted values remain untouched.
    $stringToken = '"(?:\\.|[^"\\])*"'
    $text = [regex]::Replace($text, ('(' + $stringToken + ')|//[^\r\n]*|/\*[\s\S]*?\*/'),
        [System.Text.RegularExpressions.MatchEvaluator]{
            param($match)
            if ($match.Groups[1].Success) { return $match.Value }
            return " "
        })
    $text = [regex]::Replace($text, ('(' + $stringToken + ')|,\s*(?=[}\]])'),
        [System.Text.RegularExpressions.MatchEvaluator]{
            param($match)
            if ($match.Groups[1].Success) { return $match.Value }
            return ""
        })
    try {
        $settings = $text | ConvertFrom-Json -ErrorAction Stop
        if ($text.TrimStart() -notmatch '^\{' -or -not $settings) { throw "Expected a JSON settings object." }
        foreach ($name in @("autoReapply", "autoRelaunch")) {
            $property = $settings.PSObject.Properties["rtlCursor.$name"]
            if ($property) {
                if ($property.Value -isnot [bool]) { throw "rtlCursor.$name must be a boolean." }
                $preferences[$name] = $property.Value
            }
        }
    } catch {
        throw ("Cursor user settings could not be read safely; no watcher was stopped. " + $_.Exception.Message)
    }
    return $preferences
}

function Update-AgentWatcher([string]$homeDirectory, [string]$requestedPath, [string]$roamingDirectory) {
    $homeDirectory = [System.IO.Path]::GetFullPath($homeDirectory)
    $flagPath = Join-Path $homeDirectory ".rtl-cursor-enabled"
    if (-not (Test-Path -LiteralPath $flagPath -PathType Leaf)) {
        throw "RTL Cursor is disabled. This helper only upgrades an already enabled watcher."
    }
    $package = Find-InstalledWatcherPackage $homeDirectory $requestedPath
    $stateDirectory = Join-Path $homeDirectory ".rtl-cursor"
    $scriptPath = Join-Path $stateDirectory "rtl-cursor-watch.ps1"
    $vbsPath = Join-Path $stateDirectory "rtl-cursor-watch.vbs"
    $files = $package.Files
    $settingsPath = Join-Path $stateDirectory "watch-settings.json"
    if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
        if (-not $roamingDirectory) { $roamingDirectory = Join-Path $homeDirectory "AppData\Roaming" }
        $preferences = Read-CursorUserWatchPreferences $roamingDirectory
        $files["watch-settings.json"] = [System.Text.Encoding]::UTF8.GetBytes(($preferences | ConvertTo-Json -Compress))
    }
    $stages = @()
    $deployed = $false
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
    try {
        # Prepare all complete files before stopping any managed helper.
        foreach ($name in @("rtl-cursor-watch.ps1", "rtl-cursor-watch.vbs", "rtl-cursor-loader.cjs", "watch-settings.json")) {
            if (-not $files.ContainsKey($name)) { continue }
            $stage = New-WatcherFileStage (Join-Path $stateDirectory $name) $files[$name]
            if ($name -eq "watch-settings.json") { $stage.PreserveIfAppeared = $true }
            $stages += $stage
        }
        if (-not (Test-Path -LiteralPath $flagPath -PathType Leaf)) { throw "RTL was disabled during upgrade. Upgrade cancelled." }
        Stop-ManagedWatcher $scriptPath
        if (-not (Test-Path -LiteralPath $flagPath -PathType Leaf)) { throw "RTL was disabled during upgrade. Upgrade cancelled." }
        try {
            foreach ($stage in $stages) { Publish-WatcherFileStage $stage }
            $deployed = $true
        } catch {
            foreach ($stage in @($stages | Sort-Object Destination -Descending)) { Restore-WatcherFileStage $stage }
            throw
        }
        # Existing watch-settings.json and the enabled flag remain untouched.
        $pidFile = Join-Path $stateDirectory "watch.pid"
        if (Test-Path -LiteralPath $pidFile) { Remove-Item -LiteralPath $pidFile -Force }
        Update-ExistingWatcherStartup $vbsPath
        if (-not (Test-Path -LiteralPath $flagPath -PathType Leaf)) { throw "RTL was disabled during upgrade. Watcher was not launched." }
        $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"
        $launchRequested = Get-MigrationUtcNow
        Start-Process -FilePath $wscript -ArgumentList @("//nologo", "//B", ('"' + $vbsPath + '"')) -WindowStyle Hidden -ErrorAction Stop | Out-Null
        Wait-NewManagedWatcher $scriptPath $launchRequested
        return [pscustomobject]@{ Version = $package.Version.ToString(); ExtensionPath = $package.Path; WatcherPath = $scriptPath }
    } finally {
        foreach ($stage in $stages) {
            if ([System.IO.File]::Exists($stage.Temporary)) { Remove-Item -LiteralPath $stage.Temporary -Force }
            if ($deployed -and [System.IO.File]::Exists($stage.Backup)) { Remove-Item -LiteralPath $stage.Backup -Force }
        }
    }
}

try {
    if (-not $env:USERPROFILE) { throw "USERPROFILE is unavailable." }
    $result = Update-AgentWatcher $env:USERPROFILE $ExtensionPath $env:APPDATA
    Write-Output ("RTL Cursor background watcher upgraded to " + $result.Version + ". Preferences preserved; Cursor was left untouched.")
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
