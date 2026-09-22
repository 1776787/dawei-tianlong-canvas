import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(web, "scripts/launch-browser.mjs");
const launcherSource = await readFile(script, "utf8");
const viteSource = await readFile(join(web, "vite.config.ts"), "utf8");
const portableSource = await readFile(join(web, "server/portable.ts"), "utf8");
assert.match(launcherSource, /process\.env\.APP_PORT \|\| 3001/, "Launcher default port must be 3001");
assert.match(viteSource, /const DEFAULT_PORT = 3001;/, "Vite default port must be 3001");
assert.match(portableSource, /process\.env\.APP_PORT \|\| 3001/, "Portable default port must be 3001");
const batch = await readFile(resolve(web, "../start.bat"), "utf8");
assert.ok(!/(?<!\r)\n/.test(batch), "start.bat must use CRLF line endings for cmd subroutine parsing");
const launch = (port) => run(process.execPath, [script, "--no-browser"], {
    cwd: web, windowsHide: true, timeout: 90000,
    env: { ...process.env, APP_PORT: String(port), NODE_EXE: process.execPath },
});
const listen = (server) => new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});
const close = (server) => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

await assert.rejects(launch("invalid"), error => error.code === 1 && error.stderr.includes("APP_PORT must be"));
await assert.rejects(launch(65536), error => error.code === 1 && error.stderr.includes("APP_PORT must be"));
const unrelated = createServer((_, response) => response.end("<html>Another app</html>"));
const unrelatedPort = await listen(unrelated);
try {
    await assert.rejects(launch(unrelatedPort), error => error.code === 1 && error.stderr.includes("another application"));
} finally {
    await close(unrelated);
}

const reservation = createServer();
const port = await listen(reservation);
await close(reservation);
let pid;
try {
    let first;
    try {
        first = await launch(port);
    } catch (error) {
        pid = error.stdout?.match(/Started background server \(PID (\d+)\)/)?.[1];
        throw error;
    }
    pid = first.stdout.match(/Started background server \(PID (\d+)\)/)?.[1];
    assert.ok(pid, "First launch must start a background server");
    assert.ok(first.stdout.includes(`Canvas is ready at http://localhost:${port}/`));
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes("infinite-canvas:theme_store"));
    const second = await launch(port);
    assert.ok(second.stdout.includes("Canvas is ready"));
    assert.ok(!second.stdout.includes("Started background server"), "Repeated launch must reuse the server");
} finally {
    if (pid) await run("taskkill.exe", ["/PID", pid, "/T", "/F"], { windowsHide: true }).catch(() => {});
}
console.log("PASS: invalid ports, occupied port protection, hidden server startup, readiness and reuse. No browser opened; test server stopped.");
