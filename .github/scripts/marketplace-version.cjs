"use strict";
const fs = require("node:fs");
const crypto = require("node:crypto");
const manifest = require("../../package.json");

const LISTING_WAIT_MS = 6 * 60 * 1000;
const LISTING_POLL_MS = 20 * 1000;
const QUERY_URL = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=3.0-preview.1";
const VSIX_ASSET = "Microsoft.VisualStudio.Services.VSIXPackage";
const QUERY_FLAGS = 0x1 | 0x2 | 0x80;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function listedVersion(metadata, publisher, name, version) {
    const extension = metadata && metadata.results && metadata.results[0] && metadata.results[0].extensions
        ? metadata.results[0].extensions[0]
        : null;
    if (!extension) return null;
    if (extension.publisher?.publisherName !== publisher || extension.extensionName !== name) {
        throw new Error("Marketplace metadata does not match the built extension");
    }
    return (extension.versions || []).find((item) => item.version === version) || null;
}

function packageSource(versionInfo) {
    const file = (versionInfo.files || []).find((item) => item.assetType === VSIX_ASSET);
    if (!file || !file.source || new URL(file.source).protocol !== "https:") {
        throw new Error("Marketplace did not provide an HTTPS package download");
    }
    return file.source;
}

async function checkVersion(mode, packagePath, request = fetch, options = {}) {
    if (!["check", "verify"].includes(mode)) throw new Error("Use check or verify <VSIX path>");
    const { publisher, name, version } = manifest;
    const waitMs = options.waitMs ?? (mode === "verify" ? LISTING_WAIT_MS : 0);
    const pollMs = options.pollMs ?? LISTING_POLL_MS;
    const pause = options.sleep ?? sleep;
    const started = Date.now();
    const query = {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json;api-version=3.0-preview.1"
        },
        body: JSON.stringify({
            filters: [{
                criteria: [{ filterType: 7, value: publisher + "." + name }],
                pageNumber: 1,
                pageSize: 1
            }],
            flags: QUERY_FLAGS
        }),
        signal: AbortSignal.timeout(30000)
    };

    let match;
    while (true) {
        let response;
        try {
            response = await request(QUERY_URL, query);
        } catch (error) {
            response = null;
            console.log("Marketplace lookup did not answer (" + error.message + "); still waiting for the public listing");
        }

        if (response && response.ok) {
            match = listedVersion(await response.json(), publisher, name, version);
            if (match || mode === "check") break;
        }

        if (mode !== "verify" || Date.now() - started >= waitMs) {
            const status = response ? response.status : "no response";
            if (response && response.ok && mode === "check") break;
            throw new Error("Marketplace version lookup failed: HTTP " + status);
        }
        const status = response ? response.status : "no response";
        const elapsed = Math.round((Date.now() - started) / 1000);
        console.log("Marketplace has not listed " + publisher + "." + name + " " + version + " yet (HTTP " + status + ", " + elapsed + "s). Checking again in " + Math.round(pollMs / 1000) + "s.");
        await pause(pollMs);
    }

    if (mode === "check") {
        if (match) {
            throw new Error(publisher + "." + name + " " + version + " already exists on the Visual Studio Marketplace. Prepare a new version; an existing version is not republished.");
        }
        return "No Marketplace version found; publishing may proceed.";
    }

    const download = await request(packageSource(match), { signal: AbortSignal.timeout(60000) });
    if (!download.ok) throw new Error("Marketplace package download failed: HTTP " + download.status);
    const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
    const actual = digest(Buffer.from(await download.arrayBuffer()));
    const expected = digest(fs.readFileSync(packagePath));
    if (actual !== expected) throw new Error("Published VSIX differs from the validated build");
    return "Verified " + publisher + "." + name + " " + version + ": " + actual + "\nhttps://marketplace.visualstudio.com/items?itemName=" + publisher + "." + name;
}

if (require.main === module) {
    checkVersion(process.argv[2], process.argv[3]).then((message) => {
        console.log(message);
        if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + "\n");
    }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { checkVersion };
