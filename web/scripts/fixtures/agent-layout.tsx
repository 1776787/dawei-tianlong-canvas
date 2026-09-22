import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, theme } from "antd";
import { CanvasNode } from "../../src/components/canvas/canvas-node";
import { executeAgentTool, type AgentToolkit } from "../../src/lib/canvas/agent-tools";
import { agentToolFeedback } from "../../src/lib/canvas/agent-feedback";
import { agentLayoutSummary } from "../../src/lib/canvas/agent-layout";
import { nodeBounds } from "../../src/lib/canvas/canvas-node-geometry";
import { CanvasNodeType, type CanvasNodeData } from "../../src/types/canvas";
import "../../src/styles/globals.css";
import "antd/dist/reset.css";

const noop = () => {};
const assets = [
    { category: "人物", name: "林医生", description: "女医生，短发", details: "镜头1、2：白大褂，站在诊桌左侧" },
    { category: "人物", name: "陈先生", description: "男患者，深色短发", details: "镜头1、2：蓝色衬衫，坐在诊桌右侧" },
    { category: "场景", name: "诊室", details: "白墙，桌椅与门的位置跨镜头一致" },
    { category: "场景", name: "走廊", details: "镜头3，连接诊室的医院走廊" },
    { category: "服装", name: "林医生-白大褂" },
    { category: "道具", name: "听诊器" },
];

// This fixture calls real canvas tools with isolated in-memory state, never a model or media API.
function Fixture() {
    const [nodes, setNodes] = useState<CanvasNodeData[]>([{ id: "existing-script", type: CanvasNodeType.Text, title: "已有剧本", position: { x: 0, y: 0 }, width: 560, height: 360, metadata: { content: "镜头1：医生与患者在诊室对话。\n镜头2：患者反应特写。\n镜头3：医生走向走廊。" } }]);
    const [feedback, setFeedback] = useState("就绪");
    const [scale, setScale] = useState(0.5);
    const state = useRef(nodes);
    const planId = useRef<string | undefined>(undefined);
    const toolkit: AgentToolkit = {
        getNodes: () => state.current, getConnections: () => [],
        setNodes: update => {
            state.current = typeof update === "function" ? update(state.current) : update;
            setNodes(state.current);
        },
        setConnections: noop, getCanvasCenter: () => ({ x: 280, y: 180 }),
        generateNode: async () => { throw new Error("Media generation is disabled in this fixture"); },
        focusNode: noop,
    };
    const runPlan = async (extend = false) => {
        const result = await executeAgentTool(toolkit, "create_asset_plan", JSON.stringify(extend
            ? { planId: planId.current, assets: [{ category: "人物", name: "护士" }] }
            : { source: "诊室分镜脚本", assets }));
        if (typeof result.planId === "string") planId.current = result.planId;
        setFeedback(agentToolFeedback("create_asset_plan", result).text);
    };
    const createSeveral = async () => {
        for (const type of ["text", "image", "director", "storyboard"]) await executeAgentTool(toolkit, "create_node", JSON.stringify({ type, x: 280, y: 180 }));
        setFeedback("连续创建完成");
    };
    const bounds = nodeBounds(nodes);
    const width = (bounds.right - bounds.left + 100) * scale;
    const height = (bounds.bottom - bounds.top + 120) * scale;
    return <ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}>
        <main style={{ minHeight: "100vh", background: "#18191b", color: "#e5e7eb", fontFamily: "Microsoft YaHei, sans-serif" }}>
            <header style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: 16, borderBottom: "1px solid #444" }}>
                <button onClick={() => void runPlan()}>运行资产规划</button>
                <button onClick={() => void runPlan(true)} disabled={!planId.current}>补充资产</button>
                <button onClick={() => void createSeveral()}>连续创建节点</button>
                <label>缩放 <select value={scale} onChange={event => setScale(Number(event.target.value))}><option value={0.35}>35%</option><option value={0.5}>50%</option><option value={0.8}>80%</option></select></label>
                <output role="status">{feedback}</output>
                <span data-testid="counts">节点 {nodes.length} / 独立资产 {nodes.filter(node => node.metadata?.assetPlanRole === "asset").length} / 重叠 {agentLayoutSummary(nodes).overlapCount}</span>
            </header>
            <section style={{ overflow: "auto", height: "calc(100vh - 100px)" }} aria-label="测试画布">
                <div style={{ width, height, position: "relative" }}>
                    <div style={{ transformOrigin: "top left", transform: `scale(${scale}) translate(${50 - bounds.left}px, ${60 - bounds.top}px)` }}>
                        {nodes.map(node => <CanvasNode key={node.id} data={node} scale={scale} isSelected={false} isRelated={false} isFocusRelated={false}
                            isConnectionTarget={false} isConnecting={false} showPanel={false} showImageInfo={false}
                            onMouseDown={noop} onHoverStart={noop} onHoverEnd={noop} onConnectStart={noop}
                            onResizeStart={noop} onResize={noop} onResizeEnd={noop} onContentChange={noop} onTitleChange={noop} onContextMenu={noop} />)}
                    </div>
                </div>
            </section>
        </main>
    </ConfigProvider>;
}
const root = createRoot(document.getElementById("root")!);
root.render(<Fixture />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
