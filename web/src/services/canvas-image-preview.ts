import { proxyApiUrl } from "@/lib/api-proxy";

type PreviewResult = { original?: boolean; blob?: Blob; width?: number; height?: number };
type Entry = { users: number; ready: boolean; url: string; bytes: number; promise: Promise<string> };
const cache = new Map<string, Entry>();
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 64;
let cachedBytes = 0;
let queue = Promise.resolve();
let worker: Worker | undefined;
let workerUnavailable = false;

function evictUnused() {
    for (const [source, entry] of cache) {
        if (cachedBytes <= MAX_CACHE_BYTES && cache.size <= MAX_CACHE_ENTRIES) break;
        if (entry.users || !entry.ready) continue;
        if (entry.url !== source) URL.revokeObjectURL(entry.url);
        cachedBytes -= entry.bytes;
        cache.delete(source);
    }
}

function makePreview(source: string): Promise<PreviewResult> {
    if (workerUnavailable || typeof Worker === "undefined") return Promise.resolve({ original: true });
    return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout>;
        const finish = (result: PreviewResult) => {
            clearTimeout(timer);
            if (worker) {
                worker.onmessage = null;
                worker.onerror = null;
                worker.onmessageerror = null;
            }
            resolve(result);
        };
        const fail = () => {
            worker?.terminate();
            worker = undefined;
            workerUnavailable = true;
            finish({ original: true });
        };
        try {
            worker ??= new Worker(new URL("./canvas-image-preview.worker.ts", import.meta.url), { type: "module" });
            worker.onmessage = (event: MessageEvent<PreviewResult>) => finish(event.data);
            worker.onerror = fail;
            worker.onmessageerror = fail;
            timer = setTimeout(fail, 30000);
            const url = new URL(source, window.location.href);
            const remote = (url.protocol === "http:" || url.protocol === "https:") && url.origin !== window.location.origin;
            worker.postMessage({ url: new URL(remote ? proxyApiUrl(source) : source, window.location.href).href });
        } catch {
            fail();
        }
    });
}

export function acquireCanvasImagePreview(source: string) {
    let entry = cache.get(source);
    if (!entry) {
        let resolve!: (url: string) => void;
        entry = { users: 0, ready: false, url: source, bytes: 0, promise: new Promise<string>((done) => { resolve = done; }) };
        const current = entry;
        cache.set(source, current);
        // Decode one original at a time, and skip queued images that left the viewport.
        queue = queue.then(async () => {
            try {
                if (!current.users) {
                    cache.delete(source);
                    return;
                }
                const result = await makePreview(source);
                if (result.blob) {
                    current.url = URL.createObjectURL(result.blob);
                    current.bytes = (result.width || 0) * (result.height || 0) * 4;
                    cachedBytes += current.bytes;
                }
            } finally {
                current.ready = true;
                resolve(current.url);
                evictUnused();
            }
        }).catch(() => {});
    } else {
        cache.delete(source);
        cache.set(source, entry);
    }
    entry.users++;
    const current = entry;
    let released = false;
    return {
        promise: current.promise,
        release() {
            if (released) return;
            released = true;
            current.users--;
            evictUnused();
        },
    };
}
