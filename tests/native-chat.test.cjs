"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const test = require("node:test");
const native = require("../resources/rtl-vscode-native.cjs");

function view(lines, scheme = "chatSessionInput", modelLine = 1) {
  return { model: { uri: { scheme }, getLineContent: (line) => lines[line - 1] },
    coordinatesConverter: { convertViewPositionToModelPosition: () => ({ lineNumber: modelLine }) } };
}

test("native direction reads only chat models and follows each original model line", () => {
  assert.equal(native.resolveChatDirection(view(["سلام Copilot، می‌توانی این function را اصلاح کنی؟"]), 1), 1);
  assert.equal(native.resolveChatDirection(view(["English with فارسی words"]), 1), 0);
  assert.equal(native.resolveChatDirection(view(["123 - (فارسی)"]), 1), 1);
  assert.equal(native.resolveChatDirection(view(["سلام", ""], "chatSessionInput", 2), 2), 1);
  assert.equal(native.resolveChatDirection(view(["English", "سلام"], "sessions-chat", 2), 2), 1);
  assert.equal(native.resolveChatDirection(view(["سلام full wrapped line"], "chatSessionInput", 1), 5), 1);
  for (const scheme of ["file", "untitled", "vscode-chat-code-block", "vscode-chat-code-compare-block"]) {
    assert.equal(native.resolveChatDirection(view(["سلام"], scheme), 1), null, scheme);
  }
  assert.equal(native.resolveChatDirection({}, 1), null);
  assert.doesNotMatch(native.resolveChatDirection.toString(), /setAttribute|\.style|setValue|executeEdits|document|window/);
});

const bundle = "/* Copyright (C) Microsoft Corporation. */\r\nclass View { _getTextDirection(e,t){return t.length?1:0}getTextDirection(e){return this._getTextDirection(e,[])}isRenderedRTL(){return this.getTextDirection(1)===1}};globalThis.View=View;\r\n";

test("hook is reversible, idempotent and retains original non-chat logic", () => {
  const patched = native.patchBundle(bundle);
  assert.equal(native.patchBundle(patched), patched);
  assert.equal(native.stripNativeChat(patched), bundle);
  const sandbox = {};
  vm.runInNewContext(patched, sandbox);
  const editor = new sandbox.View();
  Object.assign(editor, view(["سلام"]));
  assert.equal(editor.getTextDirection(1), 1);
  editor.model.uri.scheme = "file";
  assert.equal(editor._getTextDirection(1, []), 0);
  assert.equal(editor._getTextDirection(1, [{}]), 1);
  assert.throws(() => native.patchBundle("unsupported editor"), /supported native/);
  assert.throws(() => native.patchBundle(bundle + bundle), /supported native/);
});

function withInstall(callback, applicationName = "code") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rtl-native-install-"));
  const appOut = path.join(root, "out");
  const checksums = {};
  for (const relative of native.BUNDLES) {
    const file = path.join(appOut, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bundle);
    checksums[relative] = crypto.createHash("sha256").update(bundle).digest("base64").replace(/=+$/, "");
  }
  const product = JSON.stringify({ applicationName, checksums }, null, 2);
  fs.writeFileSync(path.join(root, "product.json"), product);
  try { callback({ root, appOut, product }); }
  finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("rtl-native-install-"));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("both native windows and integrity metadata are restored byte-for-byte on disable", () => withInstall(({ root, appOut, product }) => {
  assert.deepEqual(native.syncNativeChat(appOut), { supported: true, changed: true });
  assert.deepEqual(native.syncNativeChat(appOut), { supported: true, changed: false });
  const patchedProduct = JSON.parse(fs.readFileSync(path.join(root, "product.json"), "utf8"));
  for (const relative of native.BUNDLES) {
    const bytes = fs.readFileSync(path.join(appOut, relative));
    assert.equal(patchedProduct.checksums[relative], crypto.createHash("sha256").update(bytes).digest("base64").replace(/=+$/, ""));
    assert.equal(fs.readFileSync(path.join(appOut, relative + ".rtl-cursor-native-backup"), "utf8"), bundle);
  }
  native.syncNativeChat(appOut, false);
  assert.equal(fs.readFileSync(path.join(root, "product.json"), "utf8"), product);
  for (const relative of native.BUNDLES) assert.equal(fs.readFileSync(path.join(appOut, relative), "utf8"), bundle);
}));

test("Cursor and Antigravity installations are never modified", () => {
  for (const app of ["cursor", "antigravity"]) withInstall(({ root, appOut, product }) => {
    assert.equal(native.syncNativeChat(appOut).supported, false);
    assert.equal(fs.readFileSync(path.join(root, "product.json"), "utf8"), product);
    for (const relative of native.BUNDLES) assert.equal(fs.readFileSync(path.join(appOut, relative), "utf8"), bundle);
  }, app);
});

test("an unsupported second bundle prevents any partial native installation", () => withInstall(({ root, appOut, product }) => {
  fs.writeFileSync(path.join(appOut, native.BUNDLES[1]), "unknown engine");
  assert.equal(native.syncNativeChat(appOut).supported, false);
  assert.equal(fs.readFileSync(path.join(appOut, native.BUNDLES[0]), "utf8"), bundle);
  assert.equal(fs.readFileSync(path.join(root, "product.json"), "utf8"), product);
}));

test("a failed second bundle replacement rolls back the first and its integrity metadata", () => withInstall(({ root, appOut, product }) => {
  const realFs = require("node:fs");
  let replacements = 0;
  const fakeFs = Object.create(realFs);
  fakeFs.renameSync = (source, target) => {
    if (++replacements === 2) throw new Error("simulated rename failure");
    return realFs.renameSync(source, target);
  };
  const moduleObject = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../resources/rtl-vscode-native.cjs"), "utf8"), {
    module: moduleObject, Buffer,
    require: (name) => name === "fs" ? fakeFs : require(name)
  });
  assert.throws(() => moduleObject.exports.syncNativeChat(appOut), /simulated rename/);
  for (const relative of native.BUNDLES) assert.equal(fs.readFileSync(path.join(appOut, relative), "utf8"), bundle);
  assert.equal(fs.readFileSync(path.join(root, "product.json"), "utf8"), product);
}));
