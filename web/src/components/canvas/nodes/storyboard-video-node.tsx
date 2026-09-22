import { useMemo, useRef, useState } from "react";
import { Button, Input, Select, Segmented, Switch, Tooltip } from "antd";
import { Film, FolderOpen, Images, Play, Plus, Sparkles, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import type { CanvasTheme } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

// 分镜视表（对齐桥豆麻衣酱分镜表）：手动添加空白镜头，为每个镜头挑选参考图
// （画布图片节点或本地上传），编写视频提示词（可用 @1/@2 引用参考图），
// 用视频模型逐镜头或一键生成分镜视频。数据 JSON 存 metadata.content。
export const SHOT_VIDEO_TYPE = "storyboard-video";

export type ShotVideoShot = { id: string; prompt: string; refs: string[]; nodeId?: string };
export type ShotVideoMeta = {
    shots: ShotVideoShot[];
    seconds: string;
    size: string;
    model: string;
    quality: "auto" | "high" | "medium" | "low";
    resolution: string;
    generateAudio: string;
    watermark: string;
};

const SIZE_OPTIONS = ["auto", "16:9", "9:16", "1:1", "4:3", "3:4"];
const SECONDS_OPTIONS = ["4", "6", "8", "10", "12"];
const QUALITY_OPTIONS = ["auto", "high", "medium", "low"] as const;
const RESOLUTION_OPTIONS = ["480", "720", "1080", "1440", "2160"];

export function readShotVideoMeta(node: CanvasNodeData): ShotVideoMeta {
    try {
        const parsed = JSON.parse(node.metadata?.content || "") as Partial<ShotVideoMeta>;
        return {
            shots: Array.isArray(parsed.shots)
                ? parsed.shots
                      .filter((shot): shot is ShotVideoShot => Boolean(shot && typeof shot.prompt === "string"))
                      .map((shot) => ({
                          id: shot.id || nanoid(6),
                          prompt: shot.prompt,
                          refs: Array.isArray(shot.refs) ? shot.refs.filter((ref): ref is string => typeof ref === "string") : [],
                          ...(typeof shot.nodeId === "string" ? { nodeId: shot.nodeId } : {}),
                      }))
                : [],
            seconds: typeof parsed.seconds === "string" && parsed.seconds ? parsed.seconds : "6",
            size: typeof parsed.size === "string" && parsed.size ? parsed.size : "auto",
            model: typeof parsed.model === "string" ? parsed.model : "",
            quality: parsed.quality === "high" || parsed.quality === "medium" || parsed.quality === "low" ? parsed.quality : "auto",
            resolution: typeof parsed.resolution === "string" && parsed.resolution ? parsed.resolution : "720",
            generateAudio: parsed.generateAudio === "false" || node.metadata?.generateAudio === "false" ? "false" : "true",
            watermark: parsed.watermark === "true" || node.metadata?.watermark === "true" ? "true" : "false",
        };
    } catch {
        return { shots: [], seconds: "6", size: "auto", model: "", quality: "auto", resolution: "720", generateAudio: "true", watermark: "false" };
    }
}

export function writeShotVideoMeta(node: CanvasNodeData, meta: ShotVideoMeta): CanvasNodeData {
    return { ...node, metadata: { ...node.metadata, content: JSON.stringify(meta) } };
}

// @1/@2 → 参考图标注（与生成时参考图顺序一致）
export function composeShotVideoPrompt(shot: ShotVideoShot) {
    return shot.prompt.replace(/@(\d+)/g, (match, digits: string) => {
        const index = Number(digits) - 1;
        return index >= 0 && index < shot.refs.length ? imageReferenceLabel(index) : match;
    });
}

let registered = false;
export function registerShotVideoNode() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions([
        {
            type: SHOT_VIDEO_TYPE,
            title: i18n.t("canvas.nodeTypes.shotVideo"),
            icon: <Film className="size-5" />,
            defaultSize: { width: 620, height: 520 },
            defaultMetadata: { content: JSON.stringify({ shots: [] }), status: "idle" },
            minimapColor: "#38bdf8",
            hidePanel: true,
        },
    ]);
}

/* ---------------- 节点卡片内容 ---------------- */
export function ShotVideoNodeContent({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    const { t } = useTranslation();
    const meta = useMemo(() => readShotVideoMeta(node), [node]);
    return (
        <div className="pointer-events-none flex h-full w-full flex-col gap-2 overflow-hidden p-4">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: theme.node.text }}>
                <Film className="size-4" />
                <span className="truncate">{t("canvas.nodeTypes.shotVideo")}</span>
                <span className="text-xs font-normal opacity-55">{t("canvas.shotVideo.shotCount", { count: meta.shots.length })}</span>
            </div>
            {meta.shots.length ? (
                <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
                    {meta.shots.slice(0, 6).map((shot, index) => (
                        <div key={shot.id} className="flex items-start gap-2 text-xs" style={{ color: theme.node.muted }}>
                            <span className="shrink-0 rounded px-1 font-mono text-[10px] leading-4" style={{ background: theme.toolbar.activeBg, color: theme.node.text }}>
                                {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className="truncate">{shot.prompt || "—"}</span>
                            {shot.refs.length ? <span className="shrink-0 text-[10px] opacity-60">@{shot.refs.length}</span> : null}
                        </div>
                    ))}
                </div>
            ) : (
                <span className="text-xs opacity-55" style={{ color: theme.node.muted }}>
                    {t("canvas.shotVideo.openHint")}
                </span>
            )}
        </div>
    );
}

/* ---------------- 主节点编辑器 ---------------- */
type ShotVideoNodeEditorProps = {
    node: CanvasNodeData;
    nodes: CanvasNodeData[];
    spawning: boolean;
    onChange: (nodeId: string, meta: ShotVideoMeta) => void;
    onSpawn: (nodeId: string, shotIds?: string[]) => void;
    onFocusNode: (nodeId: string) => void;
    onUploadRef: (file: File) => Promise<string | null>;
};

function nodeImageUrl(node: CanvasNodeData | undefined): string | undefined {
    if (!node) return undefined;
    const meta = node.metadata || {};
    const primary = meta.images?.find((image) => image.id === meta.primaryImageId && image.status === "success") || meta.images?.find((image) => image.status === "success");
    return primary?.content || meta.content;
}

export function ShotVideoNodeEditor({ node, nodes, spawning, onChange, onSpawn, onFocusNode, onUploadRef }: ShotVideoNodeEditorProps) {
    const { t } = useTranslation();
    const meta = useMemo(() => readShotVideoMeta(node), [node]);
    const [draftModel, setDraftModel] = useState(meta.model);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [pickerShotId, setPickerShotId] = useState<string | null>(null);
    const [atPickerShotId, setAtPickerShotId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const uploadShotIdRef = useRef<string | null>(null);

    const commit = (next: Partial<ShotVideoMeta>) => onChange(node.id, { ...meta, model: draftModel, ...next });
    const patchShot = (shotId: string, patch: Partial<ShotVideoShot>) => commit({ shots: meta.shots.map((shot) => (shot.id === shotId ? { ...shot, ...patch } : shot)) });
    const draftOf = (shot: ShotVideoShot) => drafts[shot.id] ?? shot.prompt;

    // 在刚输入的 @ 处插入参考图编号；refId 若尚未在参考列表中则先加入
    const insertAtReference = (shotId: string, refId: string) => {
        const shot = meta.shots.find((item) => item.id === shotId);
        if (!shot) return;
        const existingIndex = shot.refs.indexOf(refId);
        const refIndex = existingIndex >= 0 ? existingIndex : shot.refs.length;
        const refs = existingIndex >= 0 ? shot.refs : [...shot.refs, refId];
        const text = drafts[shotId] ?? shot.prompt;
        const at = text.lastIndexOf("@");
        const next = at >= 0 ? `${text.slice(0, at)}@${refIndex + 1} ${text.slice(at + 1)}` : `${text}@${refIndex + 1} `;
        setDrafts((prev) => ({ ...prev, [shotId]: next }));
        commit({ shots: meta.shots.map((item) => (item.id === shotId ? { ...item, refs, prompt: next } : item)) });
        setAtPickerShotId(null);
    };

    // 画布中可作参考图的节点（图片/涂鸦，且已有内容）
    const canvasImages = useMemo(() => nodes.filter((item) => (item.type === CanvasNodeType.Image || item.type === "doodle") && nodeImageUrl(item)), [nodes]);

    const addRefFromCanvas = (shotId: string, refId: string) => {
        const shot = meta.shots.find((item) => item.id === shotId);
        if (!shot || shot.refs.includes(refId)) return;
        patchShot(shotId, { refs: [...shot.refs, refId] });
    };

    const handleUpload = async (file: File) => {
        const shotId = uploadShotIdRef.current;
        if (!shotId) return;
        const refId = await onUploadRef(file);
        const shot = readShotVideoMeta(node).shots.find((item) => item.id === shotId) || meta.shots.find((item) => item.id === shotId);
        if (refId && shot) patchShot(shotId, { refs: [...shot.refs, refId] });
    };

    const videoPreview = (shot: ShotVideoShot) => {
        const target = shot.nodeId ? nodes.find((item) => item.id === shot.nodeId) : undefined;
        const url = target?.metadata?.content;
        const status = target?.metadata?.status;
        return (
            <button
                type="button"
                className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/30"
                onClick={() => shot.nodeId && onFocusNode(shot.nodeId)}
                title={url ? t("canvas.storyboard.focusShot") : t("canvas.storyboard.noPreview")}
            >
                {url ? <video src={url} muted playsInline className="h-full w-full object-cover" /> : <span className="grid h-full w-full place-items-center opacity-35"><Film className="size-4" /></span>}
                {status === "loading" ? <span className="absolute inset-0 grid place-items-center bg-black/40 text-[10px] text-white">…</span> : null}
                {status === "error" ? <span className="absolute inset-0 grid place-items-center bg-red-500/30 text-[10px] text-white">!</span> : null}
            </button>
        );
    };

    return (
        <div
            data-canvas-no-zoom
            className="flex h-full w-full flex-col overflow-hidden p-3"
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
                    <Film className="size-4" />
                    <span className="truncate">{t("canvas.shotVideo.panelTitle")}</span>
                    <span className="shrink-0 text-[11px] font-normal opacity-50">{t("canvas.shotVideo.shotCount", { count: meta.shots.length })}</span>
                </span>
                <Button size="small" type="primary" loading={spawning} disabled={!meta.shots.some((shot) => shot.prompt.trim())} icon={<Sparkles className="size-3.5" />} onClick={() => onSpawn(node.id)}>
                    {t("canvas.shotVideo.spawnAll")}
                </Button>
            </div>
            {/* 生成参数 */}
            <div className="flex flex-wrap items-center gap-2">
                <Select size="small" className="w-20" value={meta.seconds} options={SECONDS_OPTIONS.map((value) => ({ value, label: `${value}s` }))} onChange={(value) => commit({ seconds: value })} title={t("canvas.storyboard.secondsLabel")} />
                <Select size="small" className="w-20" value={meta.size} options={SIZE_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => commit({ size: value })} title={t("canvas.storyboard.sizeLabel")} />
                <Segmented size="small" value={meta.quality} options={QUALITY_OPTIONS.map((value) => ({ value, label: value }))} onChange={(value) => commit({ quality: value as ShotVideoMeta["quality"] })} />
                <Select size="small" className="w-24" value={meta.resolution} options={RESOLUTION_OPTIONS.map((value) => ({ value, label: value === "2160" ? "4K" : value === "1440" ? "2K" : `${value}p` }))} onChange={(value) => commit({ resolution: value })} title="Resolution" />
                <label className="inline-flex items-center gap-1.5 text-[11px] opacity-75">
                    <Switch size="small" checked={meta.generateAudio !== "false"} onChange={(checked) => commit({ generateAudio: String(checked) })} />
                    <span>{t("settingsPanels.video.generateAudio")}</span>
                </label>
                <label className="inline-flex items-center gap-1.5 text-[11px] opacity-75">
                    <Switch size="small" checked={meta.watermark === "true"} onChange={(checked) => commit({ watermark: String(checked) })} />
                    <span>{t("settingsPanels.video.watermark")}</span>
                </label>
                <Input size="small" className="min-w-28 flex-1" value={draftModel} placeholder={t("canvas.shotVideo.modelPlaceholder")} onChange={(event) => setDraftModel(event.target.value)} onBlur={() => commit({})} />
            </div>
            {/* 镜头列表 */}
            <div className="thin-scrollbar mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain pr-1">
                {!meta.shots.length ? (
                    <button
                        type="button"
                        className="grid min-h-32 flex-1 place-items-center rounded-lg border border-dashed border-white/15 text-xs opacity-60 transition hover:border-sky-400/50 hover:opacity-100"
                        onClick={() => commit({ shots: [{ id: nanoid(6), prompt: "", refs: [] }] })}
                    >
                        <span className="flex items-center gap-1.5"><Plus className="size-4" />{t("canvas.shotVideo.addShot")}</span>
                    </button>
                ) : null}
                {meta.shots.map((shot, index) => (
                    <div key={shot.id} className="rounded-lg border border-white/10 p-2.5">
                        <div className="flex flex-wrap items-start gap-2">
                            <span className="mt-1 shrink-0 rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-sky-400">{String(index + 1).padStart(2, "0")}</span>
                            {videoPreview(shot)}
                            <Input.TextArea
                                value={draftOf(shot)}
                                placeholder={t("canvas.shotVideo.promptPlaceholder")}
                                autoSize={{ minRows: 3, maxRows: 6 }}
                                onChange={(event) => {
                                    const value = event.target.value;
                                    const previous = draftOf(shot);
                                    setDrafts((prev) => ({ ...prev, [shot.id]: value }));
                                    // 刚输入 @ 时自动弹出参考图选择
                                    if (value.length === previous.length + 1 && value.endsWith("@")) setAtPickerShotId(shot.id);
                                }}
                                onBlur={(event) => patchShot(shot.id, { prompt: event.target.value })}
                            />
                            <div className="flex flex-col">
                                <Tooltip title={t("canvas.shotVideo.generateShot")}>
                                    <Button aria-label={t("canvas.shotVideo.generateShot")} size="small" type="text" disabled={spawning || !shot.prompt.trim()} icon={<Play className="size-3.5" />} onClick={() => onSpawn(node.id, [shot.id])} />
                                </Tooltip>
                                <Button aria-label={t("common.delete")} size="small" type="text" icon={<Trash2 className="size-3.5" />} onClick={() => commit({ shots: meta.shots.filter((item) => item.id !== shot.id) })} />
                            </div>
                        </div>
                        {/* 参考图条 */}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {shot.refs.map((refId, refIndex) => {
                                const refNode = nodes.find((item) => item.id === refId);
                                const url = nodeImageUrl(refNode);
                                return (
                                    <span key={refId} className="group relative">
                                        <button type="button" className="block size-10 overflow-hidden rounded-md border border-white/15 bg-black/30" onClick={() => onFocusNode(refId)} title={`@${refIndex + 1} ${refNode?.title || ""}`}>
                                            {url ? <img src={url} alt="" className="h-full w-full object-cover" draggable={false} /> : <span className="grid h-full w-full place-items-center text-[10px] opacity-40">?</span>}
                                        </button>
                                        <span className="absolute -left-1 -top-1 rounded bg-sky-500 px-0.5 font-mono text-[9px] font-bold text-white">@{refIndex + 1}</span>
                                        <button
                                            type="button"
                                            className="absolute -right-1 -top-1 hidden rounded-full bg-red-500 p-0.5 text-white group-hover:block"
                                            onClick={() => patchShot(shot.id, { refs: shot.refs.filter((item) => item !== refId) })}
                                        >
                                            <X className="size-2.5" />
                                        </button>
                                    </span>
                                );
                            })}
                            <Tooltip title={t("canvas.shotVideo.pickFromCanvas")}>
                                <Button
                                    aria-label={t("canvas.shotVideo.pickFromCanvas")}
                                    size="small"
                                    type={pickerShotId === shot.id ? "primary" : "default"}
                                    icon={<Images className="size-3" />}
                                    onClick={() => {
                                        setAtPickerShotId(null);
                                        setPickerShotId((current) => (current === shot.id ? null : shot.id));
                                    }}
                                />
                            </Tooltip>
                            <Tooltip title={t("canvas.shotVideo.uploadRef")}>
                                <Button
                                    aria-label={t("canvas.shotVideo.uploadRef")}
                                    size="small"
                                    icon={<FolderOpen className="size-3" />}
                                    onClick={() => {
                                        uploadShotIdRef.current = shot.id;
                                        fileInputRef.current?.click();
                                    }}
                                />
                            </Tooltip>
                        </div>
                        {pickerShotId === shot.id ? (
                            <div className="mt-2 rounded-md border border-white/10 bg-black/10 p-2">
                                <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium opacity-70">
                                    <span>{t("canvas.shotVideo.pickFromCanvas")}</span>
                                    <button type="button" onClick={() => setPickerShotId(null)} aria-label={t("common.close")}><X className="size-3" /></button>
                                </div>
                                {canvasImages.length ? (
                                    <div className="grid max-h-40 grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5 overflow-y-auto">
                                        {canvasImages.map((item) => (
                                            <button
                                                key={item.id}
                                                type="button"
                                                className="overflow-hidden rounded-md border border-white/10 bg-black/20 text-left transition hover:border-sky-400/60"
                                                onClick={() => {
                                                    addRefFromCanvas(shot.id, item.id);
                                                    setPickerShotId(null);
                                                }}
                                            >
                                                <img src={nodeImageUrl(item)} alt={item.title} className="aspect-square w-full object-cover" draggable={false} />
                                                <span className="block truncate px-1 py-0.5 text-[9px] opacity-70">{item.title}</span>
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-5 text-center text-xs opacity-55">{t("canvas.shotVideo.noCanvasImages")}</div>
                                )}
                            </div>
                        ) : null}
                        {atPickerShotId === shot.id ? (
                            <div className="mt-2 rounded-md border border-sky-400/20 bg-sky-500/5 p-2">
                                <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium opacity-70">
                                    <span>{t("canvas.shotVideo.atPickerTitle")}</span>
                                    <button type="button" onClick={() => setAtPickerShotId(null)} aria-label={t("common.close")}><X className="size-3" /></button>
                                </div>
                                {[...shot.refs, ...canvasImages.map((item) => item.id).filter((id) => !shot.refs.includes(id))].length ? (
                                    <div className="grid max-h-40 grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5 overflow-y-auto">
                                        {[...shot.refs, ...canvasImages.map((item) => item.id).filter((id) => !shot.refs.includes(id))].map((refId) => {
                                            const refNode = nodes.find((item) => item.id === refId);
                                            const url = nodeImageUrl(refNode);
                                            const existingIndex = shot.refs.indexOf(refId);
                                            return (
                                                <button key={refId} type="button" className="relative overflow-hidden rounded-md border border-white/10 bg-black/20 text-left transition hover:border-sky-400/60" onClick={() => insertAtReference(shot.id, refId)}>
                                                    {url ? <img src={url} alt={refNode?.title || ""} className="aspect-square w-full object-cover" draggable={false} /> : <span className="grid aspect-square w-full place-items-center text-xs opacity-40">?</span>}
                                                    {existingIndex >= 0 ? <span className="absolute left-1 top-1 rounded bg-sky-500 px-1 font-mono text-[9px] font-bold text-white">@{existingIndex + 1}</span> : null}
                                                    <span className="block truncate px-1 py-0.5 text-[9px] opacity-70">{refNode?.title || refId}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="py-5 text-center text-xs opacity-55">{t("canvas.shotVideo.noCanvasImages")}</div>
                                )}
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>
            {/* 添加空白镜头 */}
            <div className="mt-3 flex items-center justify-start gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={() => commit({ shots: [...meta.shots, { id: nanoid(6), prompt: "", refs: [] }] })}>
                    {t("canvas.shotVideo.addShot")}
                </Button>
            </div>
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleUpload(file);
                    event.target.value = "";
                }}
            />
        </div>
    );
}
