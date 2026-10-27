"use strict";
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../resources/rtl-cursor-loader.cjs"), "utf8");
const home = "C:\\Users\\rtl-agent-test";

async function load(url, options = {}) {
  const scripts = [];
  const reads = [];
  const app = new EventEmitter();
  app.getName = () => "Code";
  const wc = new EventEmitter();
  Object.assign(wc, {
    id: 1, getURL: () => url, isDestroyed: () => false, isLoading: () => false,
    executeJavaScript(script) { scripts.push(script); return Promise.resolve(true); }
  });
  const extension = "fusoft.rtl-cursor-1.0.15";
  const vscodeDir = path.win32.join(home, ".vscode", "extensions");
  const preferred = options.extensionDir || vscodeDir;
  const resource = path.win32.join(preferred, extension, "resources", "rtl.js");
  const cursorDir = path.win32.join(home, ".cursor", "extensions");
  const dirs = [vscodeDir, cursorDir, preferred];
  const fakeFs = {
    writeFileSync() {}, appendFileSync() {},
    existsSync(file) { return dirs.includes(file) || file === resource; },
    readdirSync() { return [extension]; },
    readFileSync(file) {
      reads.push(file);
      if (file === resource) return "window.__cursorRtlScanAll = function() {};";
      if (file === path.win32.join(home, ".rtl-cursor-vscode", "font-settings.json")) return "{}";
      throw new Error("ENOENT: " + file);
    }
  };
  vm.runInNewContext(source, {
    require(name) {
      return { fs: fakeFs, path: path.win32, os: { homedir: () => home },
        electron: { app, BrowserWindow: { getAllWindows: () => [{ webContents: wc }] } } }[name];
    },
    process: { pid: 1, execPath: "C:\\Code\\Code.exe", argv: options.argv || [], env: options.env || {} },
    console: { warn() {} }, setTimeout() {}
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  return { scripts, reads, wc, app, resource };
}

for (const page of ["workbench.html", "workbench-jetski-agent.html", "workbench-dev.html",
  "vs/sessions/electron-browser/sessions.html", "vs/sessions/electron-browser/sessions-dev.html?test=1"]) {
  test(`the loader injects the native ${page} window`, async () => {
    const h = await load("vscode-file://vscode-app/out/" + page);
    assert.equal(h.scripts.length, 2, "Inject runtime and verify it once");
    assert.ok(h.reads.includes(h.resource));
    assert.ok(h.reads.includes(path.win32.join(home, ".rtl-cursor-vscode", "font-settings.json")));
    assert.ok(!h.reads.some((file) => file.includes(".cursor\\extensions")));
  });
}

test("the loader skips unrelated webviews and pages", async () => {
  for (const url of ["https://example.com/", "about:blank", "vscode-webview://id/index.html", "file:///tmp/sessions.html"]) {
    assert.equal((await load(url)).scripts.length, 0, url);
  }
});

test("custom and portable extension directories override the default VS Code directory", async () => {
  const custom = "D:\\Custom Extensions";
  for (const argv of [["--extensions-dir", custom], ["--extensions-dir=" + custom]]) {
    const h = await load("vscode-file://vscode-app/workbench.html", { extensionDir: custom, argv });
    assert.ok(h.reads.includes(h.resource));
  }
  const portable = "D:\\Portable Code\\data";
  const h = await load("vscode-file://vscode-app/workbench.html", {
    extensionDir: path.win32.join(portable, "extensions"), env: { VSCODE_PORTABLE: portable }
  });
  assert.ok(h.reads.includes(h.resource));
});

test("an Agents window created after startup also receives RTL", async () => {
  const h = await load("about:blank");
  h.wc.getURL = () => "vscode-file://vscode-app/out/vs/sessions/electron-browser/sessions.html";
  h.wc.emit("did-finish-load");
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(h.scripts.length, 2);
});
