"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("a Persian user bubble stays on the physical right while its text stays RTL", {
  skip: !process.env.CHROMIUM_PATH && "Set CHROMIUM_PATH to run the real Chromium layout regression"
}, () => {
  const runtime = fs.readFileSync(path.join(__dirname, "../resources/rtl.js"), "utf8");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtl-human-bubble-"));
  const fixture = path.join(tempDir, "fixture.html");
  const bubble = (id, textId, text) => `
    <div id="${id}Shell" class="human-message-with-todos-wrapper">
      <div class="composer-human-message-container">
        <div id="${id}Column" style="display:flex;flex-direction:column;align-items:flex-end;width:100%">
          <div id="${id}Bubble" class="composer-human-message standalone-glass" style="width:fit-content;max-width:70%">
            <div class="composer-human-message-content">
              <div class="aislash-editor-input-readonly"><p id="${textId}">${text}</p></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  try {
    fs.writeFileSync(fixture, `<!doctype html><meta charset="utf-8">
      <style>
        body { margin: 0; font: 16px Arial; }
        #lane { width: 640px; }
      </style>
      <div id="lane" class="composer-messages-container" data-project-send-message-layout>
        ${bubble("fa", "faText", "انجام بده")}
        ${bubble("en", "enText", "https://mars.baridsoft.ir/tfs/item/167980")}
        <div id="todoShell" class="human-message-with-todos-wrapper">
          <div id="todo" class="todo-row">بررسی عضویت گروه</div>
        </div>
      </div>
      <script>${runtime}</script>
      <script>
        const lane = document.getElementById('lane').getBoundingClientRect();
        const place = (id) => {
          const box = document.getElementById(id).getBoundingClientRect();
          return { left: box.left - lane.left, right: lane.right - box.right, width: box.width };
        };
        const snap = (id) => {
          const el = document.getElementById(id);
          const style = getComputedStyle(el);
          return { dir: el.getAttribute('dir'), direction: style.direction, align: style.textAlign };
        };
        const result = document.createElement('pre');
        result.id = 'results';
        result.textContent = encodeURIComponent(JSON.stringify({
          fa: place('faBubble'), en: place('enBubble'),
          faShell: snap('faShell'), faColumn: snap('faColumn'), faText: snap('faText'),
          enText: snap('enText'), todo: snap('todo')
        }));
        document.body.append(result);
      </script>`);
    const result = spawnSync(process.env.CHROMIUM_PATH, [
      "--headless", "--no-sandbox", "--disable-gpu", "--no-first-run",
      "--user-data-dir=" + path.join(tempDir, "profile"),
      "--dump-dom", "--virtual-time-budget=2000", pathToFileURL(fixture).href
    ], { encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const match = result.stdout.match(/<pre id="results">([^<]+)<\/pre>/);
    assert.ok(match, result.stderr + result.stdout.slice(-1600));
    const data = JSON.parse(decodeURIComponent(match[1]));
    for (const id of ["fa", "en"]) {
      assert.ok(data[id].right < 2, id + " bubble stays against the physical right: " + JSON.stringify(data[id]));
      assert.ok(data[id].left > data[id].right + 40, id + " bubble is not pushed to the left: " + JSON.stringify(data[id]));
    }
    assert.equal(data.faShell.dir, null, "The alignment shell is not classified");
    assert.equal(data.faShell.direction, "ltr");
    assert.equal(data.faColumn.direction, "ltr");
    assert.equal(data.faText.dir, "rtl", "Persian text inside the bubble stays RTL");
    assert.equal(data.faText.direction, "rtl");
    assert.equal(data.enText.direction, "ltr");
    assert.equal(data.todo.dir, "rtl", "Checklist text inside the same shell still follows its own text");
    assert.equal(data.todo.direction, "rtl");
  } finally {
    assert.equal(path.dirname(path.resolve(tempDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(tempDir).startsWith("rtl-human-bubble-"));
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 });
  }
});
