"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode2 = __toESM(require("vscode"));
var fs3 = __toESM(require("fs"));
var os = __toESM(require("os"));
var pathUser = __toESM(require("path"));
var child_process = require("child_process");
var WANT_ENABLED_KEY = "rtlCursor.enabled";
var relaunchInFlight = false;
var watchInstallInFlight;
var repairTimer;
var repairInFlight = false;
var repairGeneration = 0;
var WATCH_RUN_VALUE = "RtlCursorWatch";
function enabledFlagPath() {
  return pathUser.join(os.homedir(), ".rtl-cursor-enabled");
}
function watchStateDir() {
  return pathUser.join(os.homedir(), ".rtl-cursor");
}
function watchScriptPath() {
  return pathUser.join(watchStateDir(), "rtl-cursor-watch.ps1");
}
function watchVbsPath() {
  return pathUser.join(watchStateDir(), "rtl-cursor-watch.vbs");
}
function watchLoaderCachePath() {
  return pathUser.join(watchStateDir(), "rtl-cursor-loader.cjs");
}
function readWantEnabled(context) {
  const stored = context.globalState.get(WANT_ENABLED_KEY);
  if (stored === true) return true;
  if (stored === false) return false;
  try {
    return fs3.existsSync(enabledFlagPath());
  } catch {
    return false;
  }
}
async function writeWantEnabled(context, enabled) {
  if (context) {
    await context.globalState.update(WANT_ENABLED_KEY, enabled);
  }
  try {
    const flag = enabledFlagPath();
    if (enabled) {
      fs3.writeFileSync(flag, "1", "utf8");
    } else if (fs3.existsSync(flag)) {
      fs3.unlinkSync(flag);
    }
  } catch {
  }
}

// src/paths.ts
var vscode = __toESM(require("vscode"));
var path = __toESM(require("path"));
var fs = __toESM(require("fs"));
function getAppOutDir() {
  const appRoot = vscode.env.appRoot;
  const candidate = path.join(appRoot, "out");
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  const altCandidate = path.join(appRoot, "resources", "app", "out");
  if (fs.existsSync(altCandidate)) {
    return altCandidate;
  }
  const parentCandidate = path.join(path.dirname(appRoot), "out");
  if (fs.existsSync(parentCandidate)) {
    return parentCandidate;
  }
  return candidate;
}
function getMainJsPath() {
  return path.join(getAppOutDir(), "main.js");
}
function validatePaths() {
  const mainJsPath = getMainJsPath();
  if (!fs.existsSync(mainJsPath)) {
    return {
      valid: false,
      mainJsPath,
      error: `main.js \u067E\u06CC\u062F\u0627 \u0646\u0634\u062F: ${mainJsPath}`
    };
  }
  try {
    fs.accessSync(mainJsPath, fs.constants.R_OK);
  } catch {
    return {
      valid: false,
      mainJsPath,
      error: `\u062F\u0633\u062A\u0631\u0633\u06CC \u062E\u0648\u0627\u0646\u062F\u0646 \u0646\u062F\u0627\u0631\u06CC\u062F: ${mainJsPath}`
    };
  }
  return { valid: true, mainJsPath };
}

// src/patcher.ts
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));

// src/constants.ts
var PATCH_LINE = 'import{createRequire as __rtlCursorCreateRequire}from"module";try{__rtlCursorCreateRequire(import.meta.url)("./rtl-cursor-loader.cjs")}catch(e){console.error("[RTL Cursor] error loading ./rtl-cursor-loader.cjs: ", e)}';
var PATCH_MARKER = "rtl-cursor-loader.cjs";
var LOADER_FILENAME = "rtl-cursor-loader.cjs";
var BACKUP_PREFIX = "main.js.rtl-cursor-backup-";

// src/patcher.ts
function isPatched(mainJsPath) {
  try {
    const content = fs2.readFileSync(mainJsPath, "utf-8");
    return content.includes(PATCH_MARKER);
  } catch {
    return false;
  }
}
function stripPatchLines(content) {
  return content.split("\n").filter((line) => !line.includes(PATCH_MARKER)).join("\n");
}
function formatTimestamp() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return now.getFullYear().toString() + pad(now.getMonth() + 1) + pad(now.getDate()) + "T" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
}
function backup(mainJsPath) {
  const dir = path2.dirname(mainJsPath);
  const backupPath = path2.join(dir, BACKUP_PREFIX + formatTimestamp());
  fs2.copyFileSync(mainJsPath, backupPath);
  return backupPath;
}
function findLatestBackup(mainJsDir) {
  try {
    const files = fs2.readdirSync(mainJsDir);
    const backups = files.filter((f) => f.startsWith(BACKUP_PREFIX)).sort().reverse();
    return backups.length > 0 ? path2.join(mainJsDir, backups[0]) : null;
  } catch {
    return null;
  }
}
function hasBackups(mainJsPath) {
  return findLatestBackup(path2.dirname(mainJsPath)) !== null;
}
function applyPatch(mainJsPath) {
  const content = fs2.readFileSync(mainJsPath, "utf-8");
  if (!content.includes("Copyright (C) Microsoft Corporation")) {
    throw new Error(
      "\u0641\u0627\u06CC\u0644 main.js \u0627\u0645\u0636\u0627\u06CC \u0645\u0648\u0631\u062F \u0627\u0646\u062A\u0638\u0627\u0631 \u0631\u0627 \u0646\u062F\u0627\u0631\u062F. \u0646\u0633\u062E\u0647 Cursor \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u0646\u0645\u06CC\u200C\u0634\u0648\u062F \u06CC\u0627 \u0641\u0627\u06CC\u0644 \u062E\u0631\u0627\u0628 \u0627\u0633\u062A."
    );
  }
  if (content.includes(PATCH_LINE)) {
    return;
  }
  const clean = stripPatchLines(content);
  const copyrightEnd = clean.indexOf("*/");
  if (copyrightEnd === -1) {
    throw new Error("Cannot find the copyright header in main.js");
  }
  const insertPos = copyrightEnd + 2;
  const patched = clean.substring(0, insertPos) + "\n" + PATCH_LINE + clean.substring(insertPos);
  backup(mainJsPath);
  replaceMainJs(mainJsPath, content, patched);
}
function replaceMainJs(mainJsPath, original, replacement) {
  const tempPath = `${mainJsPath}.rtl-cursor-${process.pid}-${Date.now()}.tmp`;
  try {
    fs2.writeFileSync(tempPath, replacement, { encoding: "utf8", flag: "wx" });
    if (isEditorUpdateInProgress(mainJsPath) || fs2.readFileSync(mainJsPath, "utf8") !== original) {
      throw new Error("Editor files changed during the update; RTL repair was deferred.");
    }
    fs2.renameSync(tempPath, mainJsPath);
  } finally {
    try { if (fs2.existsSync(tempPath)) fs2.unlinkSync(tempPath); } catch {}
  }
}
function removePatch(mainJsPath) {
  const dir = path2.dirname(mainJsPath);
  const content = fs2.readFileSync(mainJsPath, "utf-8");
  if (content.includes(PATCH_MARKER)) {
    replaceMainJs(mainJsPath, content, stripPatchLines(content));
  }
  removeLoader(dir);
}
function copyLoader(outDir, extensionPath) {
  const src = path2.join(extensionPath, "resources", LOADER_FILENAME);
  const dest = path2.join(outDir, LOADER_FILENAME);
  copyAtomicFile(src, dest);
}
function copyAtomicFile(source, destination) {
  const temporary = `${destination}.rtl-cursor-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs2.writeFileSync(temporary, fs2.readFileSync(source), { flag: "wx" });
    fs2.renameSync(temporary, destination);
  } finally {
    try { if (fs2.existsSync(temporary)) fs2.unlinkSync(temporary); } catch {}
  }
}
function removeLoader(outDir) {
  const p = path2.join(outDir, LOADER_FILENAME);
  try {
    if (fs2.existsSync(p)) {
      fs2.unlinkSync(p);
    }
  } catch {
  }
}
function getDryRunSummary(mainJsPath) {
  const actions = [];
  const dir = path2.dirname(mainJsPath);
  if (isPatched(mainJsPath)) {
    actions.push("\u067E\u0686 RTL \u0627\u0632 \u0642\u0628\u0644 \u0631\u0648\u06CC main.js \u0641\u0639\u0627\u0644 \u0627\u0633\u062A");
  } else {
    actions.push(`\u0628\u06A9\u0627\u067E main.js \u2192 ${BACKUP_PREFIX}<timestamp>`);
    actions.push("\u062F\u0631\u062C \u06CC\u06A9 \u062E\u0637 loader \u062F\u0631 main.js");
  }
  const loaderDest = path2.join(dir, LOADER_FILENAME);
  actions.push(
    fs2.existsSync(loaderDest) ? `\u0628\u0647\u200C\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC loader: ${loaderDest}` : `\u0646\u0648\u0634\u062A\u0646 loader: ${loaderDest}`
  );
  actions.push("\u0627\u0633\u06A9\u0631\u06CC\u067E\u062A RTL \u062F\u0627\u062E\u0644 \u067E\u0648\u0634\u0647 \u0627\u0641\u0632\u0648\u0646\u0647 \u0645\u06CC\u200C\u0645\u0627\u0646\u062F \u0648 \u0628\u0627 \u0622\u067E\u062F\u06CC\u062A \u0627\u0641\u0632\u0648\u0646\u0647 \u0628\u0647\u200C\u0631\u0648\u0632 \u0645\u06CC\u200C\u0634\u0648\u062F");
  return actions;
}
function handlePermissionError(err) {
  const code = err.code;
  if (code === "EPERM" || code === "EACCES") {
    if (process.platform === "win32") {
      return "\u062F\u0633\u062A\u0631\u0633\u06CC \u06A9\u0627\u0641\u06CC \u0646\u06CC\u0633\u062A. Cursor \u0631\u0627 \u0628\u0627 Run as administrator \u0628\u0627\u0632 \u06A9\u0646\u06CC\u062F \u0648 \u062F\u0648\u0628\u0627\u0631\u0647 Enable \u06A9\u0646\u06CC\u062F.";
    }
    if (process.platform === "darwin") {
      return "\u062F\u0633\u062A\u0631\u0633\u06CC \u06A9\u0627\u0641\u06CC \u0646\u06CC\u0633\u062A. \u0627\u06CC\u0646 \u0631\u0627 \u0627\u062C\u0631\u0627 \u06A9\u0646\u06CC\u062F: sudo chown -R $USER /Applications/Cursor.app/Contents/Resources/app/out/";
    }
    return "\u062F\u0633\u062A\u0631\u0633\u06CC \u06A9\u0627\u0641\u06CC \u0646\u06CC\u0633\u062A. Cursor \u0631\u0627 \u0628\u0627 \u062F\u0633\u062A\u0631\u0633\u06CC \u0628\u0627\u0644\u0627\u062A\u0631 \u0627\u062C\u0631\u0627 \u06A9\u0646\u06CC\u062F.";
  }
  return `\u062E\u0637\u0627: ${err}`;
}

// src/textDirection.ts
var RTL_TEXT = /[֐-׿؀-ۿ܀-ݏݐ-ݿހ-޿߀-߿ࡰ-࢟ࢠ-ࣿיִ-ﭏﭐ-﷿ﹰ-﻾]/g;
var LTR_TOKEN = /[A-Za-z][A-Za-z0-9._/\\:-]*/g;
function getLtrTokenWeight(token) {
  if (/[._/\\:]/.test(token)) return 0.25;
  if (/^[A-Z0-9-]{2,}$/.test(token)) return 0.5;
  if (/^[a-z]+[A-Z]/.test(token)) return 0.5;
  return 1;
}
function getTextDir(text) {
  const value = text || "";
  const rtlRuns = value.match(RTL_TEXT) || [];
  const ltrTokens = value.match(LTR_TOKEN) || [];
  if (rtlRuns.length === 0) return "ltr";
  if (ltrTokens.length === 0) return "rtl";
  const rtlScore = rtlRuns.length * 1.5;
  let ltrScore = 0;
  for (const token of ltrTokens) {
    ltrScore += getLtrTokenWeight(token);
  }
  return rtlScore >= ltrScore ? "rtl" : "ltr";
}

// src/markdownItRtl.ts
function findListItemDir(tokens, openIndex) {
  const level = tokens[openIndex].level;
  for (let j = openIndex + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type === "list_item_close" && t.level === level) {
      return null;
    }
    if (t.type === "inline" && t.content.trim()) {
      return getTextDir(t.content);
    }
  }
  return null;
}
function findListDir(tokens, openIndex) {
  const open = tokens[openIndex];
  const closeType = open.type.replace("_open", "_close");
  let rtl = 0;
  let ltr = 0;
  for (let j = openIndex + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type === closeType && t.level === open.level) {
      break;
    }
    if (t.type === "list_item_open" && t.level === open.level + 1) {
      const dir = findListItemDir(tokens, j);
      if (dir === "rtl") rtl++;
      else if (dir === "ltr") ltr++;
    }
  }
  if (rtl === 0 && ltr === 0) return null;
  return rtl > ltr ? "rtl" : "ltr";
}
function findTableDir(tokens, openIndex) {
  const level = tokens[openIndex].level;
  let rtl = 0;
  let ltr = 0;
  for (let j = openIndex + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.type === "table_close" && t.level === level) {
      break;
    }
    if (t.type === "inline" && t.content.trim()) {
      if (getTextDir(t.content) === "rtl") rtl++;
      else ltr++;
    }
  }
  if (rtl === 0 && ltr === 0) return null;
  return rtl > ltr ? "rtl" : "ltr";
}
var BLOCK_OPENS = /* @__PURE__ */ new Set([
  "paragraph_open",
  "heading_open",
  "blockquote_open",
  "list_item_open",
  "bullet_list_open",
  "ordered_list_open",
  "table_open",
  "th_open",
  "td_open"
]);
function markdownItCursorRtl(isEnabled) {
  return (md) => {
    md.core.ruler.push("rtl-cursor-dir", (state) => {
      if (!isEnabled()) return;
      const { tokens } = state;
      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (!BLOCK_OPENS.has(token.type)) continue;
        let dir = null;
        if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
          dir = findListDir(tokens, i);
        } else if (token.type === "table_open") {
          dir = findTableDir(tokens, i);
        } else if (token.type === "list_item_open") {
          dir = findListItemDir(tokens, i);
        } else {
          for (let j = i + 1; j < tokens.length; j++) {
            if (tokens[j].level <= token.level && tokens[j].type.endsWith("_close")) {
              break;
            }
            if (tokens[j].type === "inline" && tokens[j].content.trim()) {
              dir = getTextDir(tokens[j].content);
              break;
            }
          }
        }
        if (dir) {
          token.attrSet("dir", dir);
        }
      }
    });
  };
}

// src/extension.ts
var statusBarItem;
var fileWatcher;
function getPatchState(mainJsPath) {
  if (!fs3.existsSync(mainJsPath)) {
    return "off";
  }
  if (isPatched(mainJsPath)) {
    return "on";
  }
  if (hasBackups(mainJsPath)) {
    return "update-needed";
  }
  return "off";
}
function updateStatusBar(state) {
  const config = vscode2.workspace.getConfiguration("rtlCursor");
  if (!config.get("showStatusBar", true)) {
    statusBarItem.hide();
    return;
  }
  switch (state) {
    case "on":
      statusBarItem.text = "$(check) RTL: ON";
      statusBarItem.backgroundColor = void 0;
      statusBarItem.tooltip = "RTL \u0647\u0648\u0634\u0645\u0646\u062F \u0641\u0639\u0627\u0644 \u0627\u0633\u062A (\u0641\u0627\u0631\u0633\u06CC RTL\u060C \u0627\u0646\u06AF\u0644\u06CC\u0633\u06CC \u0648 \u06A9\u062F LTR). \u06A9\u0644\u06CC\u06A9 = \u062E\u0627\u0645\u0648\u0634";
      break;
    case "off":
      statusBarItem.text = "$(circle-slash) RTL: OFF";
      statusBarItem.backgroundColor = new vscode2.ThemeColor(
        "statusBarItem.warningBackground"
      );
      statusBarItem.tooltip = "RTL \u062E\u0627\u0645\u0648\u0634 \u0627\u0633\u062A. \u06A9\u0644\u06CC\u06A9 = \u0631\u0648\u0634\u0646 \u06A9\u0631\u062F\u0646";
      break;
    case "update-needed":
      statusBarItem.text = "$(warning) RTL: UPDATE";
      statusBarItem.backgroundColor = new vscode2.ThemeColor(
        "statusBarItem.errorBackground"
      );
      statusBarItem.tooltip = "\u0627\u062F\u06CC\u062A\u0648\u0631 \u0622\u067E\u062F\u06CC\u062A \u0634\u062F\u0647 \u0648 \u067E\u0686 RTL \u0628\u0631\u062F\u0627\u0634\u062A\u0647 \u0634\u062F\u0647. \u06A9\u0644\u06CC\u06A9 = \u0627\u0639\u0645\u0627\u0644 \u062F\u0648\u0628\u0627\u0631\u0647";
      break;
  }
  statusBarItem.show();
}
function ensureWatchStateDir() {
  const dir = watchStateDir();
  if (!fs3.existsSync(dir)) {
    fs3.mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function updateActiveManifestPath() {
  const roaming = process.env.APPDATA || pathUser.join(os.homedir(), "AppData", "Roaming");
  return pathUser.join(roaming, "Cursor", "update-supervisor", "win32", "active.json");
}
function isEditorUpdateInProgress(mainJsPath = getMainJsPath()) {
  if (process.platform !== "win32") return false;
  const installRoot = pathUser.resolve(pathUser.dirname(mainJsPath), "..", "..", "..");
  try {
    return [updateActiveManifestPath(), pathUser.join(installRoot, "_"), pathUser.join(installRoot, "_bak")]
      .some((candidate) => fs3.existsSync(candidate));
  } catch {
    return true;
  }
}
function syncWatchSettings() {
  ensureWatchStateDir();
  const config = vscode2.workspace.getConfiguration("rtlCursor");
  const settings = { autoReapply: config.get("autoReapply", true), autoRelaunch: config.get("autoRelaunch", true) };
  const destination = pathUser.join(watchStateDir(), "watch-settings.json");
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    fs3.writeFileSync(temporary, JSON.stringify(settings), "utf8");
    fs3.renameSync(temporary, destination);
  } finally {
    try { if (fs3.existsSync(temporary)) fs3.unlinkSync(temporary); } catch {}
  }
}
function runHiddenPowerShell(script) {
  return new Promise((resolve, reject) => {
    child_process.execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, timeout: 15e3 }, (error) => error ? reject(error) : resolve());
  });
}
async function stopManagedWatchProcess() {
  const pidFile = pathUser.join(watchStateDir(), "watch.pid");
  const scriptPath = watchScriptPath().replace(/'/g, "''");
  // The PID file may be stale or missing. Identify only our exact script before stopping any helper.
  await runHiddenPowerShell(`$ErrorActionPreference='Stop'; $pattern='(?i)(?:^|\\s)-File\\s+"?' + [regex]::Escape('${scriptPath}') + '"?(?:\\s|$)'; $watchers=@(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -match $pattern }); foreach ($watcher in $watchers) { $current=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $watcher.ProcessId); if (-not $current -or $current.Name -ne 'powershell.exe' -or $current.CommandLine -notmatch $pattern -or $current.CreationDate -ne $watcher.CreationDate) { continue }; $helper=Get-Process -Id $watcher.ProcessId -ErrorAction SilentlyContinue; if ($helper) { Stop-Process -Id $watcher.ProcessId -Force -ErrorAction Stop; if (-not $helper.WaitForExit(5000)) { throw 'RTL watcher did not stop' } } }; $remaining=@(Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -match $pattern }); if ($remaining.Count -gt 0) { throw 'RTL watcher replacement deferred: old watcher is still running' }`);
  try { fs3.unlinkSync(pidFile); } catch {}
}
async function installBackgroundWatch(extensionPath) {
  if (process.platform !== "win32") {
    return;
  }
  if (watchInstallInFlight) return watchInstallInFlight;
  watchInstallInFlight = installBackgroundWatchNow(extensionPath);
  try { await watchInstallInFlight; } finally { watchInstallInFlight = void 0; }
}
async function installBackgroundWatchNow(extensionPath) {
  try {
    ensureWatchStateDir();
    syncWatchSettings();
    const srcScript = pathUser.join(extensionPath, "resources", "rtl-cursor-watch.ps1");
    const srcVbs = pathUser.join(extensionPath, "resources", "rtl-cursor-watch.vbs");
    const srcLoader = pathUser.join(extensionPath, "resources", LOADER_FILENAME);
    if (fs3.existsSync(srcScript) && fs3.existsSync(watchScriptPath()) &&
        !fs3.readFileSync(srcScript).equals(fs3.readFileSync(watchScriptPath()))) {
      await stopManagedWatchProcess();
    }
    if (fs3.existsSync(srcScript)) {
      copyAtomicFile(srcScript, watchScriptPath());
    }
    if (fs3.existsSync(srcVbs)) {
      copyAtomicFile(srcVbs, watchVbsPath());
    }
    if (fs3.existsSync(srcLoader)) {
      copyAtomicFile(srcLoader, watchLoaderCachePath());
    }
    const vbs = watchVbsPath();
    const script = watchScriptPath();
    if (!fs3.existsSync(script)) {
      return;
    }
    const runCmd = fs3.existsSync(vbs)
      ? `wscript.exe //nologo //B "${vbs.replace(/"/g, '\\"')}"`
      : `powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script.replace(/"/g, '\\"')}"`;
    child_process.spawn(
      "reg",
      ["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", WATCH_RUN_VALUE, "/t", "REG_SZ", "/d", runCmd, "/f"],
      { detached: true, stdio: "ignore", windowsHide: true }
    ).unref();
    if (fs3.existsSync(vbs)) {
      child_process.spawn(
        "wscript.exe",
        ["//nologo", "//B", vbs],
        { detached: true, stdio: "ignore", windowsHide: true }
      ).unref();
    } else {
      child_process.spawn(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-WindowStyle",
          "Hidden",
          "-File",
          script
        ],
        { detached: true, stdio: "ignore", windowsHide: true }
      ).unref();
    }
  } catch (err) {
    console.error("[RTL Cursor] failed to install background watch:", err);
  }
}
async function stopBackgroundWatch() {
  if (process.platform !== "win32") {
    return;
  }
  try {
    child_process.spawn(
      "reg",
      ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", WATCH_RUN_VALUE, "/f"],
      { detached: true, stdio: "ignore", windowsHide: true }
    ).unref();
    await stopManagedWatchProcess();
  } catch (err) {
    console.error("[RTL Cursor] failed to stop background watch:", err);
  }
}
async function scheduleEditorRelaunch() {
  const exePath = process.execPath;
  let executable;
  let args;
    if (process.platform === "win32") {
      const quote = (value) => String(value).replace(/'/g, "''");
      const installRoot = pathUser.dirname(exePath);
      // Wait for graceful exit (including save dialogs) and any updater, never force an editor to close.
      const psScript = `$ErrorActionPreference='Stop'; $exe='${quote(exePath)}'; $deadline=[DateTime]::UtcNow.AddSeconds(120); do { $running=@(Get-Process -Name '${quote(pathUser.basename(exePath, ".exe"))}' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }); $updating=(Test-Path -LiteralPath '${quote(updateActiveManifestPath())}') -or (Test-Path -LiteralPath '${quote(pathUser.join(installRoot, "_"))}') -or (Test-Path -LiteralPath '${quote(pathUser.join(installRoot, "_bak"))}'); if ($running.Count -eq 0 -and -not $updating) { break }; if ([DateTime]::UtcNow -ge $deadline) { exit 0 }; Start-Sleep -Milliseconds 250 } while ($true); Start-Process -FilePath $exe -ErrorAction Stop`;
      const encoded = Buffer.from(psScript, "utf16le").toString("base64");
      executable = "powershell.exe";
      args = [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-WindowStyle",
          "Hidden",
          "-EncodedCommand",
          encoded
        ];
    } else {
      const parentPid = Number(process.env.VSCODE_PID) || process.ppid;
      const quotedExe = "'" + String(exePath).replace(/'/g, "'\\''") + "'";
      executable = "/bin/sh";
      args = ["-c", `attempt=0; while kill -0 ${parentPid} 2>/dev/null; do attempt=$((attempt + 1)); [ "$attempt" -ge 120 ] && exit 0; sleep 1; done; exec ${quotedExe}`];
    }
  return new Promise((resolve, reject) => {
    const helper = child_process.spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: true });
    helper.once("error", reject);
    helper.once("spawn", () => { helper.unref(); resolve(helper); });
  });
}
async function relaunchEditorNow(isValid = () => true) {
  if (relaunchInFlight) {
    return;
  }
  relaunchInFlight = true;
  let helper;
  try {
    if (!isValid()) return;
    if (isEditorUpdateInProgress()) throw new Error("The editor is updating. Restart after the update finishes.");
    helper = await scheduleEditorRelaunch();
    if (!isValid()) { helper.kill(); return; }
    await vscode2.commands.executeCommand("workbench.action.quit");
  } catch (err) {
    if (helper) helper.kill();
    throw err;
  } finally {
    relaunchInFlight = false;
  }
}
async function offerRestart(message, options) {
  const auto = !!(options && options.auto);
  const config = vscode2.workspace.getConfiguration("rtlCursor");
  const autoRelaunch = config.get("autoRelaunch", true);
  if (auto && autoRelaunch) {
    void vscode2.window.showInformationMessage(
      `${message} \u0627\u062F\u06CC\u062A\u0648\u0631 \u062A\u0627 \u0686\u0646\u062F \u062B\u0627\u0646\u06CC\u0647 \u062E\u0648\u062F\u06A9\u0627\u0631 \u0628\u0627\u0632\u06CC\u06A7\u0632\u06CC \u0645\u06CC\u200C\u0634\u0648\u062F\u2026`
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    const isValid = () => vscode2.workspace.getConfiguration("rtlCursor").get("autoRelaunch", true) &&
      (!options || !options.isValid || options.isValid());
    await relaunchEditorNow(isValid);
    return;
  }
  const restartLabel = autoRelaunch ? "\u0631\u06CC\u200C\u0627\u0633\u062A\u0627\u0631\u062A \u062E\u0648\u062F\u06A9\u0627\u0631" : "\u062E\u0631\u0648\u062C \u0627\u0632 Cursor";
  const choice = await vscode2.window.showInformationMessage(
    message,
    restartLabel,
    "\u0628\u0639\u062F\u0627\u064B"
  );
  if (choice === restartLabel) {
    if (autoRelaunch) {
      await relaunchEditorNow();
    } else {
      await vscode2.commands.executeCommand("workbench.action.quit");
    }
  }
}
async function waitForEditorFilesStable(mainJsPath, maxWaitMs = 30e3) {
  const deadline = Date.now() + maxWaitMs;
  let signature;
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    try {
      const info = fs3.statSync(mainJsPath);
      const current = `${info.size}:${info.mtimeMs}`;
      if (isEditorUpdateInProgress(mainJsPath) || current !== signature) {
        signature = current;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= 10e3) {
        return true;
      }
    } catch {
      signature = void 0;
      stableSince = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 1e3));
  }
  return false;
}
function queueAutoRepair(context, delayMs = 1e3) {
  if (repairTimer) clearTimeout(repairTimer);
  repairTimer = setTimeout(async () => {
    repairTimer = void 0;
    if (!readWantEnabled(context) || !vscode2.workspace.getConfiguration("rtlCursor").get("autoReapply", true)) return;
    if (repairInFlight) { queueAutoRepair(context, 5e3); return; }
    if (getPatchState(getMainJsPath()) === "on") return;
    repairInFlight = true;
    try { await enableCommand(context, { silent: true }); } finally { repairInFlight = false; }
  }, delayMs);
}
async function enableCommand(context, options) {
  const silent = !!(options && options.silent);
  const generation = repairGeneration;
  const isRepairValid = () => generation === repairGeneration && readWantEnabled(context) &&
    vscode2.workspace.getConfiguration("rtlCursor").get("autoReapply", true);
  if (isEditorUpdateInProgress()) {
    if (silent) queueAutoRepair(context, 5e3);
    else vscode2.window.showInformationMessage("Cursor در حال آپدیت است. بعد از پایان آپدیت، RTL را فعال کنید.");
    return;
  }
  const validation = validatePaths();
  if (!validation.valid) {
    vscode2.window.showErrorMessage(`RTL Cursor: ${validation.error}`);
    return;
  }
  const mainJsPath = validation.mainJsPath;
  const outDir = getAppOutDir();
  const firstTime = !silent && !isPatched(mainJsPath) && !hasBackups(mainJsPath) && !readWantEnabled(context);
  if (firstTime) {
    const dryRun = getDryRunSummary(mainJsPath).map((a) => `\u2022 ${a}`).join("\n");
    const confirm = await vscode2.window.showWarningMessage(
      "\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC RTL \u0628\u0631\u0627\u06CC \u0686\u062A Cursor\u061F\n\n\u0627\u06CC\u0646 \u06A9\u0627\u0631 \u0641\u0627\u06CC\u0644\u200C\u0647\u0627\u06CC \u0628\u0631\u0646\u0627\u0645\u0647 Cursor \u0631\u0627 \u062A\u063A\u06CC\u06CC\u0631 \u0645\u06CC\u200C\u062F\u0647\u062F (\u0628\u0627 \u0628\u06A9\u0627\u067E).",
      { modal: true, detail: dryRun },
      "\u0641\u0639\u0627\u0644 \u06A9\u0646"
    );
    if (confirm !== "\u0641\u0639\u0627\u0644 \u06A9\u0646") {
      return;
    }
  }
  try {
    if (!(await waitForEditorFilesStable(mainJsPath))) {
      if (silent) queueAutoRepair(context, 5e3);
      else vscode2.window.showInformationMessage("فایل‌های ادیتور هنوز در حال تغییرند. بعد از پایان آپدیت دوباره تلاش کنید.");
      return;
    }
    if (silent && !isRepairValid()) return;
    copyLoader(outDir, context.extensionPath);
    applyPatch(mainJsPath);
    if (!silent) await writeWantEnabled(context, true);
    await installBackgroundWatch(context.extensionPath);
    if (silent && !isRepairValid()) return;
    updateStatusBar("on");
    setupFileWatcher(mainJsPath, context);
    if (silent && !vscode2.workspace.getConfiguration("rtlCursor").get("autoRelaunch", true)) {
      vscode2.window.showInformationMessage("پچ RTL بعد از آپدیت دوباره اعمال شد؛ با راه‌اندازی بعدی ادیتور فعال می‌شود.");
      return;
    }
    await offerRestart(
      silent ? "\u0627\u062F\u06CC\u062A\u0648\u0631 \u0622\u067E\u062F\u06CC\u062A \u0634\u062F \u0648 \u067E\u0686 RTL \u062E\u0648\u062F\u06A9\u0627\u0631 \u062F\u0648\u0628\u0627\u0631\u0647 \u0627\u0639\u0645\u0627\u0644 \u0634\u062F." : firstTime ? "\u067E\u0686 RTL \u0627\u0639\u0645\u0627\u0644 \u0634\u062F." : "\u067E\u0686 RTL \u062F\u0648\u0628\u0627\u0631\u0647 \u0627\u0639\u0645\u0627\u0644 \u0634\u062F.",
      { auto: true, isValid: silent ? isRepairValid : void 0 }
    );
  } catch (err) {
    if (silent && readWantEnabled(context)) {
      console.warn("[RTL Cursor] automatic repair deferred:", err);
      queueAutoRepair(context, 10e3);
      return;
    }
    vscode2.window.showErrorMessage(`RTL Cursor: ${handlePermissionError(err)}`);
  }
}
async function disableCommand(context) {
  if (isEditorUpdateInProgress()) {
    vscode2.window.showInformationMessage("Cursor در حال آپدیت است. بعد از پایان آپدیت، RTL را غیرفعال کنید.");
    return;
  }
  const validation = validatePaths();
  if (!validation.valid) {
    vscode2.window.showErrorMessage(`RTL Cursor: ${validation.error}`);
    return;
  }
  const confirm = await vscode2.window.showWarningMessage(
    "\u062E\u0627\u0645\u0648\u0634 \u06A9\u0631\u062F\u0646 RTL\u061F\n\nmain.js \u0627\u0632 \u0631\u0648\u06CC \u0628\u06A9\u0627\u067E \u0628\u0627\u0632\u06AF\u0631\u062F\u0627\u0646\u06CC \u0645\u06CC\u200C\u0634\u0648\u062F.",
    { modal: true },
    "\u062E\u0627\u0645\u0648\u0634 \u06A9\u0646"
  );
  if (confirm !== "\u062E\u0627\u0645\u0648\u0634 \u06A9\u0646") {
    return;
  }
  repairGeneration++;
  if (repairTimer) clearTimeout(repairTimer);
  repairTimer = void 0;
  try {
    if (!(await waitForEditorFilesStable(validation.mainJsPath))) {
      vscode2.window.showInformationMessage("فایل‌های ادیتور هنوز در حال تغییرند. بعد از پایان آپدیت دوباره تلاش کنید.");
      return;
    }
    removePatch(validation.mainJsPath);
    await writeWantEnabled(context, false);
    await stopBackgroundWatch();
    if (repairTimer) clearTimeout(repairTimer);
    repairTimer = void 0;
    if (fileWatcher) {
      fileWatcher.close();
      fileWatcher = void 0;
    }
    updateStatusBar("off");
    await offerRestart(
      "\u067E\u0686 RTL \u0628\u0631\u062F\u0627\u0634\u062A\u0647 \u0634\u062F.",
      { auto: true }
    );
  } catch (err) {
    vscode2.window.showErrorMessage(`RTL Cursor: ${handlePermissionError(err)}`);
  }
}
async function toggleCommand(context) {
  const state = getPatchState(getMainJsPath());
  if (state === "on") {
    await disableCommand(context);
  } else {
    await enableCommand(context);
  }
}
async function statusCommand() {
  const validation = validatePaths();
  if (!validation.valid) {
    vscode2.window.showErrorMessage(`RTL Cursor: ${validation.error}`);
    return;
  }
  const state = getPatchState(validation.mainJsPath);
  switch (state) {
    case "on":
      vscode2.window.showInformationMessage("RTL Cursor: \u067E\u0686 \u0641\u0639\u0627\u0644 \u0627\u0633\u062A.");
      break;
    case "off":
      vscode2.window.showInformationMessage(
        "RTL Cursor: \u067E\u0686 \u0627\u0639\u0645\u0627\u0644 \u0646\u0634\u062F\u0647. \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \u0646\u0648\u0627\u0631 \u0648\u0636\u0639\u06CC\u062A \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F \u06CC\u0627 \u062F\u0633\u062A\u0648\u0631 Enable \u0631\u0627 \u0628\u0632\u0646\u06CC\u062F."
      );
      break;
    case "update-needed": {
      const choice = await vscode2.window.showWarningMessage(
        "\u0627\u062F\u06CC\u062A\u0648\u0631 \u0622\u067E\u062F\u06CC\u062A \u0634\u062F\u0647 \u0648 \u067E\u0686 RTL \u0646\u06CC\u0627\u0632 \u0628\u0647 \u0627\u0639\u0645\u0627\u0644 \u062F\u0648\u0628\u0627\u0631\u0647 \u062F\u0627\u0631\u062F.",
        "\u0627\u0644\u0627\u0646 \u062F\u0631\u0633\u062A \u06A9\u0646"
      );
      if (choice === "\u0627\u0644\u0627\u0646 \u062F\u0631\u0633\u062A \u06A9\u0646") {
        await vscode2.commands.executeCommand("rtlCursor.enable");
      }
      break;
    }
  }
}
function setupFileWatcher(mainJsPath, context) {
  if (fileWatcher) {
    fileWatcher.close();
  }
  try {
    // Watching the directory survives atomic replacement of main.js by the updater.
    fileWatcher = fs3.watch(pathUser.dirname(mainJsPath), (eventType, filename) => {
      if (filename && String(filename) !== pathUser.basename(mainJsPath)) return;
      if (!readWantEnabled(context)) return;
      if (getPatchState(mainJsPath) === "on") return;
      updateStatusBar("update-needed");
      queueAutoRepair(context);
    });
  } catch {
  }
}
function activate(context) {
  statusBarItem = vscode2.window.createStatusBarItem(
    vscode2.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = "rtlCursor.toggle";
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(
    vscode2.commands.registerCommand(
      "rtlCursor.toggle",
      () => toggleCommand(context)
    ),
    vscode2.commands.registerCommand(
      "rtlCursor.enable",
      () => enableCommand(context)
    ),
    vscode2.commands.registerCommand("rtlCursor.disable", () => disableCommand(context)),
    vscode2.commands.registerCommand("rtlCursor.status", () => statusCommand())
  );
  const mainJsPath = getMainJsPath();
  const state = getPatchState(mainJsPath);
  if (state === "on") {
    writeWantEnabled(context, true);
    try {
      if (!isEditorUpdateInProgress(mainJsPath)) copyLoader(getAppOutDir(), context.extensionPath);
    } catch {
    }
  }
  if (readWantEnabled(context)) {
    void installBackgroundWatch(context.extensionPath);
  }
  updateStatusBar(state);
  const autoReapply = vscode2.workspace.getConfiguration("rtlCursor").get("autoReapply", true);
  if (autoReapply && readWantEnabled(context) && state !== "on") {
    queueAutoRepair(context);
  }
  if (fs3.existsSync(mainJsPath) && (getPatchState(mainJsPath) === "on" || readWantEnabled(context))) {
    setupFileWatcher(mainJsPath, context);
  }
  vscode2.workspace.onDidChangeConfiguration(
    (e) => {
      if (e.affectsConfiguration("rtlCursor.showStatusBar")) {
        updateStatusBar(getPatchState(mainJsPath));
      }
      if (e.affectsConfiguration("rtlCursor.autoReapply")) {
        repairGeneration++;
        if (process.platform === "win32" && readWantEnabled(context)) {
          try { syncWatchSettings(); } catch (err) { console.error("[RTL Cursor] failed to save watch settings:", err); }
        }
        queueAutoRepair(context);
      }
      if (e.affectsConfiguration("rtlCursor.autoRelaunch") && process.platform === "win32" && readWantEnabled(context)) {
        try { syncWatchSettings(); } catch (err) { console.error("[RTL Cursor] failed to save watch settings:", err); }
      }
    },
    null,
    context.subscriptions
  );
  return {
    extendMarkdownIt(md) {
      const engine = md;
      return engine.use(markdownItCursorRtl(() => true));
    }
  };
}
function deactivate() {
  repairGeneration++;
  if (repairTimer) clearTimeout(repairTimer);
  repairTimer = void 0;
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = void 0;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
