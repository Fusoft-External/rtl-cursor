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
function enabledFlagPath() {
  return pathUser.join(os.homedir(), ".rtl-cursor-enabled");
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
var PATCH_LINE = 'import{createRequire}from"module";try{createRequire(import.meta.url)("./rtl-cursor-loader.cjs")}catch(e){console.error("[RTL Cursor] error loading ./rtl-cursor-loader.cjs: ", e)}';
var PATCH_MARKER = "rtl-cursor-loader.cjs";
var LOADER_FILENAME = "rtl-cursor-loader.cjs";
var BACKUP_PREFIX = "main.js.rtl-cursor-backup-";

// src/patcher.ts
function isPatched(mainJsPath) {
  try {
    const content = fs2.readFileSync(mainJsPath, "utf-8");
    return content.includes(PATCH_LINE);
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
  const backupPath = backup(mainJsPath);
  try {
    const lines = content.split("\n");
    const existingIndex = lines.findIndex(
      (line) => line.startsWith("import{createRequire")
    );
    if (existingIndex !== -1) {
      lines[existingIndex] = PATCH_LINE;
      fs2.writeFileSync(mainJsPath, lines.join("\n"), "utf-8");
    } else {
      const copyrightEnd = content.indexOf("*/");
      if (copyrightEnd === -1) {
        throw new Error("\u0627\u0646\u062A\u0647\u0627\u06CC \u06A9\u0627\u0645\u0646\u062A \u06A9\u067E\u06CC\u200C\u0631\u0627\u06CC\u062A \u062F\u0631 main.js \u067E\u06CC\u062F\u0627 \u0646\u0634\u062F");
      }
      const insertPos = copyrightEnd + 2;
      const patched = content.substring(0, insertPos) + "\n" + PATCH_LINE + content.substring(insertPos);
      fs2.writeFileSync(mainJsPath, patched, "utf-8");
    }
  } catch (err) {
    try {
      fs2.copyFileSync(backupPath, mainJsPath);
    } catch (rollbackErr) {
      throw new Error(
        `\u067E\u0686 \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u0648\u062F \u0648 \u0628\u0627\u0632\u06AF\u0631\u062F\u0627\u0646\u06CC \u0647\u0645 \u0634\u06A9\u0633\u062A \u062E\u0648\u0631\u062F. \u0628\u06A9\u0627\u067E: ${backupPath}. \u062E\u0637\u0627: ${err}. Rollback: ${rollbackErr}`
      );
    }
    throw err;
  }
}
function removePatch(mainJsPath) {
  const dir = path2.dirname(mainJsPath);
  const latestBackup = findLatestBackup(dir);
  if (latestBackup) {
    fs2.copyFileSync(latestBackup, mainJsPath);
  } else {
    const content = fs2.readFileSync(mainJsPath, "utf-8");
    if (!content.includes(PATCH_MARKER)) {
      return;
    }
    fs2.writeFileSync(mainJsPath, stripPatchLines(content), "utf-8");
  }
  removeLoader(dir);
}
function copyLoader(outDir, extensionPath) {
  const src = path2.join(extensionPath, "resources", LOADER_FILENAME);
  const dest = path2.join(outDir, LOADER_FILENAME);
  fs2.copyFileSync(src, dest);
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
function scheduleEditorRelaunch() {
  const exePath = process.execPath;
  const delayMs = 2e3;
  try {
    if (process.platform === "win32") {
      // Hidden PowerShell delay + relaunch (no visible cmd / ping window).
      const psScript = `Start-Sleep -Milliseconds ${delayMs}; Start-Process -LiteralPath '${String(exePath).replace(/'/g, "''")}'`;
      const encoded = Buffer.from(psScript, "utf16le").toString("base64");
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
          "-EncodedCommand",
          encoded
        ],
        {
          detached: true,
          stdio: "ignore",
          windowsHide: true
        }
      ).unref();
      return;
    }
    const shellCmd = `sleep ${Math.max(1, Math.ceil(delayMs / 1e3))}; exec ${JSON.stringify(exePath)}`;
    child_process.spawn("/bin/sh", ["-c", shellCmd], {
      detached: true,
      stdio: "ignore"
    }).unref();
  } catch (err) {
    console.error("[RTL Cursor] failed to schedule relaunch:", err);
  }
}
async function relaunchEditorNow() {
  if (relaunchInFlight) {
    return;
  }
  relaunchInFlight = true;
  scheduleEditorRelaunch();
  try {
    await vscode2.commands.executeCommand("workbench.action.quit");
  } catch (err) {
    relaunchInFlight = false;
    throw err;
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
    await relaunchEditorNow();
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
async function enableCommand(context, options) {
  const silent = !!(options && options.silent);
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
    copyLoader(outDir, context.extensionPath);
    applyPatch(mainJsPath);
    await writeWantEnabled(context, true);
    updateStatusBar("on");
    setupFileWatcher(mainJsPath, context);
    await offerRestart(
      silent ? "\u0627\u062F\u06CC\u062A\u0648\u0631 \u0622\u067E\u062F\u06CC\u062A \u0634\u062F \u0648 \u067E\u0686 RTL \u062E\u0648\u062F\u06A9\u0627\u0631 \u062F\u0648\u0628\u0627\u0631\u0647 \u0627\u0639\u0645\u0627\u0644 \u0634\u062F." : firstTime ? "\u067E\u0686 RTL \u0627\u0639\u0645\u0627\u0644 \u0634\u062F." : "\u067E\u0686 RTL \u062F\u0648\u0628\u0627\u0631\u0647 \u0627\u0639\u0645\u0627\u0644 \u0634\u062F.",
      { auto: true }
    );
  } catch (err) {
    vscode2.window.showErrorMessage(`RTL Cursor: ${handlePermissionError(err)}`);
  }
}
async function disableCommand(context) {
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
  try {
    removePatch(validation.mainJsPath);
    await writeWantEnabled(context, false);
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
    fileWatcher = fs3.watch(mainJsPath, (eventType) => {
      if (eventType !== "change") {
        return;
      }
      setTimeout(async () => {
        if (!readWantEnabled(context)) {
          return;
        }
        const state = getPatchState(mainJsPath);
        if (state !== "update-needed" && state !== "off") {
          return;
        }
        updateStatusBar("update-needed");
        const config = vscode2.workspace.getConfiguration("rtlCursor");
        if (config.get("autoReapply", true)) {
          await enableCommand(context, { silent: true });
          return;
        }
        const choice = await vscode2.window.showWarningMessage(
          "\u0627\u062F\u06CC\u062A\u0648\u0631 \u0622\u067E\u062F\u06CC\u062A \u0634\u062F \u0648 \u067E\u0686 RTL \u0628\u0631\u062F\u0627\u0634\u062A\u0647 \u0634\u062F. \u0627\u0644\u0627\u0646 \u062F\u0631\u0633\u062A \u0634\u0648\u062F\u061F",
          "\u0627\u0644\u0627\u0646 \u062F\u0631\u0633\u062A \u06A9\u0646",
          "\u0628\u0639\u062F\u0627\u064B"
        );
        if (choice === "\u0627\u0644\u0627\u0646 \u062F\u0631\u0633\u062A \u06A9\u0646") {
          await vscode2.commands.executeCommand("rtlCursor.enable");
        }
      }, 1e3);
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
      copyLoader(getAppOutDir(), context.extensionPath);
    } catch {
    }
  }
  updateStatusBar(state);
  const autoReapply = vscode2.workspace.getConfiguration("rtlCursor").get("autoReapply", true);
  if (autoReapply && readWantEnabled(context) && state !== "on") {
    enableCommand(context, { silent: true });
  }
  if (fs3.existsSync(mainJsPath) && (getPatchState(mainJsPath) === "on" || readWantEnabled(context))) {
    setupFileWatcher(mainJsPath, context);
  }
  vscode2.workspace.onDidChangeConfiguration(
    (e) => {
      if (e.affectsConfiguration("rtlCursor.showStatusBar")) {
        updateStatusBar(getPatchState(mainJsPath));
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
