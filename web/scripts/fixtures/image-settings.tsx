import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ImageSettingsPanel } from "../../src/components/image-settings-panel";
import { canvasThemes } from "../../src/lib/canvas-theme";
import { defaultConfig, type AiConfig } from "../../src/stores/use-config-store";
import "../../src/styles/globals.css";
import "antd/dist/reset.css";

function Fixture() {
    const [config, setConfig] = useState<AiConfig>({
        ...defaultConfig, quality: "high", resolution: "4k",
        size: new URLSearchParams(location.search).get("size") || "16:9", count: "1",
    });
    const theme = canvasThemes.dark;
    return (
        <main style={{ background: theme.node.panel, color: theme.node.text, minHeight: "100vh", padding: 16 }}>
            <div style={{ maxWidth: 320 }}>
                <ImageSettingsPanel config={config} onConfigChange={(key, value) => setConfig(current => ({ ...current, [key]: value }))} theme={theme} className="space-y-4" />
                <output style={{ display: "block", marginTop: 16, overflowWrap: "anywhere" }}>{JSON.stringify({ size: config.size, resolution: config.resolution, quality: config.quality })}</output>
            </div>
        </main>
    );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
