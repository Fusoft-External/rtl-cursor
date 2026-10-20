"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const repositoryRoot = path.join(__dirname, "..");
const loaderSource = fs.readFileSync(path.join(repositoryRoot, "resources", "rtl-cursor-loader.cjs"), "utf8");
const home = "C:\\Users\\rtl-font-regression";
const extensionsDir = path.win32.join(home, ".cursor", "extensions");
const extensionName = "fusoft.rtl-cursor-1.0.14";
const resourceDir = path.win32.join(extensionsDir, extensionName, "resources");
const settingsPath = path.win32.join(home, ".rtl-cursor", "font-settings.json");

// Execute the shipped Electron loader against an isolated workbench. Read only
// the repository's font assets; never touch the user's settings or running IDE.
function injectWorkbench(settings, options = {}) {
  const fontReads = [];
  const scripts = [];
  const contents = new EventEmitter();
  Object.assign(contents, {
    id: 1,
    isDestroyed: () => false,
    isLoading: () => false,
    getURL: () => "vscode-file://vscode-app/workbench.html",
    executeJavaScript(script) { scripts.push(script); return Promise.resolve(true); }
  });
  const fakeFs = {
    writeFileSync() {},
    appendFileSync() {},
    existsSync: (file) => file === extensionsDir || file === path.win32.join(resourceDir, "rtl.js"),
    readdirSync: () => [extensionName],
    readFileSync(file) {
      if (file === settingsPath && settings !== undefined) return settings;
      if (file === path.win32.join(resourceDir, "rtl.js")) return "window.__cursorRtlScanAll = function() {};";
      if (path.win32.dirname(file) === path.win32.join(resourceDir, "fonts")) {
        fontReads.push(file);
        if (!options.missingFont) return fs.readFileSync(path.join(repositoryRoot, "resources", "fonts", path.win32.basename(file)));
      }
      throw new Error("ENOENT: " + file);
    }
  };
  vm.runInNewContext(loaderSource, {
    require(name) {
      if (name === "fs") return fakeFs;
      if (name === "path") return path.win32;
      if (name === "os") return { homedir: () => home };
      if (name === "electron") return {
        app: new EventEmitter(),
        BrowserWindow: { getAllWindows: () => [{ id: 1, webContents: contents }] }
      };
      throw new Error("Unexpected module: " + name);
    },
    process: { argv: [], pid: 1 },
    console: { warn() {} },
    setTimeout() {}
  }, { filename: "rtl-cursor-loader.cjs" });
  assert.equal(scripts.length, 1, "The RTL runtime is injected even if font loading is disabled or fails");
  const prefix = "window.__cursorRtlConfig = ";
  assert.ok(scripts[0].startsWith(prefix));
  const config = JSON.parse(scripts[0].slice(prefix.length).split(";\n")[0]);
  return { config, fontReads };
}

for (const [label, settings] of [
  ["missing settings", undefined],
  ["disabled", '{"loadBundledVazirmatn":false}'],
  ["unrelated settings", '{}'],
  ["invalid JSON", '{'],
  ["a string instead of an explicit boolean", '{"loadBundledVazirmatn":"true"}']
]) {
  test(`the font loader stays off for ${label}`, () => {
    const { config, fontReads } = injectWorkbench(settings);
    assert.deepEqual(config, { editorRtl: "off" });
    assert.deepEqual(fontReads, [], "Default RTL injection never reads or sends a font file");
  });
}

test("explicit opt-in sends the bundled Regular and Bold font bytes with their correct weights", () => {
  const { config, fontReads } = injectWorkbench('{"loadBundledVazirmatn":true}');
  assert.equal(config.editorRtl, "off");
  assert.equal(fontReads.length, 2);
  assert.deepEqual(config.bundledFonts.map((font) => font.weight), ["400", "700"]);
  for (let i = 0; i < fontReads.length; i++) {
    const expected = fs.readFileSync(path.join(repositoryRoot, "resources", "fonts", path.win32.basename(fontReads[i])));
    assert.deepEqual(Buffer.from(config.bundledFonts[i].data, "base64"), expected);
  }
});

test("missing optional font assets do not prevent normal RTL injection", () => {
  const { config } = injectWorkbench('{"loadBundledVazirmatn":true}', { missingFont: true });
  assert.deepEqual(config, { editorRtl: "off" });
});
