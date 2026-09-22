import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Modal, Select, Tooltip } from "antd";
import { ExternalLink, LayoutGrid, Maximize, Minus, Plus, Workflow, X } from "lucide-react";
import { Background, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, useViewport, type Edge, type Node, type NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeMetadata } from "@/types/canvas";
import type { RunningHubInput, RunningHubNode } from "@/services/api/runninghub";
import { layoutRunningHubNodes, RH_NODE_WIDTH, runningHubGraphLinks, runningHubNodeHeight } from "@/lib/runninghub-graph";
import { runningHubMediaSlots, matchRunningHubBindings, runningHubInputKey, type RunningHubCanvasBinding } from "@/lib/runninghub-bindings";
import { RunningHubMediaPreview } from "./runninghub-media-preview";
import { RunningHubInputField } from "./runninghub-input-field";
import "@xyflow/react/dist/style.css";
import "./runninghub-graph.css";

type Props = {
    open: boolean;
    title: string;
    workflowId: string;
    nodes: RunningHubNode[];
    inputs: RunningHubInput[];
    bindings?: RunningHubCanvasBinding[];
    targets?: Record<string, string>;
    previews?: CanvasNodeMetadata["rhInputPreviews"];
    references?: ReactNode;
    layout?: CanvasNodeMetadata["rhLayout"];
    disabled: boolean;
    uploadingIndex: number | null;
    onChange: (index: number, value: unknown) => void;
    onUpload: (index: number, file: File) => void;
    onLayout: (layout: NonNullable<CanvasNodeMetadata["rhLayout"]>) => void;
    onClose: () => void;
};
type GraphData = { workflowNode: RunningHubNode; incoming: { field: string; source: string; slot: number }[]; outgoing: number[] };
type GraphNode = Node<GraphData, "workflow">;
const EditingContext = createContext<Props | null>(null);

function nodeColor(classType: string) {
    if (/sampler|scheduler/i.test(classType)) return "#d29a43";
    if (/text|clip|prompt/i.test(classType)) return "#4eae86";
    if (/load|checkpoint|model/i.test(classType)) return "#6c9dcb";
    if (/save|preview|decode|output/i.test(classType)) return "#cd7c94";
    return "#8e969a";
}

function WorkflowGraphNode({ data, selected }: NodeProps<GraphNode>) {
    const editing = useContext(EditingContext)!;
    const { t } = useTranslation();
    const fields = editing.inputs.map((input, index) => ({ input, index })).filter(({ input }) => input.nodeId === data.workflowNode.nodeId);
    const mediaSlots = runningHubMediaSlots(editing.inputs, editing.nodes);
    const matches = matchRunningHubBindings(editing.inputs, editing.bindings || [], editing.nodes, editing.targets);
    return (
        <section className={`rh-graph-node ${selected ? "is-selected" : ""}`} style={{ borderTopColor: nodeColor(data.workflowNode.classType) }}>
            <header className="rh-graph-node-header" title={`${data.workflowNode.title} (#${data.workflowNode.nodeId})`}>
                <span>{data.workflowNode.title}</span><small>#{data.workflowNode.nodeId}</small>
            </header>
            <div className="rh-graph-class" title={data.workflowNode.classType}>{data.workflowNode.classType}</div>
            <div className="rh-graph-ports" style={{ height: Math.max(data.incoming.length, data.outgoing.length) * 24 }}>
                <div>{data.incoming.map((link) => <div className="rh-graph-port" key={link.field} title={`#${link.source} [${link.slot}] -> ${link.field}`}>
                    <Handle id={`in:${link.field}`} type="target" position={Position.Left} isConnectable={false} /><span>{link.field}</span>
                </div>)}</div>
                <div>{data.outgoing.map((slot) => <div className="rh-graph-port rh-graph-output" key={slot}>
                    <span>{t("canvas.runningHub.graph.output", { slot })}</span><Handle id={`out:${slot}`} type="source" position={Position.Right} isConnectable={false} />
                </div>)}</div>
            </div>
            <div className={`rh-graph-fields nodrag nowheel nopan ${fields.length ? "" : "is-empty"}`}>
                {fields.map(({ input, index }) => {
                    const slot = mediaSlots.find((item) => item.inputIndex === index);
                    const match = matches.find((item) => item.inputIndex === index);
                    const preview = editing.previews?.[runningHubInputKey(input)];
                    const mediaKind = match?.binding.kind === "image" || match?.binding.kind === "video" ? match.binding.kind : slot?.kind;
                    return <div key={input.fieldName}><RunningHubInputField input={input} displayLabel={slot?.label || match?.binding.label} sourceLabel={match?.binding.sourceNodeTitle} disabled={editing.disabled || Boolean(match)} uploading={editing.uploadingIndex === index} uploadDisabled={editing.uploadingIndex !== null} onChange={(value) => editing.onChange(index, value)} onUpload={(file) => editing.onUpload(index, file)} />{mediaKind ? <RunningHubMediaPreview kind={mediaKind} url={match?.binding.previewUrl || String(input.fieldValue || "")} storageKey={!match && preview?.value === input.fieldValue ? preview?.storageKey : undefined} label={slot?.label || match?.binding.label || input.fieldName} /> : null}</div>;
                })}
                {!fields.length ? <span>{t("canvas.runningHub.noEditableInputs")}</span> : null}
            </div>
        </section>
    );
}
const nodeTypes = { workflow: WorkflowGraphNode };

export function RunningHubGraphDialog(props: Props) {
    const { t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    // Parameter edits preserve the mounted graph; structural changes recreate it.
    const topologyKey = JSON.stringify(props.nodes.map((node) => [node.nodeId, node.classType, Object.keys(node.inputs)]));
    return (
        <Modal open={props.open} footer={null} closable={false} destroyOnHidden centered width="calc(100vw - 24px)" className="rh-graph-modal" styles={{ body: { padding: 0 }, container: { padding: 0, overflow: "hidden" } }} onCancel={props.onClose} modalRender={(content) => <div onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>{content}</div>}>
            {props.open ? <div className={`rh-graph-editor ${theme === "dark" ? "dark" : ""}`} aria-label={t("canvas.runningHub.graph.title")} data-canvas-no-zoom>
                <ReactFlowProvider key={`${props.workflowId}:${topologyKey}`}>
                    <GraphWorkspace {...props} />
                </ReactFlowProvider>
            </div> : null}
        </Modal>
    );
}

function GraphWorkspace(props: Props) {
    const { t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const flow = useReactFlow<GraphNode>();
    const viewport = useViewport();
    const [selected, setSelected] = useState<string>();
    const graph = useMemo(() => runningHubGraphLinks(props.nodes), [props.nodes]);
    const [nodes, setNodes, onNodesChange] = useNodesState<GraphNode>([]);
    const [initialPositions] = useState(() => layoutRunningHubNodes(props.nodes));
    const initialFitRef = useRef(false);
    useEffect(() => {
        setNodes((current) => props.nodes.map((node) => {
            const existing = current.find((item) => item.id === node.nodeId);
            const saved = props.layout?.positions?.[node.nodeId];
            const position = existing?.position || (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : initialPositions[node.nodeId]);
            return { ...existing, id: node.nodeId, type: "workflow", position, width: RH_NODE_WIDTH, height: runningHubNodeHeight(node, graph.links), dragHandle: ".rh-graph-node-header", data: { workflowNode: node, incoming: graph.links.filter((link) => link.target === node.nodeId), outgoing: [...new Set(graph.links.filter((link) => link.source === node.nodeId).map((link) => link.slot))].sort((a, b) => a - b) } };
        }));
    }, [props.nodes, graph, initialPositions, setNodes]);
    useEffect(() => {
        if (!nodes.length || props.layout?.viewport || initialFitRef.current) return;
        initialFitRef.current = true;
        // Wait for React Flow to measure the mounted node cards before fitting.
        requestAnimationFrame(() => requestAnimationFrame(() => { void flow.fitView({ padding: 0.2, duration: 0 }); }));
    }, [flow, nodes.length, props.layout?.viewport]);
    const edges = useMemo<Edge[]>(() => graph.links.map((link) => ({
        id: link.id, source: link.source, target: link.target, sourceHandle: `out:${link.slot}`, targetHandle: `in:${link.field}`, type: "default", selectable: false, reconnectable: false,
        style: { stroke: selected === link.source || selected === link.target ? "#e8b85f" : "#7693a1", strokeWidth: selected === link.source || selected === link.target ? 3 : 1.5 },
    })), [graph, selected]);
    const persist = () => props.onLayout({ positions: Object.fromEntries(flow.getNodes().map((node) => [node.id, node.position])), viewport: flow.getViewport() });
    const arrange = () => {
        const positions = layoutRunningHubNodes(props.nodes);
        setNodes((current) => current.map((node) => ({ ...node, position: positions[node.id] })));
        props.onLayout({ positions });
        requestAnimationFrame(() => { void flow.fitView({ padding: 0.15, duration: 250 }); });
    };
    const focusNode = (id: string) => {
        setSelected(id);
        setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })));
        void flow.fitView({ nodes: [{ id }], padding: 0.25, maxZoom: 1.2, duration: 250 });
    };
    const tools = [
        { label: t("canvas.runningHub.graph.zoomOut"), icon: <Minus size={16} />, action: () => void flow.zoomOut({ duration: 150 }) },
        { label: t("canvas.runningHub.graph.zoomIn"), icon: <Plus size={16} />, action: () => void flow.zoomIn({ duration: 150 }) },
        { label: t("canvas.runningHub.graph.fit"), icon: <Maximize size={16} />, action: () => void flow.fitView({ padding: 0.15, duration: 250 }) },
        { label: t("canvas.runningHub.graph.arrange"), icon: <LayoutGrid size={16} />, action: arrange },
    ];
    return (
        <EditingContext.Provider value={props}>
            <header className="rh-graph-toolbar">
                <div className="rh-graph-title"><Workflow size={18} /><strong title={props.title}>{props.title}</strong></div>
                <Select showSearch allowClear aria-label={t("canvas.runningHub.searchNodes")} placeholder={t("canvas.runningHub.searchNodes")} className="rh-graph-search" value={selected} optionFilterProp="label" options={props.nodes.map((node) => ({ value: node.nodeId, label: `${node.title} #${node.nodeId} (${node.classType})` }))} onChange={(id) => id ? focusNode(id) : setSelected(undefined)} />
                <div className="rh-graph-tools">
                    {tools.map((tool) => <Tooltip key={tool.label} title={tool.label}><Button type="text" aria-label={tool.label} icon={tool.icon} onClick={tool.action} /></Tooltip>)}
                    <span className="rh-graph-zoom">{Math.round(viewport.zoom * 100)}%</span>
                    <Tooltip title={t("canvas.runningHub.graph.official")}><Button type="text" aria-label={t("canvas.runningHub.graph.official")} icon={<ExternalLink size={16} />} href={`https://rhtv.runninghub.cn/workflow/${encodeURIComponent(props.workflowId)}`} target="_blank" rel="noopener noreferrer" /></Tooltip>
                    <Tooltip title={t("common.close")}><Button type="text" aria-label={t("common.close")} icon={<X size={18} />} onClick={props.onClose} /></Tooltip>
                </div>
            </header>
            <main className="rh-graph-surface">
                {props.references ? <aside className="rh-graph-references nodrag nowheel nopan">{props.references}</aside> : null}
                <ReactFlow<GraphNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onNodeClick={(_, node) => setSelected(node.id)} onPaneClick={() => setSelected(undefined)} onNodeDragStop={persist} onMoveEnd={persist} defaultViewport={props.layout?.viewport} fitView={!props.layout?.viewport} fitViewOptions={{ padding: 0.15 }} minZoom={0.08} maxZoom={2} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null} panActivationKeyCode={null} zoomActivationKeyCode={null} colorMode={theme === "dark" ? "dark" : "light"}>
                    <Background gap={24} size={1} />
                    <MiniMap<GraphNode> pannable zoomable nodeColor={(node) => nodeColor(node.data.workflowNode.classType)} className="rh-graph-minimap" />
                </ReactFlow>
            </main>
            <footer className="rh-graph-status"><span>{t("canvas.runningHub.nodeCount", { count: nodes.length })} / {t("canvas.runningHub.graph.links", { count: edges.length })}</span><span>{t("canvas.runningHub.graph.local")}</span>{graph.missing.length ? <span className="rh-graph-warning" title={graph.missing.join("\n")}>{t("canvas.runningHub.graph.missing", { count: graph.missing.length })}</span> : null}</footer>
        </EditingContext.Provider>
    );
}
