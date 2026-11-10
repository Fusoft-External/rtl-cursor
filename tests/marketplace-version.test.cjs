"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { checkVersion } = require("../.github/scripts/marketplace-version.cjs");
const { version } = require("../package.json");

const queryUrl = "https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=3.0-preview.1";
const downloadUrl = "https://fusoft.gallerycdn.vsassets.io/extensions/fusoft/rtl-cursor/" + version + "/package";

function response(status, body, bytes) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
        arrayBuffer: async () => bytes
    };
}

function listing(bytes, versions = [version]) {
    return response(200, {
        results: [{
            extensions: [{
                publisher: { publisherName: "fusoft" },
                extensionName: "rtl-cursor",
                versions: versions.map((item) => ({
                    version: item,
                    files: [{ assetType: "Microsoft.VisualStudio.Services.VSIXPackage", source: downloadUrl }]
                }))
            }]
        }]
    }, bytes);
}

test("verification waits until the version is listed and then matches the published file", async () => {
    const bytes = Buffer.from("marketplace-vsix");
    const file = path.join(os.tmpdir(), "rtl-marketplace-match.vsix");
    fs.writeFileSync(file, bytes);
    const seen = [];
    let lookups = 0;
    const message = await checkVersion("verify", file, async (url) => {
        seen.push(url);
        if (url === queryUrl && lookups++ < 2) return listing(bytes, ["1.0.17"]);
        if (url === queryUrl) return listing(bytes);
        return response(200, null, bytes);
    }, { waitMs: 1000, pollMs: 1, sleep: async () => {} });
    assert.equal(lookups, 3);
    assert.ok(message.includes("fusoft.rtl-cursor"));
    assert.ok(message.includes("marketplace.visualstudio.com/items?itemName=fusoft.rtl-cursor"));
    assert.deepEqual(seen.filter((url) => url === downloadUrl), [downloadUrl]);
});

test("a pre-publish check treats a missing version as safe to publish", async () => {
    const message = await checkVersion("check", "", async () => listing(null, ["1.0.17"]), { sleep: async () => { throw new Error("check must not wait"); } });
    assert.match(message, /publishing may proceed/);
});

test("a pre-publish check rejects a version that is already public", async () => {
    await assert.rejects(
        checkVersion("check", "", async () => listing(null), { sleep: async () => { throw new Error("check must not wait"); } }),
        /already exists on the Visual Studio Marketplace/
    );
});

test("a public file that differs from the build still fails", async () => {
    const file = path.join(os.tmpdir(), "rtl-marketplace-mismatch.vsix");
    fs.writeFileSync(file, Buffer.from("local-build"));
    await assert.rejects(
        checkVersion("verify", file, async (url) => url === queryUrl ? listing(Buffer.from("local-build")) : response(200, null, Buffer.from("other-build")), { waitMs: 0 }),
        /differs from the validated build/
    );
});

test("verification retries with a new timeout after an aborted gallery lookup", async () => {
    const bytes = Buffer.from("marketplace-vsix");
    const file = path.join(os.tmpdir(), "rtl-marketplace-retry.vsix");
    fs.writeFileSync(file, bytes);
    const signals = [];
    let lookups = 0;
    const message = await checkVersion("verify", file, async (url, options = {}) => {
        if (url === queryUrl) {
            signals.push(options.signal);
            if (lookups++ === 0) {
                const err = new Error("The operation was aborted due to timeout");
                err.name = "TimeoutError";
                throw err;
            }
            return listing(bytes);
        }
        return response(200, null, bytes);
    }, { waitMs: 1000, pollMs: 1, sleep: async () => {} });
    assert.equal(lookups, 2);
    assert.equal(signals.length, 2);
    assert.notEqual(signals[0], signals[1], "A timed-out AbortSignal must not be reused for the next lookup");
    assert.ok(message.includes("fusoft.rtl-cursor"));
});

test("verification fails only after the listing wait stays unpublished", async () => {
    let lookups = 0;
    await assert.rejects(
        checkVersion("verify", "", async () => { lookups++; return listing(null, ["1.0.17"]); }, { waitMs: 0 }),
        /HTTP 200/
    );
    assert.equal(lookups, 1);
});
