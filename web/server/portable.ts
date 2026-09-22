import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, closeSync, openSync } from "node:fs";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { pipeline } from "node:stream/promises";
import { createApiProxyMiddleware } from "./api-proxy";

const root = resolve(dirname(process.argv[1]), "..");
const site = join(root, "site");
const port = Number(process.env.APP_PORT || 3001);
const origin = `http://localhost:${port}`;
const identity = createHash("sha256").update(root.toLowerCase()).digest("hex");
const stateFile = join(root, "logs", `server-${port}.json`);
const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
    ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".wasm": "application/wasm",
    ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

function reply(res: ServerResponse, status: number, message: string) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(message);
}

function trusted(req: IncomingMessage) {
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host || "")) return false;
    if (req.headers["sec-fetch-site"] === "cross-site") return false;
    if (!req.headers.origin) return true;
    return req.headers.origin === `http://${req.headers.host}`;
}

async function serveFile(req: IncomingMessage, res: ServerResponse, pathname: string) {
    if (!["GET", "HEAD"].includes(req.method || "")) return reply(res, 405, "Method not allowed");
    let decoded: string;
    try { decoded = decodeURIComponent(pathname); } catch { return reply(res, 400, "Invalid path"); }
    if (decoded.includes("\\") || decoded.includes("\0") || decoded.split("/").some(part => part.startsWith(".") || part.includes(":"))) {
        return reply(res, 403, "Forbidden");
    }
    let path = resolve(site, `.${decoded}`);
    const inside = (candidate: string) => {
        const subpath = relative(site, candidate);
        return subpath !== ".." && !subpath.startsWith(`..${sep}`) && !isAbsolute(subpath);
    };
    if (!inside(path)) return reply(res, 403, "Forbidden");
    if (decoded.endsWith("/")) path = join(path, "index.html");
    let info;
    try { info = await stat(path); } catch {
        // Only application routes may fall back to the SPA, never missing assets.
        if (/^\/(?:canvas(?:\/[^/.]+)?|director|assets|config)?\/?$/.test(decoded)) {
            path = join(site, "index.html");
            info = await stat(path);
        } else return reply(res, 404, "Not found");
    }
    if (!info.isFile() || !inside(await realpath(path)) || !mime[extname(path)]) return reply(res, 404, "Not found");
    const headers: Record<string, string | number> = {
        "Content-Type": mime[extname(path)], "Content-Length": info.size,
        "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
    };
    let start = 0, end = info.size - 1, status = 200;
    if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!match || (!match[1] && !match[2])) {
            res.setHeader("Content-Range", `bytes */${info.size}`);
            return reply(res, 416, "Invalid range");
        }
        start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
            res.setHeader("Content-Range", `bytes */${info.size}`);
            return reply(res, 416, "Invalid range");
        }
        status = 206;
        headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
        headers["Content-Length"] = end - start + 1;
    }
    res.writeHead(status, headers);
    if (req.method === "HEAD" || !info.size) { res.end(); return; }
    await pipeline(createReadStream(path, { start, end }), res);
}

async function serve() {
    const token = randomBytes(32).toString("hex");
    const proxy = createApiProxyMiddleware();
    const server = createServer((req, res) => {
        void (async () => {
            if (!trusted(req)) return reply(res, 403, "Local same-origin requests only");
            const url = new URL(req.url || "/", origin);
            if (url.pathname === "/__portable/health") {
                res.setHeader("Content-Type", "application/json");
                res.setHeader("Cache-Control", "no-store");
                res.end(JSON.stringify({ app: "dawei-tianlong-portable", identity }));
            } else if (url.pathname === "/__portable/stop") {
                if (req.method !== "POST" || req.headers.authorization !== `Bearer ${token}`) return reply(res, 403, "Forbidden");
                reply(res, 200, "Stopped");
                server.close();
                setTimeout(() => process.exit(0), 250).unref();
            } else if (url.pathname === "/api-proxy") {
                proxy(req, res);
            } else {
                await serveFile(req, res, url.pathname);
            }
        })().catch(() => {
            if (!res.headersSent) reply(res, 500, "Local server error");
            else res.destroy();
        });
    });
    await new Promise<void>((done, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", done);
    });
    await mkdir(join(root, "logs"), { recursive: true });
    await writeFile(stateFile, JSON.stringify({ identity, token }), { mode: 0o600 });
    console.log(`Ready: ${origin}`);
}

async function health() {
    try {
        const response = await fetch(`${origin}/__portable/health`, { signal: AbortSignal.timeout(1500) });
        const value = await response.json();
        return value.app === "dawei-tianlong-portable" && value.identity === identity ? "ready" : "other";
    } catch (error) {
        if (error instanceof SyntaxError) return "other";
        return "waiting";
    }
}

async function openBrowser() {
    await new Promise<void>((done, reject) => {
        const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "start", "", `${origin}/`], { windowsHide: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("exit", code => code === 0 ? done() : reject(new Error("Could not open the default browser.")));
    });
}

async function launch() {
    let status = await health();
    if (process.argv.includes("--stop")) {
        if (status === "waiting") { console.log("Server is not running."); return; }
        if (status !== "ready") throw new Error("This port belongs to another application; nothing was stopped.");
        const state = JSON.parse(await readFile(stateFile, "utf8"));
        if (state.identity !== identity) throw new Error("Server identity mismatch.");
        const response = await fetch(`${origin}/__portable/stop`, { method: "POST", headers: { Authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(3000) });
        if (!response.ok) throw new Error("Could not stop this server.");
        console.log("Server stopped.");
        return;
    }
    if (status === "other") throw new Error(`Port ${port} is in use. Close the previous app or set APP_PORT to a free port.`);
    let child: ReturnType<typeof spawn> | undefined;
    if (status !== "ready") {
        await mkdir(join(root, "logs"), { recursive: true });
        const log = openSync(join(root, "logs", `server-${port}.log`), "a");
        let childError: Error | undefined;
        try {
            const env = { ...process.env };
            delete env.NODE_OPTIONS;
            delete env.NODE_PATH;
            child = spawn(process.execPath, [process.argv[1], "--serve"], {
                cwd: root, detached: true, windowsHide: true, stdio: ["ignore", log, log], env,
            });
            child.on("error", error => { childError = error; });
            child.unref();
        } finally { closeSync(log); }
        try {
            const deadline = Date.now() + 30000;
            do {
                if (childError) throw childError;
                status = await health();
                if (status === "ready") break;
                if (status === "other") throw new Error(`Port ${port} belongs to another application.`);
                if (child.exitCode !== null) throw new Error("Server could not start. Check the logs folder and APP_PORT.");
                await sleep(200);
            } while (Date.now() < deadline);
            if (status !== "ready") throw new Error("Server startup timed out. Check the logs folder.");
        } catch (error) {
            if (child.exitCode === null) child.kill();
            throw error;
        }
    }
    console.log(`Ready: ${origin}`);
    if (!process.argv.includes("--no-browser")) await openBrowser();
}

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("APP_PORT must be an integer between 1 and 65535.");
    process.exitCode = 1;
} else {
    (process.argv.includes("--serve") ? serve() : launch()).catch(error => {
        console.error(error instanceof Error ? error.message : "Startup failed.");
        process.exitCode = 1;
    });
}
