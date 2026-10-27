"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("VS Code messages stay bidirectional while Monaco owns prompt typing and layout", {
  skip: !process.env.CHROMIUM_PATH && "Set CHROMIUM_PATH to run the real Chromium layout regression"
}, () => {
  const runtime = fs.readFileSync(path.join(__dirname, "../resources/rtl.js"), "utf8");
  const nativeCss = process.env.RTL_VSCODE_CSS_PATH ? fs.readFileSync(process.env.RTL_VSCODE_CSS_PATH, "utf8") : "";
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtl-vscode-browser-"));
  const fixture = path.join(tempDir, "fixture.html");
  try {
    fs.writeFileSync(fixture, `<!doctype html><meta charset="utf-8"><style>${nativeCss}</style>
      <style>body { font-family: Arial; } .view-line { width:600px; } .chat-question-list-item {display:flex;} #streamRtl,#streamLtr {display:block;width:600px;min-height:24px;font:16px Arial;}</style>
      <div class="monaco-workbench"><div class="interactive-session">
        <div class="interactive-item-container interactive-request"><div id="request" class="chat-request-text">لطفاً این کد را بررسی کن</div></div>
        <div class="interactive-item-container interactive-response"><div id="answer" class="rendered-markdown chat-markdown-part">
          <p id="persian">این متن فارسی با <code id="inline">npm test</code> بررسی می‌شود.</p>
          <p id="english">This paragraph must stay left to right.</p>
          <p id="streamRtl"><span id="rtlAnchor">سلام</span></p>
          <p id="streamLtr"><span id="ltrAnchor">Hello</span></p>
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
      <div class="new-chat-input-container"><div class="sessions-chat-editor"><div class="monaco-editor"><div class="view-lines"><div id="newPrompt" class="view-line"><span id="newPromptText">سلام دنیا</span></div></div></div></div></div>
      <div class="ui-prompt-input"><div id="cursorPrompt" class="tiptap ProseMirror" contenteditable="true"><p id="cursorPromptLine">پیام فارسی در Cursor</p></div></div>
      <div class="aislash-editor-input"><p id="cursorComposer">متن فارسی کامپوزر</p></div>
      <div class="markdown-root"><p id="cursorAnswer">پاسخ فارسی Cursor</p><p id="cursorEnglish">English Cursor response</p><pre id="cursorCode"><code>const x = 'فارسی';</code></pre></div>
      <article role="article"><p id="antigravityAnswer">پاسخ فارسی دستیار</p><p id="antigravityEnglish">English agent response</p></article>
      <script>
      window.promptMutations=[];
      window.streamMutations=[];
      for (const id of ['streamRtl','streamLtr']) new MutationObserver(records => window.streamMutations.push(...records.map(m => m.attributeName))).observe(document.getElementById(id),{attributes:true,attributeFilter:['dir','style','data-cursor-rtl-vscode']});
      for (const promptRoot of document.querySelectorAll('.interactive-input-editor, .sessions-chat-editor')) new MutationObserver(records => window.promptMutations.push(...records.map(m => ({attribute:m.attributeName,id:m.target.id})))).observe(promptRoot,{attributes:true,subtree:true,attributeFilter:['dir','style','data-cursor-rtl-vscode','data-cursor-rtl-dir']});
      const caret=document.createRange(); caret.setStart(document.getElementById('promptText').firstChild,2); caret.collapse(true); getSelection().addRange(caret);
      </script>
      <script>${runtime}</script>
      <script>
      const snapshot = (id) => { const el = document.getElementById(id); const s = getComputedStyle(el); return {dir:el.getAttribute('dir'), direction:s.direction, align:s.textAlign, bidi:s.unicodeBidi, font:s.fontFamily}; };
      const anchorPosition=(id) => {const anchor=document.getElementById(id); const a=anchor.getBoundingClientRect(); const p=anchor.parentElement.getBoundingClientRect();return {left:a.left-p.left,right:p.right-a.right};};
      const beforeScan={rtl:anchorPosition('rtlAnchor'),ltr:anchorPosition('ltrAnchor')};
      setTimeout(() => {
        const initial = Object.fromEntries(['request','persian','english','list','cell','englishCell','question','option','englishOption','freeform','prompt','todo','title','terminal','editor','unrelated','codeLine','inline','pre','cursorPrompt','cursorPromptLine','cursorComposer','cursorAnswer','cursorEnglish','cursorCode','antigravityAnswer','antigravityEnglish'].map(id => [id, snapshot(id)]));
        const initialSelection={node:getSelection().anchorNode.parentElement.id,offset:getSelection().anchorOffset};
        const beforeStream={rtl:anchorPosition('rtlAnchor'),ltr:anchorPosition('ltrAnchor')};
        document.getElementById('streamRtl').append(document.createTextNode(' '+('English words added to the response ').repeat(10)));
        document.getElementById('streamLtr').append(document.createTextNode(' '+('متن فارسی که به پاسخ اضافه شده است ').repeat(10)));
        window.__cursorRtlSetEditorMode('always');
        const promptEditorMarked=document.querySelector('.interactive-input-editor .monaco-editor').hasAttribute('data-cursor-rtl-dir');
        const fileEditorAlignmentDuringAlways=getComputedStyle(document.getElementById('editor')).textAlign;
        window.newPromptMarked=document.querySelector('.sessions-chat-editor .monaco-editor').hasAttribute('data-cursor-rtl-dir');
        window.__cursorRtlSetEditorMode('off');
        for(const text of ['English prompt','فارسی با English در حال تایپ']) document.getElementById('newPromptText').firstChild.data=text;
        const redrawn=document.createElement('div');redrawn.className='view-line';redrawn.id='redrawnNewPrompt';redrawn.textContent='خط فارسی جدید';document.getElementById('newPrompt').after(redrawn);
        const newInput=document.querySelector('.new-chat-input-container');newInput.classList.add('new-chat-in-session');document.querySelector('.interactive-session').append(newInput);
        document.getElementById('promptText').firstChild.data = 'English prompt';
        document.getElementById('promptText').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
        document.getElementById('promptText').firstChild.data = 'فارسی با English در حال تایپ';
        document.getElementById('promptText').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'فارسی'}));
        const newLine=document.createElement('div'); newLine.className='view-line'; newLine.id='redrawnPrompt'; newLine.textContent='خط جدید فارسی'; document.getElementById('prompt').after(newLine);
        document.getElementById('english').firstChild.data = 'این پاسخ حالا فارسی شد';
        const added = document.createElement('p'); added.id='streamed'; added.textContent='پاسخ جدید در حال دریافت است'; document.getElementById('answer').append(added);
        const streamedAtInsert=snapshot('streamed');
        const input=document.getElementById('freeform'); input.value='پاسخ فارسی'; input.dispatchEvent(new Event('input',{bubbles:true}));
        setTimeout(() => {
          const result = document.createElement('pre'); result.id='results';
          result.textContent=encodeURIComponent(JSON.stringify({initial,initialSelection,promptEditorMarked,newPromptMarked:window.newPromptMarked,newPrompt:snapshot('newPrompt'),redrawnNewPrompt:snapshot('redrawnNewPrompt'),fileEditorAlignmentDuringAlways,promptMutations:window.promptMutations,streamMutations:window.streamMutations,beforeScan,beforeStream,afterStream:{rtl:anchorPosition('rtlAnchor'),ltr:anchorPosition('ltrAnchor')},redrawnPrompt:snapshot('redrawnPrompt'),changed:snapshot('english'),prompt:snapshot('prompt'),streamedAtInsert,streamed:snapshot('streamed'),freeform:snapshot('freeform')}));
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
    for (const id of ["question", "option", "todo", "title"]) {
      assert.equal(data.initial[id].dir, "rtl", id);
      assert.equal(data.initial[id].direction, "rtl", id);
      assert.equal(data.initial[id].align, "right", id);
    }
    for (const id of ["englishOption", "inline", "pre"]) assert.equal(data.initial[id].direction, "ltr", id);
    for (const id of ["request", "persian", "english", "cell", "englishCell"]) {
      assert.equal(data.initial[id].dir, null, id + " uses native paragraph bidi");
      assert.equal(data.initial[id].bidi, "plaintext", id);
      assert.equal(data.initial[id].align, "start", id);
    }
    assert.equal(data.initial.list.dir, "auto");
    for (const id of ["editor", "codeLine", "terminal", "unrelated", "prompt"]) assert.equal(data.initial[id].dir, null, id);
    assert.equal(data.initial.persian.font, "Arial", "No font override");
    assert.equal(data.changed.dir, null, "Changed paragraphs use native bidi without scanner writes");
    assert.equal(data.streamed.bidi, "plaintext", "New paragraphs receive native bidi before a delayed scan");
    assert.equal(data.streamedAtInsert.bidi, "plaintext", "New content is bidi-correct in the same frame it is inserted");
    assert.equal(data.streamedAtInsert.dir, null, "New content does not wait for a DOM patch");
    assert.deepEqual(data.streamMutations, [], "Streaming never writes direction or styles on response paragraphs");
    assert.ok(data.beforeScan.rtl.right < 1, "Persian is right-aligned before the first scheduled scan");
    assert.ok(data.beforeScan.ltr.left < 1, "English is left-aligned before the first scheduled scan");
    for (const phase of [data.beforeStream, data.afterStream]) {
      assert.ok(Math.abs(phase.rtl.right - data.beforeScan.rtl.right) < 1, "Adding English tokens cannot move the Persian start");
      assert.ok(Math.abs(phase.ltr.left - data.beforeScan.ltr.left) < 1, "Adding Persian tokens cannot move the English start");
    }
    assert.equal(data.prompt.dir, null, "Mixed-language typing stays under Monaco's control");
    assert.equal(data.redrawnPrompt.dir, null, "Monaco redraws are not patched");
    assert.equal(data.promptEditorMarked, false, "Editor RTL mode never flips the chat prompt");
    assert.equal(data.fileEditorAlignmentDuringAlways, "right", "The prompt CSS exclusion preserves optional file-editor RTL alignment");
    assert.equal(data.newPromptMarked,false,"New-session prompts stay outside file editor RTL mode");
    assert.equal(data.newPrompt.dir,null);
    assert.equal(data.redrawnNewPrompt.dir,null);
    assert.deepEqual(data.promptMutations, [], "No direction or style writes inside the prompt, including during composition");
    assert.deepEqual(data.initialSelection, {node:"promptText",offset:2}, "The initial RTL scan preserves the selection");
    assert.equal(data.freeform.dir, "auto", "Native textareas follow input without DOM mutations");
    assert.equal(data.freeform.direction, "rtl");
    for (const id of ["cursorPrompt", "cursorPromptLine", "cursorComposer", "cursorAnswer", "antigravityAnswer"]) {
      assert.equal(data.initial[id].dir, "rtl", id + " keeps its existing RTL behavior");
      assert.equal(data.initial[id].direction, "rtl", id);
    }
    for (const id of ["cursorEnglish", "cursorCode", "antigravityEnglish"]) assert.equal(data.initial[id].direction, "ltr", id);
  } finally {
    assert.equal(path.dirname(path.resolve(tempDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(tempDir).startsWith("rtl-vscode-browser-"));
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5 });
  }
});
