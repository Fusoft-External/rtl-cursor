"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { patchBundle } = require("../resources/rtl-vscode-native.cjs");

test("real Monaco keeps Persian input, native caret arrows and mouse mapping in sync", {
  skip: (!process.env.CHROMIUM_PATH || !process.env.MONACO_TEST_DIR) && "Set CHROMIUM_PATH and MONACO_TEST_DIR to an official monaco-editor package"
}, async () => {
  const packageRoot = path.resolve(process.env.MONACO_TEST_DIR);
  const runtime = fs.readFileSync(path.join(__dirname, "../resources/rtl.js"), "utf8");
  const nativeModules = fs.readdirSync(path.join(packageRoot, "dev/vs")).filter((name) => /^editor-.*\.js$/.test(name));
  let patchedModule = null;
  for (const name of nativeModules) {
    const file = path.join(packageRoot, "dev/vs", name);
    const source = fs.readFileSync(file, "utf8");
    if (source.includes("_getTextDirection(")) patchedModule = { file, source: patchBundle(source) };
  }
  assert.ok(patchedModule, "The real engine must expose the production hook");
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0}#input,#file{width:900px;height:180px}</style>
    <div class="interactive-input-editor"><div id="input"></div></div><div id="file"></div>
    <script>window.__cursorRtlConfig={editorRtl:'off'};</script><script>${runtime}</script><script src="/dev/vs/loader.js"></script><script>
    require.config({paths:{vs:'/dev/vs'}});
    require(['vs/editor/editor.main'],function(monaco){
      try {
        const sample='سلام Copilot، می‌توانی این function را اصلاح کنی؟';
        const model=monaco.editor.createModel(sample+'\\nEnglish input', 'plaintext',monaco.Uri.parse('chatSessionInput:rtl-test'));
        const options={model,wordWrap:'off',minimap:{enabled:false},fontSize:16,lineNumbers:'off',glyphMargin:false,scrollBeyondLastLine:false,automaticLayout:false};
        const editor=monaco.editor.create(document.getElementById('input'),options);
        const fileModel=monaco.editor.createModel(sample,'plaintext',monaco.Uri.parse('file:///ordinary.txt'));
        const fileEditor=monaco.editor.create(document.getElementById('file'),{...options,model:fileModel});
        editor.render(true); fileEditor.render(true);
        const result={dir:document.querySelector('#input .view-line').getAttribute('dir'),fileDir:document.querySelector('#file .view-line').getAttribute('dir')};
        result.first=editor.getScrolledVisiblePosition({lineNumber:1,column:1});
        result.english=editor.getScrolledVisiblePosition({lineNumber:2,column:1});
        const rect=document.getElementById('input').getBoundingClientRect();
        const target=editor.getTargetAtClientPoint(rect.left+result.first.left,rect.top+result.first.top+8);
        result.mouseColumn=target&&target.position&&target.position.column;
        editor.setPosition({lineNumber:1,column:1}); editor.trigger('keyboard','cursorLeft',{}); result.leftColumn=editor.getPosition().column;
        editor.trigger('keyboard','cursorRight',{}); result.rightColumn=editor.getPosition().column;
        editor.setSelection({startLineNumber:1,startColumn:1,endLineNumber:1,endColumn:5});
        editor.trigger('keyboard','type',{text:'درود'}); result.replaced=model.getLineContent(1);
        editor.setPosition({lineNumber:1,column:model.getLineMaxColumn(1)}); editor.trigger('keyboard','type',{text:' English appended'});
        editor.render(true); result.afterTypeDir=document.querySelector('#input .view-line').getAttribute('dir');
        result.value=model.getValue();
        const output=document.createElement('pre');output.id='native-results';output.textContent=encodeURIComponent(JSON.stringify(result));document.body.append(output);
      } catch(error){const output=document.createElement('pre');output.id='native-error';output.textContent=encodeURIComponent(error.stack);document.body.append(output);}
    });</script>`;
  const server = http.createServer((req, res) => {
    if (req.url === "/") { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end(html); return; }
    const file = path.resolve(packageRoot, "." + new URL(req.url, "http://localhost").pathname);
    if (!file.startsWith(packageRoot + path.sep)) { res.writeHead(403).end(); return; }
    try {
      res.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "text/javascript; charset=utf-8");
      res.end(file === patchedModule.file ? patchedModule.source : fs.readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const child = spawn(process.env.CHROMIUM_PATH, ["--headless", "--no-sandbox", "--disable-gpu", "--dump-dom", "--virtual-time-budget=6000", `http://127.0.0.1:${server.address().port}/`], { windowsHide: true });
    let output = "", errors = "";
    child.stdout.on("data", (data) => { output += data; }); child.stderr.on("data", (data) => { errors += data; });
    const timeout = setTimeout(() => child.kill(), 30000);
    const status = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    clearTimeout(timeout);
    assert.equal(status, 0, errors);
    const match = output.match(/<pre id="native-results">([^<]+)<\/pre>/);
    assert.ok(match, output.slice(-3000) + errors);
    const result = JSON.parse(decodeURIComponent(match[1]));
    assert.equal(result.dir, "rtl");
    assert.equal(result.fileDir, "ltr", "Ordinary text files keep the stock editor behavior");
    assert.ok(result.first.left > result.english.left + 300, "The native caret starts on the right for Persian and left for English");
    assert.equal(result.mouseColumn, 1, "Mouse hit testing agrees with the rendered RTL caret");
    assert.equal(result.leftColumn, 2, "The native left arrow advances through a Persian line");
    assert.equal(result.rightColumn, 1, "The native right arrow returns to the first column");
    assert.ok(result.replaced.startsWith("درود Copilot"), "Selection replacement preserves logical text order");
    assert.equal(result.afterTypeDir, "rtl");
    assert.ok(result.value.includes("English appended\\nEnglish input".replace('\\n','\n')));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
