"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const manifest = require("../../package.json");

async function checkVersion(mode, packagePath, request = fetch) {
    if (!["check", "verify"].includes(mode)) throw new Error("Use check or verify <VSIX path>");
    const { publisher, name, version } = manifest;
    const url = "https://open-vsx.org/api/" + [publisher, name, version].map(encodeURIComponent).join("/");
    const response = await request(url, { signal: AbortSignal.timeout(30000) });
    if (mode === "check" && response.status === 404) return "No active registry version found; publishing may proceed.";
    if (!response.ok) throw new Error("Open VSX version lookup failed: HTTP " + response.status);
    if (mode === "check") throw new Error(`${publisher}.${name} ${version} already exists on Open VSX. Prepare a new version; existing or deleted version numbers cannot be republished.`);

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
