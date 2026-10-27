"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("native VS Code Agent content stays bidirectional during streaming and typing", {
  skip: !process.env.CHROMIUM_PATH && "Set CHROMIUM_PATH to run the real Chromium layout regression"
}, () => {
  const runtime = fs.readFileSync(path.join(__dirname, "../resources/rtl.js"), "utf8");
  const nativeCss = process.env.RTL_VSCODE_CSS_PATH ? fs.readFileSync(process.env.RTL_VSCODE_CSS_PATH, "utf8") : "";
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtl-vscode-browser-"));
  const fixture = path.join(tempDir, "fixture.html");
  try {
    fs.writeFileSync(fixture, `<!doctype html><meta charset="utf-8"><style>${nativeCss}</style>
      <style>body { font-family: Arial; } .view-line { width:600px; } .chat-question-list-item {display:flex;}</style>
      <div class="monaco-workbench"><div class="interactive-session">
        <div class="interactive-item-container interactive-request"><div id="request" class="chat-request-text">لطفاً این کد را بررسی کن</div></div>
        <div class="interactive-item-container interactive-response"><div id="answer" class="rendered-markdown chat-markdown-part">
          <p id="persian">این متن فارسی با <code id="inline">npm test</code> بررسی می‌شود.</p>
          <p id="english">This paragraph must stay left to right.</p>
          <ul id="list"><li>اولین مورد</li><li>دومین مورد</li></ul>
          <table><tr><td id="cell">مقدار فارسی</td><td id="englishCell">English value</td></tr></table>
          <pre id="pre"><code id="code">const x = 'متن فارسی';</code></pre>
          <div class="chat-codeblock"><div class="monaco-editor"><div id="codeLine" class="view-line">const x = 'فارسی';</div></div></div>
        </div></div>
        <div class="chat-question-carousel-container">
          <div id="question" class="chat-question-title">کدام گزینه مناسب است؟</div>
          <div id="option" class="chat-question-list-item"><span class="chat-question-list-label-title">گزینه اول</span><span class="chat-question-list-indicator">✓</span></div>
          <div id="englishOption" class="chat-question-list-item"><span class="chat-question-list-label-title">Keep existing behavior</span></div>
          <textarea id="freeform" class="chat-question-freeform-textarea"></textarea>
        </div>
        <div class="interactive-input-part"><div class="interactive-input-editor"><div class="monaco-editor"><div class="view-lines"><div id="prompt" class="view-line"><span id="promptText">سلام دنیا</span></div></div></div></div></div>
        <div class="chat-todo-list-widget"><span id="todo" class="todo-content">بررسی تغییرات</span></div>
        <div class="xterm"><p id="terminal">دستور فارسی</p></div>
      </div><span id="title" class="session-title">عنوان نشست فارسی</span>
      <div class="monaco-editor"><div id="editor" class="view-line">کد فارسی</div></div>
      <div class="rendered-markdown"><p id="unrelated">بیرون از چت</p></div></div>
      <script>${runtime}</script>
      <script>
      const snapshot = (id) => { const el = document.getElementById(id); const s = getComputedStyle(el); return {dir:el.getAttribute('dir'), direction:s.direction, align:s.textAlign, font:s.fontFamily}; };
      setTimeout(() => {
        const initial = Object.fromEntries(['request','persian','english','list','cell','englishCell','question','option','englishOption','freeform','prompt','todo','title','terminal','editor','unrelated','codeLine','inline','pre'].map(id => [id, snapshot(id)]));
        document.getElementById('promptText').firstChild.data = 'English prompt';
        document.getElementById('english').firstChild.data = 'این پاسخ حالا فارسی شد';
        const added = document.createElement('p'); added.id='streamed'; added.textContent='پاسخ جدید در حال دریافت است'; document.getElementById('answer').append(added);
        const input=document.getElementById('freeform'); input.value='پاسخ فارسی'; input.dispatchEvent(new Event('input',{bubbles:true}));
        setTimeout(() => {
          const result = document.createElement('pre'); result.id='results';
          result.textContent=encodeURIComponent(JSON.stringify({initial,changed:snapshot('english'),prompt:snapshot('prompt'),streamed:snapshot('streamed'),freeform:snapshot('freeform')}));
          document.body.append(result);
        }, 400);
      }, 400);
      </script>`);
    const result = spawnSync(process.env.CHROMIUM_PATH, ["--headless", "--no-sandbox", "--disable-gpu", "--no-first-run", "--user-data-dir=" + path.join(tempDir, "profile"), "--dump-dom", "--virtual-time-budget=6000", pathToFileURL(fixture).href], {
      encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024
    });
    assert.equal(result.status, 0, result.stderr);
    const match = result.stdout.match(/<pre id="results">([^<]+)<\/pre>/);
    assert.ok(match, "The complete runtime must execute and finish its browser checks: " + result.stderr + result.stdout.slice(-1600));
    const data = JSON.parse(decodeURIComponent(match[1]));
    for (const id of ["request", "persian", "list", "cell", "question", "option", "prompt", "todo", "title"]) {
      assert.equal(data.initial[id].dir, "rtl", id);
      assert.equal(data.initial[id].direction, "rtl", id);
      assert.equal(data.initial[id].align, "right", id);
    }
    for (const id of ["english", "englishCell", "englishOption", "inline", "pre"]) assert.equal(data.initial[id].direction, "ltr", id);
    for (const id of ["editor", "codeLine", "terminal", "unrelated"]) assert.equal(data.initial[id].dir, null, id);
    assert.equal(data.initial.persian.font, "Arial", "No font override");
    assert.equal(data.changed.dir, "rtl", "Streaming updates existing paragraphs");
    assert.equal(data.streamed.dir, "rtl", "Streaming adds new paragraphs");
    assert.equal(data.prompt.dir, "ltr", "Typing updates the Monaco prompt line");
    assert.equal(data.freeform.dir, "auto", "Native textareas follow input without DOM mutations");
    assert.equal(data.freeform.direction, "rtl");
  } finally {
    assert.equal(path.dirname(path.resolve(tempDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(tempDir).startsWith("rtl-vscode-browser-"));
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 });
  }
});
