# RTL Cursor background watch — re-applies main.js patch after Cursor updates
# without needing the full IDE / extension host (so Agent Window works too).
# Launch via rtl-cursor-watch.vbs (WScript Run 0) so Windows Terminal does not
# flash an empty console at logon even with WindowStyle Hidden.
$ErrorActionPreference = "SilentlyContinue"
try {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class RtlCursorNative {
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
    [void][RtlCursorNative]::ShowWindow([RtlCursorNative]::GetConsoleWindow(), 0)
} catch {}

$homeDir = $env:USERPROFILE
$flagPath = Join-Path $homeDir ".rtl-cursor-enabled"
$stateDir = Join-Path $homeDir ".rtl-cursor"
$logPath = Join-Path $homeDir "rtl-cursor-watch.log"
$loaderCache = Join-Path $stateDir "rtl-cursor-loader.cjs"
$pidFile = Join-Path $stateDir "watch.pid"
$settingsPath = Join-Path $stateDir "watch-settings.json"
$activeUpdatePath = Join-Path $env:APPDATA "Cursor\update-supervisor\win32\active.json"

$PATCH_MARKER = "rtl-cursor-loader.cjs"
$PATCH_LINE = 'import{createRequire as __rtlCursorCreateRequire}from"module";try{__rtlCursorCreateRequire(import.meta.url)("./rtl-cursor-loader.cjs")}catch(e){console.error("[RTL Cursor] error loading ./rtl-cursor-loader.cjs: ", e)}'
$BACKUP_PREFIX = "main.js.rtl-cursor-backup-"
$EXT_DIR_RE = '^(?:peyma|fusoft)\.rtl-cursor-(\d+)\.(\d+)\.(\d+)'
$STABLE_SECONDS = 10

function Write-Log([string]$msg) {
    $line = "{0} {1}" -f (Get-Date -Format "o"), $msg
    try { Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8 } catch {}
}

# Single-instance guard
try {
    $mutex = New-Object System.Threading.Mutex($false, "Local\FusoftRtlCursorWatch")
    if (-not $mutex.WaitOne(0)) {
        Write-Log "already running; exit"
        exit 0
    }
} catch {
    Write-Log ("mutex error: " + $_.Exception.Message)
}

try {
    if (-not (Test-Path -LiteralPath $stateDir)) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
    }
    $PID | Set-Content -LiteralPath $pidFile -Encoding ASCII
} catch {}

function Get-ExtensionVersionParts([string]$name) {
    $m = [regex]::Match($name, $EXT_DIR_RE)
    if (-not $m.Success) { return @(0, 0, 0) }
    return @([int]$m.Groups[1].Value, [int]$m.Groups[2].Value, [int]$m.Groups[3].Value)
}

function Find-LoaderSource {
    if (Test-Path -LiteralPath $loaderCache) { return $loaderCache }
    $search = @(
        (Join-Path $homeDir ".cursor\extensions"),
        (Join-Path $homeDir ".antigravity-ide\extensions"),
        (Join-Path $homeDir ".antigravity\extensions")
    )
    foreach ($dir in $search) {
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        $best = $null
        $bestVer = @(0, 0, 0)
        Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_.Name -notmatch $EXT_DIR_RE) { return }
            $ver = Get-ExtensionVersionParts $_.Name
            $cmp = 0
            for ($i = 0; $i -lt 3; $i++) {
                if ($ver[$i] -ne $bestVer[$i]) { $cmp = $ver[$i] - $bestVer[$i]; break }
            }
            if ($cmp -gt 0) {
                $candidate = Join-Path $_.FullName "resources\rtl-cursor-loader.cjs"
                if (Test-Path -LiteralPath $candidate) {
                    $best = $candidate
                    $bestVer = $ver
                }
            }
        }
        if ($best) { return $best }
    }
    return $null
}

function Find-MainJsPaths {
    $paths = New-Object System.Collections.Generic.List[string]
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\cursor\resources\app\out\main.js"),
        (Join-Path $env:LOCALAPPDATA "Programs\Cursor\resources\app\out\main.js"),
        (Join-Path ${env:ProgramFiles} "Cursor\resources\app\out\main.js"),
        (Join-Path $homeDir "AppData\Local\Programs\cursor\resources\app\out\main.js")
    )
    foreach ($p in $candidates) {
        if ($p -and (Test-Path -LiteralPath $p) -and -not $paths.Contains($p)) {
            $paths.Add($p) | Out-Null
        }
    }
    # Also scan Local\Programs for cursor*\resources\app\out\main.js
    $programs = Join-Path $env:LOCALAPPDATA "Programs"
    if (Test-Path -LiteralPath $programs) {
        Get-ChildItem -LiteralPath $programs -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '^(?i)cursor' } |
            ForEach-Object {
                $p = Join-Path $_.FullName "resources\app\out\main.js"
                if ((Test-Path -LiteralPath $p) -and -not $paths.Contains($p)) { $paths.Add($p) | Out-Null }
            }
    }
    return $paths
}

function Test-AutoReapplyEnabled {
    # Older installs have no settings file and used the default (true).
    if (-not (Test-Path -LiteralPath $settingsPath)) { return $true }
    try {
        $settings = [System.IO.File]::ReadAllText($settingsPath) | ConvertFrom-Json -ErrorAction Stop
        return ($settings.autoReapply -is [bool] -and $settings.autoReapply)
    } catch {
        # A partial/invalid settings write must never enable automatic patching.
        return $false
    }
}

function Test-AutoRelaunchEnabled {
    if (-not (Test-Path -LiteralPath $settingsPath)) { return $true }
    try {
        $settings = [System.IO.File]::ReadAllText($settingsPath) | ConvertFrom-Json -ErrorAction Stop
        # Preserve the extension's default for older settings files.
        if (-not $settings.PSObject.Properties["autoRelaunch"]) { return $true }
        return ($settings.autoRelaunch -is [bool] -and $settings.autoRelaunch)
    } catch { return $false }
}

function Test-ReapplyAllowed {
    return ((Test-Path -LiteralPath $flagPath) -and (Test-AutoReapplyEnabled))
}

function Get-InstallRoot([string]$mainJsPath) {
    $dir = Split-Path -Parent $mainJsPath
    for ($i = 0; $i -lt 3; $i++) { $dir = Split-Path -Parent $dir }
    return $dir
}

function Test-UpdateInProgress([string]$mainJsPath) {
    # Do not read phases as completion: promotion_complete can still precede
    # the supervisor's final relaunch/cleanup. Only its removal is a safe gate.
    if (Test-Path -LiteralPath $activeUpdatePath) { return $true }
    $installRoot = Get-InstallRoot $mainJsPath
    foreach ($artifact in @("_", "_bak")) {
        if (Test-Path -LiteralPath (Join-Path $installRoot $artifact)) { return $true }
    }
    $updaters = @(Get-Process -ErrorAction Stop | Where-Object {
        $_.ProcessName -match '(?i)(?:cursor.*(?:setup|updat)|(?:setup|updat).*cursor)'
    })
    return ($updaters.Count -gt 0)
}

function Get-MainJsSnapshot([string]$mainJsPath) {
    # Hash catches same-length rewrites even if the updater preserves timestamps.
    $before = Get-Item -LiteralPath $mainJsPath -ErrorAction Stop
    $bytes = [System.IO.File]::ReadAllBytes($mainJsPath)
    $after = Get-Item -LiteralPath $mainJsPath -ErrorAction Stop
    if ($before.Length -ne $after.Length -or $before.LastWriteTimeUtc -ne $after.LastWriteTimeUtc) {
        throw "main.js changed while being read"
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $hash = [Convert]::ToBase64String($sha.ComputeHash($bytes)) }
    finally { $sha.Dispose() }
    return [pscustomobject]@{
        Signature = "{0}|{1}|{2}" -f $after.Length, $after.LastWriteTimeUtc.Ticks, $hash
        Content = [System.Text.Encoding]::UTF8.GetString($bytes)
    }
}

function Get-StableMainJs([string]$mainJsPath, [hashtable]$observations, [datetime]$now) {
    try {
        $snapshot = Get-MainJsSnapshot $mainJsPath
        if (-not $observations.ContainsKey($mainJsPath) -or
            $observations[$mainJsPath].Signature -ne $snapshot.Signature) {
            $observations[$mainJsPath] = @{ Signature = $snapshot.Signature; Since = $now }
            return $null
        }
        if (($now - $observations[$mainJsPath].Since).TotalSeconds -lt $STABLE_SECONDS) {
            return $null
        }
        return $snapshot
    } catch {
        $observations.Remove($mainJsPath)
        return $null
    }
}

function Write-AtomicFile([string]$destination, [byte[]]$bytes, [string]$backupPath, [string]$expectedSignature) {
    # A unique file in the same directory keeps the final replacement atomic.
    # Never truncate the live main.js or leave it containing a partial write.
    $tempPath = $destination + ".rtl-cursor-tmp-" + [guid]::NewGuid().ToString("N")
    try {
        [System.IO.File]::WriteAllBytes($tempPath, $bytes)
        if ($expectedSignature) {
            # Staging the new content may take time: recheck only after the
            # complete temporary file exists, immediately before replacement.
            if (-not (Test-ReapplyAllowed) -or (Test-UpdateInProgress $destination) -or
                (Get-MainJsSnapshot $destination).Signature -ne $expectedSignature) {
                throw "main.js repair deferred before atomic replacement"
            }
        }
        if ([System.IO.File]::Exists($destination)) {
            if ($backupPath) {
                [System.IO.File]::Replace($tempPath, $destination, $backupPath)
            } else {
                # Windows PowerShell 5.1 converts $null to an empty .NET string;
                # NullString passes the actual null required for no backup.
                [System.IO.File]::Replace($tempPath, $destination, [System.Management.Automation.Language.NullString]::Value)
            }
        } else {
            [System.IO.File]::Move($tempPath, $destination)
        }
    } finally {
        if ([System.IO.File]::Exists($tempPath)) {
            Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Apply-Patch([string]$mainJsPath, [string]$loaderSrc, [string]$expectedSignature) {
    if (-not (Test-ReapplyAllowed) -or (Test-UpdateInProgress $mainJsPath)) {
        throw "automatic repair deferred by settings or an active update"
    }
    $snapshot = Get-MainJsSnapshot $mainJsPath
    if ($snapshot.Signature -ne $expectedSignature) { throw "main.js changed before repair" }
    $content = $snapshot.Content
    if (-not $content.Contains("Copyright (C) Microsoft Corporation")) {
        throw "main.js missing expected copyright header"
    }
    if ($content.Contains($PATCH_MARKER)) { return }
    $end = $content.IndexOf("*/")
    if ($end -lt 0) { throw "copyright end not found" }
    $insert = $end + 2
    # Keep all of Cursor's own imports, including an existing createRequire.
    $content = $content.Substring(0, $insert) + "`n" + $PATCH_LINE + $content.Substring($insert)

    # Make the loader available before publishing a main.js that imports it.
    $loaderBytes = [System.IO.File]::ReadAllBytes($loaderSrc)
    $destLoader = Join-Path (Split-Path -Parent $mainJsPath) "rtl-cursor-loader.cjs"
    Write-AtomicFile $destLoader $loaderBytes $null
    if ([System.IO.Path]::GetFullPath($loaderSrc) -ne [System.IO.Path]::GetFullPath($loaderCache)) {
        Write-AtomicFile $loaderCache $loaderBytes $null
    }

    if (-not (Test-ReapplyAllowed) -or (Test-UpdateInProgress $mainJsPath)) {
        throw "automatic repair deferred by settings or an active update"
    }
    if ((Get-MainJsSnapshot $mainJsPath).Signature -ne $expectedSignature) {
        throw "main.js changed during repair"
    }
    $backup = Join-Path (Split-Path -Parent $mainJsPath) ($BACKUP_PREFIX +
        (Get-Date -Format "yyyyMMddTHHmmssfff") + "-" + [guid]::NewGuid().ToString("N"))
    Write-AtomicFile $mainJsPath ([System.Text.Encoding]::UTF8.GetBytes($content)) $backup $expectedSignature
}

function Get-CursorExe([string]$mainJsPath) {
    return Join-Path (Get-InstallRoot $mainJsPath) "Cursor.exe"
}

function Get-CursorProcesses([string]$exePath) {
    foreach ($process in @(Get-Process -Name "Cursor" -ErrorAction SilentlyContinue)) {
        try {
            if ([string]::Equals($process.Path, $exePath, [System.StringComparison]::OrdinalIgnoreCase)) {
                $process
            }
        } catch {}
    }
}

function Get-WatchUtcNow { return [datetime]::UtcNow }

function Test-CanRelaunch([string]$mainJsPath) {
    return ((Test-ReapplyAllowed) -and (Test-AutoRelaunchEnabled) -and
        -not (Test-UpdateInProgress $mainJsPath))
}

function Restart-CursorGracefully([string]$mainJsPath, [int]$timeoutSeconds = 60) {
    try {
        if (-not (Test-CanRelaunch $mainJsPath)) {
            Write-Log "automatic relaunch deferred by settings or an active update"
            return $false
        }
        $exePath = Get-CursorExe $mainJsPath
        if (-not (Test-Path -LiteralPath $exePath)) {
            Write-Log "automatic relaunch deferred: Cursor executable not found"
            return $false
        }
        $running = @(Get-CursorProcesses $exePath)
        if ($running.Count -eq 0) { return $false }
        $windows = @($running | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero })
        if ($windows.Count -eq 0) {
            Write-Log "automatic relaunch deferred: no Cursor window available for normal close"
            return $false
        }
        foreach ($process in $windows) {
            if (-not (Test-CanRelaunch $mainJsPath)) {
                Write-Log "automatic relaunch deferred before normal close"
                return $false
            }
            if (-not $process.CloseMainWindow()) {
                Write-Log "automatic relaunch cancelled: Cursor did not accept normal close"
                return $false
            }
        }
        $deadline = (Get-WatchUtcNow).AddSeconds($timeoutSeconds)
        while (@(Get-CursorProcesses $exePath).Count -gt 0) {
            if (-not (Test-CanRelaunch $mainJsPath)) {
                Write-Log "automatic relaunch deferred while waiting for Cursor to exit"
                return $false
            }
            if ((Get-WatchUtcNow) -ge $deadline) {
                Write-Log "automatic relaunch cancelled: Cursor is still running; a save prompt or another window may be open"
                return $false
            }
            Start-Sleep -Milliseconds 500
        }
        if (-not (Test-CanRelaunch $mainJsPath)) {
            Write-Log "automatic relaunch deferred before reopening Cursor"
            return $false
        }
        if (-not (Get-MainJsSnapshot $mainJsPath).Content.Contains($PATCH_MARKER)) {
            Write-Log "automatic relaunch deferred: main.js changed after repair"
            return $false
        }
        # A user or another window may have reopened this install while waiting.
        if (@(Get-CursorProcesses $exePath).Count -gt 0) {
            Write-Log "automatic relaunch skipped: Cursor has already reopened"
            return $false
        }
        Start-Process -FilePath $exePath -WindowStyle Normal -ErrorAction Stop | Out-Null
        Write-Log "Cursor reopened after normal exit; restoring its saved session"
        return $true
    } catch {
        Write-Log ("automatic relaunch failed safely: " + $_.Exception.Message)
        return $false
    }
}

function Invoke-WatchCycle([hashtable]$observations, [datetime]$now = [datetime]::UtcNow) {
    if (-not (Test-ReapplyAllowed)) {
        $observations.Clear()
        return
    }
    $loaderSrc = Find-LoaderSource
    if (-not $loaderSrc) { Write-Log "loader source not found"; return }
    foreach ($mainJs in (Find-MainJsPaths)) {
        try {
            if (Test-UpdateInProgress $mainJs) {
                $observations.Remove($mainJs)
                continue
            }
            $snapshot = Get-StableMainJs $mainJs $observations $now
            if (-not $snapshot -or $snapshot.Content.Contains($PATCH_MARKER)) { continue }
            Write-Log ("patch missing after completed update, repairing: " + $mainJs)
            Apply-Patch $mainJs $loaderSrc $snapshot.Signature
            $observations.Remove($mainJs)
            if (@(Get-CursorProcesses (Get-CursorExe $mainJs)).Count -gt 0) {
                if (Test-AutoRelaunchEnabled) {
                    Write-Log "patch applied; requesting Cursor's normal exit to activate RTL"
                    [void](Restart-CursorGracefully $mainJs)
                } else {
                    Write-Log "patch applied; changes activate on Cursor's next normal restart"
                }
            } else {
                Write-Log "patch applied; ready for Cursor's next launch"
            }
        } catch {
            $observations.Remove($mainJs)
            Write-Log ("repair deferred: " + $_.Exception.Message)
        }
    }
}

Write-Log "watch started pid=$PID"
$observations = @{}
$watcherSignature = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash
try {
    while ($true) {
        try {
            # A replacement script starts a fresh watcher instead of leaving an
            # already loaded copy of an old version running indefinitely.
            if ((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256 -ErrorAction Stop).Hash -ne $watcherSignature) {
                Write-Log "watch script changed; exit for replacement watcher"
                break
            }
            Invoke-WatchCycle $observations
        } catch {
            Write-Log ("loop error: " + $_.Exception.Message)
            $observations.Clear()
        }
        Start-Sleep -Seconds 4
    }
} finally {
    try {
        if (([System.IO.File]::ReadAllText($pidFile)).Trim() -eq [string]$PID) {
            Remove-Item -LiteralPath $pidFile -Force
        }
    } catch {}
    try { $mutex.ReleaseMutex(); $mutex.Dispose() } catch {}
}
