import { useMemo, useState } from "react";
import { Button, Input, Segmented, Select, Switch, Tooltip } from "antd";
import { Film, Image as ImageIcon, LayoutGrid, ListVideo, Play, Plus, Rows3, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";

// 分镜节点（对齐桥豆麻衣酱分镜表/分镜图表）：主题 + 镜头列表；每个镜头可关联生成节点
// （图片或视频），面板内显示生成预览、可编辑生成参数（模式/比例/时长/模型），支持
// 列表与宫格两种视图，一键生成或单镜头生成。数据以 JSON 存于 metadata.content。
export const STORYBOARD_TYPE = "storyboard";

export type StoryboardShot = { id: string; desc: string; nodeId?: string };
export type StoryboardGenMode = "image" | "video";
export type StoryboardResolution = "auto" | "1k" | "2k" | "4k";
export type StoryboardMeta = {
    theme: string;
    shots: StoryboardShot[];
    genMode: StoryboardGenMode;
    size: string;
    seconds: string;
    model: string;
    view: "list" | "grid";
    columns: number;
    resolution: StoryboardResolution;
    quality: "auto" | "high" | "medium" | "low";
    videoQuality: "auto" | "high" | "medium" | "low";
    videoResolution: string;
    generateAudio: string;
    watermark: string;
};

const SIZE_OPTIONS = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];
const RESOLUTION_OPTIONS: { value: StoryboardResolution; label: string }[] = [
    { value: "auto", label: "Auto" },
    { value: "1k", label: "1K" },
    { value: "2k", label: "2K" },
    { value: "4k", label: "4K" },
];
const QUALITY_OPTIONS: { value: StoryboardMeta["quality"]; label: string }[] = [
    { value: "auto", label: "Auto" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
];
const VIDEO_RESOLUTION_OPTIONS = ["480", "720", "1080", "1440", "2160"];
const VIDEO_SECONDS_OPTIONS = ["4", "6", "8", "10", "12"];

export function readStoryboardMeta(node: CanvasNodeData): StoryboardMeta {
    try {
        const parsed = JSON.parse(node.metadata?.content || "") as Partial<StoryboardMeta>;
        return {
            theme: typeof parsed.theme === "string" ? parsed.theme : "",
            shots: Array.isArray(parsed.shots)
                ? parsed.shots
                      .filter((shot): shot is StoryboardShot => Boolean(shot && typeof shot.desc === "string"))
                      .map((shot) => ({ id: shot.id || nanoid(6), desc: shot.desc, ...(typeof shot.nodeId === "string" ? { nodeId: shot.nodeId } : {}) }))
                : [],
            genMode: parsed.genMode === "video" ? "video" : "image",
            size: typeof parsed.size === "string" && parsed.size ? parsed.size : "auto",
            seconds: typeof parsed.seconds === "string" && parsed.seconds ? parsed.seconds : "6",
            model: typeof parsed.model === "string" ? parsed.model : "",
            view: parsed.view === "list" ? "list" : "grid",
            columns: Number.isFinite(parsed.columns) && (parsed.columns as number) >= 1 ? Math.min(9, Math.floor(parsed.columns as number)) : 3,
            resolution: parsed.resolution === "1k" || parsed.resolution === "2k" || parsed.resolution === "4k" ? parsed.resolution : "auto",
            quality: parsed.quality === "high" || parsed.quality === "medium" || parsed.quality === "low" ? parsed.quality : "auto",
            videoQuality: parsed.videoQuality === "high" || parsed.videoQuality === "medium" || parsed.videoQuality === "low" ? parsed.videoQuality : "auto",
            videoResolution: typeof parsed.videoResolution === "string" && parsed.videoResolution ? parsed.videoResolution : "720",
            generateAudio: parsed.generateAudio === "false" || node.metadata?.generateAudio === "false" ? "false" : "true",
            watermark: parsed.watermark === "true" || node.metadata?.watermark === "true" ? "true" : "false",
        };
    } catch {
        return { theme: "", shots: [], genMode: "image", size: "auto", seconds: "6", model: "", view: "grid", columns: 3, resolution: "auto", quality: "auto", videoQuality: "auto", videoResolution: "720", generateAudio: "true", watermark: "false" };
    }
}

export function writeStoryboardMeta(node: CanvasNodeData, meta: StoryboardMeta): CanvasNodeData {
    return { ...node, metadata: { ...node.metadata, content: JSON.stringify(meta) } };
}

export function composeShotPrompt(theme: string, shot: StoryboardShot, index: number, total: number) {
    const parts = [theme.trim(), shot.desc.trim()].filter(Boolean);
    return `${parts.join("\n")}\n（分镜 ${index + 1}/${total}）`;
}

let registered = false;
export function registerStoryboardNode() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions([
        {
            type: STORYBOARD_TYPE,
            title: i18n.t("canvas.nodeTypes.storyboard"),
            icon: <ListVideo className="size-5" />,
            defaultSize: { width: 360, height: 260 },
            defaultMetadata: { content: JSON.stringify({ theme: "", shots: [] }), status: "idle" },
            minimapColor: "#eab308",
            autoOpenPanel: true,
            resource: (node) => {
                const meta = readStoryboardMeta(node);
                const text = [meta.theme, ...meta.shots.map((shot, index) => `镜头${index + 1}：${shot.desc}`)].filter(Boolean).join("\n");
                return text ? { kind: "text", text } : null;
            },
        },
    ]);
}

/* ---------------- 节点卡片内容（只读摘要） ---------------- */
export function StoryboardNodeContent({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    const { t } = useTranslation();
    const meta = useMemo(() => readStoryboardMeta(node), [node]);
    return (
        <div className="pointer-events-none flex h-full w-full flex-col gap-2 overflow-hidden p-4">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: theme.node.text }}>
                <ListVideo className="size-4" />
                <span className="truncate">{meta.theme || t("canvas.storyboard.emptyTheme")}</span>
                {meta.genMode === "video" ? <Film className="size-3.5 opacity-60" /> : null}
            </div>
            {meta.shots.length ? (
                <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
                    {meta.shots.slice(0, 6).map((shot, index) => (
                        <div key={shot.id} className="flex items-start gap-2 text-xs" style={{ color: theme.node.muted }}>
                            <span className="shrink-0 rounded px-1 font-mono text-[10px] leading-4" style={{ background: theme.toolbar.activeBg, color: theme.node.text }}>
                                {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className="truncate">{shot.desc || "—"}</span>
                        </div>
                    ))}
                    {meta.shots.length > 6 ? (
                        <span className="text-[10px] opacity-55" style={{ color: theme.node.muted }}>
                            +{meta.shots.length - 6} …
                        </span>
                    ) : null}
                </div>
            ) : (
                <span className="text-xs opacity-55" style={{ color: theme.node.muted }}>
                    {t("canvas.storyboard.openHint")}
                </span>
            )}
        </div>
    );
}

/* ---------------- 下挂编辑面板 ---------------- */
type StoryboardPanelProps = {
    node: CanvasNodeData;
    nodes: CanvasNodeData[];
    spawning: boolean;
    onChange: (nodeId: string, meta: StoryboardMeta) => void;
    onSpawn: (nodeId: string) => void;
    onGenerateShot: (nodeId: string, shotId: string) => void;
    onFocusNode: (nodeId: string) => void;
    onClose: () => void;
};

function shotPreview(nodes: CanvasNodeData[], shot: StoryboardShot): { url?: string; status?: string; isVideo?: boolean } | null {
    if (!shot.nodeId) return null;
    const node = nodes.find((item) => item.id === shot.nodeId);
    if (!node) return null;
    const meta = node.metadata || {};
    const primary = meta.images?.find((image) => image.id === meta.primaryImageId && image.status === "success") || meta.images?.find((image) => image.status === "success");
    return { url: primary?.content || meta.content, status: meta.status, isVideo: node.type === "video" };
}

export function StoryboardPanel({ node, nodes, spawning, onChange, onSpawn, onGenerateShot, onFocusNode, onClose }: StoryboardPanelProps) {
    const { t } = useTranslation();
    const meta = useMemo(() => readStoryboardMeta(node), [node]);
    const [draftTheme, setDraftTheme] = useState(meta.theme);
    const [draftModel, setDraftModel] = useState(meta.model);

    const commit = (next: Partial<StoryboardMeta>) => onChange(node.id, { ...meta, theme: draftTheme, model: draftModel, ...next });

    const previewBox = (shot: StoryboardShot, size: string) => {
        const preview = shotPreview(nodes, shot);
        return (
            <button
                type="button"
                className={`relative shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/30 ${size}`}
                onClick={() => shot.nodeId && onFocusNode(shot.nodeId)}
                title={preview?.url ? t("canvas.storyboard.focusShot") : t("canvas.storyboard.noPreview")}
            >
                {preview?.url ? (
                    preview.isVideo ? (
                        <video src={preview.url} muted playsInline className="h-full w-full object-cover" />
                    ) : (
                        <img src={preview.url} alt="" className="h-full w-full object-cover" draggable={false} />
                    )
                ) : (
                    <span className="grid h-full w-full place-items-center opacity-35">{meta.genMode === "video" ? <Film className="size-4" /> : <ImageIcon className="size-4" />}</span>
                )}
                {preview?.status === "loading" ? <span className="absolute inset-0 grid place-items-center bg-black/40 text-[10px] text-white">…</span> : null}
                {preview?.status === "error" ? <span className="absolute inset-0 grid place-items-center bg-red-500/30 text-[10px] text-white">!</span> : null}
            </button>
        );
    };

    return (
        <div
            className="w-[520px] rounded-2xl border p-4 shadow-2xl backdrop-blur"
            style={{ background: "var(--ant-color-bg-elevated, rgba(20,20,24,0.96))", borderColor: "rgba(128,128,140,0.25)" }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">{t("canvas.storyboard.panelTitle")}</span>
                <div className="flex items-center gap-1">
                    <Tooltip title={meta.view === "list" ? t("canvas.storyboard.gridView") : t("canvas.storyboard.listView")}>
                        <Button size="small" type="text" icon={meta.view === "list" ? <LayoutGrid className="size-3.5" /> : <Rows3 className="size-3.5" />} onClick={() => commit({ view: meta.view === "list" ? "grid" : "list" })} />
                    </Tooltip>
                    <Button size="small" type="text" onClick={onClose}>
                        ✕
                    </Button>
                </div>
            </div>
            <Input.TextArea
                value={draftTheme}
                placeholder={t("canvas.storyboard.themePlaceholder")}
                autoSize={{ minRows: 2, maxRows: 4 }}
                onChange={(event) => setDraftTheme(event.target.value)}
                onBlur={() => commit({})}
            />
            {/* 生成参数：分辨率 / 比例 / 宫格列数 / 模型（写入镜头节点，可在节点上继续调整） */}
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <Segmented size="small" value={meta.genMode} options={[{ value: "image", label: t("canvas.storyboard.modeImage") }, { value: "video", label: t("canvas.storyboard.modeVideo") }]} onChange={(value) => commit({ genMode: value as StoryboardGenMode })} />
                {meta.genMode === "image" ? <>
                    <Segmented size="small" value={meta.resolution} options={RESOLUTION_OPTIONS} onChange={(value) => commit({ resolution: value as StoryboardResolution })} />
                    <Segmented size="small" value={meta.quality} options={QUALITY_OPTIONS} onChange={(value) => commit({ quality: value as StoryboardMeta["quality"] })} />
                </> : <>
                    <Select size="small" className="w-20" value={meta.seconds} options={VIDEO_SECONDS_OPTIONS.map((value) => ({ value, label: `${value}s` }))} onChange={(value) => commit({ seconds: value })} />
                    <Segmented size="small" value={meta.videoQuality} options={QUALITY_OPTIONS} onChange={(value) => commit({ videoQuality: value as StoryboardMeta["videoQuality"] })} />
                    <Select size="small" className="w-24" value={meta.videoResolution} options={VIDEO_RESOLUTION_OPTIONS.map((value) => ({ value, label: value === "2160" ? "4K" : value === "1440" ? "2K" : `${value}p` }))} onChange={(value) => commit({ videoResolution: value })} />
                    <label className="inline-flex items-center gap-1.5 text-[11px] opacity-75">
                        <Switch size="small" checked={meta.generateAudio !== "false"} onChange={(checked) => commit({ generateAudio: String(checked) })} />
                        <span>{t("settingsPanels.video.generateAudio")}</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-[11px] opacity-75">
                        <Switch size="small" checked={meta.watermark === "true"} onChange={(checked) => commit({ watermark: String(checked) })} />
                        <span>{t("settingsPanels.video.watermark")}</span>
                    </label>
                </>}
                <Select size="small" className="w-20" value={meta.size} options={SIZE_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => commit({ size: value })} title={t("canvas.storyboard.sizeLabel")} />
                <span className="flex items-center gap-1 text-xs opacity-75">
                    {t("canvas.storyboard.columnsLabel")}
                    <Button size="small" type="text" disabled={meta.columns <= 1} onClick={() => commit({ columns: meta.columns - 1 })}>
                        −
                    </Button>
                    <span className="font-mono">{meta.columns}</span>
                    <Button size="small" type="text" disabled={meta.columns >= 9} onClick={() => commit({ columns: meta.columns + 1 })}>
                        +
                    </Button>
                </span>
                <Input
                    size="small"
                    className="min-w-28 flex-1"
                    value={draftModel}
                    placeholder={t("canvas.storyboard.modelPlaceholder")}
                    onChange={(event) => setDraftModel(event.target.value)}
                    onBlur={() => commit({})}
                />
            </div>
            {meta.view === "grid" ? (
                <div className="mt-3 grid max-h-80 grid-cols-3 gap-2 overflow-y-auto pr-1">
                    {meta.shots.map((shot, index) => (
                        <div key={shot.id} className="flex flex-col gap-1 rounded-lg border border-white/10 p-1.5">
                            {previewBox(shot, "aspect-video w-full")}
                            <Input.TextArea
                                defaultValue={shot.desc}
                                placeholder={t("canvas.storyboard.cellPlaceholder")}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                onBlur={(event) => {
                                    const shots = meta.shots.map((item) => (item.id === shot.id ? { ...item, desc: event.target.value } : item));
                                    commit({ shots });
                                }}
                            />
                            <div className="flex items-center gap-1">
                                <span className="shrink-0 rounded bg-yellow-500/15 px-1 font-mono text-[10px] font-bold text-yellow-500">{String(index + 1).padStart(2, "0")}</span>
                                <Button size="small" type="text" className="ml-auto" disabled={spawning || !shot.desc.trim()} icon={<Play className="size-3" />} onClick={() => onGenerateShot(node.id, shot.id)} />
                                <Button size="small" type="text" icon={<Trash2 className="size-3" />} onClick={() => commit({ shots: meta.shots.filter((item) => item.id !== shot.id) })} />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
                    {meta.shots.map((shot, index) => (
                        <div key={shot.id} className="flex items-start gap-2">
                            <span className="mt-1 shrink-0 rounded bg-yellow-500/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-yellow-500">{String(index + 1).padStart(2, "0")}</span>
                            {previewBox(shot, "h-14 w-14")}
                            <Input.TextArea
                                defaultValue={shot.desc}
                                placeholder={t("canvas.storyboard.shotPlaceholder")}
                                autoSize={{ minRows: 2, maxRows: 4 }}
                                onBlur={(event) => {
                                    const shots = meta.shots.map((item) => (item.id === shot.id ? { ...item, desc: event.target.value } : item));
                                    commit({ shots });
                                }}
                            />
                            <div className="flex flex-col">
                                <Tooltip title={t("canvas.storyboard.generateShot")}>
                                    <Button size="small" type="text" disabled={spawning || !shot.desc.trim()} icon={<Play className="size-3.5" />} onClick={() => onGenerateShot(node.id, shot.id)} />
                                </Tooltip>
                                <Button size="small" type="text" icon={<Trash2 className="size-3.5" />} onClick={() => commit({ shots: meta.shots.filter((item) => item.id !== shot.id) })} />
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => commit({ shots: [...meta.shots, { id: nanoid(6), desc: "" }] })}>
                    {t("canvas.storyboard.addShot")}
                </Button>
                <Button size="small" type="primary" loading={spawning} disabled={!meta.shots.some((shot) => shot.desc.trim())} icon={<Sparkles className="size-3.5" />} onClick={() => onSpawn(node.id)}>
                    {t("canvas.storyboard.spawn")}
                </Button>
            </div>
        </div>
    );
}
