import { useState } from "react";
import { createRoot } from "react-dom/client";
import { App, Button, ConfigProvider, theme } from "antd";
import axios from "axios";
import { DEFAULT_RUNNINGHUB_WORKFLOW_ID, DEFAULT_RUNNINGHUB_WORKFLOW_URL, RunningHubNodePanel } from "../src/components/canvas/nodes/runninghub-node";
import { runningHubWorkflowDetailFromRaw } from "../src/services/api/runninghub";
import type { CanvasNodeData } from "../src/types/canvas";
import "../src/i18n";
import "antd/dist/reset.css";
import "../src/styles/globals.css";

// Isolated UI fixture: no store edits, task creation, uploads or real API calls.
axios.defaults.adapter = async () => { throw new Error("Network disabled in RH UI fixture"); };
const detail = runningHubWorkflowDetailFromRaw(DEFAULT_RUNNINGHUB_WORKFLOW_ID, {
    "259": { class_type: "PrimitiveFloat", inputs: { value: 10 }, _meta: { title: "视频时长（秒）" } },
    "19": { class_type: "LoadImage", inputs: { image: "fifth.png" } },
    "42": { class_type: "LoadImage", inputs: { image: "first.png" } },
    "265": { class_type: "MiniMaxH3ReferenceToVideo", inputs: { "ref_images.ref_image_4": ["19", 0], "ref_images.ref_image_0": ["42", 0] } },
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "fixture.safetensors" }, _meta: { title: "模型加载" } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: "A quiet courtyard, soft daylight" }, _meta: { title: "正向提示词" } },
    "3": { class_type: "KSampler", inputs: { model: ["1", 0], positive: ["2", 0], seed: 42, steps: 20, cfg: 7.5, enabled: true, settings: { mode: "test" } }, _meta: { title: "采样器" } },
    "4": { class_type: "SaveImage", inputs: { images: ["3", 0], filename_prefix: "fixture" }, _meta: { title: "输出" } },
});
function Fixture() {
    const [node, setNode] = useState<CanvasNodeData>({ id: "rh-fixture", type: "runninghub", title: "RH 可视化测试", position: { x: 0, y: 0 }, width: 420, height: 280, metadata: { rhWorkflowId: DEFAULT_RUNNINGHUB_WORKFLOW_ID, rhWorkflowUrl: DEFAULT_RUNNINGHUB_WORKFLOW_URL, rhWorkflow: { nodes: detail.nodes, raw: detail.raw }, rhInputs: detail.inputs } });
    const [mounted, setMounted] = useState(true);
    return <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}><App><div style={{ padding: 20, maxWidth: 800, margin: "auto", minHeight: "100vh", background: "#181715", color: "#f5f5f4" }}><h1>RH editor test fixture</h1><Button onClick={() => setMounted(value => !value)}>Toggle panel</Button>{mounted ? <RunningHubNodePanel node={node} onChange={(_, patch) => setNode(current => ({ ...current, metadata: { ...current.metadata, ...patch } }))} /> : null}<pre data-testid="fixture-state" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(node.metadata, null, 2)}</pre></div></App></ConfigProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
