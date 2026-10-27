"use strict";

// Use the editor's own RTL rendering, cursor movement and hit testing. This
// function only reads chat input models; it never touches rendered DOM or text.
function resolveChatDirection(view, viewLine) {
  try {
    const model = view.model;
    if (!model || !model.uri || !["chatSessionInput", "sessions-chat"].includes(model.uri.scheme)) return null;
    const position = view.coordinatesConverter.convertViewPositionToModelPosition({ lineNumber: viewLine, column: 1 });
    for (let line = position.lineNumber; line > 0 && line >= position.lineNumber - 32; line--) {
      const first = model.getLineContent(line).match(/\p{Letter}/u);
      if (first) return /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefe]/u.test(first[0]) ? 1 : 0;
    }
  } catch {}
  return null;
}

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const START = "/*rtl-cursor-native-chat:start*/";
const END = "/*rtl-cursor-native-chat:end*/";
const BUNDLES = ["vs/workbench/workbench.desktop.main.js", "vs/sessions/sessions.desktop.main.js"];

function stripNativeChat(source) {
  const start = source.indexOf(START);
  if (start === -1) return source;
  const end = source.indexOf(END, start);
  if (end === -1 || source.indexOf(START, start + START.length) !== -1) throw new Error("Ambiguous native chat RTL patch");
  return source.slice(0, start) + source.slice(end + END.length);
}

function patchBundle(source, enabled = true) {
  const clean = stripNativeChat(source);
  if (!enabled) return clean;
  const hooks = [...clean.matchAll(/_getTextDirection\(\s*([$\w]+)\s*,\s*([$\w]+)\s*\)\s*\{/g)];
  if (hooks.length !== 1 || !clean.includes("isRenderedRTL()") || !clean.includes(".getTextDirection(")) {
    throw new Error("This VS Code bundle does not expose the supported native RTL engine");
  }
  const hook = hooks[0];
  const insertion = hook.index + hook[0].length;
  const code = START + "const __rtlCursorChatDirection=(" + resolveChatDirection.toString() + ")(this," + hook[1] + ");if(__rtlCursorChatDirection!==null)return __rtlCursorChatDirection;" + END;
  return clean.slice(0, insertion) + code + clean.slice(insertion);
}

function checksum(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "");
}

function syncNativeChat(appOut, enabled = true) {
  const productPath = path.join(appOut, "..", "product.json");
  const productBytes = fs.readFileSync(productPath);
  const product = JSON.parse(productBytes.toString("utf8"));
  if (!/^code(?:-insiders)?$/.test(product.applicationName || "")) return { supported: false, changed: false, reason: "Not VS Code" };
  const changes = [];
  let productText = productBytes.toString("utf8");
  // Validate every present bundle before writing anything. Old forks and unknown
  // builds must keep their original editor behavior, including their checksums.
  try {
    for (const relative of BUNDLES) {
      const file = path.join(appOut, relative);
      if (!fs.existsSync(file)) continue;
      const original = fs.readFileSync(file);
      const next = Buffer.from(patchBundle(original.toString("latin1"), enabled), "latin1");
      if (!original.equals(next)) changes.push({ file, original, next });
      if (!original.includes(START) && !next.includes(START)) continue;
      const current = product.checksums && product.checksums[relative];
      if (current) {
        const key = JSON.stringify(relative).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const field = new RegExp("(" + key + "\\s*:\\s*\")" + current.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\")");
        if (!field.test(productText)) throw new Error("Cannot safely update native RTL integrity metadata");
        productText = productText.replace(field, (_, before, after) => before + checksum(next) + after);
      }
    }
  } catch (error) {
    return { supported: false, changed: false, reason: error.message };
  }
  if (!BUNDLES.some((relative) => fs.existsSync(path.join(appOut, relative)))) return { supported: false, changed: false, reason: "No native editor bundles" };
  const nextProduct = Buffer.from(productText, "utf8");
  if (!nextProduct.equals(productBytes)) changes.push({ file: productPath, original: productBytes, next: nextProduct });
  const published = [];
  const staged = [];
  try {
    for (const change of changes) {
      change.temp = change.file + ".rtl-cursor-native-" + crypto.randomBytes(8).toString("hex") + ".tmp";
      staged.push(change);
      fs.writeFileSync(change.temp, change.next, { flag: "wx" });
    }
    for (const change of changes) {
      if (!fs.readFileSync(change.file).equals(change.original)) throw new Error("Editor changed during native RTL installation");
    }
    for (const change of changes) {
      if (!fs.readFileSync(change.file).equals(change.original)) throw new Error("Editor changed during native RTL installation");
      if (enabled && change.file !== productPath && !fs.existsSync(change.file + ".rtl-cursor-native-backup")) {
        fs.writeFileSync(change.file + ".rtl-cursor-native-backup", change.original, { flag: "wx" });
      }
      fs.renameSync(change.temp, change.file);
      published.push(change);
    }
  } catch (error) {
    for (const change of published.reverse()) {
      if (fs.readFileSync(change.file).equals(change.next)) {
        fs.writeFileSync(change.temp, change.original);
        fs.renameSync(change.temp, change.file);
      }
    }
    throw error;
  } finally {
    for (const change of staged) {
      try { fs.unlinkSync(change.temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  return { supported: true, changed: changes.length > 0 };
}

module.exports = { resolveChatDirection, patchBundle, stripNativeChat, syncNativeChat, BUNDLES, START, END };
