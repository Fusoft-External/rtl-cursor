# Isolated regression tests. Extract functions with the parser; never launch or
# dot-source the watcher, read the user's Cursor files, or control real processes.
$ErrorActionPreference = "Stop"
$watcherPath = Join-Path (Split-Path -Parent $PSScriptRoot) "resources\rtl-cursor-watch.ps1"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($watcherPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
$unsafeCommands = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and
    $node.GetCommandName() -match '^(?:Stop-Process|taskkill|Restart-Cursor)$'
}, $true))
$unsafeMembers = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and
    $node.Member.Extent.Text -match '^Kill$'
}, $true))
if ($unsafeCommands.Count -or $unsafeMembers.Count) { throw "watcher contains a forced editor termination path" }
$starts = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq "Start-Process"
}, $true))
if ($starts.Count -ne 1 -or $starts[0].Extent.Text -notmatch 'Start-Process -FilePath \$exePath -WindowStyle Normal') {
    throw "watcher must reopen only the matching install using the supported FilePath parameter"
}
foreach ($function in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    Invoke-Expression $function.Extent.Text
}
# Import literal constants from the implementation so syntax regressions are
# exercised rather than duplicated in the test's own patch text.
foreach ($constantName in @("PATCH_MARKER", "PATCH_LINE", "BACKUP_PREFIX", "STABLE_SECONDS")) {
    $assignment = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq ('$' + $constantName)
    }, $true)
    Invoke-Expression $assignment.Extent.Text
}

$fixtureRoot = Join-Path $PSScriptRoot ("watch-fixtures-" + [guid]::NewGuid().ToString("N"))
$installRoot = Join-Path $fixtureRoot "Cursor"
$outDir = Join-Path $installRoot "resources\app\out"
$stateDir = Join-Path $fixtureRoot "state"
$mainJsPath = Join-Path $outDir "main.js"
$cursorExePath = Join-Path $installRoot "Cursor.exe"
$loaderSrcPath = Join-Path $fixtureRoot "source-loader.cjs"
$loaderCache = Join-Path $stateDir "rtl-cursor-loader.cjs"
$settingsPath = Join-Path $stateDir "watch-settings.json"
$activeUpdatePath = Join-Path $fixtureRoot "update-supervisor\active.json"
$flagPath = Join-Path $fixtureRoot "enabled"
$script:simulatedUpdater = $false
$script:simulatedCursor = $true
$script:logs = @()
$script:processReads = 0
$script:testsPassed = 0
$script:closeRequests = 0
$script:launches = @()
$script:clock = [datetime]"2026-10-06T00:00:00Z"
$script:closeAccepted = $true
$script:pendingExit = $false
$script:simulatedChild = $false
$script:updaterOnClose = $false
$script:disableOnClose = $false
$script:sleepTicks = 0
$script:exitAfterTicks = 0

function Assert-True([bool]$condition, [string]$message) {
    if (-not $condition) { throw "FAIL: $message" }
}
function Pass([string]$name) {
    $script:testsPassed++
    Write-Output ("PASS: " + $name)
}
function Write-Log([string]$message) { $script:logs += $message }
function Find-LoaderSource { return $loaderSrcPath }
function Find-MainJsPaths { return @($mainJsPath) }
function Get-WatchUtcNow { return $script:clock }
function Start-Sleep {
    param([int]$Milliseconds)
    $script:clock = $script:clock.AddMilliseconds($Milliseconds)
    $script:sleepTicks++
    if ($script:exitAfterTicks -gt 0 -and $script:sleepTicks -ge $script:exitAfterTicks) {
        $script:simulatedCursor = $false
        $script:simulatedChild = $false
    }
}
function Start-Process {
    [CmdletBinding()]
    param([string]$FilePath, [string]$WindowStyle)
    $script:launches += [pscustomobject]@{ FilePath = $FilePath; WindowStyle = $WindowStyle }
}
function Get-Process {
    [CmdletBinding()]
    param([string]$Name)
    $script:processReads++
    if ($Name -eq "Cursor") {
        if ($script:simulatedCursor) {
            $process = [pscustomobject]@{ ProcessName = "Cursor"; Id = 12345; Path = $cursorExePath; MainWindowHandle = [IntPtr]1 }
            $process | Add-Member -MemberType ScriptMethod -Name CloseMainWindow -Value {
                $script:closeRequests++
                if ($script:updaterOnClose) { $script:simulatedUpdater = $true }
                if ($script:disableOnClose) { Remove-Item -LiteralPath $flagPath -Force }
                if ($script:closeAccepted -and -not $script:pendingExit) { $script:simulatedCursor = $false }
                return $script:closeAccepted
            }
            $process
        }
        if ($script:simulatedChild) {
            [pscustomobject]@{ ProcessName = "Cursor"; Id = 12346; Path = $cursorExePath; MainWindowHandle = [IntPtr]::Zero }
        }
        $unrelated = [pscustomobject]@{ ProcessName = "Cursor"; Id = 99999; Path = (Join-Path $fixtureRoot "OtherCursor\Cursor.exe"); MainWindowHandle = [IntPtr]2 }
        $unrelated | Add-Member -MemberType ScriptMethod -Name CloseMainWindow -Value { throw "must not close another Cursor install" }
        $unrelated
    } else {
        if ($script:simulatedUpdater) { [pscustomobject]@{ ProcessName = "CursorSetup-x64"; Id = 54321 } }
        [pscustomobject]@{ ProcessName = "UnrelatedUpdater"; Id = 11111 }
    }
}
function Reset-Fixture {
    [System.IO.File]::WriteAllText($mainJsPath, $original, (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":true,"autoRelaunch":false}')
    [System.IO.File]::WriteAllText($flagPath, "enabled")
    if (Test-Path -LiteralPath $activeUpdatePath) { Remove-Item -LiteralPath $activeUpdatePath -Force }
    foreach ($artifact in @("_", "_bak")) {
        $artifactPath = Join-Path $installRoot $artifact
        if (Test-Path -LiteralPath $artifactPath) { Remove-Item -LiteralPath $artifactPath -Force }
    }
    $script:simulatedUpdater = $false
    $script:simulatedCursor = $true
    $script:logs = @()
    $script:closeRequests = 0
    $script:launches = @()
    $script:clock = [datetime]"2026-10-06T00:00:00Z"
    $script:closeAccepted = $true
    $script:pendingExit = $false
    $script:simulatedChild = $false
    $script:updaterOnClose = $false
    $script:disableOnClose = $false
    $script:sleepTicks = 0
    $script:exitAfterTicks = 0
}

try {
    New-Item -ItemType Directory -Path $outDir, $stateDir, (Split-Path -Parent $activeUpdatePath) -Force | Out-Null
    [System.IO.File]::WriteAllText($loaderSrcPath, 'module.exports = "test loader";')
    [System.IO.File]::WriteAllText($flagPath, "enabled")
    [System.IO.File]::WriteAllText($cursorExePath, "test executable placeholder; never launched")
    $original = "/*! Copyright (C) Microsoft Corporation. All rights reserved. */`n" +
        'import{createRequire}from"module";const ownRequire=createRequire(import.meta.url);' + "`nconsole.log(1);"
    $t0 = [datetime]"2026-10-06T00:00:00Z"

    Reset-Fixture
    [System.IO.File]::WriteAllText($activeUpdatePath, '{"phase":"promotion_complete"}')
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    Invoke-WatchCycle $observations ($t0.AddSeconds(60))
    Assert-True (([System.IO.File]::ReadAllText($mainJsPath)) -eq $original) "active supervisor must defer repair even at promotion_complete"
    Assert-True ($observations.Count -eq 0) "active update must discard stability observations"
    Remove-Item -LiteralPath $activeUpdatePath -Force
    Invoke-WatchCycle $observations ($t0.AddSeconds(64))
    Assert-True (([System.IO.File]::ReadAllText($mainJsPath)) -eq $original) "completion starts a fresh stability interval"
    Pass "supervisor active.json blocks patching until removed, then requires stability"

    foreach ($artifact in @("_", "_bak")) {
        Reset-Fixture
        [System.IO.File]::WriteAllText((Join-Path $installRoot $artifact), "updater artifact")
        $observations = @{}
        Invoke-WatchCycle $observations $t0
        Invoke-WatchCycle $observations ($t0.AddSeconds(60))
        Assert-True (([System.IO.File]::ReadAllText($mainJsPath)) -eq $original) "$artifact must block repair"
    }
    Reset-Fixture
    $script:simulatedUpdater = $true
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    Invoke-WatchCycle $observations ($t0.AddSeconds(60))
    Assert-True (([System.IO.File]::ReadAllText($mainJsPath)) -eq $original) "running Cursor updater must block repair"
    Pass "updater artifacts and Cursor installer processes block repair"

    Reset-Fixture
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    $originalTimestamp = (Get-Item -LiteralPath $mainJsPath).LastWriteTimeUtc
    $changed = $original.Replace("console.log(1)", "console.log(2)")
    [System.IO.File]::WriteAllText($mainJsPath, $changed, (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::SetLastWriteTimeUtc($mainJsPath, $originalTimestamp)
    Invoke-WatchCycle $observations ($t0.AddSeconds(12))
    Invoke-WatchCycle $observations ($t0.AddSeconds(20))
    Assert-True (([System.IO.File]::ReadAllText($mainJsPath)) -eq $changed) "same-size same-timestamp changes require a new full stable interval"
    Invoke-WatchCycle $observations ($t0.AddSeconds(24))
    $patched = [System.IO.File]::ReadAllText($mainJsPath)
    Assert-True ($patched.Contains($PATCH_LINE)) "stable update must install patch"
    Assert-True ($patched.Contains('import{createRequire}from"module";const ownRequire=createRequire(import.meta.url);')) "Cursor's own createRequire import must be preserved"
    Assert-True ($patched.Contains("console.log(2)")) "latest completed update contents must be retained"
    Assert-True (([System.IO.File]::ReadAllText((Join-Path $outDir "rtl-cursor-loader.cjs"))) -eq ([System.IO.File]::ReadAllText($loaderSrcPath))) "loader must be installed with patch"
    Assert-True (($script:logs -join "`n").Contains("next normal restart")) "running Cursor must receive a next-restart log, without being restarted"
    Assert-True ($script:closeRequests -eq 0 -and $script:launches.Count -eq 0) "autoRelaunch=false must leave Cursor windows untouched"
    $backups = @(Get-ChildItem -LiteralPath $outDir -Filter ($BACKUP_PREFIX + "*"))
    Assert-True ($backups.Count -eq 1 -and ([System.IO.File]::ReadAllText($backups[0].FullName)) -eq $changed) "atomic replacement must preserve the original in a backup"
    Assert-True (@(Get-ChildItem -LiteralPath $outDir -Filter "*.rtl-cursor-tmp-*").Count -eq 0) "atomic replacement must clean temporary files"
    Invoke-WatchCycle $observations ($t0.AddSeconds(28))
    Invoke-WatchCycle $observations ($t0.AddSeconds(40))
    Assert-True (([System.IO.File]::ReadAllText($mainJsPath)) -eq $patched) "already patched file must be left intact"
    Pass "real stability detects same-size rewrites and applies patch preserving imports and backup"

    Reset-Fixture
    $script:simulatedCursor = $false
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    Invoke-WatchCycle $observations ($t0.AddSeconds(12))
    Assert-True (([System.IO.File]::ReadAllText($mainJsPath)).Contains($PATCH_LINE)) ("next update must atomically refresh an existing loader: " + ($script:logs -join "; "))
    Assert-True (($script:logs -join "`n").Contains("next launch")) "closed Cursor must remain closed with patch ready for next launch"
    Pass "existing loader can be atomically refreshed and closed Cursor stays closed"

    Reset-Fixture
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":false}')
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    Invoke-WatchCycle $observations ($t0.AddSeconds(60))
    Assert-True (([System.IO.File]::ReadAllText($mainJsPath)) -eq $original) "autoReapply=false must disable watcher patching"
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":')
    Assert-True (-not (Test-AutoReapplyEnabled)) "malformed settings must fail closed"
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":"false"}')
    Assert-True (-not (Test-AutoReapplyEnabled)) "non-boolean settings must fail closed"
    Remove-Item -LiteralPath $settingsPath -Force
    Assert-True (Test-AutoReapplyEnabled) "missing legacy settings must use documented default"
    Pass "autoReapply preference and malformed settings are respected"

    Reset-Fixture
    $snapshot = Get-MainJsSnapshot $mainJsPath
    [System.IO.File]::WriteAllText($mainJsPath, $changed, (New-Object System.Text.UTF8Encoding($false)))
    $rejected = $false
    try { Apply-Patch $mainJsPath $loaderSrcPath $snapshot.Signature }
    catch { $rejected = $true }
    Assert-True ($rejected -and ([System.IO.File]::ReadAllText($mainJsPath)) -eq $changed) "last-moment change must reject repair"
    Pass "source changed between observation and repair is rejected"

    Reset-Fixture
    $snapshot = Get-MainJsSnapshot $mainJsPath
    $rejected = $false
    try { Apply-Patch $mainJsPath (Join-Path $fixtureRoot "missing-loader.cjs") $snapshot.Signature }
    catch { $rejected = $true }
    Assert-True ($rejected -and ([System.IO.File]::ReadAllText($mainJsPath)) -eq $original) "loader failure must never publish patched main.js"
    Pass "loader must be installed successfully before main.js changes"

    Reset-Fixture
    $snapshot = Get-MainJsSnapshot $mainJsPath
    $script:originalAtomic = ${function:Write-AtomicFile}
    function Write-AtomicFile([string]$destination, [byte[]]$bytes, [string]$backupPath, [string]$expectedSignature) {
        & $script:originalAtomic $destination $bytes $backupPath $expectedSignature
        if ($destination -eq (Join-Path $outDir "rtl-cursor-loader.cjs")) {
            [System.IO.File]::WriteAllText($activeUpdatePath, '{"phase":"applying"}')
        }
    }
    try {
        $rejected = $false
        try { Apply-Patch $mainJsPath $loaderSrcPath $snapshot.Signature }
        catch { $rejected = $true }
        Assert-True ($rejected -and ([System.IO.File]::ReadAllText($mainJsPath)) -eq $original) "update starting during loader installation must block main.js replacement"
    } finally { Set-Item -LiteralPath Function:\Write-AtomicFile -Value $script:originalAtomic }
    Pass "update starting during loader installation is rechecked before main.js replacement"

    Reset-Fixture
    $snapshot = Get-MainJsSnapshot $mainJsPath
    [System.IO.File]::WriteAllText($mainJsPath, $changed, (New-Object System.Text.UTF8Encoding($false)))
    $rejected = $false
    try { Write-AtomicFile $mainJsPath ([System.Text.Encoding]::UTF8.GetBytes("replacement")) (Join-Path $outDir "unused-backup") $snapshot.Signature }
    catch { $rejected = $true }
    Assert-True ($rejected -and ([System.IO.File]::ReadAllText($mainJsPath)) -eq $changed) "atomic writer must reject changed source after staging"
    Assert-True (@(Get-ChildItem -LiteralPath $outDir -Filter "*.rtl-cursor-tmp-*").Count -eq 0) "rejected atomic write must remove its staged file"
    Pass "atomic writer rechecks source and cleans staged files after rejection"

    Reset-Fixture
    $snapshot = Get-MainJsSnapshot $mainJsPath
    $script:originalAtomic = ${function:Write-AtomicFile}
    function Write-AtomicFile([string]$destination, [byte[]]$bytes, [string]$backupPath, [string]$expectedSignature) {
        & $script:originalAtomic $destination $bytes $backupPath $expectedSignature
        if ($destination -eq (Join-Path $outDir "rtl-cursor-loader.cjs")) { Remove-Item -LiteralPath $flagPath -Force }
    }
    try {
        $rejected = $false
        try { Apply-Patch $mainJsPath $loaderSrcPath $snapshot.Signature }
        catch { $rejected = $true }
        Assert-True ($rejected -and ([System.IO.File]::ReadAllText($mainJsPath)) -eq $original) "disabling RTL during loader installation must block main.js replacement"
    } finally { Set-Item -LiteralPath Function:\Write-AtomicFile -Value $script:originalAtomic }
    Pass "disabling RTL during repair prevents publishing main.js"

    Reset-Fixture
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":true,"autoRelaunch":true}')
    [System.IO.File]::WriteAllText($activeUpdatePath, '{"phase":"promotion_complete"}')
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    Invoke-WatchCycle $observations ($t0.AddSeconds(60))
    Assert-True ($script:closeRequests -eq 0 -and $script:launches.Count -eq 0) "active update must never close or restart Cursor"
    Remove-Item -LiteralPath $activeUpdatePath -Force
    Invoke-WatchCycle $observations ($t0.AddSeconds(64))
    Assert-True ($script:closeRequests -eq 0) "update completion must start fresh stability interval before normal close"
    Invoke-WatchCycle $observations ($t0.AddSeconds(76))
    Assert-True ($script:closeRequests -eq 1 -and $script:launches.Count -eq 1) "stable completed update must normally close and reopen its running Cursor install once"
    Assert-True ($script:launches[0].FilePath -eq $cursorExePath -and $script:launches[0].WindowStyle -eq "Normal") "relaunch must open the same Cursor executable visibly"
    Invoke-WatchCycle $observations ($t0.AddSeconds(80))
    Invoke-WatchCycle $observations ($t0.AddSeconds(92))
    Assert-True ($script:closeRequests -eq 1 -and $script:launches.Count -eq 1) "already repaired main.js must not trigger a second restart"
    Pass "automatic graceful restart occurs once after update cleanup and real stability"

    Reset-Fixture
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":true,"autoRelaunch":true}')
    $script:simulatedCursor = $false
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    Invoke-WatchCycle $observations ($t0.AddSeconds(12))
    Assert-True ($script:closeRequests -eq 0 -and $script:launches.Count -eq 0) "an already closed Cursor install must stay closed even when automatic relaunch is enabled"
    Pass "automatic repair does not launch a previously closed Cursor install"

    Reset-Fixture
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":true,"autoRelaunch":true}')
    $script:pendingExit = $true
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    Invoke-WatchCycle $observations ($t0.AddSeconds(12))
    Assert-True ($script:closeRequests -eq 1 -and $script:launches.Count -eq 0 -and $script:simulatedCursor) "save prompt or pending normal exit must never cause a duplicate launch or forced termination"
    Assert-True ($script:sleepTicks -eq 120) "normal-exit wait must stop after bounded 60 seconds"
    Pass "save prompt or cancelled exit leaves Cursor running with no duplicate launch"

    Reset-Fixture
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":true,"autoRelaunch":true}')
    $script:closeAccepted = $false
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    Invoke-WatchCycle $observations ($t0.AddSeconds(12))
    Assert-True ($script:closeRequests -eq 1 -and $script:launches.Count -eq 0 -and $script:sleepTicks -eq 0) "rejected normal close must abort without launching or waiting"
    Pass "rejected normal close safely aborts automatic restart"

    Reset-Fixture
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":true,"autoRelaunch":true}')
    $script:simulatedChild = $true
    $script:exitAfterTicks = 4
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    Invoke-WatchCycle $observations ($t0.AddSeconds(12))
    Assert-True ($script:closeRequests -eq 1 -and $script:sleepTicks -eq 4 -and $script:launches.Count -eq 1) "restart must wait for all processes in current installation, leaving another installation untouched"
    Pass "graceful restart waits for matching child processes without closing other installs"

    Reset-Fixture
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":true,"autoRelaunch":true}')
    $script:simulatedCursor = $false
    $script:simulatedChild = $true
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    Invoke-WatchCycle $observations ($t0.AddSeconds(12))
    Assert-True ($script:closeRequests -eq 0 -and $script:launches.Count -eq 0) "background process without a closeable Cursor window must not be terminated or relaunched"
    Pass "no closeable window aborts safely without launching another Cursor"

    Reset-Fixture
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":true,"autoRelaunch":true}')
    $script:updaterOnClose = $true
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    Invoke-WatchCycle $observations ($t0.AddSeconds(12))
    Assert-True ($script:closeRequests -eq 1 -and $script:launches.Count -eq 0) "updater starting during normal exit must block reopening"
    Pass "updater state is rechecked after normal exit before reopening"

    Reset-Fixture
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":true,"autoRelaunch":true}')
    $script:disableOnClose = $true
    $observations = @{}
    Invoke-WatchCycle $observations $t0
    Invoke-WatchCycle $observations ($t0.AddSeconds(12))
    Assert-True ($script:closeRequests -eq 1 -and $script:launches.Count -eq 0) "disabling RTL during normal exit must block reopening"
    Pass "enabled flag is rechecked after normal exit before reopening"

    Write-Output ("Watcher regression tests passed: " + $script:testsPassed)
} finally {
    # Resolve and verify before recursive cleanup; no fixture path points at a
    # user's actual Cursor installation or profile.
    $resolvedFixture = [System.IO.Path]::GetFullPath($fixtureRoot)
    $expectedParent = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
    if (-not $resolvedFixture.StartsWith($expectedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing fixture cleanup outside tests directory"
    }
    if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
