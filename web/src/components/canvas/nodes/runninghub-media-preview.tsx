import { useEffect, useState } from "react";
import { Image } from "antd";
import { resolveMediaUrl } from "@/services/file-storage";

export function RunningHubMediaPreview({ url = "", storageKey, kind, label }: { url?: string; storageKey?: string; kind: "image" | "video"; label: string }) {
    const [resolved, setResolved] = useState("");
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let active = true;
        setResolved(""); setFailed(false);
        void resolveMediaUrl(storageKey, url).then((value) => { if (active) setResolved(value); }).catch(() => { if (active) setFailed(true); });
        return () => { active = false; };
    }, [url, storageKey]);
    const valid = /^(https?:|blob:|data:(image|video)\/)/i.test(resolved);
    return <div className="rh-reference-preview" aria-label={label}>
        {valid && !failed ? kind === "video" ? <video src={resolved} controls preload="metadata" onError={() => setFailed(true)} /> : <Image src={resolved} alt={label} onError={() => setFailed(true)} /> : <span>{url || storageKey ? "暂无可访问预览" : "未添加素材"}</span>}
    </div>;
}
