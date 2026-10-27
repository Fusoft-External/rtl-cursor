# Project instructions

## Standing release workflow

The repository owner has asked that a finished VSIX build be followed by a Git
push and a GitHub release. This is a standing instruction for future work in this
repository; do not stop after producing only a local installer or ask again for
permission to publish that completed version. Follow any later instruction to
skip publishing, make a draft, or perform a local-only build.

After completing a release version:

1. Update `package.json`, the current installation filename and release notes in
   `readme.md`, and any runtime version identifiers affected by the change.
2. Run the checks appropriate to the change. Build the VSIX into
   `releases/rtl-cursor-<version>.vsix` and inspect its contents. Include required
   resources and third-party licenses; exclude development files and old VSIXes.
3. Commit the related source, documentation, assets, tests, and finished VSIX.
   Preserve unrelated user changes. Push to this repository's `origin` using the
   existing branch convention (currently `main`), without force-pushing.
4. Create the version tag `v<version>` on that exact release commit, push it, and
   publish a GitHub release in `Fusoft-External/rtl-cursor`. Attach the matching
   VSIX and `scripts/update-agent-watcher.ps1`, the migration helper used by
   Agent-mode users, plus `SHA256SUMS.txt` covering both files. Write release
   notes covering the final behavior, relevant validation, and any installation
   or restart steps.
5. Verify the published tag, release, and downloadable assets, then give the user
   the release link. Do not replace an existing published version or move an
   existing tag; inspect any collision first.

GitHub release publication is authorized by this workflow. Publishing to the
Visual Studio Marketplace is a separate action and needs its own user request.
Use existing Git/GitHub authentication without printing or committing secrets.
If authentication or access blocks publication, keep the completed local work
and report exactly which remaining step needs attention.

## Repository notes

- The shipped extension entry point is `dist/extension.js`; this checkout does
  not contain its original `src` tree. The injected runtime is `resources/rtl.js`
  and its Electron loader is `resources/rtl-cursor-loader.cjs`.
- Run JavaScript regression checks with `npm test`. Additional Windows checks
  are `npm run test:watcher` and `npm run test:migration` when those areas change.
- Package with `vsce package --no-dependencies --allow-missing-repository --out
  releases/rtl-cursor-<version>.vsix`, using a Node.js version supported by vsce.
  If the system Node.js is too old, use the available bundled workspace runtime.
- Font settings belong to the editor and user. Bundled Vazirmatn loading is
  optional and disabled by default; registering a font must not force it through
  CSS, inline styles, or changes to the user's editor settings.
- VS Code's Monaco prompt (`.interactive-input-editor`) owns its rendered lines,
  cursor geometry, selection and IME composition. Never set RTL attributes or
  override direction/alignment on its `.view-line` elements, including through
  the general editor RTL mode; keep RTL processing on displayed chat content.
  A test asserting that a prompt line becomes RTL is insufficient: assert zero
  extension-owned DOM/style mutations during mixed-language input and redraws.
  Native RTL may be enabled through the editor's model direction engine, scoped
  strictly to `chatSessionInput` / `sessions-chat` models; let Monaco own DOM,
  caret movement and hit testing. Validate using a real Monaco instance, including
  cursor arrows, mouse mapping, selection replacement and non-chat exclusion.
- VS Code streaming prose must use native per-paragraph bidi (`unicode-bidi:
  plaintext` with `text-align: start`) in CSS scoped to native chat. Do not
  repeatedly classify these paragraphs by language majority or write `dir` while
  tokens arrive. Test actual text positions before and after mixed-language
  appends, not just computed styles; preserve Cursor/Antigravity behavior.
- Run `npm run test:browser` with `CHROMIUM_PATH` pointing to a headless Chromium
  executable. Set `MONACO_TEST_DIR` to an official extracted `monaco-editor`
  package for the native input test and `RTL_VSCODE_CSS_PATH` to the installed
  Agents/workbench CSS for chat layout checks; neither dependency is shipped.
