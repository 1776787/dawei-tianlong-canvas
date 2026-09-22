const MAX_EDGE = 1024;

// Animated images and vectors keep their original rendering behavior.
async function isStaticRaster(blob: Blob) {
    if (blob.type === "image/jpeg") return true;
    if (blob.type !== "image/png" && blob.type !== "image/webp") return false;
    const bytes = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
    if (blob.type === "image/webp") return !(bytes[12] === 86 && bytes[15] === 88 && (bytes[20] & 2));
    const view = new DataView(bytes.buffer);
    for (let offset = 8; offset + 12 <= bytes.length;) {
        const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
        if (type === "acTL") return false;
        if (type === "IDAT") return true;
        offset += view.getUint32(offset) + 12;
    }
    return false;
}

self.onmessage = async (event: MessageEvent<{ url: string }>) => {
    let bitmap: ImageBitmap | undefined;
    try {
        const response = await fetch(event.data.url);
        if (!response.ok) throw new Error("Image fetch failed");
        const blob = await response.blob();
        if (!(await isStaticRaster(blob))) {
            self.postMessage({ original: true });
            return;
        }
        bitmap = await createImageBitmap(blob);
        const ratio = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        if (ratio === 1) {
            self.postMessage({ original: true });
            return;
        }
        const width = Math.max(1, Math.round(bitmap.width * ratio));
        const height = Math.max(1, Math.round(bitmap.height * ratio));
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Preview canvas unavailable");
        context.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();
        bitmap = undefined;
        const preview = await canvas.convertToBlob({ type: "image/webp", quality: 0.9 });
        self.postMessage({ blob: preview, width, height });
    } catch {
        self.postMessage({ original: true });
    } finally {
        bitmap?.close();
    }
};

export {};
