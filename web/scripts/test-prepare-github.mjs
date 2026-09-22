import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporary = await mkdtemp(join(tmpdir(), "canvas-publish-test-"));
const fixture = join(temporary, "project");
const secret = "fixture-secret-" + "1234567890abcdef";
async function put(file, content) {
    const path = join(fixture, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
}
function run(...args) {
    const result = spawnSync(process.execPath, [join(fixture, "web/scripts/prepare-github.mjs"), ...args], {
        cwd: fixture, encoding: "utf8", windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.ok(!result.stdout.includes(secret), "Audit must not print secret values");
    return result;
}

try {
    await mkdir(join(fixture, "web/scripts"), { recursive: true });
    await cp(join(root, ".gitignore"), join(fixture, ".gitignore"));
    await cp(join(root, "web/scripts/prepare-github.mjs"), join(fixture, "web/scripts/prepare-github.mjs"));
    await put("web/.env.local", `API_KEY="${secret}"\n`);
    await put("web/.env.example", "API_KEY=\n");
    await put("web/server.log", secret);
    await put("infinite-canvas-config.json", JSON.stringify({ apiKey: secret }));
    await put("infinite-canvas-backup-2026-09-22.zip", secret);
    await put("web/node_modules/private.txt", secret);
    await put("web/output/private.txt", secret);
    await put("README.md", "Public source\n");
    const clean = run("--audit-only");
    assert.equal(clean.status, 0, clean.stderr);
    const report = JSON.parse(clean.stdout);
    assert.equal(report.knownSecretValuesChecked, 1);
    assert.deepEqual(report.findings, []);
    assert.deepEqual(report.reviewRequired, []);

    await put("leak.txt", secret);
    const leaked = run("--audit-only");
    assert.equal(leaked.status, 1);
    assert.ok(JSON.parse(leaked.stdout).findings.some(item => item.file === "leak.txt"));
    await put("leak.txt", "Public text");
    await put("token.txt", "ghp_" + "a".repeat(30));
    assert.equal(run("--audit-only").status, 1);
    await put("token.txt", "Public text");
    await put("paths.txt", 'import "@/components/home/example";\n"https://user:secret@fixture.invalid"\n');
    assert.deepEqual(JSON.parse(run("--audit-only").stdout).reviewRequired, []);
    const personalPath = ["C:", "Users", "TestPerson", "project"].join("\\");
    const personalEmail = ["user", "personal-domain.org"].join("@");
    await put("paths.txt", JSON.stringify(personalPath) + "\n" + JSON.stringify(personalEmail));
    assert.equal(JSON.parse(run("--audit-only").stdout).reviewRequired.length, 2);
    await put("paths.txt", "Public text");

    const exported = run();
    assert.equal(exported.status, 0, exported.stderr);
    const output = exported.stdout.match(/^UPLOAD_DIRECTORY=(.+)$/m)?.[1].trim();
    assert.ok(output && dirname(output) === temporary);
    assert.equal(await readFile(join(output, "README.md"), "utf8"), "Public source\n");
    assert.equal(await readFile(join(output, "web/.env.example"), "utf8"), "API_KEY=\n");
    assert.ok(!(await readdir(join(output, "web"))).includes(".env.local"));
    assert.ok(!(await readdir(output)).includes("infinite-canvas-config.json"));
    assert.equal(await readFile(join(fixture, "web/.env.local"), "utf8"), `API_KEY="${secret}"\n`);
    assert.ok(!(await readdir(fixture)).includes(".git"));
    console.log("Passed: private file exclusion, secret detection, redacted reports, review warnings, verified export, original preservation.");
} finally {
    const actual = await realpath(temporary);
    const parent = await realpath(tmpdir());
    if (dirname(actual).toLowerCase() !== parent.toLowerCase() || !basename(actual).startsWith("canvas-publish-test-")) {
        throw new Error("Refusing cleanup outside the temporary test directory.");
    }
    await rm(actual, { recursive: true, force: true });
}
