import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(web, "node_modules/.cache/canvas-viewport-test.mjs");
await mkdir(dirname(output), { recursive: true });
await build({
    entryPoints: [resolve(web, "src/components/canvas/canvas-viewport.tsx")],
    outfile: output, bundle: true, platform: "node", format: "esm", packages: "external",
    alias: { "@": resolve(web, "src") },
});
const { createCanvasViewport } = await import(pathToFileURL(output).href);
const a = createCanvasViewport({ x: 0, y: 0, k: 1 });
const b = createCanvasViewport({ x: 40, y: 60, k: 2 });
let notifications = 0;
const off = a.store.subscribe((next) => {
    notifications++;
    assert.equal(a.ref.current, next, "Pointer geometry must see the new viewport before subscribers render");
});
for (let index = 0; index < 100; index++) a.setViewport((prev) => ({ ...prev, x: prev.x + 1 }));
assert.equal(a.ref.current.x, 100, "Functional updates must not use stale React state");
assert.equal(notifications, 100);
a.setViewport({ ...a.ref.current });
assert.equal(notifications, 100, "Identical transforms must not notify");
assert.deepEqual(b.store.getState(), { x: 40, y: 60, k: 2 }, "Projects must not share viewport state");
a.setViewport({ x: -200, y: 300, k: 0.25 });
assert.equal(a.store.getState().k, 0.25);
off();
a.setViewport({ x: 0, y: 0, k: 1 });
assert.equal(notifications, 101, "Persistence subscription must detach");
console.log("Canvas viewport tests passed: synchronous geometry, 100 functional updates, no-op suppression, project isolation, external reset and subscription cleanup.");
