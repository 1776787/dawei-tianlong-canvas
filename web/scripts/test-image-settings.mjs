import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import axios from "axios";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(web, "node_modules/.cache/image-settings-test.mjs");
await mkdir(dirname(output), { recursive: true });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
await build({
    stdin: {
        contents: [
            'export * from "./src/lib/image-dimensions.ts";',
            'export * from "./src/components/image-settings-panel.tsx";',
            'export * from "./src/services/api/image.ts";',
            'export { getPluginTemplates } from "./src/services/api/model-plugin.ts";',
            'export { buildGenerationConfig } from "./src/lib/canvas/canvas-generation-helpers.ts";',
            'export { applyNodeConfigPatch, buildImageGenerationMetadata } from "./src/lib/canvas/canvas-node-factory.ts";',
            'export { defaultConfig } from "./src/stores/use-config-store.ts";',
        ].join("\n"),
        resolveDir: web,
    },
    outfile: output, bundle: true, platform: "node", format: "esm", packages: "external",
    alias: { "@": resolve(web, "src") }, define: { "import.meta.env.DEV": "false" },
});
const api = await import(pathToFileURL(output).href);
assert.deepEqual(api.imageAspectOptions.map(item => item.value), ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "auto"]);
assert.ok(api.imageAspectOptions.every(item => !/[24]k/i.test(item.label)));
assert.equal(api.imageAspectValue("2048x2048"), "1:1");
assert.equal(api.imageAspectValue("2048x1152"), "16:9");
assert.equal(api.imageAspectValue("3840x2160"), "16:9");
assert.equal(api.imageAspectValue("2160x3840"), "9:16");
assert.equal(api.imageAspectValue("1360x1024"), "4:3");
assert.equal(api.imageAspectValue("1232x928"), "4:3");
assert.equal(api.imageAspectValue("1808x800"), undefined);
assert.equal(api.imageSizeLabel("3840x2160"), "3840x2160");
assert.deepEqual(api.imageDimensions("3840x2160", "1k"), { width: 3840, height: 2160 });
assert.equal(api.imageDimensions("auto", "4k"), null);
assert.equal(api.imageDimensions("Infinity:1", "4k"), null);
assert.deepEqual(api.imageDimensions("16 : 9", "4k"), api.imageDimensions("16:9", "4k"));

const originalAdapter = axios.defaults.adapter;
let body;
axios.defaults.adapter = async config => {
    body = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
    return {
        data: config.url.includes("generateContent")
            ? { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "fixture" } }] } }] }
            : { data: [{ url: "https://fixture.invalid/image.png" }] },
        status: 200, statusText: "OK", headers: {}, config,
    };
};
const config = {
    ...api.defaultConfig, channels: [], baseUrl: "https://fixture.invalid", apiKey: "fixture",
    model: "gpt-image-test", imageModel: "gpt-image-test", count: "1",
};
try {
    await api.requestGeneration({ ...config, resolution: "4k", quality: "high", size: "auto" }, "fixture");
    assert.equal(body.size, "3840x2160", "Auto aspect must not drop the explicit 4K output size");
    assert.equal(body.quality, "high");
    for (const resolution of ["auto", "1k", "2k", "4k"]) {
        for (const size of api.imageAspectOptions.map(item => item.value)) {
            // Pixel dimensions depend on resolution, not generation quality.
            const request = { ...config, resolution, quality: "low", size };
            const before = structuredClone(request);
            await api.requestGeneration(request, "fixture");
            const preview = api.imageDimensions(size, request.resolution);
            const autoSize = { "1k": "1024x1024", "2k": "2048x2048", "4k": "3840x2160" }[resolution];
            assert.equal(body.size, preview ? `${preview.width}x${preview.height}` : autoSize);
            assert.deepEqual(request, before);
        }
    }
    await api.requestGeneration({ ...config, resolution: "4k", quality: "low", size: "16:9" }, "fixture");
    assert.equal(body.size, "3840x2160");
    await api.requestGeneration({ ...config, resolution: "4k", size: "9:16" }, "fixture");
    assert.equal(body.size, "2160x3840");
    await api.requestGeneration({ ...config, resolution: "4k", size: "2048x1152" }, "fixture");
    assert.equal(body.size, "2048x1152"); // Existing explicit pixel sizes remain exact.
    for (const size of ["16:9", "9:16", "auto"]) {
        await api.requestGeneration({ ...config, apiFormat: "gemini", model: "gemini-3-pro-image", resolution: "4k", quality: "low", size }, "fixture");
        assert.equal(body.generationConfig.responseFormat.image.imageSize, "4K");
        assert.equal(body.generationConfig.responseFormat.image.aspectRatio, size === "auto" ? undefined : size);
    }
    const nodeConfig = api.buildGenerationConfig({
        ...config, apiFormat: "gemini", resolution: "2k", quality: "medium",
        model: "pixel::gpt-image-2",
        channels: [{ id: "pixel", name: "Fixture", baseUrl: "https://fixture.invalid", apiKey: "fixture", apiFormat: "openai", models: [{ name: "gpt-image-2", capability: "image" }] }],
    }, {
        id: "image-node", type: "image", title: "Fixture", position: { x: 0, y: 0 },
        metadata: { model: "pixel::gpt-image-2", resolution: "4k", quality: "high", size: "auto", count: 1 },
    }, "image");
    await api.requestGeneration(nodeConfig, "fixture");
    assert.equal(body.model, "gpt-image-2");
    assert.equal(body.quality, "high");
    assert.equal(body.size, "3840x2160", "Node 4K overrides global 2K and uses the selected channel's format");

    const references = [{ id: "ref", name: "fixture.png", type: "image/png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }];
    await api.requestEdit(nodeConfig, "fixture", references);
    assert.ok(body instanceof FormData);
    assert.equal(body.get("size"), "3840x2160", "Image edit must preserve explicit 4K");
    assert.equal(body.get("quality"), "high");
    assert.equal(body.getAll("image").length, 1);
    assert.equal(body.get("response_format"), null, "GPT Image edit must retain its native parameter contract");
    const nodeFixture = {
        id: "independent-settings", type: "image", title: "Fixture",
        position: { x: 0, y: 0 }, width: 320, height: 180,
        metadata: { size: "16:9", quality: "low", resolution: "4k", count: 1 },
    };
    const dimensionsByResolution = {};
    for (const resolution of ["auto", "1k", "2k", "4k"]) {
        for (const quality of ["auto", "low", "medium", "high"]) {
            const node = api.applyNodeConfigPatch(nodeFixture, { quality, resolution });
            const request = api.buildGenerationConfig({ ...config, quality: "high", resolution: "2k" }, node, "image");
            assert.equal(request.quality, quality, "Node quality, including Auto, must override global quality");
            assert.equal(request.resolution, resolution, "Resolution must remain independent of quality");
            await api.requestGeneration(request, "fixture");
            assert.equal(body.quality, quality === "auto" ? undefined : quality);
            dimensionsByResolution[resolution] ??= body.size;
            assert.equal(body.size, dimensionsByResolution[resolution], "Changing quality must never resize the image");
            await api.requestEdit(request, "fixture", references);
            assert.equal(body.get("quality"), quality === "auto" ? null : quality);
            assert.equal(body.get("size"), dimensionsByResolution[resolution]);
            const metadata = api.buildImageGenerationMetadata("generation", request, 1, []);
            const restored = api.buildGenerationConfig(config, { ...node, metadata }, "image");
            assert.equal(restored.quality, quality, "Generated nodes must retain quality for subsequent edits");
            assert.equal(restored.resolution, resolution);
            await api.requestGeneration({ ...request, apiFormat: "gemini", model: "gemini-3-pro-image" }, "fixture");
            assert.equal(body.generationConfig.responseFormat.image.imageSize, resolution === "auto" ? undefined : resolution.toUpperCase());
        }
    }
    assert.equal(dimensionsByResolution["4k"], "3840x2160");
    assert.equal(dimensionsByResolution["1k"], "1360x768");
    assert.equal(api.buildGenerationConfig({ ...config, quality: "medium" }, {
        ...nodeFixture, metadata: { resolution: "4k" },
    }, "image").quality, "medium", "Unset node quality inherits the global setting independently");
    const qualityPatch = api.applyNodeConfigPatch(nodeFixture, { quality: "high" });
    assert.equal(qualityPatch.metadata.resolution, "4k");
    assert.equal(api.applyNodeConfigPatch(qualityPatch, { resolution: "1k" }).metadata.quality, "high");
    for (const quality of ["auto", "low", "medium", "high"]) {
        await api.requestGeneration({ ...config, resolution: "auto", quality, size: "2048x1152" }, "fixture");
        assert.equal(body.size, "2048x1152");
        await api.requestGeneration({ ...config, apiFormat: "gemini", model: "gemini-3-pro-image", resolution: "auto", quality, size: "auto" }, "fixture");
        assert.equal(body.generationConfig.responseFormat?.image?.imageSize, undefined);
    }
    await api.requestEdit({ ...config, apiFormat: "gemini", model: "gemini-3-pro-image", resolution: "4k", quality: "high", size: "auto" }, "fixture", references);
    assert.equal(body.generationConfig.responseFormat.image.imageSize, "4K");
    assert.equal(body.generationConfig.responseFormat.image.aspectRatio, undefined, "Native Gemini edit must retain automatic aspect");

    const templates = api.getPluginTemplates().image;
    const scripted = (model, script, apiFormat = "openai") => ({
        ...config, resolution: "4k", quality: "high", size: "auto", model: `script::${model}`,
        channels: [{ id: "script", name: "Fixture", baseUrl: "https://fixture.invalid", apiKey: "fixture", apiFormat, models: [{ name: model, capability: "image", script }] }],
    });
    const openAiScript = scripted("gpt-image-2", templates[0].script);
    await api.requestGeneration(openAiScript, "fixture");
    assert.equal(body.size, "3840x2160");
    assert.equal(body.quality, "high");
    assert.equal(body.output_format, "png");
    assert.equal(body.response_format, undefined);
    await api.requestEdit(openAiScript, "fixture", references);
    assert.equal(body.get("size"), "3840x2160", "Built-in script edit must forward size");
    assert.equal(body.get("quality"), "high", "Built-in script edit must forward quality");
    for (const [resolution, quality, size] of [["4k", "low", "3840x2160"], ["1k", "high", "1024x1024"]]) {
        const request = { ...openAiScript, resolution, quality };
        await api.requestGeneration(request, "fixture");
        assert.equal(body.quality, quality);
        assert.equal(body.size, size);
        await api.requestEdit(request, "fixture", references);
        assert.equal(body.get("quality"), quality);
        assert.equal(body.get("size"), size);
    }
    const geminiScript = scripted("gemini-3-pro-image", templates[1].script, "gemini");
    for (const run of [
        () => api.requestGeneration(geminiScript, "fixture"),
        () => api.requestEdit(geminiScript, "fixture", references),
    ]) {
        await run();
        assert.equal(body.generationConfig.responseFormat.image.imageSize, "4K");
        assert.equal(body.generationConfig.responseFormat.image.aspectRatio, undefined);
    }
    const echoScript = scripted("custom-image", 'await request({ method: "post", url: "/echo", data: params }); return ["https://fixture.invalid/image.png"];');
    await api.requestGeneration(echoScript, "fixture");
    assert.equal(body.ratio, "auto");
    assert.equal(body.resolution, "4k", "Custom scripts must receive the independent resolution tier");
    assert.equal(body.size, "3840x2160");
    await api.requestGeneration({ ...echoScript, quality: "low" }, "fixture");
    assert.equal(body.resolution, "4k");
    assert.equal(body.quality, "low");
    assert.equal(body.size, "3840x2160");
    await api.requestGeneration({ ...config, resolution: "auto", quality: "high", size: "auto" }, "fixture");
    assert.equal(body.size, undefined, "Fully automatic resolution retains provider defaults");
} finally {
    axios.defaults.adapter = originalAdapter;
}
console.log("Image settings tests passed: all 16 quality/resolution combinations, independent Auto and global inheritance, node metadata round-trips, JSON generation, multipart editing, built-in/custom scripts, Gemini sizing, explicit pixels and matching previews. All requests mocked.");
