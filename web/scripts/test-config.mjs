import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(web, "node_modules/.cache/config-test.mjs");
await mkdir(dirname(output), { recursive: true });
const legacyKey = "infinite-canvas:ai_config_store";
const legacyValue = JSON.stringify({ state: { config: {
    apiKey: "fixture-old-key", baseUrl: "https://fixture.invalid",
    channels: [{ id: "old", name: "Old", apiKey: "fixture-old-key", baseUrl: "https://fixture.invalid", models: [] }],
} }, version: 0 });
const storage = new Map([[legacyKey, legacyValue]]);
const reads = [];
globalThis.localStorage = {
    getItem(key) { reads.push(key); return storage.get(key) ?? null; },
    setItem(key, value) { storage.set(key, value); },
    removeItem(key) { storage.delete(key); },
};
globalThis.window = { localStorage: globalThis.localStorage };

try {
    await build({
        entryPoints: [resolve(web, "src/stores/use-config-store.ts")],
        outfile: output, bundle: true, platform: "node", format: "esm", packages: "external",
        alias: { "@": resolve(web, "src") }, define: { "import.meta.env.DEV": "false" },
    });
    const api = await import(pathToFileURL(output).href);
    const assertEmpty = config => {
        assert.deepEqual(config.channels, []);
        assert.deepEqual(config.models, []);
        for (const field of ["baseUrl", "apiKey", "model", "imageModel", "videoModel", "textModel", "audioModel"]) {
            assert.equal(config[field], "", `Empty config must clear ${field}`);
        }
    };
    assertEmpty(api.defaultConfig);
    assert.equal(api.defaultConfig.runningHubApiKey, "");
    assertEmpty(api.useConfigStore.getState().config);
    assert.notEqual(api.CONFIG_STORE_KEY, legacyKey);
    assert.ok(!reads.includes(legacyKey), "Do not hydrate another application's credentials");
    assert.equal(storage.get(legacyKey), legacyValue, "Leave the original application's settings untouched");
    assert.equal(api.useConfigStore.getState().isAiConfigReady(api.defaultConfig, ""), false);

    const current = api.useConfigStore.getState();
    const merge = api.useConfigStore.persist.getOptions().merge;
    assertEmpty(merge({}, current).config);
    assertEmpty(merge({ config: api.defaultConfig }, current).config);
    assertEmpty(merge({ config: { channels: [], apiKey: "fixture-stale-key", baseUrl: "https://fixture.invalid", model: "old" } }, current).config);
    const channel = api.createModelChannel({
        id: "example", name: "Example", baseUrl: "https://fixture.invalid", apiKey: "fixture-new-key",
        models: [{ name: "example-video", capability: "video", script: "return 'fixture';" }],
    });
    const configured = api.withChannels(api.defaultConfig, [channel]);
    assert.equal(configured.videoModel, "example::example-video");
    assert.equal(configured.apiKey, "fixture-new-key");
    assert.equal(api.useConfigStore.getState().isAiConfigReady(configured, configured.videoModel), true);
    assert.deepEqual(merge({ config: configured }, current).config.channels, [channel]);
    assert.deepEqual(merge(merge({ config: configured }, current), current).config.channels, [channel]);
    assert.equal(api.resolveModelScript(configured, configured.videoModel), "return 'fixture';");

    const cleared = api.withChannels(configured, []);
    assertEmpty(cleared);
    const replacement = api.createModelChannel({ id: "empty", apiKey: "" });
    assert.equal(api.withChannels(configured, [replacement]).apiKey, "");
    api.useConfigStore.setState({ config: configured });
    await api.useConfigStore.persist.rehydrate();
    assert.deepEqual(api.useConfigStore.getState().config.channels, [channel]);
    api.useConfigStore.setState({ config: cleared });
    await api.useConfigStore.persist.rehydrate();
    assertEmpty(api.useConfigStore.getState().config);
    assert.ok(!storage.get(api.CONFIG_STORE_KEY).includes("fixture-new-key"));
    assert.equal(storage.get(legacyKey), legacyValue);
    console.log("PASS: empty defaults, isolated hydration, explicit channel persistence, no automatic channels, complete last-channel removal.");
} finally {
    delete globalThis.window;
    delete globalThis.localStorage;
}
