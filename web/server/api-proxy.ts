import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Plugin } from "vite";

const requestExcludedHeaders = new Set([
    "host", "connection", "content-length", "transfer-encoding", "keep-alive",
    "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade", "expect",
    "origin", "referer", "cookie",
]);
const responseExcludedHeaders = new Set([
    "content-encoding", "content-length", "transfer-encoding", "connection",
    "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "upgrade",
    "set-cookie",
]);

function sendError(res: ServerResponse, status: number, code: string, message: string) {
    if (res.destroyed) return;
    if (res.headersSent) {
        res.destroy();
        return;
    }
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ error: { code, message } }));
}

export function createApiProxyMiddleware(timeoutMs = 300_000) {
    return (req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
            let target: URL;
            try {
                const value = new URL(req.url || "", "http://localhost").searchParams.get("target");
                if (!value) throw new Error("missing target");
                target = new URL(value);
                if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) {
                    throw new Error("invalid target");
                }
            } catch {
                sendError(res, 400, "proxy_invalid_target", "A valid HTTP(S) target URL is required.");
                return;
            }

            const controller = new AbortController();
            let timedOut = false;
            const timer = setTimeout(() => {
                timedOut = true;
                controller.abort();
            }, timeoutMs);
            const disconnect = () => controller.abort();
            req.once("aborted", disconnect);
            res.once("close", disconnect);
            try {
                const headers: Record<string, string> = {};
                const connectionHeaders = new Set(
                    (req.headers.connection || "").toLowerCase().split(",").map(value => value.trim()),
                );
                for (const [key, value] of Object.entries(req.headers)) {
                    if (!value || requestExcludedHeaders.has(key) || connectionHeaders.has(key) || key.startsWith("sec-")) continue;
                    headers[key] = Array.isArray(value) ? value.join(", ") : value;
                }
                if (headers.authorization === "Bearer local-server") {
                    sendError(res, 401, "missing_credentials", "Configure your API key in the channel settings.");
                    return;
                }
                // Preserve multipart bytes and their boundary, including all reference images.
                let body: Uint8Array<ArrayBuffer> | undefined;
                if (!["GET", "HEAD"].includes(req.method || "GET")) {
                    const chunks: Buffer[] = [];
                    const abortUpload = () => req.destroy();
                    controller.signal.addEventListener("abort", abortUpload, { once: true });
                    try {
                        for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                        if (chunks.length) body = new Uint8Array(Buffer.concat(chunks));
                    } finally {
                        controller.signal.removeEventListener("abort", abortUpload);
                    }
                }
                const upstream = await fetch(target, {
                    method: req.method,
                    headers,
                    body,
                    signal: controller.signal,
                });
                res.statusCode = upstream.status;
                upstream.headers.forEach((value, key) => {
                    // Fetch decompresses the response; its original length/encoding no longer apply.
                    if (!responseExcludedHeaders.has(key)) res.setHeader(key, value);
                });
                if (upstream.body) {
                    await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream), res);
                } else {
                    res.end();
                }
            } catch (error) {
                const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined)?.code : undefined;
                const detail = typeof cause === "string" && /^[A-Z0-9_]+$/.test(cause) ? ` (${cause})` : "";
                sendError(res, timedOut ? 504 : 502, timedOut ? "proxy_timeout" : "proxy_upstream_failed",
                    timedOut ? "The upstream API did not finish within 5 minutes." : `The local proxy could not complete the upstream request${detail}.`);
            } finally {
                clearTimeout(timer);
                req.off("aborted", disconnect);
                res.off("close", disconnect);
            }
        })();
    };
}

export function apiProxyPlugin(): Plugin {
    const middleware = createApiProxyMiddleware();
    return {
        name: "canvas-api-proxy",
        configureServer(server) {
            server.middlewares.use("/api-proxy", middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use("/api-proxy", middleware);
        },
    };
}
