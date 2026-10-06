"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const bundlePath = path.join(__dirname, "..", "dist", "extension.js");
const bundle = fs.readFileSync(bundlePath, "utf8");
const windowsPath = path.win32;
const home = "C:\\Users\\rtl-regression";
const extensionPath = "C:\\Extensions\\rtl-cursor";
const appRoot = "C:\\Program Files\\Cursor\\resources\\app";
const outDir = windowsPath.join(appRoot, "out");
const mainJsPath = windowsPath.join(outDir, "main.js");
const stateDir = windowsPath.join(home, ".rtl-cursor");
const watchScriptPath = windowsPath.join(stateDir, "rtl-cursor-watch.ps1");
const watchPidPath = windowsPath.join(stateDir, "watch.pid");
const originalMain = "/* Copyright (C) Microsoft Corporation. */\nconst editorVersion = 'updated';\n";

// Run the actual shipped bundle in isolation. No editor, process, registry, or
// installed extension file is touched by these mocks.
function createHarness(options = {}) {
  const files = new Map([
    [outDir, null],
    [stateDir, null],
    [mainJsPath, originalMain],
    [windowsPath.join(home, ".rtl-cursor-enabled"), "1"],
    [windowsPath.join(extensionPath, "resources", "rtl-cursor-watch.ps1"), "# bundled watcher\n"],
    [windowsPath.join(extensionPath, "resources", "rtl-cursor-watch.vbs"), "' bundled launcher\n"],
    [windowsPath.join(extensionPath, "resources", "rtl-cursor-loader.cjs"), "// bundled loader\n"]
  ]);
  const timestamps = new Map();
  const spawnCalls = [];
  const execCalls = [];
  const quitCalls = [];
  const writes = [];
  const logs = [];
  const timers = [];
  const watchers = [];
  const commands = new Map();
  const globalStateWrites = [];
  let clock = Date.UTC(2026, 9, 6, 4, 0, 0);
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const config = { autoReapply: true, autoRelaunch: true, showStatusBar: true, ...options.config };
  const globalState = new Map([["rtlCursor.enabled", true]]);
  const context = {
    extensionPath,
    subscriptions: [],
    globalState: {
      get: (key) => globalState.get(key),
      update: async (key, value) => { globalStateWrites.push({ key, value }); globalState.set(key, value); }
    }
  };
  let configListener;
  const key = (file) => windowsPath.normalize(String(file));
  const read = (file) => {
    const target = key(file);
    if (!files.has(target) || files.get(target) === null) {
      const error = new Error(`ENOENT: ${target}`);
      error.code = "ENOENT";
      throw error;
    }
    return files.get(target);
  };
  const write = (file, content) => {
    const target = key(file);
    writes.push({ file: target, content: String(content) });
    files.set(target, String(content));
    timestamps.set(target, (timestamps.get(target) || 1000) + 1);
    if (options.onWrite) options.onWrite(target, String(content), files);
  };
  const fakeFs = {
    constants: { R_OK: 4, W_OK: 2 },
    existsSync: (file) => files.has(key(file)),
    readFileSync: (file, encoding) => encoding ? String(read(file)) : Buffer.from(String(read(file))),
    writeFileSync: write,
    appendFileSync: (file, content) => write(file, (files.get(key(file)) || "") + String(content)),
    copyFileSync: (src, dst) => write(dst, read(src)),
    renameSync: (src, dst) => { write(dst, read(src)); files.delete(key(src)); },
    unlinkSync: (file) => { files.delete(key(file)); },
    mkdirSync: (file) => { files.set(key(file), null); },
    accessSync: (file) => { read(file); },
    statSync: (file) => {
      const content = read(file);
      return { size: Buffer.byteLength(content), mtimeMs: timestamps.get(key(file)) || 1000, isFile: () => true };
    },
    readdirSync: (directory) => [...files.keys()]
      .filter((file) => windowsPath.dirname(file) === key(directory))
      .map((file) => windowsPath.basename(file)),
    watch: (file, callback) => {
      const watcher = { file: key(file), callback, closed: false, close() { this.closed = true; } };
      watchers.push(watcher);
      return watcher;
    }
  };
  fakeFs.promises = {
    readFile: async (...args) => fakeFs.readFileSync(...args),
    writeFile: async (...args) => fakeFs.writeFileSync(...args),
    stat: async (...args) => fakeFs.statSync(...args)
  };
  const childProcess = {
    spawn(command, args, spawnOptions) {
      const child = new EventEmitter();
      child.pid = 8000 + spawnCalls.length;
      child.unref = () => {};
      child.kill = () => { child.killed = true; };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      const call = { command, args, options: spawnOptions, child };
      spawnCalls.push(call);
      queueMicrotask(() => {
        if (options.onSpawn) options.onSpawn(call);
        if (options.spawnError && String(command).toLowerCase().includes("powershell")) {
          child.emit("error", new Error("PowerShell unavailable"));
        } else {
          child.emit("spawn");
          child.emit("exit", 0);
          child.emit("close", 0);
        }
      });
      return child;
    },
    execFileSync(command, args, execOptions) {
      execCalls.push({ command, args, options: execOptions });
      const result = options.execResult ? options.execResult(command, args, execOptions) : "";
      return execOptions && execOptions.encoding ? String(result) : Buffer.from(String(result));
    },
    execFile(command, args, execOptions, callback) {
      if (typeof execOptions === "function") callback = execOptions;
      execCalls.push({ command, args, options: execOptions });
      const result = options.execResult ? options.execResult(command, args, execOptions) : "";
      queueMicrotask(() => callback(null, String(result), ""));
      return { unref() {} };
    }
  };
  const vscode = {
    env: { appRoot },
    StatusBarAlignment: { Right: 2 },
    ThemeColor: function ThemeColor(id) { this.id = id; },
    commands: {
      registerCommand: (name, fn) => { commands.set(name, fn); return { dispose() {} }; },
      executeCommand: async (name) => {
        quitCalls.push(name);
        if (name === "workbench.action.quit" && options.quitError) throw new Error("Quit cancelled");
        if (commands.has(name)) return commands.get(name)();
      }
    },
    workspace: {
      getConfiguration: () => ({ get: (name, fallback) => name in config ? config[name] : fallback }),
      onDidChangeConfiguration: (listener) => { configListener = listener; return { dispose() {} }; }
    },
    window: {
      createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
      showInformationMessage: async (...args) => { logs.push({ level: "info", args }); return options.infoChoice; },
      showWarningMessage: async (...args) => { logs.push({ level: "warn", args }); return options.warningChoice; },
      showErrorMessage: async (...args) => { logs.push({ level: "error", args }); }
    }
  };
  const sandbox = {
    module: { exports: {} },
    exports: {},
    require(name) {
      if (name === "vscode") return vscode;
      if (name === "fs") return fakeFs;
      if (name === "path") return windowsPath;
      if (name === "os") return { homedir: () => home, tmpdir: () => "C:\\Temp" };
      if (name === "child_process") return childProcess;
      if (name === "crypto") return require("node:crypto");
      throw new Error(`Unexpected module required by bundle: ${name}`);
    },
    process: {
      platform: "win32", pid: 4567, ppid: 1234,
      execPath: "C:\\Program Files\\Cursor's app\\Cursor.exe",
      env: { VSCODE_PID: "1234", LOCALAPPDATA: windowsPath.join(home, "AppData", "Local") },
      kill: (...args) => { throw new Error(`Attempted to kill a real process: ${args}`); }
    },
    console: {
      log: (...args) => logs.push({ level: "log", args }),
      warn: (...args) => logs.push({ level: "warn", args }),
      error: (...args) => logs.push({ level: "error", args })
    },
    Buffer,
    Date: FakeDate,
    setTimeout: (fn, delay) => { const timer = { fn, delay, cancelled: false, unref() {} }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cancelled = true; },
    setInterval: (fn, delay) => { const timer = { fn, delay, interval: true, cancelled: false, unref() {} }; timers.push(timer); return timer; },
    clearInterval: (timer) => { if (timer) timer.cancelled = true; },
    queueMicrotask
  };
  vm.createContext(sandbox);
  vm.runInContext(bundle, sandbox, { filename: bundlePath });
  return {
    sandbox, files, writes, logs, spawnCalls, execCalls, quitCalls, timers, watchers, context, config, globalStateWrites,
    setFile: (file, content) => { files.set(key(file), content); },
    configChanged: (name) => { if (configListener) configListener({ affectsConfiguration: (candidate) => candidate === name }); },
    async settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); },
    async complete(promise, maximumTimers = 50) {
      let finished = false;
      let failure;
      promise.then(() => { finished = true; }, (error) => { finished = true; failure = error; });
      for (let i = 0; i < maximumTimers && !finished; i++) {
        await this.settle();
        if (!finished) await this.runTimer();
      }
      assert.equal(finished, true, "The isolated operation must complete within its retry limit");
      if (failure) throw failure;
    },
    async runTimer() {
      const timer = timers.find((item) => !item.cancelled && !item.ran);
      if (!timer) return false;
      timer.ran = true;
      clock += timer.delay;
      timer.fn();
      for (let i = 0; i < 12; i++) await Promise.resolve();
      return true;
    }
  };
}

function decodePowerShell(call) {
  const encodedIndex = call.args.indexOf("-EncodedCommand");
  assert.notEqual(encodedIndex, -1, "Windows helper must use an encoded PowerShell command");
  return Buffer.from(call.args[encodedIndex + 1], "base64").toString("utf16le");
}

function validatePowerShell(script) {
  if (process.platform !== "win32") return;
  const parserCommand = [
    "$script = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($env:RTL_TEST_SCRIPT_B64))",
    "$parseTokens = $null; $parseErrors = $null",
    "$null = [Management.Automation.Language.Parser]::ParseInput($script, [ref]$parseTokens, [ref]$parseErrors)",
    "if ($parseErrors.Count) { $parseErrors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }",
    "if (-not (Get-Command Start-Process).Parameters.ContainsKey('FilePath')) { exit 2 }"
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", parserCommand], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, RTL_TEST_SCRIPT_B64: Buffer.from(script, "utf16le").toString("base64") }
  });
  assert.equal(result.status, 0, result.stderr || "Generated PowerShell script did not parse");
}

function verifyMigrationWithMockProcesses(script, fakeProcesses, expectedStoppedIds) {
  if (process.platform !== "win32") return;
  // These PowerShell functions shadow every process API used by the generated
  // script. They only inspect in-memory records; no real PID can be stopped.
  assert.doesNotMatch(script, /taskkill|Start-Process|Microsoft\.PowerShell\.Management\\Stop-Process/i);
  const wrapper = [
    "$ErrorActionPreference = 'Stop'",
    "$global:fakeProcesses = ConvertFrom-Json -InputObject $env:RTL_TEST_FAKE_PROCESS",
    "$global:expectedStopped = ConvertFrom-Json -InputObject $env:RTL_TEST_EXPECTED_STOPS",
    "$global:fakeStopped = @()",
    "$global:fakeHelper = [pscustomobject]@{}",
    "$global:fakeHelper | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($timeout) $true }",
    "function Get-CimInstance { param($ClassName, $Filter); if ($ClassName -ne 'Win32_Process') { throw 'Unexpected process query' }; if ($Filter -match '^ProcessId=(\\d+)$') { return @($global:fakeProcesses | Where-Object { $_.ProcessId -eq [int]$matches[1] }) }; return $global:fakeProcesses }",
    "function Get-Process { param($Id, $ErrorAction); if ($Id -notin $global:expectedStopped) { throw 'Unrelated process was queried for stopping' }; return $global:fakeHelper }",
    "function Stop-Process { param($Id, [switch]$Force, $ErrorAction); $global:fakeStopped += $Id; $global:fakeProcesses = @($global:fakeProcesses | Where-Object { $_.ProcessId -ne $Id }) }",
    "$script = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($env:RTL_TEST_SCRIPT_B64))",
    "& ([scriptblock]::Create($script))",
    "if ($global:fakeStopped.Count -ne $global:expectedStopped.Count) { throw 'Unexpected number of stopped processes' }",
    "foreach ($stoppedId in $global:fakeStopped) { if ($stoppedId -notin $global:expectedStopped) { throw 'Unrelated process was stopped' } }"
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", wrapper], {
    encoding: "utf8", windowsHide: true,
    env: {
      ...process.env,
      RTL_TEST_SCRIPT_B64: Buffer.from(script, "utf16le").toString("base64"),
      RTL_TEST_FAKE_PROCESS: JSON.stringify(fakeProcesses),
      RTL_TEST_EXPECTED_STOPS: JSON.stringify(expectedStoppedIds)
    }
  });
  assert.equal(result.status, 0, result.stderr || "Mocked watcher migration failed");
}

test("Windows relaunch uses a valid FilePath parameter and waits for editor exit and update completion", async () => {
  const harness = createHarness();
  await harness.sandbox.scheduleEditorRelaunch();
  await harness.settle();
  const relaunch = harness.spawnCalls.find((call) => call.command === "powershell.exe" && call.args.includes("-EncodedCommand"));
  assert.ok(relaunch, "A hidden relaunch helper was created");
  const script = decodePowerShell(relaunch);
  validatePowerShell(script);
  assert.match(script, /Start-Process\s+-FilePath\b/i);
  assert.doesNotMatch(script, /Start-Process\s+-LiteralPath\b/i);
  assert.match(script, /Get-Process|Wait-Process/i, "The helper waits for graceful editor exit");
  assert.match(script, /\$_.Path\s+-eq\s+\$exe/, "Only processes from this editor installation are considered");
  assert.match(script, /\$running.Count\s+-eq\s+0\s+-and\s+-not\s+\$updating/, "A running editor or updater prevents relaunch");
  assert.match(script, /update-supervisor/);
  assert.match(script, /_bak/);
  assert.match(script, /UtcNow.AddSeconds\(/, "Cancelled quit cannot leave a permanent relaunch helper");
  assert.doesNotMatch(script, /taskkill|Stop-Process/i, "Relaunch must never forcibly terminate the editor");
  assert.equal(relaunch.options.windowsHide, true);
});

test("a failure to start the relaunch helper leaves the editor open", async () => {
  const harness = createHarness({ spawnError: true });
  await assert.rejects(harness.sandbox.relaunchEditorNow());
  assert.deepEqual(harness.quitCalls, [], "Quit must only be requested after helper scheduling succeeds");
});

test("a rejected quit cancels only the newly created relaunch helper", async () => {
  const harness = createHarness({ quitError: true });
  await assert.rejects(harness.sandbox.relaunchEditorNow(), /Quit cancelled/);
  assert.deepEqual(harness.quitCalls, ["workbench.action.quit"]);
  assert.equal(harness.spawnCalls.length, 1);
  assert.equal(harness.spawnCalls[0].child.killed, true);
  assert.equal(harness.sandbox.relaunchInFlight, false, "Retry is permitted after cancelled quit");
});

test("active editor updates prevent a manual restart", async () => {
  const harness = createHarness();
  harness.setFile(harness.sandbox.updateActiveManifestPath(), "{}");
  await assert.rejects(harness.sandbox.relaunchEditorNow(), /updat/i);
  assert.deepEqual(harness.quitCalls, []);
  assert.deepEqual(harness.spawnCalls, []);
});

test("automatic post-update repair preserves the updated editor and schedules one graceful restart", async () => {
  const harness = createHarness();
  harness.sandbox.statusBarItem = { show() {}, hide() {} };
  await harness.complete(harness.sandbox.enableCommand(harness.context, { silent: true }));
  await harness.settle();
  assert.ok(harness.files.get(mainJsPath).includes("rtl-cursor-loader.cjs"), "Updated main.js gets the RTL patch");
  const backups = [...harness.files.entries()].filter(([file]) => windowsPath.basename(file).startsWith("main.js.rtl-cursor-backup-"));
  assert.equal(backups.length, 1);
  assert.equal(backups[0][1], originalMain, "The backup contains the new editor version, unchanged");
  assert.deepEqual(harness.quitCalls, ["workbench.action.quit"], "Completed update repair activates RTL automatically through graceful quit");
  assert.equal(harness.spawnCalls.filter((call) => call.args.includes("-EncodedCommand") && decodePowerShell(call).includes("Start-Process")).length, 1,
    "Automatic repair schedules exactly one editor launch");
  assert.deepEqual(harness.globalStateWrites, [], "Automatic repair does not overwrite the user's enable preference");
  assert.equal(harness.writes.some(({ file }) => file === windowsPath.join(home, ".rtl-cursor-enabled")), false);
});

test("autoRelaunch false keeps the editor open after automatic RTL repair", async () => {
  const harness = createHarness({ config: { autoRelaunch: false } });
  harness.sandbox.statusBarItem = { show() {}, hide() {} };
  await harness.complete(harness.sandbox.enableCommand(harness.context, { silent: true }));
  assert.ok(harness.files.get(mainJsPath).includes("rtl-cursor-loader.cjs"));
  assert.deepEqual(harness.quitCalls, []);
  assert.equal(harness.spawnCalls.some((call) => call.args.includes("-EncodedCommand") && decodePowerShell(call).includes("Start-Process")), false);
});

test("updated watcher installation verifies helper identity before migrating its PID", async () => {
  const harness = createHarness();
  harness.setFile(watchScriptPath, "# old watcher\n");
  harness.setFile(watchPidPath, "9876");
  await harness.sandbox.installBackgroundWatch(extensionPath);
  const migration = harness.execCalls.find((call) => call.command === "powershell.exe");
  assert.ok(migration, "The old watcher was examined before copying the replacement");
  const script = decodePowerShell(migration);
  validatePowerShell(script);
  assert.match(script, /Get-CimInstance\s+Win32_Process/);
  assert.match(script, /\$_.Name\s+-eq\s+'powershell.exe'/);
  assert.match(script, /\$_.CommandLine\s+-match/);
  assert.ok(script.includes(watchScriptPath), "The exact managed watcher path identifies the process");
  assert.match(script, /Stop-Process\s+-Id/);
  assert.match(script, /WaitForExit\(5000\)/, "Replacement launch waits for old helper exit");
  assert.doesNotMatch(script, /taskkill|Cursor\.exe/i);
  assert.equal(harness.files.get(watchScriptPath), "# bundled watcher\n");
  assert.equal(harness.files.has(watchPidPath), false);
});

test("watcher migration never stops a reused PID belonging to an unrelated process", async () => {
  const harness = createHarness();
  harness.setFile(watchPidPath, "9876");
  await harness.sandbox.stopManagedWatchProcess();
  const script = decodePowerShell(harness.execCalls[0]);
  verifyMigrationWithMockProcesses(script, [
    { ProcessId: 9876, Name: "Cursor.exe", CommandLine: "Cursor.exe" },
    { ProcessId: 9877, Name: "powershell.exe", CommandLine: 'powershell.exe -File "C:\\unrelated.ps1"' },
    { ProcessId: 9878, Name: "powershell.exe", CommandLine: `powershell.exe -NoProfile -File "${watchScriptPath}"` }
  ], [9878]);
});

test("malformed stored watcher PID cannot target a process or inject PowerShell", async () => {
  const harness = createHarness();
  harness.setFile(watchScriptPath, "# old watcher\n");
  harness.setFile(watchPidPath, "9876; Stop-Process -Name Cursor");
  await harness.sandbox.installBackgroundWatch(extensionPath);
  const script = decodePowerShell(harness.execCalls[0]);
  assert.doesNotMatch(script, /Stop-Process -Name Cursor/, "A stored PID string never becomes executable code");
  verifyMigrationWithMockProcesses(script, [
    { ProcessId: 9876, Name: "powershell.exe", CommandLine: `powershell.exe -File "${watchScriptPath}"` }
  ], [9876]);
  assert.equal(harness.spawnCalls.some((call) => call.command.toLowerCase() === "taskkill"), false);
});

test("watcher migration finds the managed helper when its PID file is missing", async () => {
  const harness = createHarness();
  harness.setFile(watchScriptPath, "# old watcher\n");
  await harness.sandbox.installBackgroundWatch(extensionPath);
  const script = decodePowerShell(harness.execCalls[0]);
  verifyMigrationWithMockProcesses(script, [
    { ProcessId: 9876, Name: "powershell.exe", CommandLine: `powershell.exe -File "${watchScriptPath}"` },
    { ProcessId: 9877, Name: "powershell.exe", CommandLine: 'powershell.exe -File "C:\\other.ps1"' }
  ], [9876]);
  assert.equal(harness.files.get(watchScriptPath), "# bundled watcher\n");
});

test("matching watcher content preserves an existing helper and synchronizes autoReapply", async () => {
  const harness = createHarness({ config: { autoReapply: false } });
  harness.setFile(watchScriptPath, "# bundled watcher\n");
  harness.setFile(watchPidPath, "9876");
  await harness.sandbox.installBackgroundWatch(extensionPath);
  assert.deepEqual(harness.execCalls, [], "An unchanged watcher does not need process migration");
  assert.equal(harness.files.get(watchPidPath), "9876");
  assert.deepEqual(JSON.parse(harness.files.get(windowsPath.join(stateDir, "watch-settings.json"))), { autoReapply: false, autoRelaunch: true });
});

test("configuration changes immediately synchronize autoReapply with the background watcher", async () => {
  const harness = createHarness({ config: { autoReapply: false } });
  harness.sandbox.activate(harness.context);
  await harness.settle();
  harness.config.autoReapply = true;
  harness.configChanged("rtlCursor.autoReapply");
  await harness.settle();
  assert.deepEqual(JSON.parse(harness.files.get(windowsPath.join(stateDir, "watch-settings.json"))), { autoReapply: true, autoRelaunch: true });
  harness.config.autoRelaunch = false;
  harness.configChanged("rtlCursor.autoRelaunch");
  await harness.settle();
  assert.deepEqual(JSON.parse(harness.files.get(windowsPath.join(stateDir, "watch-settings.json"))), { autoReapply: true, autoRelaunch: false });
  harness.config.autoReapply = false;
  harness.configChanged("rtlCursor.autoReapply");
  await harness.settle();
  assert.deepEqual(JSON.parse(harness.files.get(windowsPath.join(stateDir, "watch-settings.json"))), { autoReapply: false, autoRelaunch: false });
});

test("a directory rename notification waits for the updater, then repairs and automatically restarts", async () => {
  const harness = createHarness();
  harness.sandbox.statusBarItem = { show() {}, hide() {} };
  harness.setFile(harness.sandbox.updateActiveManifestPath(), "{}");
  harness.sandbox.setupFileWatcher(mainJsPath, harness.context);
  assert.equal(harness.watchers[0].file, outDir, "Directory watching survives atomic main.js replacement");
  harness.watchers[0].callback("rename", "unrelated.js");
  assert.equal(harness.timers.length, 0, "Changes to unrelated editor files are ignored");
  harness.watchers[0].callback("rename", "main.js");
  await harness.runTimer();
  assert.equal(harness.files.get(mainJsPath), originalMain, "Active update files remain untouched");
  assert.equal(harness.files.has(windowsPath.join(outDir, "rtl-cursor-loader.cjs")), false);
  assert.deepEqual(harness.quitCalls, []);
  harness.files.delete(harness.sandbox.updateActiveManifestPath());
  for (let i = 0; i < 25 && harness.quitCalls.length === 0; i++) await harness.runTimer();
  await harness.settle();
  assert.ok(harness.files.get(mainJsPath).includes("rtl-cursor-loader.cjs"), "Repair retries after updater completion and stable files");
  assert.deepEqual(harness.quitCalls, ["workbench.action.quit"]);
});

for (const preference of ["autoReapply", "enabled"]) {
  test(`disabling ${preference} during file stability checks cancels automatic repair`, async () => {
    const harness = createHarness();
    harness.sandbox.statusBarItem = { show() {}, hide() {} };
    const repair = harness.sandbox.enableCommand(harness.context, { silent: true });
    await harness.settle();
    assert.ok(harness.timers.length > 0, "Automatic repair waits for stable editor files");
    if (preference === "enabled") await harness.context.globalState.update("rtlCursor.enabled", false);
    else harness.config.autoReapply = false;
    await harness.complete(repair);
    assert.equal(harness.files.get(mainJsPath), originalMain);
    assert.equal(harness.files.has(windowsPath.join(outDir, "rtl-cursor-loader.cjs")), false);
    assert.equal(harness.writes.some(({ file }) => windowsPath.basename(file).startsWith("main.js.rtl-cursor-backup-")), false);
    assert.deepEqual(harness.quitCalls, []);
  });
}

for (const preference of ["autoRelaunch", "autoReapply", "enabled"]) {
  test(`disabling ${preference} after patching cancels the pending automatic restart`, async () => {
    const harness = createHarness();
    harness.sandbox.statusBarItem = { show() {}, hide() {} };
    const repair = harness.sandbox.enableCommand(harness.context, { silent: true });
    await harness.settle();
    for (let i = 0; i < 25 && !harness.timers.some((timer) => timer.delay === 900 && !timer.ran && !timer.cancelled); i++) {
      await harness.runTimer();
    }
    assert.ok(harness.files.get(mainJsPath).includes("rtl-cursor-loader.cjs"), "The patch was completed before the preference changed");
    assert.ok(harness.timers.some((timer) => timer.delay === 900 && !timer.ran && !timer.cancelled), "The restart is still in its notification delay");
    if (preference === "enabled") await harness.context.globalState.update("rtlCursor.enabled", false);
    else harness.config[preference] = false;
    await harness.complete(repair);
    assert.deepEqual(harness.quitCalls, [], "An updated preference cancels graceful quit");
    assert.equal(harness.spawnCalls.some((call) => call.args.includes("-EncodedCommand") && decodePowerShell(call).includes("Start-Process")), false,
      "A cancelled restart never starts an editor relaunch helper");
    if (preference === "enabled") assert.equal(harness.context.globalState.get("rtlCursor.enabled"), false);
  });
}

test("a preference change while the relaunch helper starts stops only that helper and keeps the editor open", async () => {
  let harness;
  harness = createHarness({
    onSpawn(call) {
      if (call.args.includes("-EncodedCommand") && decodePowerShell(call).includes("Start-Process")) harness.config.autoReapply = false;
    }
  });
  harness.sandbox.statusBarItem = { show() {}, hide() {} };
  await harness.complete(harness.sandbox.enableCommand(harness.context, { silent: true }));
  assert.deepEqual(harness.quitCalls, []);
  const cancelledHelper = harness.spawnCalls.find((call) => call.args.includes("-EncodedCommand") && decodePowerShell(call).includes("Start-Process"));
  assert.ok(cancelledHelper);
  assert.equal(cancelledHelper.child.killed, true);
  assert.equal(harness.spawnCalls.filter((call) => call.child.killed).length, 1, "Only the newly created helper is stopped");
});

test("file stability never succeeds while update promotion artifacts exist", async () => {
  const harness = createHarness();
  harness.setFile(windowsPath.join("C:\\Program Files\\Cursor", "_bak"), null);
  let stable;
  await harness.complete(harness.sandbox.waitForEditorFilesStable(mainJsPath, 12000).then((result) => { stable = result; }));
  assert.equal(stable, false);
  assert.equal(harness.writes.length, 0);
});

test("applying the RTL patch preserves unrelated createRequire imports", () => {
  const harness = createHarness();
  const unrelatedImport = 'import{createRequire}from"module";const requireForEditor=createRequire(import.meta.url);';
  const source = originalMain + unrelatedImport + "\n";
  harness.setFile(mainJsPath, source);
  harness.sandbox.applyPatch(mainJsPath);
  const patched = harness.files.get(mainJsPath);
  assert.ok(patched.includes(unrelatedImport));
  assert.match(patched, /createRequire as __rtlCursorCreateRequire/);
  const backups = [...harness.files.entries()].filter(([file]) => windowsPath.basename(file).startsWith("main.js.rtl-cursor-backup-"));
  assert.equal(backups[0][1], source);
});

test("disabling strips only the RTL patch instead of restoring a stale editor backup", () => {
  const harness = createHarness();
  harness.sandbox.applyPatch(mainJsPath);
  harness.setFile(windowsPath.join(outDir, "main.js.rtl-cursor-backup-99999999T999999"), "outdated editor code");
  harness.setFile(windowsPath.join(outDir, "rtl-cursor-loader.cjs"), "loader");
  harness.sandbox.removePatch(mainJsPath);
  assert.equal(harness.files.get(mainJsPath), originalMain);
  assert.equal(harness.files.has(windowsPath.join(outDir, "rtl-cursor-loader.cjs")), false);
});

test("a concurrent editor update wins over a pending RTL file replacement", () => {
  const updatedAgain = originalMain + "const secondUpdate = true;\n";
  const harness = createHarness({
    onWrite(file, content, files) {
      if (file.startsWith(`${mainJsPath}.rtl-cursor-`) && file.endsWith(".tmp")) files.set(mainJsPath, updatedAgain);
    }
  });
  assert.throws(() => harness.sandbox.applyPatch(mainJsPath), /files changed/i);
  assert.equal(harness.files.get(mainJsPath), updatedAgain, "The updater's newest content is retained");
  assert.equal([...harness.files.keys()].some((file) => file.startsWith(`${mainJsPath}.rtl-cursor-`) && file.endsWith(".tmp")), false,
    "Aborted patch removes its temporary file");
});

module.exports = { createHarness, decodePowerShell, validatePowerShell };
