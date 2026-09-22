import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { gzipSync } from "node:zlib";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { createServer, preview } from "vite";
import axios from "axios";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(web, "node_modules/.cache/api-proxy-test.mjs");
await mkdir(dirname(output), { recursive: true });
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
await build({
    stdin: {
        contents: [
            'export * from "./server/api-proxy.ts";',
            'export * from "./src/lib/api-proxy.ts";',
            'export { requestEdit } from "./src/services/api/image.ts";',
            'export { defaultConfig } from "./src/stores/use-config-store.ts";',
        ].join("\n"),
        resolveDir: web,
    },
    outfile: output, bundle: true, platform: "node", format: "esm", packages: "external",
    alias: { "@": resolve(web, "src") }, define: { "import.meta.env.DEV": "false" },
});
const api = await import(pathToFileURL(output).href);
const closeHttp = server => new Promise((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose());
    server.closeAllConnections();
});
const listen = server => new Promise(resolveListen => {
    server.listen(0, "127.0.0.1", () => resolveListen(`http://127.0.0.1:${server.address().port}`));
});
const payload = { data: [{ url: "https://fixture.invalid/result.png" }] };
let upstreamCalls = 0;
let received;
const upstream = createHttpServer((req, res) => {
    void (async () => {
        upstreamCalls++;
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const bytes = Buffer.concat(chunks);
        received = { headers: req.headers, url: req.url, bytes };
        if (req.url === "/slow") return;
        if (req.url === "/disconnect") {
            req.socket.destroy();
            return;
        }
        if (req.url === "/broken-stream") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.write('{"data":');
            setTimeout(() => res.destroy(), 20);
            return;
        }
        if (req.url === "/denied") {
            res.writeHead(401, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "fixture permission denied" } }));
            return;
        }
        if (req.url === "/redirect") {
            res.writeHead(302, { Location: "/compressed" });
            res.end();
            return;
        }
        if (req.url === "/compressed") {
            const compressed = gzipSync(JSON.stringify(payload));
            res.writeHead(200, {
                "Content-Type": "application/json", "Content-Encoding": "gzip",
                "Content-Length": compressed.length,
            });
            res.end(compressed);
            return;
        }
        if (req.url?.startsWith("/v1/images/edits")) {
            received.form = await new Response(bytes, { headers: { "Content-Type": req.headers["content-type"] } }).formData();
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(payload));
    })().catch(error => {
        res.statusCode = 500;
        res.end(String(error));
    });
});
const upstreamOrigin = await listen(upstream);
const shortProxy = createHttpServer(api.createApiProxyMiddleware(100));
const shortOrigin = await listen(shortProxy);
const originalAdapter = axios.defaults.adapter;
let dev;
let production;
try {
    dev = await createServer({
        root: web, logLevel: "silent",
        server: { host: "127.0.0.1", port: 0, open: false },
    });
    await dev.listen();
    production = await preview({
        root: web, logLevel: "silent",
        preview: { host: "127.0.0.1", port: 0, open: false },
    });
    for (const [mode, server] of [["dev", dev], ["preview", production]]) {
        const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
        globalThis.window = { location: { origin } };
        const url = path => api.proxyApiUrl(`${upstreamOrigin}${path}`);
        assert.match(url("/v1/images/edits"), /^\/api-proxy\?target=/);
        assert.equal(api.proxyApiUrl(`${origin}/same-origin`), `${origin}/same-origin`);
        assert.equal(api.proxyApiUrl("data:image/png;base64,Zml4dHVyZQ=="), "data:image/png;base64,Zml4dHVyZQ==");
        const bytes = Buffer.alloc(2 * 1024 * 1024, 137);
        const multipart = new FormData();
        multipart.set("model", "gpt-image-2.5-sunburst");
        multipart.set("quality", "low");
        multipart.set("size", "3840x2160");
        multipart.append("image", new Blob([bytes], { type: "image/png" }), "reference.png");
        multipart.append("image", new Blob(["second"]), "second.png");
        multipart.set("mask", new Blob(["mask"]), "mask.png");
        const response = await fetch(`${origin}${url("/v1/images/edits?fixture=1")}`, {
            method: "POST", body: multipart,
            headers: { Authorization: "Bearer fixture", Origin: origin, Referer: `${origin}/canvas`, Cookie: "local=private" },
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), payload);
        assert.equal(received.url, "/v1/images/edits?fixture=1");
        assert.equal(received.headers.authorization, "Bearer fixture");
        for (const header of ["origin", "referer", "cookie"]) assert.equal(received.headers[header], undefined);
        assert.equal(received.form.get("model"), "gpt-image-2.5-sunburst");
        assert.equal(received.form.get("quality"), "low");
        assert.equal(received.form.get("size"), "3840x2160");
        assert.equal(received.form.getAll("image").length, 2);
        assert.deepEqual(Buffer.from(await received.form.get("image").arrayBuffer()), bytes);
        assert.equal(await received.form.get("mask").text(), "mask");

        // Exercise the actual GPT channel's requestEdit, not just a hand-built upload.
        const model = "gpt-image-2.5-sunburst";
        const config = {
            ...api.defaultConfig, model: `gpt::${model}`, imageModel: `gpt::${model}`,
            resolution: "4k", quality: "low", size: "auto",
            channels: [{ id: "gpt", name: "GPT fixture", baseUrl: upstreamOrigin, apiKey: "fixture",
                apiFormat: "openai", models: [{ name: model, capability: "image" }] }],
        };
        const references = [{ id: "ref", name: "ref.png", type: "image/png", dataUrl: "data:image/png;base64,Zml4dHVyZQ==" }];
        axios.defaults.adapter = request => axios.getAdapter("http")({ ...request, url: `${origin}${request.url}` });
        await api.requestEdit(config, "fixture", references);
        assert.equal(received.form.get("model"), model);
        assert.equal(received.form.get("quality"), "low");
        assert.equal(received.form.get("size"), "3840x2160");
        assert.equal(received.form.get("response_format"), null);

        axios.defaults.adapter = async request => {
            throw new axios.AxiosError("Network Error", "ERR_NETWORK", request);
        };
        await assert.rejects(api.requestEdit(config, "fixture", references), error =>
            error.message.includes("\u672c\u5730\u8f6c\u53d1") && !error.message.includes("\u8de8\u57df\u7b56\u7565"));
        for (const code of ["proxy_timeout", "proxy_upstream_failed"]) {
            axios.defaults.adapter = async request => {
                throw new axios.AxiosError("fixture", "ERR_BAD_RESPONSE", request, null, {
                    config: request, status: 502, data: { error: { code, message: "fixture detail" } },
                });
            };
            await assert.rejects(api.requestEdit(config, "fixture", references), error =>
                error.message.includes(code === "proxy_timeout" ? "5 \u5206\u949f" : "\u672c\u5730\u8f6c\u53d1"));
        }
        const denied = await fetch(`${origin}${url("/denied")}`);
        assert.equal(denied.status, 401);
        assert.equal((await denied.json()).error.message, "fixture permission denied");
        const disconnected = await fetch(`${origin}${url("/disconnect")}`);
        assert.equal(disconnected.status, 502);
        assert.equal((await disconnected.json()).error.code, "proxy_upstream_failed");
        const compressed = await fetch(`${origin}${url("/redirect")}`);
        assert.equal(compressed.headers.get("content-encoding"), null);
        assert.deepEqual(await compressed.json(), payload);
        await assert.rejects(async () => (await fetch(`${origin}${url("/broken-stream")}`)).text());
        const count = upstreamCalls;
        const placeholder = await fetch(`${origin}${url("/v1/models")}`, {
            headers: { Authorization: "Bearer local-server" },
        });
        assert.equal(placeholder.status, 401);
        assert.equal((await placeholder.json()).error.code, "missing_credentials");
        assert.equal(upstreamCalls, count, "A placeholder must never use server credentials or reach the upstream");
        for (const target of ["", "invalid", "file:///C:/Windows/win.ini", "https://user:secret@fixture.invalid"]) {
            assert.equal((await fetch(`${origin}/api-proxy?target=${encodeURIComponent(target)}`)).status, 400);
        }
        assert.equal(upstreamCalls, count);
        console.log(`${mode}: multipart, GPT channel, errors, redirect, compressed and interrupted responses passed`);
    }
    const timeout = await fetch(`${shortOrigin}/api-proxy?target=${encodeURIComponent(`${upstreamOrigin}/slow`)}`);
    assert.equal(timeout.status, 504);
    assert.equal((await timeout.json()).error.code, "proxy_timeout");
    console.log("Proxy timeout passed; all tests used local mock endpoints.");
} finally {
    axios.defaults.adapter = originalAdapter;
    delete globalThis.window;
    await dev?.close();
    if (production) await closeHttp(production.httpServer);
    await closeHttp(shortProxy);
    await closeHttp(upstream);
}
