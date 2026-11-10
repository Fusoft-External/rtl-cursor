"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const manifest = require("../../package.json");

const REVIEW_WAIT_MS = 6 * 60 * 1000;
const REVIEW_POLL_MS = 20 * 1000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkVersion(mode, packagePath, request = fetch, options = {}) {
    if (!["check", "verify"].includes(mode)) throw new Error("Use check or verify <VSIX path>");
    const { publisher, name, version } = manifest;
    const url = "https://open-vsx.org/api/" + [publisher, name, version].map(encodeURIComponent).join("/");
    const waitMs = options.waitMs ?? (mode === "verify" ? REVIEW_WAIT_MS : 0);
    const pollMs = options.pollMs ?? REVIEW_POLL_MS;
    const pause = options.sleep ?? sleep;
    const started = Date.now();
    let response;

    while (true) {
        try {
            response = await request(url, { signal: AbortSignal.timeout(30000) });
        } catch (error) {
            response = null;
            console.log("Open VSX lookup did not answer (" + error.message + "); still waiting for the public listing");
        }

        if (response && response.ok) break;
        if (mode === "check" && response && response.status === 404) {
            return "No active registry version found; publishing may proceed.";
        }
        if (mode !== "verify" || Date.now() - started >= waitMs) {
            const status = response ? response.status : "no response";
            throw new Error("Open VSX version lookup failed: HTTP " + status);
        }
        const status = response ? response.status : "no response";
        const elapsed = Math.round((Date.now() - started) / 1000);
        console.log("Open VSX has not listed " + publisher + "." + name + " " + version + " yet (HTTP " + status + ", " + elapsed + "s). Review keeps a new publish private; checking again in " + Math.round(pollMs / 1000) + "s.");
        await pause(pollMs);
    }

    if (mode === "check") {
        throw new Error(`${publisher}.${name} ${version} already exists on Open VSX. Prepare a new version; existing or deleted version numbers cannot be republished.`);
    }

    const metadata = await response.json();
    if (metadata.namespace !== publisher || metadata.name !== name || metadata.version !== version) {
        throw new Error("Registry metadata does not match the built extension");
    }
    if (!metadata.files || !metadata.files.download || new URL(metadata.files.download).protocol !== "https:") {
        throw new Error("Registry did not provide an HTTPS package download");
    }
    const download = await request(metadata.files.download, { signal: AbortSignal.timeout(60000) });
    if (!download.ok) throw new Error("Registry package download failed: HTTP " + download.status);
    const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
    const actual = digest(Buffer.from(await download.arrayBuffer()));
    const expected = digest(fs.readFileSync(packagePath));
    if (actual !== expected) throw new Error("Published VSIX differs from the validated build");
    return `Verified ${publisher}.${name} ${version}: ${actual}\nhttps://open-vsx.org/extension/${publisher}/${name}`;
}

if (require.main === module) {
    checkVersion(process.argv[2], process.argv[3]).then((message) => {
        console.log(message);
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + "\n");
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { checkVersion };
