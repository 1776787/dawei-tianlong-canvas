import i18n from "@/i18n";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import type { UploadedImage } from "@/services/image-storage";
import type { CanvasNodeData, CanvasNodeImage } from "@/types/canvas";

export function pendingImageResult(node: CanvasNodeData, imageId?: string) {
    if (imageId) {
        const image = node.metadata?.images?.find(item => item.id === imageId);
        return image?.pendingImageUrl ? { url: image.pendingImageUrl, imageId } : undefined;
    }
    if (node.metadata?.pendingImageUrl) return { url: node.metadata.pendingImageUrl, imageId: undefined };
    const image = node.metadata?.images?.find(item => item.pendingImageUrl && item.status !== "success");
    return image?.pendingImageUrl ? { url: image.pendingImageUrl, imageId: image.id } : undefined;
}

export function markImageReceiving(node: CanvasNodeData, url: string, imageId?: string): CanvasNodeData {
    const hasContent = Boolean(node.metadata?.content);
    return {
        ...node,
        metadata: {
            ...node.metadata,
            status: hasContent ? node.metadata?.status : "loading",
            errorDetails: undefined,
            ...(imageId
                ? { images: node.metadata?.images?.map(image => image.id === imageId
                    ? { ...image, pendingImageUrl: url, status: "loading", errorDetails: undefined } : image) }
                : { pendingImageUrl: url, status: "loading" }),
        },
    };
}

export function markImageReceiveFailed(node: CanvasNodeData, errorDetails: string, imageId?: string): CanvasNodeData {
    const images = imageId ? node.metadata?.images?.map(image => image.id === imageId
        ? { ...image, status: "error" as const, errorDetails } : image) : node.metadata?.images;
    const status = images?.some(image => image.status === "loading") ? "loading" : node.metadata?.content ? "success" : "error";
    return { ...node, metadata: { ...node.metadata, images, status, errorDetails } };
}

export function completeImageReceive(node: CanvasNodeData, uploaded: UploadedImage, imageId?: string): CanvasNodeData {
    const item: CanvasNodeImage | undefined = imageId ? {
        id: imageId, status: "success", content: uploaded.url, storageKey: uploaded.storageKey,
        naturalWidth: uploaded.width, naturalHeight: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType,
    } : undefined;
    const images = item ? node.metadata?.images?.map(image => image.id === item.id ? item : image) : node.metadata?.images;
    const makePrimary = !imageId || !node.metadata?.content || node.metadata.primaryImageId === imageId;
    const size = makePrimary && !node.metadata?.freeResize
        ? fitNodeSize(uploaded.width, uploaded.height, node.width, node.height)
        : { width: node.width, height: node.height };
    return {
        ...node, ...size,
        position: { x: node.position.x + (node.width - size.width) / 2, y: node.position.y + (node.height - size.height) / 2 },
        metadata: {
            ...node.metadata,
            ...(makePrimary ? imageMetadata(uploaded) : {}),
            images, pendingImageUrl: undefined, errorDetails: undefined,
            primaryImageId: makePrimary && imageId ? imageId : node.metadata?.primaryImageId,
            status: images?.some(image => image.status === "loading") ? "loading" : "success",
        },
    };
}

export function imageReceiveError(error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return `${i18n.t("apiErrors.generatedImageReceiveFailed")}\n${detail}`;
}
