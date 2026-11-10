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

GitHub release publication is authorized by this workflow. When the user says
`cicd`, publish the latest version to GitHub, Open VSX, and the Visual Studio
Marketplace. Cursor installs from Open VSX and VS Code from the Marketplace, so
that latest number must be the same in every place. Do not publish a different
number to one registry, and do not backfill older missing numbers unless the
user asks. A change that only runs in one editor still ships as that one latest
version. Skip a registry only when the user explicitly says to skip it.
Use existing Git/GitHub authentication without printing or committing secrets.
If authentication or access blocks publication, keep the completed local work
and report exactly which remaining step needs attention.

For subsequent automated releases, prefer `.github/workflows/build-release.yml`:
push the versioned source commit to `main`, then push `v<version>` on that exact
commit. Actions runs all checks, builds and inspects the VSIX from the tagged
source, and publishes the three required assets with notes from `readme.md`.
The local VSIX build/commit steps above apply to manual packaging; the CI-built
VSIX is authoritative for automated releases. Its main/PR/manual runs only upload
build artifacts and do not publish or replace an existing release. A version tag
publishes the GitHub release only. CI-only changes do not require changing the
extension version or moving its current tag.

The command `cicd` is what publishes the latest version to all three places.
Push the version tag, let `.github/workflows/build-release.yml` create the
GitHub release, then run `.github/workflows/publish-openvsx.yml` and
`.github/workflows/publish-marketplace.yml` for that same tag with
`publish=true`. Confirm all three when they finish. Do not run a registry
workflow again for a version it already has. Use `publish=false` only for a
build-only check. Keep the OIDC publish steps in their own workflow files. The
trusted publisher policies are bound to those filenames; moving the publish
commands into `build-release.yml` breaks publication.

Open VSX uses `.github/workflows/publish-openvsx.yml` and the `openvsx`
environment. The Trusted Publisher registration must name `Fusoft-External`,
`rtl-cursor`, `publish-openvsx.yml`, and environment `openvsx`, for extension
`fusoft.rtl-cursor`. Do not add or request a long-lived Open VSX token. Never
delete an Open VSX version to reuse its number: deleted numbers stay reserved.

The Visual Studio Marketplace uses `.github/workflows/publish-marketplace.yml`
and the `marketplace` environment. It publishes with
`vsce publish --packagePath --oidc`. The Trusted Publishing policy must name
repository owner `Fusoft-External`, repository `rtl-cursor`, workflow
`publish-marketplace.yml`, and environment `marketplace`, for publisher
`fusoft`. Do not add or request a Marketplace PAT. `@vscode/vsce` in
`.github/ci` must stay on a release that supports `--oidc` (currently 4.1.0).
An existing Marketplace version is not republished.

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
  Global LTR/code CSS must exclude `.interactive-input-editor .monaco-editor`;
  ancestor bidi overrides can clip pure RTL input under the real workbench CSS.
  The native browser test must load installed workbench CSS and assert pure
  Persian glyph bounds remain inside the input, as well as mixed text behavior.
- Agents uses `.sessions-chat-editor` for its new-session composer rather than
  `.interactive-input-editor`. Exclude both from global code bidi CSS, DOM
  scanning and file-editor RTL modes. Test both real Monaco wrappers with the
  installed Agents CSS, including the revealed welcome composer and redraws.
- Resolve runtime assets from the editor's `extensions.json` installation
  registry, skipping `.obsolete` versions. A higher numbered leftover directory
  can survive a downgrade until after the main-process loader has already run;
  `--list-extensions` alone does not prove which runtime a window received.
  Check the loader log's selected path and script length after a full restart.
- VS Code streaming prose must use native per-paragraph bidi (`unicode-bidi:
  plaintext` with `text-align: start`) in CSS scoped to native chat. Do not
  repeatedly classify these paragraphs by language majority or write `dir` while
  tokens arrive. Test actual text positions before and after mixed-language
  appends, not just computed styles; preserve Cursor/Antigravity behavior.
- Run `npm run test:browser` with `CHROMIUM_PATH` pointing to a headless Chromium
  executable. Set `MONACO_TEST_DIR` to an official extracted `monaco-editor`
  package for the native input test and `RTL_VSCODE_CSS_PATH` to the installed
  Agents/workbench CSS for chat layout checks; neither dependency is shipped.
