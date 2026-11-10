"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { checkVersion } = require("../.github/scripts/openvsx-version.cjs");

const versionUrl = "https://open-vsx.org/api/fusoft/rtl-cursor/1.0.18";
const downloadUrl = "https://open-vsx.org/api/fusoft/rtl-cursor/1.0.18/file/fusoft.rtl-cursor-1.0.18.vsix";

function response(status, body, bytes) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
        arrayBuffer: async () => bytes
    };
}

function published(bytes) {
    return response(200, {
        namespace: "fusoft",
        name: "rtl-cursor",
        version: "1.0.18",
        files: { download: downloadUrl }
    }, bytes);
}

test("verification waits through review 404s and then matches the published file", async () => {
    const bytes = Buffer.from("vsix-under-review");
    const file = path.join(os.tmpdir(), "rtl-openvsx-match.vsix");
    fs.writeFileSync(file, bytes);
    const seen = [];
    let lookups = 0;
    const message = await checkVersion("verify", file, async (url) => {
        seen.push(url);
        if (url === versionUrl && lookups++ < 2) return response(404, {});
        if (url === versionUrl) return published(bytes);
        return response(200, null, bytes);
    }, { waitMs: 1000, pollMs: 1, sleep: async () => {} });
    assert.equal(lookups, 3);
    assert.ok(message.includes("fusoft.rtl-cursor"));
    assert.deepEqual(seen.filter((url) => url === downloadUrl), [downloadUrl]);
});

test("a pre-publish check still treats a missing version as safe to publish", async () => {
    const message = await checkVersion("check", "", async () => response(404, {}), { sleep: async () => { throw new Error("check must not wait"); } });
    assert.match(message, /publishing may proceed/);
});

test("a public file that differs from the build still fails", async () => {
    const file = path.join(os.tmpdir(), "rtl-openvsx-mismatch.vsix");
    fs.writeFileSync(file, Buffer.from("local-build"));
    await assert.rejects(
        checkVersion("verify", file, async (url) => url === versionUrl ? published(Buffer.from("local-build")) : response(200, null, Buffer.from("other-build")), { waitMs: 0 }),
        /differs from the validated build/
    );
});

test("verification fails only after the review wait stays unpublished", async () => {
    let lookups = 0;
    await assert.rejects(
        checkVersion("verify", "", async () => { lookups++; return response(404, {}); }, { waitMs: 0 }),
        /HTTP 404/
    );
    assert.equal(lookups, 1);
});
