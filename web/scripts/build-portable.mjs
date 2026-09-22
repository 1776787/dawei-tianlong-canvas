import { build as bundle } from "esbuild";
import { build as buildSite } from "vite";
import react from "@vitejs/plugin-react";
import { zipSync, unzipSync } from "fflate";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const run = promisify(execFile);
const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = dirname(web);
const packageJson = JSON.parse(await readFile(join(web, "package.json"), "utf8"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const output = resolve(repo, "../../output/releases", `${packageJson.version}-${stamp}`);
const name = `Dawei-Tianlong-Canvas-${packageJson.version}-win-x64`;
const portable = join(output, name);
const site = join(portable, "site");
const licenses = join(portable, "licenses");
const cache = join(web, "node_modules/.cache/portable-runtime");
const runtimeVersion = "v24.20.0";
const runtimeArchive = `node-${runtimeVersion}-win-x64.zip`;
const runtimeHash = "6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Build this package on Windows x64.");
await mkdir(portable, { recursive: true });
await mkdir(licenses);
await mkdir(cache, { recursive: true });

async function filesIn(root) {
    const result = [];
    for (const entry of await readdir(root, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in the package: ${entry.name}`);
        const path = join(root, entry.name);
        if (entry.isDirectory()) result.push(...await filesIn(path));
        else result.push(path);
    }
    return result;
}

async function copy(source, target) {
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, errorOnExist: true, force: false });
}

// Never evaluate the development Vite config or read its .env credentials.
for (const key of Object.keys(process.env)) {
    if (key.startsWith("VITE_")) delete process.env[key];
}
console.log("Building clean frontend...");
await buildSite({
    configFile: false, root: web, envDir: false, publicDir: false,
    plugins: [react()], base: "/",
    resolve: { alias: { "@": join(web, "src") } },
    define: { "import.meta.env.VITE_PORTABLE_RELEASE": JSON.stringify("true") },
    build: { outDir: site, emptyOutDir: false, sourcemap: false, minify: "esbuild", license: { fileName: "FRONTEND-LICENSES.md" } },
});
await copy(join(site, "FRONTEND-LICENSES.md"), join(licenses, "FRONTEND-LICENSES.md"));
for (const asset of ["brand-logo.png", "icons", "prompt-covers"]) {
    await copy(join(web, "public", asset), join(site, asset));
}
await writeFile(join(site, "config.js"), "window.__RUNTIME_CONFIG__ = {};\n");

console.log("Building clean director studio...");
const studio = join(web, "monoform-studio");
const studioVite = await import(pathToFileURL(join(studio, "node_modules/vite/dist/node/index.js")).href);
const studioReact = (await import(pathToFileURL(join(studio, "node_modules/@vitejs/plugin-react/dist/index.js")).href)).default;
await studioVite.build({
    configFile: false, root: studio, envDir: false, publicDir: false,
    plugins: [studioReact()], base: "./",
    build: { outDir: join(site, "monoform"), emptyOutDir: false, sourcemap: false, minify: true, license: { fileName: "DIRECTOR-LICENSES.md" } },
});
await copy(join(site, "monoform/DIRECTOR-LICENSES.md"), join(licenses, "DIRECTOR-LICENSES.md"));
await copy(join(studio, "public/models/xbot-animated.glb"), join(site, "monoform/models/xbot-animated.glb"));
await copy(join(studio, "public/branding/monoform-mark.png"), join(site, "monoform/branding/monoform-mark.png"));
await copy(join(studio, "public/models/ANIMATION_SOURCES.md"), join(licenses, "ANIMATION_SOURCES.md"));

console.log("Bundling local server...");
await bundle({
    entryPoints: [join(web, "server/portable.ts")], outfile: join(portable, "runtime/app.cjs"),
    bundle: true, platform: "node", format: "cjs", target: "node24",
    minify: true, sourcemap: false, legalComments: "eof",
});

console.log("Preparing verified Node.js runtime...");
const archivePath = join(cache, runtimeArchive);
let archive;
try { archive = await readFile(archivePath); } catch { /* Fetch the pinned official runtime on first build. */ }
if (!archive || sha256(archive) !== runtimeHash) {
    await run("curl.exe", ["--fail", "--location", "--retry", "2", "--max-time", "180", `https://nodejs.org/download/release/${runtimeVersion}/${runtimeArchive}`, "--output", archivePath], { windowsHide: true, maxBuffer: 1024 * 1024 });
    archive = await readFile(archivePath);
}
if (sha256(archive) !== runtimeHash) throw new Error("Official Node.js archive checksum mismatch.");
const nodeEntries = unzipSync(archive, { filter: entry => /\/(?:node\.exe|LICENSE)$/.test(entry.name) });
for (const filename of ["node.exe", "LICENSE"]) {
    const bytes = nodeEntries[`node-${runtimeVersion}-win-x64/${filename}`];
    if (!bytes) throw new Error(`Official runtime is missing ${filename}.`);
    await writeFile(join(portable, filename === "node.exe" ? "runtime/node.exe" : "licenses/NODE-LICENSE.txt"), bytes);
}
const runtime = await run(join(portable, "runtime/node.exe"), ["--version"], { windowsHide: true });
if (runtime.stdout.trim() !== runtimeVersion) throw new Error("Runtime version mismatch.");

await copy(join(repo, "LICENSE"), join(portable, "LICENSE"));
await copy(join(web, "scripts/release/README.md"), join(portable, "README.md"));
const crlf = text => text.replace(/\r?\n/g, "\r\n");
await writeFile(join(portable, "start.vbs"), crlf(await readFile(join(web, "scripts/release/start.vbs"), "utf8")));
await writeFile(join(portable, "start.bat"), crlf('@echo off\n"%SystemRoot%\\System32\\wscript.exe" //nologo "%~dp0start.vbs"\nexit /b\n'));
await writeFile(join(portable, "stop.vbs"), crlf([
    "Option Explicit",
    'Dim shell, files, root',
    'Set shell = CreateObject("WScript.Shell")',
    'Set files = CreateObject("Scripting.FileSystemObject")',
    'root = files.GetParentFolderName(WScript.ScriptFullName)',
    'shell.Run Chr(34) & shell.ExpandEnvironmentStrings("%SystemRoot%\\System32\\wscript.exe") & Chr(34) & " //nologo " & Chr(34) & files.BuildPath(root, "start.vbs") & Chr(34) & " --stop", 0, True',
].join("\n")));
await writeFile(join(portable, "diagnose.bat"), crlf('@echo off\nset "NODE_OPTIONS="\nset "NODE_PATH="\n"%~dp0runtime\\node.exe" "%~dp0runtime\\app.cjs" --no-browser\npause\n'));

const mediabunny = JSON.parse(await readFile(join(studio, "node_modules/mediabunny/package.json"), "utf8"));
await copy(join(studio, "node_modules/mediabunny/LICENSE"), join(licenses, "MEDIABUNNY-MPL-2.0.txt"));
await writeFile(join(licenses, "SOURCE-OFFERS.md"), `# Third-party source availability\n\nMediabunny ${mediabunny.version} is included unmodified under MPL-2.0.\nThe corresponding source archive is available at:\nhttps://registry.npmjs.org/mediabunny/-/mediabunny-${mediabunny.version}.tgz\nUpstream: https://github.com/Vanilagy/mediabunny\nLicense: MEDIABUNNY-MPL-2.0.txt\n\nThis source notice applies to this third-party component, not the application's original modules.\n`);
await writeFile(join(licenses, "ASSET-NOTICES.md"), [
    "# Asset notices",
    "",
    "Director animation provenance is documented in ANIMATION_SOURCES.md.",
    "The xbot character and MONOFORM mark are inherited project assets. This build does not establish their original ownership or redistribution permissions.",
    "Prompt cover images are inherited from the local project. Their original author/license metadata is not present in this project.",
    "Before public redistribution, the publisher must confirm permissions for these assets or replace them with assets they are authorized to distribute.",
    "",
].join("\n"));
await writeFile(join(licenses, "RUNTIME.md"), `# Runtime\n\nNode.js ${runtimeVersion}, Windows x64.\nSource: https://nodejs.org/download/release/${runtimeVersion}/${runtimeArchive}\nArchive SHA-256: ${runtimeHash}\nSee NODE-LICENSE.txt for Node.js and its bundled components.\n`);

console.log("Auditing release files...");
const forbidden = /(?:^|\/)(?:src|node_modules|\.git|\.env[^/]*|tests|scripts|logs|data|output)(?:\/|$)|\.(?:map|tsx?|jsx|log|pem|key|pfx|bak)$/i;
const knownSecrets = [];
for (const entry of await readdir(web)) {
    if (!entry.startsWith(".env")) continue;
    const text = await readFile(join(web, entry), "utf8");
    for (const line of text.split(/\r?\n/)) {
        const match = /^\s*([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)\s*=\s*(.+?)\s*$/.exec(line);
        if (match) {
            const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
            if (value.length >= 8) knownSecrets.push(value);
        }
    }
}
const inventory = [];
const zipEntries = {};
for (const path of await filesIn(portable)) {
    const local = relative(portable, path).split(sep).join("/");
    if (forbidden.test(local)) throw new Error(`Disallowed release file: ${local}`);
    const bytes = await readFile(path);
    if (/\.(?:js|cjs|css|html|json|md|txt|vbs|bat)$/.test(path) || local === "LICENSE") {
        const text = bytes.toString("utf8");
        if (knownSecrets.some(secret => text.includes(secret))) throw new Error(`Private environment value found in ${local}.`);
        if (/sourceMappingURL\s*=|sourcesContent"\s*:/.test(text)) throw new Error(`Source map found in ${local}.`);
        if (/sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) throw new Error(`Potential credential found in ${local}.`);
    }
    inventory.push({ path: local, bytes: bytes.length, sha256: sha256(bytes) });
    zipEntries[`${name}/${local}`] = bytes;
}
const manifest = JSON.stringify({ name, version: packageJson.version, runtime: runtimeVersion, files: inventory }, null, 2);
await writeFile(join(portable, "manifest.json"), manifest);
zipEntries[`${name}/manifest.json`] = Buffer.from(manifest);
console.log("Writing portable ZIP...");
const zip = zipSync(zipEntries, { level: 6 });
await writeFile(join(output, `${name}.zip`), zip);
await writeFile(join(output, "SHA256SUMS.txt"), `${sha256(zip)}  ${name}.zip\n`);
const github = join(output, "github-repo");
await mkdir(github);
await copy(join(web, "scripts/release/GITHUB-README.md"), join(github, "README.md"));
await copy(join(repo, "LICENSE"), join(github, "LICENSE"));
await writeFile(join(github, ".gitignore"), "*.zip\n*.exe\n*.log\n.env*\n");
await writeFile(join(output, "PUBLISH-CHECKLIST.md"), [
    "# 发布检查单",
    "",
    "- `github-repo` 是公开仓库内容，ZIP 和 SHA256SUMS.txt 放入 GitHub Releases 附件。",
    "- 不要把开发项目根目录添加到这个仓库，也不要上传运行后产生的 logs 或个人备份。",
    "- 构建已排除原始应用源码、source map、开发依赖、环境文件，并检查了本机环境密钥值。",
    "- 发布包包含压缩后的浏览器代码及本地服务代码；压缩不是加密，不能阻止逆向分析。",
    "- 原 MIT 许可、依赖许可和 Mediabunny 的 MPL 源码获取地址已随包保留。",
    "- **公开发布前仍须确认：提示词封面图、xbot 模型和 MONOFORM 标识的再分发权限。项目内未提供完整授权证明。**",
    "- 应先在另一台 Windows x64 电脑完成解压、启动和服务配置验证；本机测试不能替代干净机器验证。",
    "",
].join("\n"));
await writeFile(join(output, "BUILD-REPORT.json"), JSON.stringify({
    package: `${name}.zip`, sizeBytes: zip.length, sha256: sha256(zip), files: inventory.length,
    sourceMaps: false, originalApplicationSource: false, bundledRuntime: runtimeVersion,
    environmentSecretsChecked: knownSecrets.length, redistributionAssetReviewRequired: true,
}, null, 2));
await writeFile(join(web, "node_modules/.cache/portable-latest.json"), JSON.stringify({ output, portable }));
console.log(`PORTABLE_OUTPUT=${output}`);
console.log(`ZIP_SIZE_MB=${(zip.length / 1024 / 1024).toFixed(1)}`);
