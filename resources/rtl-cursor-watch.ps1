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

$PATCH_MARKER = "rtl-cursor-loader.cjs"
$PATCH_LINE = 'import{createRequire}from"module";try{createRequire(import.meta.url)("./rtl-cursor-loader.cjs")}catch(e){console.error("[RTL Cursor] error loading ./rtl-cursor-loader.cjs: ", e)}'
$BACKUP_PREFIX = "main.js.rtl-cursor-backup-"
$EXT_DIR_RE = '^(?:peyma|fusoft)\.rtl-cursor-(\d+)\.(\d+)\.(\d+)'

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

function Test-IsPatched([string]$mainJsPath) {
    try {
        $text = [System.IO.File]::ReadAllText($mainJsPath)
        return $text.Contains($PATCH_MARKER)
    } catch {
        # If unreadable mid-update, skip this round instead of false-repairing.
        return $true
    }
}

function Backup-MainJs([string]$mainJsPath) {
    $dir = Split-Path -Parent $mainJsPath
    $stamp = Get-Date -Format "yyyyMMddTHHmmss"
    $dest = Join-Path $dir ($BACKUP_PREFIX + $stamp)
    Copy-Item -LiteralPath $mainJsPath -Destination $dest -Force
    return $dest
}

function Apply-Patch([string]$mainJsPath, [string]$loaderSrc) {
    $content = [System.IO.File]::ReadAllText($mainJsPath)
    if (-not $content.Contains("Copyright (C) Microsoft Corporation")) {
        throw "main.js missing expected copyright header"
    }
    if ($content.Contains($PATCH_LINE)) {
        # Still refresh loader file
    } else {
        Backup-MainJs $mainJsPath | Out-Null
        $lines = $content -split "`n", -1
        $idx = -1
        for ($i = 0; $i -lt $lines.Length; $i++) {
            if ($lines[$i].StartsWith("import{createRequire")) { $idx = $i; break }
        }
        if ($idx -ge 0) {
            $lines[$idx] = $PATCH_LINE
            $content = [string]::Join("`n", $lines)
        } else {
            $end = $content.IndexOf("*/")
            if ($end -lt 0) { throw "copyright end not found" }
            $insert = $end + 2
            $content = $content.Substring(0, $insert) + "`n" + $PATCH_LINE + $content.Substring($insert)
        }
        [System.IO.File]::WriteAllText($mainJsPath, $content)
    }

    $outDir = Split-Path -Parent $mainJsPath
    $destLoader = Join-Path $outDir "rtl-cursor-loader.cjs"
    Copy-Item -LiteralPath $loaderSrc -Destination $destLoader -Force
    # Keep a durable cache outside the app dir (survives Cursor updates)
    Copy-Item -LiteralPath $loaderSrc -Destination $loaderCache -Force
}

function Get-CursorExe([string]$mainJsPath) {
    try {
        $app = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $mainJsPath)) # .../resources/app/out -> resources
        $root = Split-Path -Parent $app # install root
        $exe = Join-Path $root "Cursor.exe"
        if (Test-Path -LiteralPath $exe) { return $exe }
    } catch {}
    $fallback = Join-Path $env:LOCALAPPDATA "Programs\cursor\Cursor.exe"
    if (Test-Path -LiteralPath $fallback) { return $fallback }
    return $null
}

function Restart-Cursor([string]$exePath) {
    if (-not $exePath) { return }
    Write-Log ("relaunch scheduled: " + $exePath)
    $escaped = $exePath.Replace("'", "''")
    $ps = "Start-Sleep -Milliseconds 2000; Start-Process -LiteralPath '$escaped'"
    $bytes = [System.Text.Encoding]::Unicode.GetBytes($ps)
    $encoded = [Convert]::ToBase64String($bytes)
    Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden", "-EncodedCommand", $encoded
    ) -WindowStyle Hidden | Out-Null
    Get-Process -Name "Cursor" -ErrorAction SilentlyContinue | ForEach-Object {
        try { $_.CloseMainWindow() | Out-Null } catch {}
    }
    Start-Sleep -Milliseconds 800
    Get-Process -Name "Cursor" -ErrorAction SilentlyContinue | ForEach-Object {
        try { Stop-Process -Id $_.Id -Force } catch {}
    }
}

Write-Log "watch started pid=$PID"

$lastHash = @{}
while ($true) {
    try {
        if (-not (Test-Path -LiteralPath $flagPath)) {
            Start-Sleep -Seconds 5
            continue
        }

        $loaderSrc = Find-LoaderSource
        if (-not $loaderSrc) {
            Write-Log "loader source not found"
            Start-Sleep -Seconds 8
            continue
        }

        foreach ($mainJs in (Find-MainJsPaths)) {
            if (-not (Test-Path -LiteralPath $mainJs)) { continue }

            # Wait until file looks settled after an update
            try {
                $item = Get-Item -LiteralPath $mainJs
                $key = $mainJs
                $sig = "{0}|{1}" -f $item.Length, $item.LastWriteTimeUtc.Ticks
                if ($lastHash.ContainsKey($key) -and $lastHash[$key] -ne $sig) {
                    # changed recently; give updater a moment
                    $lastHash[$key] = $sig
                    Start-Sleep -Seconds 2
                } else {
                    $lastHash[$key] = $sig
                }
            } catch {}

            if (Test-IsPatched $mainJs) { continue }

            Write-Log ("patch missing, repairing: " + $mainJs)
            try {
                Apply-Patch $mainJs $loaderSrc
                Write-Log "patch applied"
                $exe = Get-CursorExe $mainJs
                $running = @(Get-Process -Name "Cursor" -ErrorAction SilentlyContinue)
                if ($running.Count -gt 0) {
                    Restart-Cursor $exe
                } else {
                    Write-Log "Cursor not running; patch ready for next launch"
                }
            } catch {
                Write-Log ("patch failed: " + $_.Exception.Message)
            }
        }
    } catch {
        Write-Log ("loop error: " + $_.Exception.Message)
    }
    Start-Sleep -Seconds 4
}
