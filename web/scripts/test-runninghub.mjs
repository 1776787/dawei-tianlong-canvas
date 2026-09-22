import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import axios from "axios";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(web, "node_modules/.cache/runninghub-test.mjs");
await mkdir(dirname(output), { recursive: true });
await build({ stdin: { contents: 'export * from "./src/services/api/runninghub.ts"; export * from "./src/lib/runninghub-graph.ts"; export * from "./src/lib/runninghub-bindings.ts"; export * from "./src/lib/runninghub-reference-ports.ts";', resolveDir: web }, outfile: output, bundle: true, platform: "node", format: "esm", packages: "external", alias: { "@": resolve(web, "src") }, define: { "import.meta.env.DEV": "false" } });
const api = await import(pathToFileURL(output).href);
const raw = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "test.safetensors" }, _meta: { title: "Model" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "Original prompt" } },
    "3": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["2", 0], seed: 42, steps: 20, enabled: true, settings: { mode: "test" } } },
    "4": { class_type: "SaveImage", inputs: { images: ["3", 0], filename_prefix: "fixture" } },
};
const detail = api.runningHubWorkflowDetailFromRaw("fixture", JSON.stringify(raw));
assert.equal(detail.nodes.length, 4);
assert.equal(api.runningHubGraphLinks(detail.nodes).links.length, 4);
assert.deepEqual(api.runningHubGraphLinks(detail.nodes).links.map((link) => [link.source, link.slot, link.target, link.field]), [["1", 1, "2", "clip"], ["1", 0, "3", "model"], ["2", 0, "3", "positive"], ["3", 0, "4", "images"]]);
assert.equal(detail.inputs.some((input) => input.fieldName === "model"), false);
for (const invalid of ["null", "[]", '"string"', "42", "{"]) assert.throws(() => api.parseRunningHubWorkflowJson(invalid));
assert.equal(api.isRunningHubLink(["1", 0, "extra"]), false);
assert.equal(api.isRunningHubLink(["1", -1]), false);
assert.equal(api.isRunningHubLink(["1", 0.5]), false);
assert.throws(() => api.runningHubWorkflowDetailFromRaw("fixture", { nodes: [], version: 0.4 }));
const edits = detail.inputs.map((input) => input.fieldName === "text" ? { ...input, fieldValue: "Updated prompt" } : input.fieldName === "steps" ? { ...input, fieldValue: "32" } : input.fieldName === "enabled" ? { ...input, fieldValue: false } : input.fieldName === "settings" ? { ...input, fieldValue: '{"mode":"changed"}' } : input);
const next = api.runningHubRawWithInputs(raw, edits);
assert.equal(raw["2"].inputs.text, "Original prompt");
assert.equal(next["2"].inputs.text, "Updated prompt");
assert.equal(next["3"].inputs.steps, 32);
assert.equal(next["3"].inputs.enabled, false);
assert.deepEqual(next["3"].inputs.settings, { mode: "changed" });
assert.deepEqual(next["3"].inputs.positive, ["2", 0]);
assert.equal(api.sameRunningHubStructure(raw, next), true);
for (const mutate of [value => { delete value["1"]; }, value => { value["3"].class_type = "Other"; }, value => { value["3"].inputs.positive = ["1", 0]; }, value => { value["3"].inputs.extra = 1; }]) { const invalid = structuredClone(raw); mutate(invalid); assert.equal(api.sameRunningHubStructure(raw, invalid), false); }
const seed = detail.inputs.find((input) => input.fieldName === "seed");
assert.equal(api.valueForRunningHubInput({ ...seed, fieldValue: "9007199254740993" }), "9007199254740993");
assert.throws(() => api.valueForRunningHubInput({ ...seed, fieldValue: "" }));
assert.throws(() => api.valueForRunningHubInput({ ...seed, fieldValue: "NaN" }));
const json = detail.inputs.find((input) => input.fieldName === "settings");
assert.throws(() => api.valueForRunningHubInput({ ...json, fieldValue: "{" }));
assert.deepEqual(api.runningHubRawWithInputs(raw, [{ ...json, fieldValue: "{" }])["3"].inputs.settings, raw["3"].inputs.settings);
const positions = api.layoutRunningHubNodes(detail.nodes);
assert.equal(Object.keys(positions).length, 4);
assert.deepEqual(positions, api.layoutRunningHubNodes(detail.nodes));
const graph = api.runningHubGraphLinks(detail.nodes);
for (const a of detail.nodes) for (const b of detail.nodes) {
    if (a === b) continue;
    const p = positions[a.nodeId], q = positions[b.nodeId];
    assert.ok(p.x + api.RH_NODE_WIDTH <= q.x || q.x + api.RH_NODE_WIDTH <= p.x || p.y + api.runningHubNodeHeight(a, graph.links) <= q.y || q.y + api.runningHubNodeHeight(b, graph.links) <= p.y, "layout nodes overlap");
}
assert.deepEqual(api.layoutRunningHubNodes([]), {});
const bindingNodes = [
    { id: "text", type: "text", title: "提示词来源", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "prompt value" } },
    { id: "img-a", type: "image", title: "人物图", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "image-a" } },
    { id: "img-b", type: "image", title: "场景图", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "image-b" } },
    { id: "vid", type: "video", title: "参考视频", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "video-a" } },
];
const bindingConnections = [
    { id: "c1", fromNodeId: "img-b", toNodeId: "rh" },
    { id: "c2", fromNodeId: "text", toNodeId: "rh" },
    { id: "c3", fromNodeId: "img-a", toNodeId: "rh" },
    { id: "c4", fromNodeId: "vid", toNodeId: "rh" },
];
const bindings = api.buildRunningHubBindings("rh", bindingNodes, bindingConnections);
assert.deepEqual(bindings.map((binding) => binding.label), ["参考图一", "提示词", "参考图二", "参考视频一"]);
const reorderedBindings = api.buildRunningHubBindings("rh", bindingNodes, bindingConnections, ["text", "img-a", "img-b", "vid"]);
assert.deepEqual(reorderedBindings.map((binding) => binding.label), ["提示词", "参考图一", "参考图二", "参考视频一"]);
const bindingInputs = [
    { nodeId: "prompt", nodeTitle: "Prompt", fieldName: "text", fieldValue: "", valueType: "string" },
    { nodeId: "refs", nodeTitle: "Refs", fieldName: "image", fieldValue: "", valueType: "string" },
    { nodeId: "refs", nodeTitle: "Refs", fieldName: "image_2", fieldValue: "", valueType: "string" },
    { nodeId: "refs", nodeTitle: "Refs", fieldName: "video", fieldValue: "", valueType: "string" },
];
const appliedBindings = api.applyRunningHubBindings(bindingInputs, reorderedBindings);
assert.deepEqual(appliedBindings.inputs.map((input) => input.fieldValue), ["prompt value", "image-a", "image-b", "video-a"]);
const referenceGraph = api.runningHubWorkflowDetailFromRaw("ports", {
    "19": { class_type: "LoadImage", inputs: { image: "fifth.png" } },
    "42": { class_type: "LoadImage", inputs: { image: "first.png" } },
    "43": { class_type: "ImageScale", inputs: { image: ["42", 0], width: 1024 } },
    "265": { class_type: "MiniMaxH3ReferenceToVideo", inputs: { "ref_images.ref_image_4": ["19", 0], "ref_images.ref_image_0": ["43", 0] } },
});
const numberedSlots = api.runningHubMediaSlots(referenceGraph.inputs, referenceGraph.nodes);
const switched = api.runningHubWorkflowWithReferencePorts(referenceGraph.raw, ["image:4"]);
assert.equal(switched["265"].inputs["ref_images.ref_image_4"], undefined);
assert.equal(switched["19"], undefined);
assert.ok(switched["42"] && switched["43"]);
assert.deepEqual(referenceGraph.raw["265"].inputs["ref_images.ref_image_4"], ["19", 0]);
assert.deepEqual(api.runningHubWorkflowWithReferencePorts(referenceGraph.raw, []), referenceGraph.raw);
const sharedBranch = { ...referenceGraph.raw, "900": { class_type: "PreviewImage", inputs: { images: ["19", 0] } } };
assert.ok(api.runningHubWorkflowWithReferencePorts(sharedBranch, ["image:4"])["19"]);
assert.deepEqual(numberedSlots.map(slot => [slot.input.nodeId, slot.ordinal, slot.label]), [["42", 0, "参考图一"], ["19", 4, "参考图五"]]);
const numberedMatches = api.matchRunningHubBindings(referenceGraph.inputs, bindings.filter(binding => binding.kind === "image"), referenceGraph.nodes);
assert.equal(referenceGraph.inputs[numberedMatches[0].inputIndex].nodeId, "42");
assert.equal(numberedMatches[1].inputIndex, -1, "Missing second reference must not consume the fifth slot");
const sharedGraph = api.runningHubWorkflowDetailFromRaw("ambiguous", {
    ...referenceGraph.raw,
    "266": { class_type: "Consumer", inputs: { "ref_images.ref_image_1": ["42", 0] } },
});
assert.equal(api.runningHubMediaSlots(sharedGraph.inputs, sharedGraph.nodes).find(slot => slot.input.nodeId === "42").ordinal, -1);
const switchInputs = [...bindingInputs,
    { nodeId: "switches", nodeTitle: "References", fieldName: "参考图1", fieldValue: false, valueType: "boolean" },
    { nodeId: "switches", nodeTitle: "References", fieldName: "参考图2", fieldValue: true, valueType: "boolean" },
    { nodeId: "switches", nodeTitle: "References", fieldName: "参考视频1", fieldValue: false, valueType: "boolean" },
];
assert.equal(api.runningHubReferenceSwitch(switchInputs, 1, "参考图一"), 4);
assert.equal(api.runningHubReferenceSwitch(switchInputs, 2, "参考图二"), 5);
assert.equal(api.runningHubReferenceSwitch(switchInputs, 3, "参考视频一"), 6);
const uploadedReferences = [];
const prepared = await api.prepareRunningHubInputs(switchInputs, reorderedBindings, [], {}, async binding => { uploadedReferences.push(binding.sourceNodeId); return `uploaded:${binding.value}`; });
assert.deepEqual(uploadedReferences, ["img-b"]);
assert.equal(prepared[1].fieldValue, "");
assert.equal(prepared[2].fieldValue, "uploaded:image-b");
assert.equal(prepared[4].fieldValue, false);
assert.equal(api.toRunningHubNodeInfoList(prepared)[4].fieldValue, false);
const restoredSwitches = JSON.parse(JSON.stringify(switchInputs));
assert.equal(api.runningHubReferenceEnabled(restoredSwitches, 1, "参考图一"), false);
const mapping = { [api.runningHubInputKey(switchInputs[1])]: api.runningHubInputKey(switchInputs[5]) };
assert.equal(api.runningHubReferenceSwitch(switchInputs, 1, "参考图一", mapping), 5);
assert.equal(api.runningHubReferenceSwitch(bindingInputs, 1, "参考图一"), -1);
const ambiguousSwitches = [...switchInputs, { ...switchInputs[4], nodeId: "duplicate" }];
assert.equal(api.runningHubReferenceSwitch(ambiguousSwitches, 1, "参考图一"), -1);
const unusual = api.runningHubWorkflowDetailFromRaw("fixture", { ...raw, "5": { class_type: "Missing", inputs: { image: ["99", 0] } }, "6": { class_type: "Cycle", inputs: { a: ["7", 0] } }, "7": { class_type: "Cycle", inputs: { a: ["6", 0] } } });
assert.equal(api.runningHubGraphLinks(unusual.nodes).missing.length, 1);
assert.equal(Object.keys(api.layoutRunningHubNodes(unusual.nodes)).length, 7);
const calls = [];
axios.defaults.adapter = async config => {
    calls.push(config);
    const path = new URL(config.url).pathname;
    if (path === "/api/openapi/getJsonApiFormat") return { data: { code: "0", data: { prompt: JSON.stringify(raw) } }, status: 200, statusText: "OK", headers: {}, config };
    if (path === "/task/openapi/create") return { data: { code: 0, data: { taskId: "mock-task" } }, status: 200, statusText: "OK", headers: {}, config };
    if (path === "/openapi/v2/query") return { data: { status: "SUCCESS", results: [] }, status: 200, statusText: "OK", headers: {}, config };
    throw new Error(`Unexpected request: ${path}`);
};
const fetched = await api.fetchRunningHubWorkflow({ workflowId: "fixture", apiKey: "test-placeholder" });
assert.equal(fetched.nodes.length, 4);
await api.runRunningHubWorkflow({ workflowId: "fixture", apiKey: "test-placeholder", inputs: edits, intervalMs: 0 });
const payload = JSON.parse(calls.find(call => call.url.endsWith("/create")).data);
assert.deepEqual(payload.nodeInfoList, api.toRunningHubNodeInfoList(edits));
assert.equal(payload.rhLayout, undefined);
for (const mode of ["standard", "plus", "ultra"]) {
    await api.runRunningHubWorkflow({ workflowId: "fixture", apiKey: "test-placeholder", inputs: [], instanceType: mode, intervalMs: 0 });
    const modePayload = JSON.parse(calls.filter(call => call.url.endsWith("/create")).at(-1).data);
    assert.equal(modePayload.instanceType, mode === "standard" ? undefined : mode);
}
await api.runRunningHubWorkflow({ workflowId: "fixture", apiKey: "test-placeholder", workflow: switched, inputs: [], intervalMs: 0 });
assert.deepEqual(JSON.parse(JSON.parse(calls.filter(call => call.url.endsWith("/create")).at(-1).data).workflow), switched);
const durationDetail = api.runningHubWorkflowDetailFromRaw("2096240120595828738", {
    "259": { class_type: "PrimitiveFloat", inputs: { value: 10 }, _meta: { title: "视频时长（秒）" } },
    "265": { class_type: "VideoGenerator", inputs: { duration: ["259", 0] } },
});
const durationEdits = durationDetail.inputs.map(input => ({ ...input, fieldValue: 12.5 }));
const durationRaw = api.runningHubRawWithInputs(durationDetail.raw, durationEdits);
assert.equal(durationRaw["259"].inputs.value, 12.5);
assert.deepEqual(durationRaw["265"].inputs.duration, ["259", 0]);
assert.equal(durationDetail.raw["259"].inputs.value, 10);
assert.equal(api.sameRunningHubStructure(durationDetail.raw, durationRaw), true);
for (const workflow of [undefined, durationRaw]) {
    await api.runRunningHubWorkflow({ workflowId: durationDetail.workflowId, apiKey: "test-placeholder", inputs: durationEdits, workflow, intervalMs: 0 });
    const durationPayload = JSON.parse(calls.filter(call => call.url.endsWith("/create")).at(-1).data);
    assert.equal(durationPayload.workflowId, "2096240120595828738");
    assert.deepEqual(durationPayload.nodeInfoList, [{ nodeId: "259", fieldName: "value", fieldValue: 12.5 }]);
    if (workflow) assert.equal(JSON.parse(durationPayload.workflow)["259"].inputs.value, 12.5);
}
assert.equal(payload.nodeInfoList.find(input => input.fieldName === "steps").fieldValue, 32);
assert.deepEqual(JSON.parse(calls.find(call => call.url.endsWith("/query")).data), { taskId: "mock-task" });
const reply = (config, data) => ({ data, status: 200, statusText: "OK", headers: {}, config });
let attempts = 0;
axios.defaults.adapter = async config => {
    assert.ok(config.url.endsWith('/query'), 'Retries must never create a task');
    assert.equal(config.timeout, 30000);
    if (++attempts === 1) throw new axios.AxiosError('temporary network failure', 'ERR_NETWORK', config);
    return reply(config, attempts < 4 ? { status: 'RUNNING' } : { code: '0', data: { status: 'SUCCESS', results: [{ fileUrl: 'https://example.invalid/result.mp4', fileType: 'video' }] } });
};
const recovered = await api.pollRunningHubTask({ taskId: 'existing', apiKey: 'test-placeholder', intervalMs: 0 });
assert.equal(attempts, 4);
assert.equal(recovered.results[0].outputType, 'video');
assert.equal(recovered.results[0].url, 'https://example.invalid/result.mp4');
axios.defaults.adapter = async config => reply(config, { status: 'FAILED', errorMessage: 'remote failure' });
await assert.rejects(api.pollRunningHubTask({ taskId: 'existing', apiKey: 'test-placeholder' }), api.RunningHubTaskFailedError);
axios.defaults.adapter = async config => reply(config, { status: 'RUNNING' });
await assert.rejects(api.pollRunningHubTask({ taskId: 'existing', apiKey: 'test-placeholder', timeoutMs: 0 }), api.RunningHubQueryPendingError);
const stop = new AbortController();
axios.defaults.adapter = async config => { stop.abort(); return reply(config, { status: 'RUNNING' }); };
await assert.rejects(api.pollRunningHubTask({ taskId: 'existing', apiKey: 'test-placeholder', signal: stop.signal }), error => error.name === 'AbortError');
const realNow = Date.now;
let clock = 0;
attempts = 0;
try {
    Date.now = () => (clock += 3600000);
    axios.defaults.adapter = async config => reply(config, ++attempts < 3 ? { status: 'RUNNING' } : { status: 'SUCCESS', results: [] });
    await api.pollRunningHubTask({ taskId: 'existing', apiKey: 'test-placeholder', intervalMs: 0 });
    assert.equal(attempts, 3, 'Default polling must survive hours of elapsed time');
} finally { Date.now = realNow; }
console.log("PASS: graph ports, layout, cycles, missing nodes, input types, JSON sync, structure guard, large seeds and mocked API submission. No network requests were sent.");
