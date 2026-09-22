import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(web, "node_modules/.cache/canvas-clipboard-test.mjs");
await mkdir(dirname(output), { recursive: true });
await build({
    entryPoints: [resolve(web, "src/lib/canvas/canvas-clipboard.ts")],
    outfile: output, bundle: true, platform: "node", format: "esm",
});
const { copyIncomingConnections, pasteIncomingConnections } = await import(pathToFileURL(output).href);
const edges = [
    { id: "ab", fromNodeId: "a", toNodeId: "b", fromHandle: "image" },
    { id: "xb", fromNodeId: "x", toNodeId: "b" },
    { id: "bc", fromNodeId: "b", toNodeId: "c" },
];
const original = structuredClone(edges);
const existing = new Set(["a", "x", "b", "c"]);
let sequence = 0;
const createId = () => `paste-${++sequence}`;
const clipboard = copyIncomingConnections(edges, new Set(["b"]));
assert.deepEqual(clipboard.map(edge => edge.id), ["ab", "xb"]);
assert.notEqual(clipboard[0], edges[0]);
const pasted = pasteIncomingConnections(clipboard, new Map([["b", "b-copy"]]), existing, createId);
assert.deepEqual(pasted.map(edge => [edge.fromNodeId, edge.toNodeId]), [["a", "b-copy"], ["x", "b-copy"]]);
assert.equal(pasted[0].fromHandle, "image");
const again = pasteIncomingConnections(clipboard, new Map([["b", "b-copy2"]]), existing, createId);
assert.equal(new Set([...pasted, ...again].map(edge => edge.id)).size, 4);
const multi = copyIncomingConnections(edges, new Set(["a", "b"]));
assert.deepEqual(
    pasteIncomingConnections(multi, new Map([["a", "a-copy"], ["b", "b-copy"]]), existing, createId)
        .map(edge => [edge.fromNodeId, edge.toNodeId]),
    [["a-copy", "b-copy"], ["x", "b-copy"]],
);
assert.deepEqual(
    pasteIncomingConnections(clipboard, new Map([["b", "b-copy"]]), new Set(["x", "b"]), createId)
        .map(edge => edge.fromNodeId),
    ["x"],
);
assert.equal(pasteIncomingConnections(clipboard, new Map(), existing, createId).length, 0);
assert.deepEqual(copyIncomingConnections(edges, new Set(["a"])), []);
assert.deepEqual(edges, original);
console.log("Canvas clipboard tests passed: original upstream, multiple inputs, internal remapping, outgoing exclusion, deleted upstream, unique IDs, preserved metadata and unchanged originals.");
