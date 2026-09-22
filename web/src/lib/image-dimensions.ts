export const IMAGE_ASPECT_OPTIONS = [
    { value: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", width: 1360, height: 1024, icon: "landscape" },
    { value: "3:4", width: 1024, height: 1360, icon: "portrait" },
    { value: "16:9", width: 1824, height: 1024, icon: "landscape" },
    { value: "9:16", width: 1024, height: 1824, icon: "portrait" },
    { value: "auto", width: 0, height: 0, icon: "auto" },
] as const;

const RESOLUTION_BASE: Record<string, number> = { "1k": 1024, "2k": 2048, "4k": 2880 };
const AUTO_PIXEL_SIZE: Record<string, string> = { "1k": "1024x1024", "2k": "2048x2048", "4k": "3840x2160" };
const STEP = 16;

/** Pixel-only APIs need a concrete size to honor a tier, even with automatic aspect. */
export function resolveImagePixelSize(size: string, resolution?: string) {
    const value = size.trim();
    if (!value || value.toLowerCase() === "auto") return AUTO_PIXEL_SIZE[resolution || ""] || "auto";
    return value;
}

/** Shared by the pixel preview and request adapter; explicit pixel sizes stay exact. */
export function imageDimensions(size: string, resolution?: string) {
    const pixels = size.match(/^(\d+)x(\d+)$/i);
    if (pixels) return { width: Number(pixels[1]), height: Number(pixels[2]) };
    const ratio = size.split(":");
    if (ratio.length !== 2) return null;
    const widthRatio = Number(ratio[0]);
    const heightRatio = Number(ratio[1]);
    if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio) || widthRatio <= 0 || heightRatio <= 0) return null;
    const landscape = widthRatio >= heightRatio;
    const longRatio = landscape ? widthRatio / heightRatio : heightRatio / widthRatio;
    const base = RESOLUTION_BASE[resolution || ""];
    const longSide = base
        ? Math.floor(Math.sqrt(base * base * longRatio) / STEP) * STEP
        : Math.round(1024 * longRatio / STEP) * STEP;
    const shortSide = base ? Math.round(longSide / longRatio / STEP) * STEP : 1024;
    return landscape ? { width: longSide, height: shortSide } : { width: shortSide, height: longSide };
}

export function imageAspectValue(size: string) {
    if (IMAGE_ASPECT_OPTIONS.some((option) => option.value === size)) return size;
    const dimensions = imageDimensions(size);
    if (!dimensions || !dimensions.height) return undefined;
    const ratio = dimensions.width / dimensions.height;
    return IMAGE_ASPECT_OPTIONS.find((option) => {
        if (option.value === "auto") return false;
        const [width, height] = option.value.split(":").map(Number);
        return Math.abs(ratio / (width / height) - 1) <= 0.01;
    })?.value;
}
