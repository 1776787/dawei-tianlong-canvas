import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "antd";
import { CanvasNodePromptPanel } from "../../src/components/canvas/canvas-node-prompt-panel";
import { CanvasConfigNodePanel } from "../../src/components/canvas/canvas-config-node-panel";
import { applyNodeConfigPatch } from "../../src/lib/canvas/canvas-node-factory";
import { buildGenerationConfig } from "../../src/lib/canvas/canvas-generation-helpers";
import { useEffectiveConfig } from "../../src/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "../../src/types/canvas";
import "../../src/styles/globals.css";

const noop = () => {};
function Fixture() {
    const config = useEffectiveConfig();
    const [node, setNode] = useState<CanvasNodeData>({
        id: "settings-fixture", title: "Settings fixture",
        type: new URLSearchParams(location.search).get("type") === "config" ? CanvasNodeType.Config : CanvasNodeType.Image,
        position: { x: 0, y: 0 }, width: 500, height: 240,
        metadata: { quality: "low", resolution: "4k", size: "16:9", count: 1, prompt: "Fixture" },
    });
    const change = (_id: string, patch: Partial<CanvasNodeMetadata>) => setNode((current) => applyNodeConfigPatch(current, patch));
    const request = buildGenerationConfig(config, node, "image");
    return <App>
        <main style={{ minHeight: 1000, padding: "620px 16px 16px", background: "#181818" }}>
            <div style={{ width: 600, maxWidth: "100%", height: 240, background: "#242424" }}>
                {node.type === CanvasNodeType.Config
                    ? <CanvasConfigNodePanel node={node} isRunning={false} inputSummary={{ textCount: 0, imageCount: 0, videoCount: 0 }}
                        onConfigChange={change} onGenerate={noop} onStop={noop} onComposerToggle={noop} />
                    : <CanvasNodePromptPanel node={node} isRunning={false} onConfigChange={change}
                        onPromptChange={(id, prompt) => change(id, { prompt })} onGenerate={noop} onStop={noop} />}
            </div>
            <output style={{ display: "block", color: "white" }}>{JSON.stringify({
                storedQuality: node.metadata?.quality, storedResolution: node.metadata?.resolution,
                requestQuality: request.quality, requestResolution: request.resolution,
            })}</output>
        </main>
    </App>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
