import React, { Profiler, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { AtelierCanvas } from "../../src/components/canvas/atelier-canvas";
import { CanvasNode } from "../../src/components/canvas/canvas-node";
import { CanvasNodeType, type CanvasNodeData } from "../../src/types/canvas";
import "../../src/styles/globals.css";

const noop = () => {};
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const durations = new Map<string, number>();
let commits = 0;
const initialNodes: CanvasNodeData[] = Array.from({ length: 11 }, (_, index) => ({
    id: `image-${index}`, title: `Image ${index + 1}`, type: CanvasNodeType.Image,
    position: { x: 30 + (index % 4) * 250, y: 45 + Math.floor(index / 4) * 210 },
    width: 220, height: 180,
    metadata: { content: `/prompt-covers/${String(index + 1).padStart(2, "0")}.webp` },
}));

function Fixture() {
    const [nodes, setNodes] = useState(initialNodes);
    const [viewport, setViewport] = useState({ x: 0, y: 0, k: 1 });
    const [result, setResult] = useState("Ready: 11 image nodes");
    const viewportRef = useRef(viewport);
    const containerRef = useRef<HTMLDivElement>(null);
    const getScale = useCallback(() => viewportRef.current.k, []);
    useLayoutEffect(() => { viewportRef.current = viewport; }, [viewport]);
    const onViewportChange = useCallback((next: typeof viewport) => {
        commits++;
        setViewport(next);
    }, []);
    const resize = useCallback((id: string, width: number, height: number) => {
        setNodes((prev) => prev.map((node) => node.id === id ? { ...node, width, height } : node));
    }, []);

    async function run() {
        try {
            flushSync(() => { setNodes(initialNodes); setViewport({ x: 0, y: 0, k: 1 }); });
            await frame();
            durations.clear();
            for (let step = 1; step <= 30; step++) {
                flushSync(() => setNodes((prev) => prev.map((node, index) =>
                    index === 0 ? { ...node, position: { x: 30 + step, y: 45 } } : node)));
                await frame();
            }
            const untouchedRenderTime = [...durations].filter(([id]) => id !== "image-0").reduce((sum, [, duration]) => sum + duration, 0);
            if (untouchedRenderTime > 1) throw new Error(`Unchanged nodes rendered: ${untouchedRenderTime.toFixed(2)}ms`);
            durations.clear();
            commits = 0;
            const container = containerRef.current!;
            const rect = container.getBoundingClientRect();
            for (let index = 0; index < 20; index++) {
                container.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -10, clientX: rect.left + 400, clientY: rect.top + 300 }));
            }
            await frame();
            await frame();
            if (commits !== 1) throw new Error(`Expected one zoom commit, got ${commits}`);
            const expected = Math.pow(1.1, 2);
            if (Math.abs(viewportRef.current.k - expected) > 1e-8) throw new Error("Wheel deltas were dropped");
            if (Math.abs((400 - viewportRef.current.x) / viewportRef.current.k - 400) > 1e-8) throw new Error("Zoom anchor moved");
            const zoomRenderTime = [...durations.values()].reduce((sum, duration) => sum + duration, 0);
            if (zoomRenderTime > 1) throw new Error(`Zoom rendered nodes: ${zoomRenderTime.toFixed(2)}ms`);
            const node = container.querySelector('[data-node-id="image-0"]')!;
            const handle = node.querySelector(".cursor-nwse-resize")!;
            handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100, clientY: 100 }));
            window.dispatchEvent(new MouseEvent("mousemove", { clientX: 100 - 121, clientY: 100 - 99 }));
            window.dispatchEvent(new MouseEvent("mouseup"));
            await frame();
            await frame();
            if (Math.abs(parseFloat((node as HTMLElement).style.width) - 320) > 0.01) throw new Error("Resize used stale zoom");
            setResult(`PASS: 11 images; 30 moves, unchanged-node render time ${untouchedRenderTime.toFixed(2)}ms; 20 wheel events -> 1 commit; zoom render time ${zoomRenderTime.toFixed(2)}ms; anchor and resize correct.`);
        } catch (error) {
            setResult(`FAIL: ${String(error)}`);
        }
    }

    return <div>
        <header style={{ padding: 12, display: "flex", gap: 16 }}>
            <button onClick={() => void run()}>Run regression</button><output>{result}</output>
        </header>
        <div style={{ height: 740 }}>
            <AtelierCanvas containerRef={containerRef} viewport={viewport} tool="pan" onViewportChange={onViewportChange}>
                {nodes.map((node) => <Profiler key={node.id} id={node.id} onRender={(id, phase, duration) => {
                    if (phase !== "mount") durations.set(id, (durations.get(id) || 0) + duration);
                }}>
                    <CanvasNode data={node} getScale={getScale} isSelected={false} isRelated={false}
                        isFocusRelated={false} isConnectionTarget={false} isConnecting={false}
                        showPanel={false} showImageInfo={false} onMouseDown={noop} onHoverStart={noop}
                        onHoverEnd={noop} onConnectStart={noop} onResizeStart={noop} onResize={resize}
                        onResizeEnd={noop} onContentChange={noop} onTitleChange={noop} onContextMenu={noop} />
                </Profiler>)}
            </AtelierCanvas>
        </div>
    </div>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
