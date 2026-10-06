# Parse and extract helper functions only. Never run its operational USERPROFILE
# entry point, touch the real registry, or start/stop any real process.
$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$helperPath = Join-Path $repositoryRoot "scripts\update-agent-watcher.ps1"
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($helperPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw ($parseErrors | Out-String) }
foreach ($function in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    Invoke-Expression $function.Extent.Text
}
$cursorControls = @($ast.FindAll({
    param($node)
    ($node -is [System.Management.Automation.Language.InvokeMemberExpressionAst] -and $node.Member.Extent.Text -match '^(?:CloseMainWindow|Kill)$') -or
    ($node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq "taskkill")
}, $true))
if ($cursorControls.Count -gt 0) { throw "Migration helper must never control Cursor itself." }

$fixtureRoot = Join-Path $PSScriptRoot ("migration-fixtures-" + [guid]::NewGuid().ToString("N"))
$fixtureHome = Join-Path $fixtureRoot "home with spaces"
$extensionRoot = Join-Path $fixtureHome ".cursor\extensions"
$fixtureState = Join-Path $fixtureHome ".rtl-cursor"
$flagPath = Join-Path $fixtureHome ".rtl-cursor-enabled"
$managedPath = Join-Path $fixtureState "rtl-cursor-watch.ps1"
$settingsPath = Join-Path $fixtureState "watch-settings.json"
$fixtureRoaming = Join-Path $fixtureHome "AppData\Roaming"
$cursorUserSettings = Join-Path $fixtureRoaming "Cursor\User\settings.json"
$script:processes = @()
$script:stopped = @()
$script:launches = @()
$script:registryUpdates = @()
$script:registryHasEntry = $true
$script:registryCommand = "old watcher command"
$script:reuseProcessId = $false
$script:refuseStop = $false
$script:waitFailed = $false
$script:clock = [datetime]"2026-10-06T02:00:00Z"
$script:launchStartsWatcher = $true
$script:newWatcherIsStale = $false
$script:sleepTicks = 0
$script:testsPassed = 0

function Assert-True([bool]$condition, [string]$message) {
    if (-not $condition) { throw "FAIL: $message" }
}
function Pass([string]$name) { $script:testsPassed++; Write-Output ("PASS: " + $name) }
function Get-CimInstance {
    [CmdletBinding()]
    param([string]$ClassName, [string]$Filter)
    if ($Filter -eq "Name = 'powershell.exe'") {
        $script:processes | Where-Object { $_.Name -eq "powershell.exe" }
    } elseif ($Filter -match '^ProcessId=(\d+)$') {
        $process = @($script:processes | Where-Object { $_.ProcessId -eq [int]$Matches[1] }) | Select-Object -First 1
        if ($script:reuseProcessId -and $process.ProcessId -eq 101) {
            [pscustomobject]@{ Name = $process.Name; ProcessId = $process.ProcessId; CreationDate = ([datetime]$process.CreationDate).AddMinutes(1); CommandLine = $process.CommandLine }
        } else { $process }
    } else { throw "Unexpected CIM request: $Filter" }
}
function Get-Process {
    [CmdletBinding()]
    param([int]$Id)
    if (@($script:processes | Where-Object { $_.ProcessId -eq $Id }).Count -gt 0) {
        $helper = [pscustomobject]@{ Id = $Id }
        $helper | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param([int]$milliseconds) return (-not $script:waitFailed) }
        $helper
    }
}
function Stop-Process {
    [CmdletBinding()]
    param([int]$Id, [switch]$Force)
    $script:stopped += $Id
    if (-not $script:refuseStop) { $script:processes = @($script:processes | Where-Object { $_.ProcessId -ne $Id }) }
}
function Get-ItemProperty {
    [CmdletBinding()]
    param([string]$LiteralPath, [string]$Name)
    if ($script:registryHasEntry) { [pscustomobject]@{ RtlCursorWatch = $script:registryCommand } }
}
function Set-ItemProperty {
    [CmdletBinding()]
    param([string]$LiteralPath, [string]$Name, [string]$Value)
    $script:registryUpdates += [pscustomobject]@{ LiteralPath = $LiteralPath; Name = $Name; Value = $Value }
    $script:registryCommand = $Value
}
function Start-Process {
    [CmdletBinding()]
    param([string]$FilePath, [string[]]$ArgumentList, [string]$WindowStyle)
    $script:launches += [pscustomobject]@{ FilePath = $FilePath; ArgumentList = $ArgumentList; WindowStyle = $WindowStyle }
    if ($script:launchStartsWatcher) {
        $creationDate = $script:clock.AddMilliseconds(1)
        if ($script:newWatcherIsStale) { $creationDate = $script:clock.AddHours(-1) }
        $script:processes += [pscustomobject]@{ Name = "powershell.exe"; ProcessId = 404; CreationDate = $creationDate; CommandLine = ('powershell.exe -NoProfile -File "' + $managedPath + '"') }
    }
}
function Get-MigrationUtcNow { return $script:clock }
function Start-Sleep {
    param([int]$Milliseconds)
    $script:clock = $script:clock.AddMilliseconds($Milliseconds)
    $script:sleepTicks++
}
function New-FixtureExtension([string]$version, [string]$publisher = "fusoft") {
    $path = Join-Path $extensionRoot ("fusoft.rtl-cursor-" + $version)
    New-Item -ItemType Directory -Path (Join-Path $path "resources") -Force | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $path "package.json"), ('{"name":"rtl-cursor","publisher":"' + $publisher + '","version":"' + $version + '"}'))
    foreach ($name in @("rtl-cursor-watch.ps1", "rtl-cursor-watch.vbs", "rtl-cursor-loader.cjs")) {
        [System.IO.File]::WriteAllBytes((Join-Path $path ("resources\" + $name)), [System.IO.File]::ReadAllBytes((Join-Path $repositoryRoot ("resources\" + $name))))
    }
    return $path
}
function Reset-Fixture {
    [System.IO.File]::WriteAllText($flagPath, "keep enabled")
    [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":false,"autoRelaunch":false,"custom":"preserve exactly"}')
    foreach ($name in @("rtl-cursor-watch.ps1", "rtl-cursor-watch.vbs", "rtl-cursor-loader.cjs")) {
        [System.IO.File]::WriteAllText((Join-Path $fixtureState $name), "old content: $name")
    }
    [System.IO.File]::WriteAllText((Join-Path $fixtureState "watch.pid"), "303")
    if (Test-Path -LiteralPath $cursorUserSettings) { Remove-Item -LiteralPath $cursorUserSettings -Force }
    $script:processes = @(
        [pscustomobject]@{ Name = "powershell.exe"; ProcessId = 101; CreationDate = [datetime]"2026-10-06T01:00:00Z"; CommandLine = ('powershell.exe -NoProfile -File "' + $managedPath + '"') },
        [pscustomobject]@{ Name = "powershell.exe"; ProcessId = 202; CreationDate = [datetime]"2026-10-06T01:00:00Z"; CommandLine = ('powershell.exe -File "' + $managedPath + '.other"') },
        [pscustomobject]@{ Name = "Cursor.exe"; ProcessId = 303; CreationDate = [datetime]"2026-10-06T01:00:00Z"; CommandLine = "Cursor.exe --agent" }
    )
    $script:stopped = @()
    $script:launches = @()
    $script:registryUpdates = @()
    $script:registryHasEntry = $true
    $script:registryCommand = "old watcher command"
    $script:reuseProcessId = $false
    $script:refuseStop = $false
    $script:waitFailed = $false
    $script:clock = [datetime]"2026-10-06T02:00:00Z"
    $script:launchStartsWatcher = $true
    $script:newWatcherIsStale = $false
    $script:sleepTicks = 0
}

try {
    New-Item -ItemType Directory -Path $extensionRoot, $fixtureState, (Split-Path -Parent $cursorUserSettings) -Force | Out-Null
    $oldExtension = New-FixtureExtension "1.0.12"
    $releaseExtension = New-FixtureExtension "1.0.13"
    $newerExtension = New-FixtureExtension "1.0.14"
    $invalidExtension = New-FixtureExtension "1.0.99" "someone-else"

    Reset-Fixture
    $selected = Find-InstalledWatcherPackage $fixtureHome $null
    Assert-True ($selected.Path -eq $newerExtension) "automatic discovery must choose highest valid installed version"
    $rejected = $false
    try { Get-InstalledWatcherPackage $oldExtension | Out-Null } catch { $rejected = $true }
    Assert-True $rejected "legacy extension must not be accepted as upgrade source"
    $rejected = $false
    try { Get-InstalledWatcherPackage $invalidExtension | Out-Null } catch { $rejected = $true }
    Assert-True $rejected "package publisher must be verified"
    Pass "highest installed supported package is selected with manifest validation"

    Reset-Fixture
    $preferences = [System.IO.File]::ReadAllBytes($settingsPath)
    $result = Update-AgentWatcher $fixtureHome $releaseExtension
    Assert-True ($result.Version -eq "1.0.13") "explicit installed extension must select requested version"
    Assert-True ($script:stopped.Count -eq 1 -and $script:stopped[0] -eq 101) "only exact-path managed watcher may be stopped, independent of stale PID file"
    Assert-True (@($script:processes | Where-Object { $_.ProcessId -eq 202 -or $_.ProcessId -eq 303 }).Count -eq 2) "other PowerShell session and Cursor must remain untouched"
    foreach ($name in @("rtl-cursor-watch.ps1", "rtl-cursor-watch.vbs", "rtl-cursor-loader.cjs")) {
        Assert-True (([Convert]::ToBase64String([System.IO.File]::ReadAllBytes((Join-Path $fixtureState $name)))) -eq
            ([Convert]::ToBase64String([System.IO.File]::ReadAllBytes((Join-Path $releaseExtension ("resources\" + $name)))))) "all managed resources must be atomically deployed"
    }
    Assert-True (([Convert]::ToBase64String([System.IO.File]::ReadAllBytes($settingsPath))) -eq [Convert]::ToBase64String($preferences)) "watch settings must be preserved byte for byte"
    Assert-True (([System.IO.File]::ReadAllText($flagPath)) -eq "keep enabled") "enabled flag must be preserved"
    Assert-True ($script:launches.Count -eq 1 -and (Split-Path -Leaf $script:launches[0].FilePath) -eq "wscript.exe" -and $script:launches[0].WindowStyle -eq "Hidden") "only hidden managed wscript launcher may be started"
    Assert-True ($script:launches[0].ArgumentList[2] -eq ('"' + (Join-Path $fixtureState "rtl-cursor-watch.vbs") + '"')) "managed VBS path with spaces must stay quoted"
    Assert-True ($script:registryUpdates.Count -eq 1 -and $script:registryUpdates[0].Name -eq "RtlCursorWatch") "existing Run value must be updated without touching other startup settings"
    Assert-True (@(Get-ChildItem -LiteralPath $fixtureState -Filter "*.upgrade-*").Count -eq 0) "successful upgrade must clean staging and backup files"
    Pass "existing enabled watcher migrates safely without changing preferences or Cursor"

    Reset-Fixture
    Remove-Item -LiteralPath $flagPath -Force
    $rejected = $false
    try { Update-AgentWatcher $fixtureHome $releaseExtension | Out-Null } catch { $rejected = $true }
    Assert-True ($rejected -and $script:stopped.Count -eq 0 -and $script:launches.Count -eq 0 -and -not (Test-Path -LiteralPath $flagPath)) "disabled RTL must not be enabled or migrated"
    Pass "disabled extension is left disabled without process or startup mutations"

    Reset-Fixture
    $missingResource = Join-Path $releaseExtension "resources\rtl-cursor-loader.cjs"
    $loaderBytes = [System.IO.File]::ReadAllBytes($missingResource)
    Remove-Item -LiteralPath $missingResource -Force
    try {
        $rejected = $false
        try { Update-AgentWatcher $fixtureHome $releaseExtension | Out-Null } catch { $rejected = $true }
        Assert-True ($rejected -and $script:stopped.Count -eq 0 -and $script:launches.Count -eq 0) "missing source resource must fail before stopping the old watcher"
    } finally { [System.IO.File]::WriteAllBytes($missingResource, $loaderBytes) }
    Pass "all source resources must validate before stopping an existing watcher"

    Reset-Fixture
    $script:reuseProcessId = $true
    $rejected = $false
    try { Update-AgentWatcher $fixtureHome $releaseExtension | Out-Null } catch { $rejected = $true }
    Assert-True ($rejected -and $script:stopped.Count -eq 0 -and $script:launches.Count -eq 0) "changed CreationDate must reject termination and remaining watcher must abort upgrade"
    Assert-True (([System.IO.File]::ReadAllText($managedPath)) -eq "old content: rtl-cursor-watch.ps1") "rejected process verification must not replace live script"
    Pass "PID reuse is rechecked using CreationDate before termination"

    Reset-Fixture
    $script:refuseStop = $true
    $rejected = $false
    try { Update-AgentWatcher $fixtureHome $releaseExtension | Out-Null } catch { $rejected = $true }
    Assert-True ($rejected -and $script:launches.Count -eq 0 -and $script:registryUpdates.Count -eq 0) "remaining managed process must abort before deployment and relaunch"
    Assert-True (([System.IO.File]::ReadAllText($managedPath)) -eq "old content: rtl-cursor-watch.ps1") "remaining watcher must leave old files intact"
    Assert-True (@(Get-ChildItem -LiteralPath $fixtureState -Filter "*.upgrade-*").Count -eq 0) "aborted upgrade must clean staged files"
    Pass "remaining old watcher prevents deployment and duplicate watcher launch"

    Reset-Fixture
    $script:waitFailed = $true
    $rejected = $false
    try { Update-AgentWatcher $fixtureHome $releaseExtension | Out-Null } catch { $rejected = $true }
    Assert-True ($rejected -and $script:launches.Count -eq 0) "normal helper exit wait must succeed before replacement"
    Pass "watcher exit timeout aborts safely before deployment"

    Reset-Fixture
    $script:registryHasEntry = $false
    Remove-Item -LiteralPath $settingsPath -Force
    Update-AgentWatcher $fixtureHome $releaseExtension | Out-Null
    $initialized = [System.IO.File]::ReadAllText($settingsPath) | ConvertFrom-Json
    Assert-True ($script:registryUpdates.Count -eq 0 -and $initialized.autoReapply -eq $true -and $initialized.autoRelaunch -eq $true) "absent startup entry stays absent; missing preference and user settings files use configured defaults"
    Pass "startup disabled status is preserved and missing legacy settings use defaults"

    Reset-Fixture
    Remove-Item -LiteralPath $settingsPath -Force
    $jsonc = @'
{
    // Cursor user preferences
    "url": "https://example.com/a//b/*c*/?q=,}",
    "escaped": "quoted: \" // keep inside string /* keep */",
    /* RTL preferences remain disabled */
    "rtlCursor.autoReapply": false,
    "rtlCursor.autoRelaunch": false,
    "unrelated": [1, 2,],
}
'@
    [System.IO.File]::WriteAllText($cursorUserSettings, $jsonc)
    $readPreferences = Read-CursorUserWatchPreferences $fixtureRoaming
    Assert-True (-not $readPreferences.autoReapply -and -not $readPreferences.autoRelaunch) "JSONC parser must preserve URLs/quoted markers while reading false preferences"
    Update-AgentWatcher $fixtureHome $releaseExtension $fixtureRoaming | Out-Null
    $initialized = [System.IO.File]::ReadAllText($settingsPath) | ConvertFrom-Json
    Assert-True ($initialized.autoReapply -eq $false -and $initialized.autoRelaunch -eq $false) "legacy migration must import user RTL preferences before launching new watcher"
    Assert-True (([System.IO.File]::ReadAllText($cursorUserSettings)) -eq $jsonc) "Cursor user settings must never be edited"
    Pass "missing watcher preferences import Cursor JSONC booleans preserving quoted comment markers"

    foreach ($invalidSettings in @('{"rtlCursor.autoReapply":', '{"rtlCursor.autoReapply":"false"}')) {
        Reset-Fixture
        Remove-Item -LiteralPath $settingsPath -Force
        [System.IO.File]::WriteAllText($cursorUserSettings, $invalidSettings)
        $rejected = $false
        try { Update-AgentWatcher $fixtureHome $releaseExtension $fixtureRoaming | Out-Null } catch { $rejected = $true }
        Assert-True ($rejected -and $script:stopped.Count -eq 0 -and $script:launches.Count -eq 0 -and -not (Test-Path -LiteralPath $settingsPath)) "invalid Cursor settings must fail closed before stopping watcher or initializing defaults"
    }
    Pass "invalid JSONC and non-boolean preferences fail closed before watcher stop"

    Reset-Fixture
    [System.IO.File]::WriteAllText($cursorUserSettings, '{invalid')
    $preferences = [System.IO.File]::ReadAllText($settingsPath)
    Update-AgentWatcher $fixtureHome $releaseExtension $fixtureRoaming | Out-Null
    Assert-True (([System.IO.File]::ReadAllText($settingsPath)) -eq $preferences) "existing watcher preferences must remain authoritative and byte exact"
    Pass "existing watcher preferences stay untouched without reading unrelated user settings"

    Reset-Fixture
    $script:launchStartsWatcher = $false
    $rejected = $false
    try { Update-AgentWatcher $fixtureHome $releaseExtension | Out-Null } catch { $rejected = $true }
    Assert-True ($rejected -and $script:launches.Count -eq 1 -and $script:sleepTicks -eq 30) "successful launcher without a new matching watcher must time out instead of reporting success"
    Assert-True (@($script:processes | Where-Object { $_.ProcessId -eq 303 }).Count -eq 1) "failed watcher startup must never control Cursor as a fallback"
    Pass "launcher success requires a new exact-path watcher acknowledgement"

    Reset-Fixture
    $script:newWatcherIsStale = $true
    $rejected = $false
    try { Update-AgentWatcher $fixtureHome $releaseExtension | Out-Null } catch { $rejected = $true }
    Assert-True ($rejected -and $script:sleepTicks -eq 30) "a matching stale helper must not satisfy new watcher startup acknowledgement"
    Pass "new watcher acknowledgement requires a new CreationDate"

    Reset-Fixture
    $originalPublish = ${function:Publish-WatcherFileStage}
    function Publish-WatcherFileStage($stage) {
        if ((Split-Path -Leaf $stage.Destination) -eq "rtl-cursor-loader.cjs") { throw "simulated deployment failure" }
        & $originalPublish $stage
    }
    try {
        $rejected = $false
        try { Update-AgentWatcher $fixtureHome $releaseExtension | Out-Null } catch { $rejected = $true }
        Assert-True ($rejected -and $script:launches.Count -eq 0) "partial deployment failure must abort watcher launch"
        foreach ($name in @("rtl-cursor-watch.ps1", "rtl-cursor-watch.vbs", "rtl-cursor-loader.cjs")) {
            Assert-True (([System.IO.File]::ReadAllText((Join-Path $fixtureState $name))) -eq "old content: $name") "partial deployment must restore original managed resources"
        }
    } finally { Set-Item -LiteralPath Function:\Publish-WatcherFileStage -Value $originalPublish }
    Pass "partial deployment failure restores original managed resources"

    Reset-Fixture
    Remove-Item -LiteralPath $settingsPath -Force
    [System.IO.File]::WriteAllText($cursorUserSettings, '{"rtlCursor.autoReapply":false,"rtlCursor.autoRelaunch":false}')
    $originalPublish = ${function:Publish-WatcherFileStage}
    function Publish-WatcherFileStage($stage) {
        & $originalPublish $stage
        if ((Split-Path -Leaf $stage.Destination) -eq "watch-settings.json") { throw "simulated failure after preference publication" }
    }
    try {
        $rejected = $false
        try { Update-AgentWatcher $fixtureHome $releaseExtension $fixtureRoaming | Out-Null } catch { $rejected = $true }
        Assert-True ($rejected -and $script:launches.Count -eq 0 -and -not (Test-Path -LiteralPath $settingsPath)) "partial migration must roll back newly initialized preferences with other resources"
        foreach ($name in @("rtl-cursor-watch.ps1", "rtl-cursor-watch.vbs", "rtl-cursor-loader.cjs")) {
            Assert-True (([System.IO.File]::ReadAllText((Join-Path $fixtureState $name))) -eq "old content: $name") "preference publication failure must restore original watcher files"
        }
    } finally { Set-Item -LiteralPath Function:\Publish-WatcherFileStage -Value $originalPublish }
    Pass "new legacy preference file rolls back atomically with managed resources"

    Reset-Fixture
    Remove-Item -LiteralPath $settingsPath -Force
    $originalStop = ${function:Stop-ManagedWatcher}
    function Stop-ManagedWatcher([string]$scriptPath) {
        & $originalStop $scriptPath
        [System.IO.File]::WriteAllText($settingsPath, '{"autoReapply":false,"autoRelaunch":false,"new":"preserve concurrently saved preferences"}')
    }
    try {
        Update-AgentWatcher $fixtureHome $releaseExtension $fixtureRoaming | Out-Null
        Assert-True (([System.IO.File]::ReadAllText($settingsPath)).Contains("preserve concurrently saved preferences")) "preferences appearing after staging must not be overwritten by migration defaults"
    } finally { Set-Item -LiteralPath Function:\Stop-ManagedWatcher -Value $originalStop }
    Pass "preferences saved during migration remain authoritative"

    Write-Output ("Migration regression tests passed: " + $script:testsPassed)
} finally {
    $resolvedFixture = [System.IO.Path]::GetFullPath($fixtureRoot)
    $expectedParent = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
    if (-not $resolvedFixture.StartsWith($expectedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing fixture cleanup outside tests directory"
    }
    if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
