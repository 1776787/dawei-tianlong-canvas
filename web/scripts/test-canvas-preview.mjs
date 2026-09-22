import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(web, "node_modules/.cache/canvas-preview-test.mjs");
await mkdir(dirname(output), { recursive: true });
await build({
    entryPoints: [resolve(web, "src/services/canvas-image-preview.ts")],
    outfile: output, bundle: true, platform: "node", format: "esm",
    alias: { "@": resolve(web, "src") },
});

const requests = [];
const revoked = [];
let active = 0;
let peak = 0;
let sequence = 0;
globalThis.window = { location: new URL("http://localhost:3000/") };
globalThis.Worker = class {
    postMessage({ url }) {
        requests.push(url);
        active++;
        peak = Math.max(peak, active);
        setTimeout(() => {
            active--;
            this.onmessage?.({ data: url.includes("original")
                ? { original: true }
                : { blob: new Blob(["preview"]), width: 1024, height: 1024 } });
        }, 1);
    }
    terminate() {}
};
URL.createObjectURL = () => `blob:preview-${sequence++}`;
URL.revokeObjectURL = (url) => revoked.push(url);
const { acquireCanvasImagePreview: acquire } = await import(pathToFileURL(output).href);
const a = acquire("blob:shared");
const b = acquire("blob:shared");
assert.equal(await a.promise, await b.promise);
assert.equal(requests.length, 1, "Canvas and sidebar share one decode");
a.release();
a.release();
assert.equal(revoked.length, 0, "A duplicate release cannot invalidate another consumer");
b.release();
const cached = acquire("blob:shared");
await cached.promise;
assert.equal(requests.length, 1, "Remounts reuse the thumbnail");
cached.release();

const leases = Array.from({ length: 12 }, (_, index) => acquire(`blob:image-${index}`));
const abandoned = acquire("blob:abandoned");
abandoned.release();
await Promise.all(leases.map((lease) => lease.promise));
await abandoned.promise;
assert.equal(peak, 1, "Full-resolution images must decode serially");
assert.ok(!requests.some((url) => url.includes("abandoned")), "Skip unmounted queued images");
assert.ok(revoked.length <= 1, "Never evict previews still displayed");
leases.forEach((lease) => lease.release());
assert.ok(revoked.length >= 5, "Evict unused decoded pixels above 32 MiB");
const original = acquire("blob:original");
assert.equal(await original.promise, "blob:original");
original.release();
assert.ok(!revoked.includes("blob:original"), "Original media URLs are never revoked");
console.log("Canvas preview tests passed: shared decode, cache reuse, serial queue, cancellation, bounded idle cache, active leases and original-media fallback.");
