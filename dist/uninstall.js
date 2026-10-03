"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/uninstall.ts
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));

// src/constants.ts
var PATCH_MARKER = "rtl-cursor-loader.cjs";
var LOADER_FILENAME = "rtl-cursor-loader.cjs";
var BACKUP_PREFIX = "main.js.rtl-cursor-backup-";

// src/uninstall.ts
function findMainJsCandidates() {
  const candidates = [];
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    if (localAppData) {
      candidates.push(
        path.join(localAppData, "Programs", "cursor", "resources", "app", "out", "main.js"),
        path.join(localAppData, "Programs", "Antigravity IDE", "resources", "app", "out", "main.js"),
        path.join(localAppData, "Programs", "Antigravity", "resources", "app", "out", "main.js")
      );
    }
    const programFiles = process.env["ProgramFiles"] || "";
    if (programFiles) {
      candidates.push(
        path.join(programFiles, "Cursor", "resources", "app", "out", "main.js")
      );
    }
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/Cursor.app/Contents/Resources/app/out/main.js");
  } else {
    candidates.push("/opt/Cursor/resources/app/out/main.js");
    candidates.push("/usr/share/cursor/resources/app/out/main.js");
  }
  return candidates;
}
function findPatchedMainJs() {
  for (const candidate of findMainJsCandidates()) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const content = fs.readFileSync(candidate, "utf-8");
      if (content.includes(PATCH_MARKER)) {
        return candidate;
      }
    } catch {
      continue;
    }
  }
  return null;
}
function findLatestBackup(mainJsDir) {
  try {
    const files = fs.readdirSync(mainJsDir);
    const backups = files.filter((f) => f.startsWith(BACKUP_PREFIX)).sort().reverse();
    return backups.length > 0 ? path.join(mainJsDir, backups[0]) : null;
  } catch {
    return null;
  }
}
function removePatch(mainJsPath2) {
  const dir = path.dirname(mainJsPath2);
  const latestBackup = findLatestBackup(dir);
  if (latestBackup) {
    fs.copyFileSync(latestBackup, mainJsPath2);
  } else {
    const content = fs.readFileSync(mainJsPath2, "utf-8");
    if (!content.includes(PATCH_MARKER)) return;
    const filtered = content.split("\n").filter((line) => !line.includes(PATCH_MARKER));
    fs.writeFileSync(mainJsPath2, filtered.join("\n"), "utf-8");
  }
  try {
    const p = path.join(dir, LOADER_FILENAME);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
    }
  } catch {
  }
}
var mainJsPath = findPatchedMainJs();
if (mainJsPath) {
  try {
    removePatch(mainJsPath);
  } catch {
  }
}
