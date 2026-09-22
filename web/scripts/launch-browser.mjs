import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.APP_PORT || 3001);
let server;
let serverError;
let ready = false;

async function pageState(url) {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
        return response.ok && (await response.text()).includes("infinite-canvas:theme_store") ? "ready" : "other";
    } catch {
        return "waiting";
    }
}

function startServer() {
    const stdout = openSync(join(web, "server.log"), "a");
    const stderr = openSync(join(web, "server-error.log"), "a");
    try {
        const child = spawn(process.execPath, [
            join(web, "node_modules/vite/bin/vite.js"),
            "--host", "127.0.0.1", "--port", String(port), "--strictPort",
        ], { cwd: web, detached: true, windowsHide: true, stdio: ["ignore", stdout, stderr] });
        child.on("error", error => { serverError = error; });
        child.unref();
        console.log(`[INFO] Started background server (PID ${child.pid}).`);
        return child;
    } finally {
        closeSync(stdout);
        closeSync(stderr);
    }
}

function openBrowser(url) {
    return new Promise((resolve, reject) => {
        const opener = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/c", "start", "", url], {
            windowsHide: true, stdio: "ignore",
        });
        opener.once("error", reject);
        opener.once("exit", code => code === 0 ? resolve() : reject(new Error(`Browser opener exited with code ${code}.`)));
    });
}

try {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("APP_PORT must be an integer between 1 and 65535.");
    }
    const url = `http://localhost:${port}/`;
    let state = await pageState(url);
    if (state === "other") throw new Error(`Port ${port} is serving another application. Set APP_PORT to an unused port.`);
    if (state !== "ready") {
        server = startServer();
        const deadline = Date.now() + 60000;
        do {
            if (serverError) throw serverError;
            state = await pageState(url);
            if (state === "other") throw new Error(`Port ${port} is serving another application. Set APP_PORT to an unused port.`);
            if (state === "ready") break;
            // A concurrent launcher may have won the port while its server is still warming up.
            if (server.exitCode !== null) {
                await sleep(1000);
                state = await pageState(url);
                if (state === "ready") break;
                throw new Error("The Canvas server exited. See web/server-error.log.");
            }
            await sleep(300);
        } while (Date.now() < deadline);
        if (state !== "ready") throw new Error("The Canvas server did not become ready. See web/server.log and web/server-error.log.");
    }
    ready = true;
    console.log(`[INFO] Canvas is ready at ${url}`);
    if (!process.argv.includes("--no-browser")) await openBrowser(url);
} catch (error) {
    if (!ready && server && server.exitCode === null) server.kill();
    console.error(`[ERROR] ${error.message}`);
    process.exitCode = 1;
}
