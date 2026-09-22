import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { App, ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios from "axios";
import CanvasPage from "../../src/pages/canvas/project";
import { useCanvasStore } from "../../src/stores/canvas/use-canvas-store";
import { defaultConfig, useConfigStore } from "../../src/stores/use-config-store";
import { useGenerationHistoryStore } from "../../src/stores/canvas/use-generation-history-store";
import { CanvasNodeType } from "../../src/types/canvas";
import "../../src/styles/globals.css";

const pending: { resolve: (response: Response) => void; reject: (error: unknown) => void }[] = [];
const realFetch = window.fetch.bind(window);
let apiCalls = 0;
let downloads = 0;
let lastModel = "";
let notify = () => {};
// Only the synthetic result is delayed. No API call leaves this fixture.
window.fetch = (input, init) => {
    if (String(input) !== "/prompt-covers/01.webp") return realFetch(input, init);
    downloads++;
    return new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        notify();
    });
};
axios.defaults.adapter = async config => {
    apiCalls++;
    lastModel = config.data instanceof FormData ? String(config.data.get("model")) : JSON.parse(config.data).model;
    notify();
    return { data: { data: [{ url: "/prompt-covers/01.webp" }] }, status: 200, statusText: "OK", headers: {}, config };
};
const client = new QueryClient();
async function prepare() {
    if (!useCanvasStore.persist.hasHydrated()) {
        await new Promise<void>(resolve => {
            const off = useCanvasStore.persist.onFinishHydration(() => { off(); resolve(); });
        });
    }
    const memory = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    useCanvasStore.persist.setOptions({ storage: memory });
    useConfigStore.persist.setOptions({ storage: memory });
    useGenerationHistoryStore.persist.setOptions({ storage: memory });
    useConfigStore.setState({ config: {
        ...defaultConfig, channelMode: "local", apiKey: "fixture", baseUrl: "https://fixture.invalid",
        model: "fixture::gpt-image-2.5-sunburst", imageModel: "fixture::gpt-image-2.5-sunburst",
        models: ["fixture::gpt-image-2.5-sunburst"],
        channels: [{ id: "fixture", name: "GPT fixture", baseUrl: "https://fixture.invalid", apiKey: "fixture", apiFormat: "openai",
            models: [{ name: "gpt-image-2.5-sunburst", capability: "image" }] }], canvasImageCount: "1",
    } });
    return useCanvasStore.getState().importProject({
        title: "Image Receive Fixture", viewport: { x: 30, y: 30, k: 1 },
        nodes: [{
            id: "receive-source", title: "Fixture", type: CanvasNodeType.Config,
            position: { x: 0, y: 0 }, width: 360, height: 260,
            metadata: { generationMode: "image", prompt: "Fixture image", count: Number(new URLSearchParams(location.search).get("count") || 1) },
        }],
        connections: [],
    });
}
function Fixture({ id }: { id: string }) {
    const [, render] = useState(0);
    notify = () => render(count => count + 1);
    const project = useCanvasStore(state => state.projects.find(item => item.id === id));
    return <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <header style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: 8, background: "white", color: "black" }}>
            <button onClick={() => { pending.shift()?.resolve(new Response("offline", { status: 503 })); notify(); }}>Fail download</button>
            <button onClick={async () => { const response = await realFetch("/prompt-covers/01.webp"); pending.shift()?.resolve(response); notify(); }}>Complete download</button>
            <output>{JSON.stringify({ apiCalls, downloads, lastModel, pending: pending.length, nodes: project?.nodes.map(node => ({
                id: node.id, status: node.metadata?.status, hasImage: Boolean(node.metadata?.content),
                receiving: Boolean(node.metadata?.pendingImageUrl || node.metadata?.images?.some(image => image.pendingImageUrl)),
                images: node.metadata?.images?.map(image => ({ status: image.status, saved: Boolean(image.storageKey) })),
            })) })}</output>
        </header>
        <div style={{ flex: 1, minHeight: 0 }}>
            <ConfigProvider><App style={{ height: "100%" }}><QueryClientProvider client={client}>
                <MemoryRouter initialEntries={[`/canvas/${id}`]}><Routes><Route path="/canvas/:id" element={<CanvasPage />} /></Routes></MemoryRouter>
            </QueryClientProvider></App></ConfigProvider>
        </div>
    </div>;
}
void prepare().then(id => createRoot(document.getElementById("root")!).render(<Fixture id={id} />));
