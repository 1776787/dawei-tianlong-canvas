import React, { Profiler, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CanvasPage from "../../src/pages/canvas/project";
import { useCanvasStore } from "../../src/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "../../src/types/canvas";
import "../../src/styles/globals.css";

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const client = new QueryClient();
let reactMs = 0;
let reactCommits = 0;
const urls: string[] = [];

async function prepare() {
    if (!useCanvasStore.persist.hasHydrated()) {
        await new Promise<void>((resolve) => {
            const off = useCanvasStore.persist.onFinishHydration(() => { off(); resolve(); });
        });
    }
    // This fixture never persists its generated project or modifies a user's project.
    useCanvasStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
    const nodes: CanvasNodeData[] = [];
    for (let index = 0; index < 11; index++) {
        const image = new Image();
        image.src = `/prompt-covers/${String(index + 1).padStart(2, "0")}.webp`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 3840;
        canvas.height = 2160;
        canvas.getContext("2d")!.drawImage(image, 0, 0, 3840, 2160);
        const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/jpeg", 0.95));
        const url = URL.createObjectURL(blob);
        urls.push(url);
        canvas.width = canvas.height = 1;
        nodes.push({
            id: `perf-image-${index}`, title: `4K Image ${index + 1}`, type: CanvasNodeType.Image,
            position: { x: (index % 4) * 280, y: Math.floor(index / 4) * 210 },
            width: 260, height: 146.25,
            metadata: { content: url, naturalWidth: 3840, naturalHeight: 2160, mimeType: "image/jpeg", bytes: blob.size, status: "success" },
        });
    }
    return useCanvasStore.getState().importProject({
        title: "4K Performance Fixture", nodes, viewport: { x: 60, y: 60, k: 0.8 },
        connections: new URLSearchParams(location.search).has("connections") ? [
            { id: "perf-connection-1", fromNodeId: nodes[0].id, toNodeId: nodes[5].id },
            { id: "perf-connection-2", fromNodeId: nodes[5].id, toNodeId: nodes[10].id },
        ] : [],
    });
}

function Fixture({ id }: { id: string }) {
    const [result, setResult] = useState("Ready: full project, 11 x 3840x2160 images");
    async function run() {
        if (document.visibilityState !== "visible") return setResult("Frame-rate measurement requires a foreground page; background timing is invalid.");
        const first = document.querySelector('[data-node-id="perf-image-0"]')!;
        if (!first) return setResult("Wait for the project to load");
        const surface = first.closest(".origin-top-left")!.parentElement!;
        const rect = surface.getBoundingClientRect();
        const times: number[] = [];
        reactMs = reactCommits = 0;
        let last = await frame();
        for (let index = 0; index < 90; index++) {
            if (document.visibilityState !== "visible") return setResult("Measurement discarded: page was backgrounded.");
            surface.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: index < 45 ? -8 : 8, clientX: rect.left + 500, clientY: rect.top + 300 }));
            const now = await frame();
            times.push(now - last);
            last = now;
        }
        times.sort((a, b) => a - b);
        const images = Array.from(surface.querySelectorAll("img"));
        const pixels = images.reduce((sum, image) => sum + image.naturalWidth * image.naturalHeight, 0);
        setResult(JSON.stringify({
            frames: times.length, medianMs: +times[45].toFixed(1), p95Ms: +times[85].toFixed(1), maxMs: +times[89].toFixed(1),
            over32ms: times.filter((time) => time > 32).length, reactMs: +reactMs.toFixed(1), reactCommits,
            mountedImages: images.length, decodedRGBA_MiB: +(pixels * 4 / 1024 / 1024).toFixed(1),
        }));
    }
    function verify() {
        const project = useCanvasStore.getState().openProject(id)!;
        const images = Array.from(document.querySelectorAll<HTMLImageElement>("[data-node-id] img"));
        const sidebarImages = Array.from(document.querySelectorAll<HTMLImageElement>("aside img")).filter((image) => image.alt.startsWith("4K Image"));
        const all = [...images, ...sidebarImages];
        const failures: string[] = [];
        if (images.length !== 11) failures.push(`Expected 11 mounted images, got ${images.length}`);
        if (all.some((image) => !image.complete || image.naturalWidth !== 1024 || image.naturalHeight !== 576 || image.getAttribute("aria-busy") === "true")) failures.push("Previews not ready or not bounded");
        if (images.some((image) => sidebarImages.find((other) => other.alt === image.alt)?.src !== image.src)) failures.push("Sidebar did not share the cached preview");
        if (project.nodes.some((node, index) => node.metadata?.content !== urls[index] || node.metadata.naturalWidth !== 3840)) failures.push("Original media was modified");
        if (Array.from(document.querySelectorAll("svg")).some((svg) => svg.getBoundingClientRect().width >= 10000)) failures.push("Oversized SVG surface");
        const connectionPaths = document.querySelectorAll("[data-connection-id]");
        if (connectionPaths.length !== project.connections.length) failures.push("Connection paths missing");
        setResult(failures.length ? `FAIL: ${failures.join("; ")}` : `PASS: 11 bounded previews; shared sidebar cache; 3840x2160 originals unchanged; ${connectionPaths.length} connections; no oversized SVG surface.`);
    }
    async function verifyInteractions() {
        const first = document.querySelector<HTMLElement>('[data-node-id="perf-image-0"]');
        if (!first) return setResult("FAIL: project is not ready");
        const surface = first.closest(".origin-top-left")!.parentElement!;
        const rect = first.getBoundingClientRect();
        const initialTransform = first.style.transform;
        first.querySelector<HTMLElement>(".border-2")!.dispatchEvent(new MouseEvent("mousedown", {
            bubbles: true, button: 0, clientX: rect.left + 40, clientY: rect.top + 40,
        }));
        window.dispatchEvent(new MouseEvent("mousemove", { buttons: 1, clientX: rect.left + 120, clientY: rect.top + 40 }));
        await frame();
        await frame();
        const guides = Array.from(surface.querySelectorAll("svg")).filter((svg) => svg.classList.contains("z-[90]"));
        const bounded = guides.every((svg) => {
            const bounds = svg.getBoundingClientRect();
            const surfaceBounds = surface.getBoundingClientRect();
            return bounds.width <= surfaceBounds.width + 1 && bounds.height <= surfaceBounds.height + 1;
        });
        window.dispatchEvent(new MouseEvent("mouseup", { clientX: rect.left + 120, clientY: rect.top + 40 }));
        await frame();
        await frame();
        setResult(first.style.transform !== initialTransform && bounded
            ? `PASS: drag committed; ${guides.length} alignment surfaces bounded to viewport; connections retained.`
            : `FAIL: drag or alignment bounds: ${JSON.stringify({ initialTransform, finalTransform: first.style.transform, bounded, guides: guides.length, viewport: surface.getBoundingClientRect().toJSON() })}`);
    }
    async function verifyViewport() {
        const node = document.querySelector<HTMLElement>('[data-node-id="perf-image-0"]')!;
        const world = node.closest<HTMLElement>(".origin-top-left")!;
        const surface = world.parentElement!;
        const before = new DOMMatrix(getComputedStyle(world).transform);
        const rect = surface.getBoundingClientRect();
        reactMs = reactCommits = 0;
        for (let index = 0; index < 20; index++) {
            surface.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -10, clientX: rect.left + 100, clientY: rect.top + 100 }));
        }
        await frame();
        await frame();
        const after = new DOMMatrix(getComputedStyle(world).transform);
        const zoomMs = reactMs;
        const zoomCommits = reactCommits;
        const anchor = Math.abs((100 - after.e) / after.a - (100 - before.e) / before.a) < 0.001;
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const saved = useCanvasStore.getState().openProject(id)!.viewport;
        const pass = anchor && Math.abs(after.a / before.a - 1.21) < 0.001 && Math.abs(saved.k - after.a) < 0.001;
        setResult(`${pass ? "PASS" : "FAIL"}: 20 wheel events; zoom anchor; saved viewport; React ${zoomMs.toFixed(2)}ms across ${zoomCommits} commits.`);
    }
    return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <header style={{ padding: 8, display: "flex", flexWrap: "wrap", gap: 16, background: "white", color: "black" }}>
            <button onClick={() => void run()}>Measure full canvas</button>
            <button onClick={verify}>Verify previews</button><output>{result}</output>
            <button onClick={() => void verifyInteractions()}>Verify drag</button>
            <button onClick={() => void verifyViewport()}>Verify viewport</button>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>
            <ConfigProvider><App style={{ height: "100%" }}><QueryClientProvider client={client}>
                <MemoryRouter initialEntries={[`/canvas/${id}`]}><Profiler id="project" onRender={(_, phase, duration) => {
                    if (phase !== "mount") { reactMs += duration; reactCommits++; }
                }}><Routes><Route path="/canvas/:id" element={<CanvasPage />} /></Routes></Profiler></MemoryRouter>
            </QueryClientProvider></App></ConfigProvider>
        </div>
    </div>;
}

void prepare().then((id) => createRoot(document.getElementById("root")!).render(<Fixture id={id} />));
window.addEventListener("pagehide", () => urls.forEach((url) => URL.revokeObjectURL(url)));
