import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const auditOnly = process.argv.includes("--audit-only");
const temporary = await mkdtemp(join(tmpdir(), "canvas-publish-"));
const secrets = new Set();
const environmentFiles = [];
const findings = [];
const reviews = [];
const hashes = new Map();
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const textExtension = /\.(?:[cm]?js|jsx|tsx?|json|md|txt|html|css|ya?ml|toml|xml|svg|bat|cmd|ps1|vbs|sh|mjs|lock)$/i;
const credential = /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{24,}|AIza[A-Za-z0-9_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const privatePath = /[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[^\\/\s"'<>]+|(?:^|[\s"'`=])\/(?:Users|home)\/[^/\s"'<>]+/im;
const email = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const sensitiveFile = /(?:^|\/)(?:\.env(?!\.example$)[^/]*|\.npmrc|\.netrc|\.git-credentials|backup\.json|infinite-canvas-config[^/]*\.json|infinite-canvas-backup[^/]*\.zip)$|\.(?:pem|key|pfx|p12)$/i;

async function collectEnvironment(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (["node_modules", ".git", "dist", ".next", "out"].includes(entry.name)) continue;
        if (entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await collectEnvironment(path);
        else if (/^\.env(?:\.|$)/.test(entry.name) && entry.name !== ".env.example") {
            const values = parseEnv(await readFile(path, "utf8"));
            const keys = Object.entries(values).filter(([key, value]) => /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key) && value);
            for (const [, value] of keys) if (value.length >= 8) secrets.add(value);
            environmentFiles.push({ path: relative(root, path), configuredSecretFields: keys.length });
        }
    }
}

try {
    await collectEnvironment(root);
    // A disposable Git directory applies project ignore rules without changing the user's repository.
    execFileSync("git", ["init", "--bare", "--quiet", temporary], { windowsHide: true });
    const git = ["--git-dir", temporary, "--work-tree", root, "-c", "core.excludesFile=NUL"];
    const output = execFileSync("git", [...git, "ls-files", "--others", "--exclude-standard", "-z"], {
        cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
    });
    const files = output.toString("utf8").split("\0").filter(Boolean).sort();
    if (!files.length) throw new Error("No source files selected.");
    let totalBytes = 0;
    for (const file of files) {
        const path = resolve(root, file);
        if (!path.startsWith(root + sep)) throw new Error("File outside project.");
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) {
            findings.push({ file, reason: "Non-regular file requires manual review" });
            continue;
        }
        if (sensitiveFile.test(file)) findings.push({ file, reason: "Private file selected" });
        const bytes = await readFile(path);
        hashes.set(file, digest(bytes));
        totalBytes += bytes.length;
        if ([...secrets].some(secret => bytes.includes(Buffer.from(secret)))) {
            findings.push({ file, reason: "Contains a local environment secret" });
        }
        if (info.size > 100 * 1024 * 1024) findings.push({ file, reason: "File exceeds 100 MiB" });
        if (textExtension.test(file) || !basename(file).includes(".")) {
            const text = bytes.toString("utf8");
            if (credential.test(text)) findings.push({ file, reason: "Potential credential" });
            if (privatePath.test(text)) reviews.push({ file, reason: "Personal filesystem path" });
            if ([...text.matchAll(email)].some(match => !/(?:^|\.)(?:invalid|example|test|localhost)$|^(?:example\.(?:com|org|net))$/i.test(match[1]))) {
                reviews.push({ file, reason: "Email address (may be third-party attribution)" });
            }
        }
    }
    const report = {
        selectedFiles: files.length,
        selectedBytes: totalBytes,
        environmentFiles,
        knownSecretValuesChecked: secrets.size,
        findings,
        reviewRequired: reviews,
        limitations: [
            "Heuristic scan, not a guarantee that all personal information is absent.",
            "Images, models, personal prompts and third-party attribution require human review.",
            "Existing Git history and browser storage are not scanned or copied.",
            "Only current files selected by project ignore rules are included.",
        ],
    };
    console.log(JSON.stringify(report, null, 2));
    if (findings.length) {
        process.exitCode = 1;
    } else if (!auditOnly) {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const destination = join(dirname(root), `${basename(root)}-github-${stamp}`);
        await mkdir(destination);
        for (const file of files) {
            const target = join(destination, file);
            await mkdir(dirname(target), { recursive: true });
            await cp(join(root, file), target, { errorOnExist: true, force: false });
            if (digest(await readFile(target)) !== hashes.get(file)) {
                throw new Error(`Source changed during export; do not publish this incomplete copy: ${file}`);
            }
        }
        await writeFile(`${destination}.audit.json`, JSON.stringify(report, null, 2) + "\n");
        console.log(`UPLOAD_DIRECTORY=${destination}`);
        console.log("Review warnings and visual assets before publishing. No upload was performed.");
    }
} finally {
    const parent = await realpath(tmpdir());
    const actual = await realpath(temporary);
    if (dirname(actual).toLowerCase() !== parent.toLowerCase() || !basename(actual).startsWith("canvas-publish-")) {
        throw new Error("Refusing cleanup outside the temporary audit directory.");
    }
    await rm(actual, { recursive: true, force: true });
}
