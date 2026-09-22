import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(web, "node_modules/.cache/image-receive-test.mjs");
await mkdir(dirname(output), { recursive: true });
const records = new Map();
const removed = [];
const store = {
    async setItem(key, value) { records.set(key, value); return value; },
    async getItem(key) { return records.get(key); },
    async removeItem(key) { removed.push(key); records.delete(key); },
};
globalThis.fixtureImageStore = store;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.Image = class {
    naturalWidth = 1024;
    naturalHeight = 768;
    set src(value) { queueMicrotask(() => this.onload?.()); }
};
await build({
    stdin: {
        contents: [
            'export { uploadImage } from "./src/services/image-storage.ts";',
            'export * from "./src/lib/canvas/canvas-image-results.ts";',
            'export { resetInterruptedGeneration } from "./src/lib/canvas/canvas-generation-helpers.ts";',
        ].join("\n"), resolveDir: web,
    },
    outfile: output, bundle: true, platform: "node", format: "esm", packages: "external",
    alias: { "@": resolve(web, "src") },
    plugins: [{
        name: "memory-image-store",
        setup(builder) {
            builder.onResolve({ filter: /^localforage$/ }, () => ({ path: "store", namespace: "fixture" }));
            builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
                contents: "export default { createInstance: () => globalThis.fixtureImageStore };",
            }));
        },
    }],
});
const api = await import(pathToFileURL(output).href);
const originalFetch = globalThis.fetch;
const originalSetItem = store.setItem;
const url = "https://fixture.invalid/generated.png";
const blob = new Blob(["fixture image bytes"], { type: "image/png" });
let downloadCalls = 0;
try {
    globalThis.fetch = async () => { downloadCalls++; return new Response(blob); };
    const uploaded = await api.uploadImage(url);
    assert.equal(uploaded.width, 1024);
    assert.equal(uploaded.height, 768);
    assert.ok(records.has(uploaded.storageKey));
    assert.equal(records.get(uploaded.storageKey).size, blob.size);

    for (const [response, pattern] of [
        [new Response("denied", { status: 403 }), /403/],
        [new Response("<html>error</html>", { headers: { "Content-Type": "text/html" } }), /\u9519\u8bef\u9875\u9762/],
        [new Response("{}", { headers: { "Content-Type": "application/json" } }), /\u9519\u8bef\u9875\u9762/],
        [new Response(""), /\u7a7a\u5185\u5bb9/],
    ]) {
        const before = records.size;
        globalThis.fetch = async () => response;
        await assert.rejects(api.uploadImage(url), pattern);
        assert.equal(records.size, before, "Invalid downloads must never be saved as images");
    }

    globalThis.fetch = () => new Promise(() => {});
    await assert.rejects(api.uploadImage(url, { timeoutMs: 20 }), /60/);
    globalThis.fetch = async () => ({ ok: true, blob: () => new Promise(() => {}) });
    await assert.rejects(api.uploadImage(url, { timeoutMs: 20 }), /60/);
    let releaseWrite;
    let lateKey;
    globalThis.fetch = async () => new Response(blob);
    store.setItem = (key, value) => {
        lateKey = key;
        return new Promise(resolveWrite => {
            releaseWrite = () => { records.set(key, value); resolveWrite(value); };
        });
    };
    await assert.rejects(api.uploadImage(url, { timeoutMs: 20 }), /60/);
    releaseWrite();
    await new Promise(resolveTick => setImmediate(resolveTick));
    assert.ok(removed.includes(lateKey));
    assert.equal(records.has(lateKey), false, "A timed-out write must not leak a stored image");
    store.setItem = originalSetItem;
    const controller = new AbortController();
    globalThis.fetch = () => new Promise(() => {});
    const pending = api.uploadImage(url, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    await assert.rejects(api.uploadImage(url, { signal: controller.signal }), { name: "AbortError" });

    const slot = id => ({ id, status: "loading", content: "", storageKey: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "" });
    const initial = {
        id: "node", type: "image", title: "Fixture", position: { x: 0, y: 0 }, width: 320, height: 240,
        metadata: { status: "loading", images: [slot("one"), slot("two")] },
    };
    const receiving = api.markImageReceiving(initial, url, "one");
    assert.equal(api.pendingImageResult(receiving, "one").url, url);
    assert.equal(api.pendingImageResult(receiving, "two"), undefined);
    assert.equal(initial.metadata.images[0].pendingImageUrl, undefined, "State updates must be immutable");
    const failure = api.markImageReceiveFailed(receiving, api.imageReceiveError(new Error("offline")), "one");
    assert.equal(failure.metadata.images[0].status, "error");
    assert.equal(api.pendingImageResult(failure).url, url);
    const restored = api.resetInterruptedGeneration([JSON.parse(JSON.stringify(failure))])[0];
    assert.equal(restored.metadata.status, "error");
    assert.equal(restored.metadata.images[1].status, "error");
    assert.equal(api.pendingImageResult(restored).url, url, "Refresh must retain the completed API result");
    globalThis.fetch = async () => { downloadCalls++; return new Response(blob); };
    const recovered = api.completeImageReceive(restored, await api.uploadImage(api.pendingImageResult(restored).url), "one");
    assert.equal(recovered.metadata.status, "success");
    assert.equal(recovered.metadata.images[0].status, "success");
    assert.equal(recovered.metadata.images[0].pendingImageUrl, undefined);
    assert.ok(recovered.metadata.content.startsWith("blob:"));
    assert.equal(api.pendingImageResult(recovered), undefined);
    assert.equal(downloadCalls, 2, "Recovery only downloads the existing result");
    const partial = api.completeImageReceive(receiving, uploaded, "one");
    assert.equal(partial.metadata.status, "loading");
    assert.ok(partial.metadata.content, "A completed image must be available while another is pending");
    const partialRestored = api.resetInterruptedGeneration([partial])[0];
    assert.equal(partialRestored.metadata.status, "success");
    assert.equal(partialRestored.metadata.images[0].status, "success");
    assert.equal(partialRestored.metadata.images[1].status, "error");
    const single = { ...initial, metadata: { status: "loading" } };
    const singleReceiving = api.markImageReceiving(single, url);
    assert.equal(api.pendingImageResult(singleReceiving).url, url);
    assert.equal(api.completeImageReceive(singleReceiving, uploaded).metadata.pendingImageUrl, undefined);
    console.log("PASS: receive success, HTTP/HTML/empty errors, stalled headers/body/storage, abort, late-write cleanup, retained results, download-only recovery, partial success and refresh.");
} finally {
    globalThis.fetch = originalFetch;
    store.setItem = originalSetItem;
    delete globalThis.fixtureImageStore;
}
