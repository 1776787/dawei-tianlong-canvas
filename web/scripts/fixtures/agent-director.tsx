import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider, theme } from "antd";
import { CanvasAgentPanel } from "../../src/components/canvas/canvas-agent-panel";
import { CanvasNode } from "../../src/components/canvas/canvas-node";
import { registerBuiltinNodes } from "../../src/components/canvas/nodes/builtin-nodes";
import { registerStoryboardNode } from "../../src/components/canvas/nodes/storyboard-node";
import { defaultConfig, useConfigStore } from "../../src/stores/use-config-store";
import { useAgentPanelStore } from "../../src/stores/use-agent-panel-store";
import { directorProjectRequest } from "../../src/lib/canvas/director-agent";
import { agentLayoutSummary } from "../../src/lib/canvas/agent-layout";
import type { AgentToolkit } from "../../src/lib/canvas/agent-tools";
import type { requestToolChat, ResponseToolCall } from "../../src/services/api/image";
import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData } from "../../src/types/canvas";
import "../../src/styles/globals.css";
import "antd/dist/reset.css";

// Keep synthetic settings and persisted QA sessions on their own browser origin.
if (location.port !== "3011") throw new Error("Run this fixture on isolated port 3011");
registerBuiltinNodes();
registerStoryboardNode();
useConfigStore.setState({
    config: { ...defaultConfig, channels: [{ id: "qa", name: "QA", apiFormat: "openai", baseUrl: "http://fixture.invalid", apiKey: "fixture-only",
        models: [{ name: "director-fixture", capability: "text" }] }], textModel: "qa::director-fixture", model: "qa::director-fixture" },
});
useAgentPanelStore.setState({ panelOpen: true, width: 380 });
const scenario = new URLSearchParams(location.search).get("scenario") || "storyboard";
const noop = () => {};
const call = (name: string, args: Record<string, unknown>): ResponseToolCall => ({
    id: crypto.randomUUID(), type: "function", function: { name, arguments: JSON.stringify(args) },
});
const step = (status: string) => call("update_task_plan", { steps: [
    { id: "plan", title: scenario === "director" ? "安排人物、机位与运镜" : "编排诊室双镜头", status },
] });
const initial: CanvasNodeData[] = scenario === "director" ? [{
    id: "qa-director", type: CanvasNodeType.Director, title: "诊室预演", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: {},
}] : [];

function Fixture() {
    const [nodes, setNodes] = useState<CanvasNodeData[]>(initial);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [sessions, setSessions] = useState<CanvasAssistantSession[]>(() => JSON.parse(localStorage.getItem(`qa-sessions:${scenario}`) || "[]"));
    const [sceneSummary, setSceneSummary] = useState("");
    const nodesRef = useRef(nodes), connectionsRef = useRef(connections);
    useEffect(() => { localStorage.setItem(`qa-sessions:${scenario}`, JSON.stringify(sessions)); }, [sessions]);
    const toolkit = useMemo<AgentToolkit>(() => ({
        getNodes: () => nodesRef.current, getConnections: () => connectionsRef.current,
        setNodes: update => { nodesRef.current = typeof update === "function" ? update(nodesRef.current) : update; setNodes(nodesRef.current); },
        setConnections: update => { connectionsRef.current = typeof update === "function" ? update(connectionsRef.current) : update; setConnections(connectionsRef.current); },
        getCanvasCenter: () => ({ x: 200, y: 150 }), focusNode: noop,
        describeGeneration: (id, mode) => ({ mode, count: nodesRef.current.find(node => node.id === id)?.metadata?.count || 1, model: "fixture-image", size: "16:9", quality: "high" }),
        generateNode: async (id, _mode, _prompt, signal) => {
            if (signal?.aborted) return { status: "canceled", sourceNodeId: id, nodeIds: [], requested: 0, succeeded: 0, failed: 0 };
            const node = nodesRef.current.find(node => node.id === id)!;
            const count = node.metadata?.count || 1;
            const partial = scenario === "partial";
            const next = nodesRef.current.map(node => node.id === id ? { ...node, metadata: { ...node.metadata,
                content: "/brand-logo.png", mimeType: "image/png", status: "success" as const,
                images: Array.from({ length: count }, (_, index) => ({ id: `${id}-${index}`, status: partial && index > 0 ? "error" as const : "success" as const,
                    content: "/brand-logo.png", storageKey: "", mimeType: "image/png", naturalWidth: 256, naturalHeight: 256, bytes: 100 })),
            } } : node);
            nodesRef.current = next;
            setNodes(next);
            return { status: partial ? "partial" : "success", sourceNodeId: id, nodeIds: [id], requested: count, succeeded: partial ? 1 : count, failed: partial ? count - 1 : 0,
                ...(partial ? { error: "模拟第二张图片失败" } : {}) };
        },
    }), []);
    const requestChat: typeof requestToolChat = async (_config, messages, tools, onDelta, _choice, options) => {
        if (!tools.length) return { content: "这是普通对话回复。", toolCalls: [] };
        if (scenario === "stop") {
            await new Promise<void>((resolve, reject) => {
                const cancel = () => { clearTimeout(timer); reject(new DOMException("Stopped", "AbortError")); };
                const timer = setTimeout(() => { options?.signal?.removeEventListener("abort", cancel); resolve(); }, 15000);
                options?.signal?.addEventListener("abort", cancel, { once: true });
            });
        }
        const names = messages.flatMap(message => "type" in message ? [message.name] : []);
        const content = "正在执行诊室分镜任务。";
        onDelta?.(content);
        if (scenario === "director") {
            if (!names.includes("get_director_scene")) return { content, toolCalls: [step("in_progress"), call("get_director_scene", { id: "qa-director" })] };
            if (!names.includes("configure_director_shot")) return { content, toolCalls: [call("configure_director_shot", {
                id: "qa-director", shotId: "consultation", name: "诊室对话", durationSeconds: 5,
                objects: [{ id: "doctor", type: "person", position: [-1, 0, 0], rotation: [0, Math.PI / 2, 0] },
                    { id: "patient", type: "person", position: [1, 0, 0], rotation: [0, -Math.PI / 2, 0] },
                    { id: "desk", type: "table", position: [0, 0, 0.4] }],
                camera: { position: [4, 2, 5], target: [0, 1, 0], focalLength: 35 },
                path: [{ seconds: 0, position: [4, 2, 5], target: [0, 1, 0], focalLength: 35 }, { seconds: 5, position: [2, 1.7, 4], target: [0, 1, 0], focalLength: 45 }],
                motions: [{ id: "doctor", points: [{ seconds: 0, position: [-1, 0, 0] }, { seconds: 3, position: [-0.6, 0, 0], pose: "walk", continuousMotion: true }] }],
            })] };
        } else if (scenario === "generation" || scenario === "partial") {
            if (!names.includes("create_node")) return { content, toolCalls: [step("in_progress"), call("create_node", { type: "image", title: "诊室画面", prompt: "诊室内医生和患者对话", count: 2 })] };
            if (!names.includes("generate_image")) return { content, toolCalls: [call("generate_image", { id: nodesRef.current.find(node => node.type === "image")!.id })] };
            if (!names.includes("inspect_image")) {
                const image = nodesRef.current.find(node => node.type === "image")!;
                return { content, toolCalls: (image.metadata?.images || []).filter(item => item.status === "success").map(item => call("inspect_image", { id: image.id, imageId: item.id })) };
            }
        } else {
            if (!names.includes("create_node")) return { content, toolCalls: [step("in_progress"), call("create_node", { type: "storyboard", title: "诊室对话", theme: "日光下的现代诊室", shots: ["中景，医生询问病情，5秒。", "患者反应特写，3秒，视线方向保持一致。"] })] };
            if (!names.includes("prepare_storyboard_shot")) {
                const board = nodesRef.current.find(node => node.type === "storyboard")!;
                const shots = JSON.parse(board.metadata!.content!).shots;
                return { content, toolCalls: shots.map((shot: { id: string }) => call("prepare_storyboard_shot", { id: board.id, shotId: shot.id })) };
            }
        }
        if (names.filter(name => name === "update_task_plan").length < 2) return { content, toolCalls: [step("completed")] };
        return { content: scenario === "partial" ? "已完成一张，另一张生成失败，等待确认后重试。" : "本轮编排完成，成果已保留在画布。", toolCalls: [] };
    };
    const inspectScene = async () => {
        const project = await directorProjectRequest("qa-director");
        setSceneSummary(`物体 ${project?.objects?.length || 0} / 运镜点 ${project?.keyframes?.length || 0} / 动画轨道 ${Object.keys(project?.objectKeyframes || {}).length}`);
    };
    return <main style={{ height: "100dvh", display: "flex", background: "#18191b", color: "#e5e7eb" }}>
        <section style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>
            <header style={{ padding: 12, display: "flex", flexWrap: "wrap", gap: 12, borderBottom: "1px solid #444" }}>
                <label>测试场景 <select aria-label="测试场景" value={scenario} onChange={event => location.assign(`?scenario=${event.target.value}`)}>
                    <option value="storyboard">分镜编排</option><option value="generation">图片审批</option><option value="partial">部分失败</option><option value="director">导演台</option><option value="stop">停止任务</option>
                </select></label>
                <output data-testid="canvas-counts">节点 {nodes.length} / 连线 {connections.length} / 重叠 {agentLayoutSummary(nodes).overlapCount}</output>
                {scenario === "director" ? <><button onClick={() => void inspectScene()}>读取预演状态</button><output>{sceneSummary}</output></> : null}
            </header>
            {scenario === "director" ? <iframe title="导演台预演" data-director-node="qa-director" src="/monoform/index.html?key=qa-director" style={{ flex: 1, width: "100%", border: 0 }} /> : <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
                <div style={{ width: 1600, height: 1000, position: "relative", transform: "scale(0.55)", transformOrigin: "top left" }}>
                    {nodes.map(node => <CanvasNode key={node.id} data={node} scale={0.55} isSelected={false} isRelated={false} isFocusRelated={false}
                        isConnectionTarget={false} isConnecting={false} showPanel={false} showImageInfo={false}
                        onMouseDown={noop} onHoverStart={noop} onHoverEnd={noop} onConnectStart={noop}
                        onResizeStart={noop} onResize={noop} onResizeEnd={noop} onContentChange={noop} onTitleChange={noop} onContextMenu={noop} />)}
                </div>
            </div>}
        </section>
        <CanvasAgentPanel toolkit={toolkit} chatSessions={sessions} setChatSessions={setSessions} requestChat={requestChat} />
    </main>;
}

const root = createRoot(document.getElementById("root")!);
root.render(<ConfigProvider theme={{ algorithm: theme.darkAlgorithm }}><App><Fixture /></App></ConfigProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
