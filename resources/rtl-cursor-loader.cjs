(function() {
    var fs = require("fs");
    var path = require("path");
    var os = require("os");

    var LOG_PREFIX = "[RTL Cursor Loader]";
    var homeDir = os.homedir();
    var LOG_FILE = path.join(homeDir, "rtl-cursor.log");
    var LOADER_VERSION = "1.0.17";
    var EXT_DIR_RE = /^(?:peyma|fusoft)\.rtl-cursor-(\d+)\.(\d+)\.(\d+)/;

    function log() {
        var args = Array.prototype.slice.call(arguments);
        var line = new Date().toISOString() + " " + args.join(" ") + "\n";
        try { fs.appendFileSync(LOG_FILE, line); } catch (e) {}
        console.warn.apply(console, [LOG_PREFIX].concat(args));
    }

    try {
        fs.writeFileSync(
            LOG_FILE,
            "=== rtl-cursor-loader started at " + new Date().toISOString() + " ===\nhome=" + homeDir + "\n"
        );
    } catch (initErr) {
        console.warn(LOG_PREFIX, "FATAL: cannot write log", initErr.message);
    }

    log("pid=" + process.pid, "version=" + LOADER_VERSION);

    var electron;
    try {
        electron = require("electron");
        log(
            "electron ok. app=" + (electron.app ? "ok" : "undefined") +
            " BrowserWindow=" + (electron.BrowserWindow ? "ok" : "undefined")
        );
    } catch (e) {
        log("FATAL: require('electron') failed:", e.message);
        return;
    }

    function parseExtensionVersion(dirName) {
        var m = dirName.match(EXT_DIR_RE);
        if (!m) return [0, 0, 0];
        return [Number(m[1]), Number(m[2]), Number(m[3])];
    }

    function compareExtensionDirs(a, b) {
        var va = parseExtensionVersion(a);
        var vb = parseExtensionVersion(b);
        for (var i = 0; i < 3; i++) {
            if (va[i] !== vb[i]) return va[i] - vb[i];
        }
        return 0;
    }

    function installedExtensionDirs(candidateDir) {
        var obsolete = {};
        var obsoletePath = path.join(candidateDir, ".obsolete");
        if (fs.existsSync(obsoletePath)) {
            try { obsolete = JSON.parse(fs.readFileSync(obsoletePath, "utf8")) || {}; }
            catch (error) { log("could not read obsolete extensions:", error.message); }
        }
        var registryPath = path.join(candidateDir, "extensions.json");
        var dirs;
        if (fs.existsSync(registryPath)) {
            // Extension directories can survive a downgrade until the extension
            // host cleans them up. Only registered installations may be loaded;
            // a higher numbered leftover must never override the active VSIX.
            try {
                var registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
                if (!Array.isArray(registry)) throw new Error("Invalid extension registry");
                dirs = registry.filter(function(entry) {
                    return entry && entry.identifier && /^(?:peyma|fusoft)\.rtl-cursor$/i.test(entry.identifier.id || "");
                }).map(function(entry) {
                    return entry.relativeLocation;
                }).filter(function(dir) {
                    return typeof dir === "string" && path.basename(dir) === dir && EXT_DIR_RE.test(dir);
                });
            } catch (error) {
                log("could not read installed extension registry:", error.message);
                return [];
            }
        } else {
            // Older/portable installations may not have a registry yet.
            dirs = fs.readdirSync(candidateDir).filter(function(dir) { return EXT_DIR_RE.test(dir); });
        }
        return dirs.filter(function(dir) { return obsolete[dir] !== true; }).sort(compareExtensionDirs);
    }

    function isVSCodeApp() {
        return /^(?:code(?: - insiders)?|code-insiders)\.exe$/i.test(path.basename(process.execPath || "")) ||
            /^(?:code|visual studio code)(?: - insiders)?$/i.test(electron.app.getName ? electron.app.getName() : "");
    }

    function findRtlScript() {
        var args = process.argv;
        var extDir = "";
        for (var i = 0; i < args.length; i++) {
            if (args[i] === "--extensions-dir" && args[i + 1]) {
                extDir = args[i + 1];
                break;
            }
            if (typeof args[i].startsWith === "function" && args[i].startsWith("--extensions-dir=")) {
                extDir = args[i].slice("--extensions-dir=".length);
                break;
            }
        }
        var searchDirs = [];
        if (extDir) searchDirs.push(extDir);
        // Resolve VS Code from its own installation, even when a newer/older
        // copy is also installed in Cursor. Portable mode keeps extensions in data.
        var isVSCode = isVSCodeApp();
        if (isVSCode) {
            if (process.env && process.env.VSCODE_PORTABLE) searchDirs.push(path.join(process.env.VSCODE_PORTABLE, "extensions"));
            searchDirs.push(path.join(homeDir, /insiders/i.test(process.execPath || "") ? ".vscode-insiders" : ".vscode", "extensions"));
        } else searchDirs.push(
            path.join(homeDir, ".cursor", "extensions"),
            path.join(homeDir, ".antigravity-ide", "extensions"),
            path.join(homeDir, ".antigravity", "extensions"),
            path.join(homeDir, ".vscode", "extensions")
        );

        for (var s = 0; s < searchDirs.length; s++) {
            var candidateDir = searchDirs[s];
            if (!fs.existsSync(candidateDir)) continue;
            try {
                var dirs = installedExtensionDirs(candidateDir);
                for (var d = dirs.length - 1; d >= 0; d--) {
                    var rtlPath = path.join(candidateDir, dirs[d], "resources", "rtl.js");
                    if (fs.existsSync(rtlPath)) {
                        log("rtl.js found at:", rtlPath);
                        return rtlPath;
                    }
                }
            } catch (e) {
                log("searchDirs error in " + candidateDir + ":", e.message);
            }
        }
        return "";
    }

    function isWorkbenchUrl(url) {
        return typeof url === "string" && (
            url.indexOf("workbench.html") !== -1 ||
            url.indexOf("workbench-jetski-agent") !== -1 ||
            url.indexOf("workbench-dev.html") !== -1 ||
            /(?:^|\/)vs\/sessions\/electron-browser\/sessions(?:-dev)?\.html(?:[?#]|$)/.test(url)
        );
    }

    // Cursor Canvas is served from a local Node server (127.0.0.1:ephemeral)
    // and mounted as preview iframes in chat + as the canvas editor document.
    function isCanvasUrl(url) {
        if (typeof url !== "string" || !url) return false;
        var local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url);
        if (!local) return false;
        return (
            url.indexOf("/canvas/") !== -1 ||
            url.indexOf("/canvas?") !== -1 ||
            url.indexOf("/runtime/canvas-runtime") !== -1 ||
            url.indexOf("preview=") !== -1
        );
    }

    function isInjectableUrl(url) {
        return isWorkbenchUrl(url) || isCanvasUrl(url);
    }

    function frameKey(frame) {
        try {
            if (frame && typeof frame.processId === "number" && typeof frame.routingId === "number") {
                return frame.processId + ":" + frame.routingId;
            }
        } catch (e) {}
        try {
            return String(frame && frame.url || "");
        } catch (e2) {
            return "";
        }
    }

    function isRtlRuntimeAliveInTarget(target) {
        return target.executeJavaScript('typeof window.__cursorRtlScanAll === "function"');
    }

    function getRuntimeConfig(rtlPath) {
        var config = { editorRtl: "off" };
        try {
            var isVSCode = isVSCodeApp();
            var settingsPath = path.join(homeDir, isVSCode ? ".rtl-cursor-vscode" : ".rtl-cursor", "font-settings.json");
            var settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
            if (settings.loadBundledVazirmatn !== true) return config;
            var fontDir = path.join(path.dirname(rtlPath), "fonts");
            config.bundledFonts = [
                { weight: "400", data: fs.readFileSync(path.join(fontDir, "Vazirmatn-Regular.ttf")).toString("base64") },
                { weight: "700", data: fs.readFileSync(path.join(fontDir, "Vazirmatn-Bold.ttf")).toString("base64") }
            ];
        } catch (e) {
            // Missing settings or fonts leave the editor's font behavior untouched.
        }
        return config;
    }

    function runRtlScriptOnTarget(target, label, currentUrl) {
        var rtlPath = findRtlScript();
        if (!rtlPath) {
            log(label, "rtl.js NOT FOUND");
            target.__rtlInjecting = false;
            return;
        }
        var script = fs.readFileSync(rtlPath, "utf-8");
        var configScript = "window.__cursorRtlConfig = " + JSON.stringify(getRuntimeConfig(rtlPath)) + ";\n";
        log(label, "executeJavaScript length:", script.length, "url=" + currentUrl);
        target.executeJavaScript(configScript + script)
            .then(function() { return isRtlRuntimeAliveInTarget(target); })
            .then(function(alive) {
                target.__rtlInjecting = false;
                if (alive) {
                    target.__rtlInjectedUrl = currentUrl;
                    log(label, "OK, runtime verified");
                } else {
                    target.__rtlInjectedUrl = "";
                    log(label, "finished but runtime not verified");
                }
            })
            .catch(function(err) {
                target.__rtlInjecting = false;
                target.__rtlInjectedUrl = "";
                log(label, "ERROR:", err && err.message);
            });
    }

    function injectIntoTarget(target, label, urlHint) {
        if (!target) { log(label, "no target"); return; }
        try {
            if (typeof target.isDestroyed === "function" && target.isDestroyed()) {
                log(label, "destroyed");
                return;
            }
        } catch (e) {
            return;
        }
        if (target.__rtlInjecting) { log(label, "in flight"); return; }

        var currentUrl = urlHint || "";
        if (!currentUrl) {
            try {
                currentUrl = typeof target.getURL === "function" ? target.getURL() : (target.url || "");
            } catch (e) {
                currentUrl = "";
            }
        }
        if (!isInjectableUrl(currentUrl)) {
            log(label, "skip url=" + currentUrl);
            return;
        }
        if (target.__rtlInjectedUrl === currentUrl) {
            isRtlRuntimeAliveInTarget(target)
                .then(function(alive) {
                    if (alive) {
                        log(label, "already active");
                        return;
                    }
                    target.__rtlInjectedUrl = "";
                    injectIntoTarget(target, label + "-revive", currentUrl);
                })
                .catch(function() {
                    target.__rtlInjectedUrl = "";
                    injectIntoTarget(target, label + "-revive", currentUrl);
                });
            return;
        }
        target.__rtlInjecting = true;
        try {
            runRtlScriptOnTarget(target, label, currentUrl);
        } catch (e) {
            target.__rtlInjecting = false;
            target.__rtlInjectedUrl = "";
            log(label, "inject error:", e.message);
        }
    }

    function collectFrames(wc) {
        var frames = [];
        try {
            var main = wc.mainFrame;
            if (!main) return frames;
            frames.push(main);
            if (main.framesInSubtree && typeof main.framesInSubtree === "object") {
                var list = main.framesInSubtree;
                for (var i = 0; i < list.length; i++) {
                    if (list[i] && list[i] !== main) frames.push(list[i]);
                }
            } else if (typeof main.framesInSubtree === "function") {
                var list2 = main.framesInSubtree();
                for (var j = 0; j < list2.length; j++) {
                    if (list2[j] && list2[j] !== main) frames.push(list2[j]);
                }
            }
        } catch (e) {
            log("collectFrames error:", e.message);
        }
        return frames;
    }

    function injectIntoWebContents(wc, label) {
        if (!wc || wc.isDestroyed()) { log(label, "wc destroyed"); return; }
        var currentUrl = "";
        try { currentUrl = wc.getURL ? wc.getURL() : ""; } catch (e) { currentUrl = ""; }

        // Main frame (workbench window or a canvas webview whose top doc is canvas)
        injectIntoTarget(wc, label + "-main", currentUrl);

        // Nested iframe frames (Canvas preview in chat lives here)
        var frames = collectFrames(wc);
        for (var i = 0; i < frames.length; i++) {
            var frame = frames[i];
            var fUrl = "";
            try { fUrl = frame.url || ""; } catch (e) { fUrl = ""; }
            if (!isCanvasUrl(fUrl) && !isWorkbenchUrl(fUrl)) continue;
            // Avoid double-injecting the main frame via both wc and mainFrame
            if (frame === wc.mainFrame && isWorkbenchUrl(currentUrl)) continue;
            injectIntoTarget(frame, label + "-frame[" + frameKey(frame) + "]", fUrl);
        }
    }

    function scheduleInjectFallback(wc, winId) {
        var delays = [250, 1000, 2500, 5000];
        for (var i = 0; i < delays.length; i++) {
            (function(delay) {
                setTimeout(function() {
                    if (!wc || wc.isDestroyed()) return;
                    injectIntoWebContents(wc, "fallback[" + winId + "@" + delay + "ms]");
                }, delay);
            })(delays[i]);
        }
    }

    function setupWebContents(wc, label) {
        if (!wc) { log(label, "no webContents"); return; }
        if (wc.__rtlCursorHooked) return;
        wc.__rtlCursorHooked = true;

        var id = "";
        try { id = String(wc.id); } catch (e) { id = "?"; }

        wc.on("did-start-loading", function() {
            wc.__rtlInjectedUrl = "";
        });
        wc.on("did-finish-load", function() {
            injectIntoWebContents(wc, "inject[" + id + "]");
        });
        wc.on("did-navigate-in-page", function() {
            injectIntoWebContents(wc, "navigate-in-page[" + id + "]");
        });
        wc.on("did-frame-finish-load", function(event, isMainFrame, frameProcessId, frameRoutingId) {
            try {
                var frame = null;
                if (electron.webFrameMain && typeof electron.webFrameMain.fromId === "function") {
                    frame = electron.webFrameMain.fromId(frameProcessId, frameRoutingId);
                }
                if (frame) {
                    var fUrl = "";
                    try { fUrl = frame.url || ""; } catch (e) { fUrl = ""; }
                    if (isInjectableUrl(fUrl)) {
                        injectIntoTarget(
                            frame,
                            "frame-load[" + id + ":" + frameProcessId + ":" + frameRoutingId + "]",
                            fUrl
                        );
                    }
                }
            } catch (err) {
                log("did-frame-finish-load error:", err && err.message);
            }
            // Also rescan all frames; canvas previews can appear after chat paint
            if (!isMainFrame) {
                injectIntoWebContents(wc, "frame-rescan[" + id + "]");
            }
        });

        scheduleInjectFallback(wc, id);
        if (!wc.isLoading() && !wc.isDestroyed()) {
            injectIntoWebContents(wc, "inject-now[" + id + "]");
        }
    }

    function setupWindow(win, label) {
        if (!win || !win.webContents) { log(label, "no webContents"); return; }
        setupWebContents(win.webContents, label);
    }

    // Prepare the native editor engine before either workbench starts reading
    // its bundle. The cached helper also removes native hooks after uninstall.
    if (isVSCodeApp() && typeof __dirname === "string") {
        try {
            var nativeRtlPath = findRtlScript();
            var sourceNativeHelper = nativeRtlPath ? path.join(path.dirname(nativeRtlPath), "rtl-vscode-native.cjs") : "";
            var hasNativeSource = sourceNativeHelper && fs.existsSync(sourceNativeHelper);
            var nativeHelper = hasNativeSource ? sourceNativeHelper : path.join(__dirname, "rtl-vscode-native.cjs");
            if (fs.existsSync(nativeHelper)) {
                var nativeResult = require(nativeHelper).syncNativeChat(__dirname, Boolean(hasNativeSource));
                log("native chat input:", JSON.stringify(nativeResult));
            }
        } catch (nativeError) { log("native chat input setup failed:", nativeError.message); }
    }

    try {
        electron.app.on("browser-window-created", function(ev, win) {
            log("browser-window-created id=" + win.id);
            setupWindow(win, "setup[" + win.id + "]");
        });
        log("browser-window-created listener registered");
    } catch (e) {
        log("FATAL: app.on failed:", e.message);
        return;
    }

    // Guest webviews / OOPIF-related webContents (canvas editor surface)
    try {
        electron.app.on("web-contents-created", function(ev, contents) {
            var url = "";
            try { url = contents.getURL ? contents.getURL() : ""; } catch (e) { url = ""; }
            log("web-contents-created id=" + contents.id + " url=" + url);
            setupWebContents(contents, "wc[" + contents.id + "]");
        });
        log("web-contents-created listener registered");
    } catch (e) {
        log("web-contents-created listener failed:", e.message);
    }

    try {
        var existing = electron.BrowserWindow.getAllWindows();
        log("existing windows:", existing.length);
        for (var i = 0; i < existing.length; i++) {
            setupWindow(existing[i], "existing[" + existing[i].id + "]");
        }
    } catch (e) {
        log("getAllWindows error:", e.message);
    }

    log("loader setup complete.");
})();
