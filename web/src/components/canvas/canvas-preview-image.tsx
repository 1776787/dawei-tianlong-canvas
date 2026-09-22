import { memo, useEffect, useState, type ImgHTMLAttributes } from "react";
import { acquireCanvasImagePreview } from "@/services/canvas-image-preview";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string };
const emptyPixel = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";

export const CanvasPreviewImage = memo(function CanvasPreviewImage({ src, ...props }: Props) {
    const [preview, setPreview] = useState<{ source: string; url: string }>();
    useEffect(() => {
        let active = true;
        const lease = acquireCanvasImagePreview(src);
        void lease.promise.then((url) => {
            if (active) setPreview({ source: src, url });
        });
        return () => {
            active = false;
            lease.release();
        };
    }, [src]);
    const ready = preview?.source === src;
    return <img {...props} src={ready ? preview.url : emptyPixel} decoding="async" aria-busy={!ready}
        onError={(event) => {
            if (ready && preview.url !== src) setPreview({ source: src, url: src });
            else props.onError?.(event);
        }} />;
});
