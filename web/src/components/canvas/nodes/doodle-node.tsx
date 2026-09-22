import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Modal, Slider, Tooltip } from "antd";
import { Brush, Eraser, PaintBucket, RotateCcw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasNodeData } from "@/types/canvas";

// 涂鸦节点（对应桥豆麻衣酱 doodle-canvas）：手绘草图/标注/构图参考。
// 画好的 PNG dataURL 存 metadata.content，通过 resource 声明为 image，
// 连接到下游图片/视频节点时会作为参考图参与生成。
export const DOODLE_TYPE = "doodle";

const BOARD_SIZE = 1024;
const COLORS = ["#111111", "#ffffff", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];

let registered = false;
export function registerDoodleNode() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions([
        {
            type: DOODLE_TYPE,
            title: i18n.t("canvas.nodeTypes.doodle"),
            icon: <Brush className="size-5" />,
            defaultSize: { width: 300, height: 300 },
            defaultMetadata: { status: "idle" },
            minimapColor: "#ec4899",
            autoOpenPanel: true,
            keepAspectRatio: () => true,
            resource: (node) => (node.metadata?.content ? { kind: "image", url: node.metadata.content } : null),
        },
    ]);
}

/* ---------------- 节点卡片内容 ---------------- */
export function DoodleNodeContent({ node, theme }: { node: CanvasNodeData; theme: CanvasTheme }) {
    const { t } = useTranslation();
    if (node.metadata?.content) {
        return <img src={node.metadata.content} alt={node.title} draggable={false} className="pointer-events-none h-full w-full rounded-[inherit] object-contain" style={{ background: "#ffffff" }} />;
    }
    return (
        <div className="pointer-events-none flex h-full w-full flex-col items-center justify-center gap-2 p-4" style={{ color: theme.node.muted }}>
            <Brush className="size-8 opacity-60" />
            <span className="text-xs opacity-70">{t("canvas.doodle.openHint")}</span>
        </div>
    );
}

/* ---------------- 画板弹窗 ---------------- */
type DoodleDialogProps = {
    node: CanvasNodeData;
    open: boolean;
    onClose: () => void;
    onSave: (nodeId: string, dataUrl: string) => void;
};

export function DoodleDialog({ node, open, onClose, onSave }: DoodleDialogProps) {
    const { t } = useTranslation();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const drawingRef = useRef(false);
    const lastRef = useRef<{ x: number; y: number } | null>(null);
    const undoRef = useRef<string[]>([]);
    const [color, setColor] = useState(COLORS[0]);
    const [lineWidth, setLineWidth] = useState(8);
    const [eraser, setEraser] = useState(false);
    const [canUndo, setCanUndo] = useState(false);

    const initBoard = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);
        const existing = node.metadata?.content;
        if (existing) {
            const image = new Image();
            image.onload = () => ctx.drawImage(image, 0, 0, BOARD_SIZE, BOARD_SIZE);
            image.src = existing;
        }
        undoRef.current = [];
        setCanUndo(false);
    }, [node.metadata?.content]);

    useEffect(() => {
        if (open) requestAnimationFrame(initBoard);
    }, [open, initBoard]);

    const boardPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        return { x: ((event.clientX - rect.left) / rect.width) * BOARD_SIZE, y: ((event.clientY - rect.top) / rect.height) * BOARD_SIZE };
    };

    const pushUndo = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        undoRef.current = [...undoRef.current.slice(-14), canvas.toDataURL("image/png")];
        setCanUndo(true);
    };

    const handleDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        event.preventDefault();
        (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
        pushUndo();
        drawingRef.current = true;
        lastRef.current = boardPoint(event);
        handleMove(event);
    };

    const handleMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!ctx) return;
        const point = boardPoint(event);
        const last = lastRef.current || point;
        ctx.strokeStyle = eraser ? "#ffffff" : color;
        ctx.lineWidth = eraser ? lineWidth * 3 : lineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(last.x, last.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
        lastRef.current = point;
    };

    const handleUp = () => {
        drawingRef.current = false;
        lastRef.current = null;
    };

    const undo = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        const snapshot = undoRef.current.pop();
        if (!ctx || !snapshot) return;
        const image = new Image();
        image.onload = () => ctx.drawImage(image, 0, 0, BOARD_SIZE, BOARD_SIZE);
        image.src = snapshot;
        setCanUndo(undoRef.current.length > 0);
    };

    const clearBoard = () => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        pushUndo();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, BOARD_SIZE, BOARD_SIZE);
    };

    const save = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        onSave(node.id, canvas.toDataURL("image/png"));
        onClose();
    };

    return (
        <Modal open={open} onCancel={onClose} onOk={save} okText={t("canvas.doodle.save")} title={t("canvas.doodle.title")} width={680} centered destroyOnClose>
            <div className="flex flex-col gap-3 py-1" data-canvas-no-zoom>
                <div className="flex flex-wrap items-center gap-2">
                    {COLORS.map((item) => (
                        <button
                            key={item}
                            type="button"
                            className="size-6 rounded-full border-2 transition-transform hover:scale-110"
                            style={{ background: item, borderColor: !eraser && color === item ? "#3b82f6" : "rgba(128,128,140,0.35)" }}
                            onClick={() => {
                                setColor(item);
                                setEraser(false);
                            }}
                        />
                    ))}
                    <Tooltip title={t("canvas.doodle.brush")}>
                        <Button size="small" type={!eraser ? "primary" : "default"} icon={<PaintBucket className="size-3.5" />} onClick={() => setEraser(false)} />
                    </Tooltip>
                    <Tooltip title={t("canvas.doodle.eraser")}>
                        <Button size="small" type={eraser ? "primary" : "default"} icon={<Eraser className="size-3.5" />} onClick={() => setEraser(true)} />
                    </Tooltip>
                    <div className="flex w-36 items-center gap-2">
                        <span className="text-xs opacity-60">{t("canvas.doodle.size")}</span>
                        <Slider className="flex-1" min={2} max={48} value={lineWidth} onChange={setLineWidth} />
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                        <Tooltip title={t("canvas.doodle.undo")}>
                            <Button size="small" type="text" disabled={!canUndo} icon={<RotateCcw className="size-3.5" />} onClick={undo} />
                        </Tooltip>
                        <Tooltip title={t("canvas.doodle.clear")}>
                            <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={clearBoard} />
                        </Tooltip>
                    </div>
                </div>
                <canvas
                    ref={canvasRef}
                    width={BOARD_SIZE}
                    height={BOARD_SIZE}
                    className="aspect-square w-full cursor-crosshair touch-none rounded-lg border"
                    style={{ borderColor: "rgba(128,128,140,0.3)", background: "#ffffff" }}
                    onPointerDown={handleDown}
                    onPointerMove={handleMove}
                    onPointerUp={handleUp}
                    onPointerLeave={handleUp}
                />
                <span className="text-xs opacity-50">{t("canvas.doodle.hint")}</span>
            </div>
        </Modal>
    );
}
