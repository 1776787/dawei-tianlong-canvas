import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, InputNumber, Select, Spin, Tag } from "antd";
import { CheckCircle2, Download, ExternalLink, FileJson, Image as ImageIcon, Play, RefreshCw, Search, Workflow, XCircle } from "lucide-react";
import { saveAs } from "file-saver";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useConfigStore } from "@/stores/use-config-store";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import i18n from "@/i18n";
import { RunningHubInputField } from "./runninghub-input-field";
import { applyRunningHubBindings, buildRunningHubBindings, matchRunningHubBindings, runningHubMediaSlots, runningHubInputKey, prepareRunningHubInputs } from "@/lib/runninghub-bindings";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { proxyApiUrl } from "@/lib/api-proxy";
import { RunningHubReferences } from "./runninghub-references";
import { runningHubWorkflowWithReferencePorts } from "@/lib/runninghub-reference-ports";
import type { CanvasConnection } from "@/types/canvas";
import {
    fetchRunningHubWorkflow,
    pollRunningHubTask,
    RunningHubTaskFailedError,
    RunningHubQueryPendingError,
    runRunningHubWorkflow,
    runningHubWorkflowDetailFromRaw,
    runningHubRawWithInputs,
    sameRunningHubStructure,
    uploadRunningHubFile,
    type RunningHubInput,
    type RunningHubNode,
} from "@/services/api/runninghub";

const RunningHubGraphDialog = lazy(() => import("./runninghub-graph-dialog").then((module) => ({ default: module.RunningHubGraphDialog })));

export const RUNNINGHUB_TYPE = "runninghub";
export const DEFAULT_RUNNINGHUB_WORKFLOW_ID = "2096240120595828738";
export const DEFAULT_RUNNINGHUB_WORKFLOW_URL = `https://rhtv.runninghub.cn/workflow/${DEFAULT_RUNNINGHUB_WORKFLOW_ID}?source=workspace`;

const EMPTY_WORKFLOW_PATCH: Partial<CanvasNodeMetadata> = {
    rhWorkflow: undefined,
    rhLayout: undefined,
    rhInputs: [],
    rhBindingTargets: undefined,
    rhReferenceSwitchTargets: undefined,
    rhDisabledReferencePorts: undefined,
    rhInputPreviews: undefined,
    rhWorkflowTitle: undefined,
    rhTaskId: undefined,
    rhResults: undefined,
    rhPreviewIndex: undefined,
    content: undefined,
    mimeType: undefined,
    status: "idle",
    errorDetails: undefined,
};

const RESET_WORKFLOW_RESULT_PATCH: Partial<CanvasNodeMetadata> = {
    rhQueryWarning: undefined,
    rhTaskId: undefined,
    rhResults: undefined,
    rhPreviewIndex: undefined,
    content: undefined,
    mimeType: undefined,
    status: "idle",
    errorDetails: undefined,
};

type RunningHubProps = {
    node: CanvasNodeData;
    canvasNodes?: CanvasNodeData[];
    canvasConnections?: CanvasConnection[];
    onChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onClose?: () => void;
};

function readNodes(node: CanvasNodeData): RunningHubNode[] {
    const value = node.metadata?.rhWorkflow;
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const nodes = (value as { nodes?: unknown }).nodes;
    return Array.isArray(nodes) ? (nodes as RunningHubNode[]) : [];
}

function readRawWorkflow(node: CanvasNodeData) {
    const value = node.metadata?.rhWorkflow;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = (value as { raw?: unknown }).raw;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
}

function readInputs(node: CanvasNodeData): RunningHubInput[] {
    return Array.isArray(node.metadata?.rhInputs) ? (node.metadata?.rhInputs as RunningHubInput[]) : [];
}

function outputKind(node: CanvasNodeData) {
    const type = String(node.metadata?.mimeType || node.metadata?.rhResults?.[0]?.outputType || "").toLowerCase();
    if (type.includes("video") || ["mp4", "webm", "mov", "mkv"].some((item) => type.includes(item))) return "video";
    if (type.includes("audio") || ["mp3", "wav", "m4a", "aac", "ogg"].some((item) => type.includes(item))) return "audio";
    if (type.includes("json") || type.includes("txt")) return "text";
    return "image";
}

export function RunningHubNodeContent({ node, theme, onChange }: { node: CanvasNodeData; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange?: RunningHubProps["onChange"] }) {
    const { t } = useTranslation();
    const content = node.metadata?.content;
    const kind = outputKind(node);
    const nodes = readNodes(node);
    const status = node.metadata?.status || "idle";
    if (content || node.metadata?.rhResults?.length) return <div className="flex h-full min-h-0 w-full flex-col" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}><RunningHubResultPreview node={node} compact onPreview={(index) => {
        const result = node.metadata?.rhResults?.[index];
        if (result) onChange?.(node.id, { rhPreviewIndex: index, content: result.url, mimeType: mimeFromOutputType(result.outputType || outputTypeFromUrl(result.url) || "") });
    }} /></div>;

    if (content && kind === "video") return <video src={content} controls className="h-full w-full rounded-[18px] bg-black object-contain" data-canvas-no-zoom />;
    if (content && kind === "audio")
        return (
            <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
                <div className="flex items-center gap-2 text-sm opacity-70">
                    <Workflow className="size-4" />
                    <span>{t("canvas.runningHub.result")}</span>
                </div>
                <audio src={content} controls className="w-full" data-canvas-no-zoom />
            </div>
        );
    if (content && kind === "text")
        return (
            <div className="thin-scrollbar h-full w-full overflow-y-auto whitespace-pre-wrap break-words p-4 text-xs" style={{ color: theme.node.text }}>
                {content}
            </div>
        );
    if (content) return <img src={content} alt={node.title} className="h-full w-full rounded-[18px] object-contain" data-canvas-no-zoom />;

    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.text }}>
            <span className="grid size-12 place-items-center rounded-2xl" style={{ background: `${theme.toolbar.activeBg}cc`, color: "#0ea5e9" }}>
                <Workflow className="size-6" />
            </span>
            <span className="max-w-full truncate text-sm font-semibold">{node.metadata?.rhWorkflowTitle || node.title || "RunningHub"}</span>
            <span className="text-[11px] opacity-60">
                {status === "loading" ? t("canvas.runningHub.running") : nodes.length ? t("canvas.runningHub.nodeCount", { count: nodes.length }) : t("canvas.runningHub.loadHint")}
            </span>
            {status === "error" ? <XCircle className="size-4 text-red-400" /> : status === "success" ? <CheckCircle2 className="size-4 text-emerald-400" /> : null}
        </div>
    );
}

export function RunningHubNodePanel({ node, canvasNodes = [], canvasConnections = [], onChange, onClose }: RunningHubProps) {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const queryController = useRef<AbortController | null>(null);
    useEffect(() => () => queryController.current?.abort(), []);
    const [inputs, setInputs] = useState<RunningHubInput[]>(readInputs(node));
    const inputsRef = useRef(inputs);
    inputsRef.current = inputs;
    const autoLoadRef = useRef("");
    const [graphOpen, setGraphOpen] = useState(false);
    const [rawDirty, setRawDirty] = useState(false);
    const [error, setError] = useState(node.metadata?.errorDetails || "");
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [nodeSearch, setNodeSearch] = useState("");
    const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
    const nodes = readNodes(node);
    const allBindings = useMemo(() => buildRunningHubBindings(node.id, canvasNodes, canvasConnections, node.metadata?.rhBindingOrder || []), [canvasConnections, canvasNodes, node.id, node.metadata?.rhBindingOrder]);
    const bindings = allBindings;
    const bindingMatches = useMemo(() => matchRunningHubBindings(inputs, bindings, nodes, node.metadata?.rhBindingTargets), [bindings, inputs, nodes, node.metadata?.rhBindingTargets]);
    const mediaSlots = useMemo(() => runningHubMediaSlots(inputs, nodes), [inputs, nodes]);
    const workflowId = node.metadata?.rhWorkflowId || workflowIdFromUrl(node.metadata?.rhWorkflowUrl || "");
    const storedRaw = readRawWorkflow(node);
    const rawWorkflow = useMemo(() => storedRaw ? runningHubRawWithInputs(storedRaw, inputs) : null, [storedRaw, inputs]);
    const [rawOpen, setRawOpen] = useState(false);
    const [rawDraft, setRawDraft] = useState(() => (rawWorkflow ? JSON.stringify(rawWorkflow, null, 2) : ""));

    useEffect(() => {
        const next = readInputs(node);
        setInputs((current) => {
            const changed = next.length !== current.length || next.some((item, index) => {
                const existing = current[index];
                return !existing || existing.nodeId !== item.nodeId || existing.fieldName !== item.fieldName || JSON.stringify(existing.fieldValue) !== JSON.stringify(item.fieldValue);
            });
            return changed ? next : current;
        });
    }, [node.metadata?.rhInputs]);

    useEffect(() => {
        if (!rawOpen && rawWorkflow) setRawDraft(JSON.stringify(rawWorkflow, null, 2));
    }, [rawOpen, rawWorkflow]);

    // Connections are a live overlay; the stored field values remain the manual fallback on disconnect.
    const effectiveInputs = useMemo(() => applyRunningHubBindings(inputs, bindings, true, nodes, node.metadata?.rhBindingTargets).inputs, [inputs, bindings, nodes, node.metadata?.rhBindingTargets]);
    const durationIndex = workflowId === DEFAULT_RUNNINGHUB_WORKFLOW_ID ? inputs.findIndex((input) => input.nodeId === "259" && input.fieldName === "value" && input.valueType === "number") : -1;
    const durationInput = effectiveInputs[durationIndex];
    const durationValue = durationInput?.fieldValue == null || durationInput.fieldValue === "" ? null : Number(durationInput.fieldValue);
    const durationInvalid = Boolean(durationInput) && (durationValue === null || !Number.isFinite(durationValue) || durationValue <= 0);
    const durationBound = bindingMatches.some((match) => match.inputIndex === durationIndex && durationIndex >= 0);

    const hasKey = Boolean(config.runningHubApiKey?.trim());
    const editingLocked = loading || running || uploadingIndex !== null;

    const loadWorkflow = useCallback(async () => {
        if (!workflowId) {
            setError(t("canvas.runningHub.workflowIdRequired"));
            return;
        }
        if (!hasKey) {
            setError(t("canvas.runningHub.apiKeyRequired"));
            openConfigDialog(false, "preferences");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const detail = await fetchRunningHubWorkflow({ workflowId, apiKey: config.runningHubApiKey || "", baseUrl: config.runningHubBaseUrl });
            const nextInputs = detail.inputs;
            setInputs(nextInputs);
            onChange(node.id, {
                rhWorkflowId: detail.workflowId,
                rhWorkflow: { nodes: detail.nodes, raw: detail.raw },
                rhInputs: nextInputs,
                rhWorkflowTitle: detail.nodes[0]?.title || node.title,
                ...RESET_WORKFLOW_RESULT_PATCH,
            });
            setRawDraft(JSON.stringify(detail.raw, null, 2));
            setRawDirty(false);
            message.success(t("canvas.runningHub.loaded"));
        } catch (loadError) {
            const details = loadError instanceof Error ? loadError.message : t("canvas.runningHub.loadFailed");
            setError(details);
            onChange(node.id, { status: "error", errorDetails: details });
        } finally {
            setLoading(false);
        }
    }, [config.runningHubApiKey, config.runningHubBaseUrl, hasKey, message, node.id, node.title, onChange, openConfigDialog, t, workflowId]);

    useEffect(() => {
        const key = `${node.id}:${workflowId}:${config.runningHubApiKey}`;
        if (nodes.length || !workflowId || !hasKey || autoLoadRef.current === key) return;
        autoLoadRef.current = key;
        void loadWorkflow();
    }, [loadWorkflow, nodes.length, workflowId, hasKey, node.id, config.runningHubApiKey]);

    const updateInput = (index: number, value: unknown) => {
        const next = inputsRef.current.map((input, inputIndex) => (inputIndex === index ? { ...input, fieldValue: value } : input));
        inputsRef.current = next;
        setInputs(next);
        const raw = storedRaw ? runningHubRawWithInputs(storedRaw, next) : null;
        const detail = raw ? runningHubWorkflowDetailFromRaw(workflowId, raw) : null;
        onChange(node.id, { rhInputs: next, ...(detail ? { rhWorkflow: { nodes: detail.nodes, raw: detail.raw } } : {}), ...RESET_WORKFLOW_RESULT_PATCH });
    };

    const swapMediaInputs = (left: number, right: number) => {
        const next = inputsRef.current.map((input) => ({ ...input }));
        if (!next[left] || !next[right]) return;
        [next[left].fieldValue, next[right].fieldValue] = [next[right].fieldValue, next[left].fieldValue];
        const previews = { ...node.metadata?.rhInputPreviews };
        const leftKey = runningHubInputKey(next[left]), rightKey = runningHubInputKey(next[right]);
        const leftPreview = previews[leftKey], rightPreview = previews[rightKey];
        delete previews[leftKey]; delete previews[rightKey];
        if (rightPreview) previews[leftKey] = rightPreview;
        if (leftPreview) previews[rightKey] = leftPreview;
        inputsRef.current = next; setInputs(next);
        const raw = storedRaw ? runningHubRawWithInputs(storedRaw, next) : null;
        const detail = raw ? runningHubWorkflowDetailFromRaw(workflowId, raw) : null;
        onChange(node.id, { rhInputs: next, rhInputPreviews: previews, ...(detail ? { rhWorkflow: { nodes: detail.nodes, raw: detail.raw } } : {}), ...RESET_WORKFLOW_RESULT_PATCH });
    };

    const moveBinding = (sourceNodeId: string, direction: -1 | 1) => {
        const binding = bindings.find((item) => item.sourceNodeId === sourceNodeId);
        if (!binding || binding.kind === "text") return;
        const sameKind = bindings.filter((item) => item.kind === binding.kind);
        const index = sameKind.findIndex((item) => item.sourceNodeId === sourceNodeId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= sameKind.length) return;
        const reordered = [...bindings];
        const left = reordered.findIndex((item) => item.sourceNodeId === sameKind[index].sourceNodeId);
        const right = reordered.findIndex((item) => item.sourceNodeId === sameKind[nextIndex].sourceNodeId);
        [reordered[left], reordered[right]] = [reordered[right], reordered[left]];
        const ids = reordered.map((item) => item.sourceNodeId);
        onChange(node.id, { rhBindingOrder: ids, ...RESET_WORKFLOW_RESULT_PATCH });
    };

    const openGraph = () => {
        const open = () => { setRawOpen(false); setRawDirty(false); setGraphOpen(true); };
        if (rawDirty) modal.confirm({ title: t("canvas.runningHub.graph.discardJson"), onOk: open });
        else open();
    };

    const applyRawWorkflow = () => {
        if (!workflowId) {
            setError(t("canvas.runningHub.workflowIdRequired"));
            return;
        }
        try {
            const detail = runningHubWorkflowDetailFromRaw(workflowId, JSON.parse(rawDraft));
            if (rawWorkflow && !sameRunningHubStructure(rawWorkflow, detail.raw)) throw new Error(t("canvas.runningHub.graph.structureError"));
            setInputs(detail.inputs);
            inputsRef.current = detail.inputs;
            setRawDirty(false);
            setRawDraft(JSON.stringify(detail.raw, null, 2));
            onChange(node.id, {
                rhWorkflow: { nodes: detail.nodes, raw: detail.raw },
                rhInputs: detail.inputs,
                rhWorkflowTitle: detail.nodes[0]?.title || node.title,
                ...RESET_WORKFLOW_RESULT_PATCH,
            });
            setError("");
            message.success(t("canvas.runningHub.jsonApplied"));
        } catch (parseError) {
            const details = parseError instanceof Error ? parseError.message : t("canvas.runningHub.invalidJson");
            setError(details);
            message.error(details);
        }
    };

    const uploadInputFile = async (index: number, file: File) => {
        if (!hasKey) {
            setError(t("canvas.runningHub.apiKeyRequired"));
            openConfigDialog(false, "preferences");
            return;
        }
        setUploadingIndex(index);
        setError("");
        try {
            const result = await uploadRunningHubFile(file, config.runningHubApiKey || "", config.runningHubBaseUrl);
            // RunningHub's desktop-compatible upload route returns fileName; newer
            // gateways may return a downloadable URL instead.
            const uploadedUrl = result.download_url || result.fileUrl || result.fileName || "";
            if (!uploadedUrl) throw new Error(t("canvas.runningHub.uploadFailed"));
            updateInput(index, uploadedUrl);
            if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
                const stored = await uploadMediaFile(file, "rh-preview");
                onChange(node.id, { rhInputPreviews: { ...node.metadata?.rhInputPreviews, [runningHubInputKey(inputsRef.current[index])]: { value: uploadedUrl, storageKey: stored.storageKey, name: file.name, kind: file.type.startsWith("video/") ? "video" : "image" } } });
            }
            message.success(t("canvas.runningHub.uploaded"));
        } catch (uploadError) {
            const details = uploadError instanceof Error ? uploadError.message : t("canvas.runningHub.uploadFailed");
            setError(details);
            message.error(details);
        } finally {
            setUploadingIndex(null);
        }
    };

    const applyTaskResult = useCallback((taskId: string, results: Awaited<ReturnType<typeof pollRunningHubTask>>["results"]) => {
        const normalizedResults = results.map((result) => ({ ...result, outputType: result.outputType || outputTypeFromUrl(result.url) }));
        const firstType = normalizedResults[0]?.outputType;
        onChange(node.id, {
            status: "success",
            content: normalizedResults[0]?.url,
            rhTaskId: taskId,
            rhQueryWarning: undefined,
            rhPreviewIndex: 0,
            rhResults: normalizedResults,
            mimeType: firstType ? mimeFromOutputType(firstType) : undefined,
            errorDetails: undefined,
        });
        if (!normalizedResults[0]) message.info(t("canvas.runningHub.noResult"));
        else message.success(t("canvas.runningHub.completed"));
    }, [message, node.id, onChange, t]);

    const queryTask = useCallback(async () => {
        const taskId = String(node.metadata?.rhTaskId || "");
        if (!taskId || !hasKey) return;
        if (queryController.current) return;
        const controller = new AbortController();
        queryController.current = controller;
        setRunning(true);
        setError("");
        try {
            const result = await pollRunningHubTask({ taskId, apiKey: config.runningHubApiKey || "", baseUrl: config.runningHubBaseUrl, signal: controller.signal });
            applyTaskResult(result.taskId, result.results);
        } catch (queryError) {
            const details = controller.signal.aborted ? "已停止本地查询，远端任务未取消，可继续查询结果。" : queryError instanceof Error ? queryError.message : t("canvas.runningHub.runFailed");
            setError(details);
            const failed = queryError instanceof RunningHubTaskFailedError;
            onChange(node.id, { status: failed ? "error" : node.metadata?.content ? "success" : "idle", errorDetails: failed ? details : undefined, rhQueryWarning: failed ? undefined : details });
            if (failed) message.error(details);
            else message.warning(details);
        } finally {
            queryController.current = null;
            setRunning(false);
        }
    }, [applyTaskResult, config.runningHubApiKey, config.runningHubBaseUrl, hasKey, message, node.id, node.metadata?.rhTaskId, onChange, t]);

    const runWorkflow = async () => {
        if (queryController.current) return;
        if (durationInvalid) {
            setError(t("canvas.runningHub.videoDurationInvalid"));
            return;
        }
        if (!workflowId) {
            setError(t("canvas.runningHub.workflowIdRequired"));
            return;
        }
        if (!hasKey) {
            setError(t("canvas.runningHub.apiKeyRequired"));
            openConfigDialog(false, "preferences");
            return;
        }
        setRunning(true);
        setError("");
        onChange(node.id, { ...RESET_WORKFLOW_RESULT_PATCH, status: "loading" });
        try {
            const submittedInputs = await prepareRunningHubInputs(inputsRef.current, bindings, nodes, node.metadata?.rhBindingTargets || {}, async (binding) => {
                let blob = binding.storageKey ? await (binding.kind === "image" ? getImageBlob(binding.storageKey) : getMediaBlob(binding.storageKey)) : null;
                if (!blob) {
                    const source = binding.value || "";
                    const response = await fetch(/^https?:/i.test(source) ? proxyApiUrl(source) : source);
                    if (!response.ok) throw new Error(`${binding.label}: ${response.status}`);
                    blob = await response.blob();
                }
                const extension = blob.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || (binding.kind === "image" ? "png" : "mp4");
                const uploaded = await uploadRunningHubFile(new File([blob], `${binding.kind}-${binding.sourceNodeId}.${extension}`, { type: blob.type }), config.runningHubApiKey || "", config.runningHubBaseUrl);
                const value = uploaded.fileName || uploaded.download_url || uploaded.fileUrl;
                if (!value) throw new Error(`${binding.label}: ${t("canvas.runningHub.uploadFailed")}`);
                return value;
            }, node.metadata?.rhReferenceSwitchTargets, node.metadata?.rhDisabledReferencePorts);
            const executionRaw = node.metadata?.rhDisabledReferencePorts?.length && storedRaw ? runningHubWorkflowWithReferencePorts(runningHubRawWithInputs(storedRaw, submittedInputs), node.metadata.rhDisabledReferencePorts) : undefined;
            const result = await runRunningHubWorkflow({
                workflowId,
                workflow: executionRaw,
                apiKey: config.runningHubApiKey || "",
                baseUrl: config.runningHubBaseUrl,
                inputs: executionRaw ? runningHubWorkflowDetailFromRaw(workflowId, executionRaw).inputs : submittedInputs,
                accessPassword: String(node.metadata?.rhAccessPassword || ""),
                instanceType: String(node.metadata?.rhInstanceType || "standard"),
                usePersonalQueue: Boolean(node.metadata?.rhUsePersonalQueue),
                retainSeconds: Number(node.metadata?.rhRetainSeconds) || undefined,
                onTaskCreated: (taskId) => {
                    queryController.current = new AbortController();
                    onChange(node.id, { rhTaskId: taskId });
                },
                getQuerySignal: () => queryController.current?.signal,
            });
            applyTaskResult(result.taskId, result.results);
        } catch (runError) {
            const stopped = (queryController.current as AbortController | null)?.signal.aborted;
            const details = stopped ? "已停止本地查询，远端任务未取消，可继续查询结果。" : runError instanceof Error ? runError.message : t("canvas.runningHub.runFailed");
            setError(details);
            const pending = stopped || runError instanceof RunningHubQueryPendingError;
            onChange(node.id, { status: pending ? "idle" : "error", errorDetails: pending ? undefined : details, rhQueryWarning: pending ? details : undefined });
            if (pending) message.warning(details);
            else message.error(details);
        } finally {
            queryController.current = null;
            setRunning(false);
        }
    };

    const referenceEditor = <RunningHubReferences inputs={inputs} nodes={nodes} bindings={bindings} disabledPorts={node.metadata?.rhDisabledReferencePorts} onPortSwitch={(key, enabled) => onChange(node.id, { rhDisabledReferencePorts: enabled ? (node.metadata?.rhDisabledReferencePorts || []).filter((item) => item !== key) : [...new Set([...(node.metadata?.rhDisabledReferencePorts || []), key])], ...RESET_WORKFLOW_RESULT_PATCH })} switchTargets={node.metadata?.rhReferenceSwitchTargets} onSwitch={updateInput} onSwitchTarget={(key, target) => onChange(node.id, { rhReferenceSwitchTargets: { ...node.metadata?.rhReferenceSwitchTargets, [key]: target }, ...RESET_WORKFLOW_RESULT_PATCH })} previews={node.metadata?.rhInputPreviews} targets={node.metadata?.rhBindingTargets} disabled={editingLocked || rawDirty} onTarget={(slotKey, target) => onChange(node.id, { rhBindingTargets: { ...node.metadata?.rhBindingTargets, [slotKey]: target }, ...RESET_WORKFLOW_RESULT_PATCH })} onMove={moveBinding} onSwap={swapMediaInputs} onUpload={(index, file) => void uploadInputFile(index, file)} />;
    const nodeGroups = useMemo(() => {
        const grouped = new Map<string, RunningHubInput[]>();
        inputs.forEach((input) => grouped.set(input.nodeId, [...(grouped.get(input.nodeId) || []), input]));
        return grouped;
    }, [inputs]);
    const filteredNodes = useMemo(() => {
        const query = nodeSearch.trim().toLowerCase();
        if (!query) return nodes;
        return nodes.filter((workflowNode) => `${workflowNode.nodeId} ${workflowNode.title} ${workflowNode.classType}`.toLowerCase().includes(query));
    }, [nodeSearch, nodes]);

    return (
        <div className="rounded-[20px] border p-4 shadow-2xl backdrop-blur-xl" style={{ background: `${theme.toolbar.panel}f5`, borderColor: theme.toolbar.border, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: theme.toolbar.activeBg, color: "#0ea5e9" }}>
                    <Workflow className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{node.metadata?.rhWorkflowTitle || node.title || "RunningHub"}</div>
                    <div className="mt-1 truncate text-[11px] opacity-55">workflowId: {workflowId || t("canvas.runningHub.unconfigured")}</div>
                </div>
                <Button type="text" size="small" icon={<XCircle className="size-4" />} onClick={onClose} aria-label={t("common.cancel")} />
            </div>
            <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px]">
                <Input
                    size="small"
                    value={String(node.metadata?.rhWorkflowUrl || "")}
                    disabled={editingLocked}
                    placeholder={t("canvas.runningHub.workflowUrl")}
                    onChange={(event) => {
                        const url = event.target.value;
                        const nextId = workflowIdFromUrl(url);
                        const idChanged = Boolean(nextId !== workflowId || (!nextId && url.trim()));
                        onChange(node.id, { rhWorkflowUrl: url, rhWorkflowId: nextId || undefined, ...(idChanged ? EMPTY_WORKFLOW_PATCH : {}) });
                    }}
                />
                <Input
                    size="small"
                    value={workflowId}
                    disabled={editingLocked}
                    placeholder={t("canvas.runningHub.workflowId")}
                    onChange={(event) => {
                        const nextId = event.target.value.trim();
                        onChange(node.id, { rhWorkflowId: nextId, ...(nextId !== workflowId ? EMPTY_WORKFLOW_PATCH : {}) });
                    }}
                />
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Button size="small" icon={loading ? <Spin size="small" /> : <RefreshCw className="size-3.5" />} onClick={() => void loadWorkflow()} disabled={editingLocked}>
                    {t("canvas.runningHub.refresh")}
                </Button>
                <Select
                    size="small"
                    className="w-28"
                    aria-label="RH run mode"
                    value={node.metadata?.rhInstanceType || "standard"}
                    disabled={editingLocked}
                    options={[
                        { value: "standard", label: "Standard" },
                        { value: "plus", label: "Plus" },
                        { value: "ultra", label: "Ultra" },
                    ]}
                    onChange={(value) => onChange(node.id, { rhInstanceType: value })}
                />
                <Button type="primary" size="small" icon={running ? <Spin size="small" /> : <Play className="size-3.5" />} onClick={() => void runWorkflow()} disabled={editingLocked || rawDirty || durationInvalid || !workflowId || !nodes.length}>
                    {running ? t("canvas.runningHub.running") : t("canvas.runningHub.run")}
                </Button>
                {running && node.metadata?.rhTaskId ? <Button size="small" icon={<XCircle size={14} />} onClick={() => queryController.current?.abort()}>停止查询</Button> : null}
                {node.metadata?.rhTaskId ? (
                    <Button size="small" icon={running ? <Spin size="small" /> : <RefreshCw className="size-3.5" />} onClick={() => void queryTask()} disabled={loading || running}>
                        {t("canvas.runningHub.queryTask")}
                    </Button>
                ) : null}
                <Tag color={node.metadata?.status === "success" ? "success" : node.metadata?.status === "error" ? "error" : "default"}>{node.metadata?.rhQueryWarning ? "待确认 · 可继续查询" : node.metadata?.status || "idle"}</Tag>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
                <Button icon={<Workflow className="size-4" />} disabled={!nodes.length || loading} onClick={openGraph}>{t("canvas.runningHub.graph.open")}</Button>
                <Button icon={<ExternalLink className="size-3.5" />} disabled={!workflowId} href={workflowId ? `https://rhtv.runninghub.cn/workflow/${encodeURIComponent(workflowId)}` : undefined} target="_blank" rel="noopener noreferrer">{t("canvas.runningHub.graph.official")}</Button>
            </div>
            {workflowId === DEFAULT_RUNNINGHUB_WORKFLOW_ID ? (
                <div className="mb-3 border-t pt-3" style={{ borderColor: theme.toolbar.border }}>
                    <div className="flex flex-wrap items-center gap-3">
                        <label htmlFor={`${node.id}-video-duration`} className="text-xs font-medium">{t("canvas.runningHub.videoDuration")}</label>
                        <InputNumber
                            id={`${node.id}-video-duration`}
                            size="small"
                            className="!w-28"
                            aria-label={t("canvas.runningHub.videoDuration")}
                            min={0}
                            step={0.1}
                            value={durationValue}
                            status={durationInvalid ? "error" : undefined}
                            disabled={editingLocked || rawDirty || durationIndex < 0 || durationBound}
                            onChange={(value) => updateInput(durationIndex, value)}
                        />
                    </div>
                    {durationInvalid ? <div role="alert" className="mt-1 text-xs text-red-400">{t("canvas.runningHub.videoDurationInvalid")}</div> : null}
                </div>
            ) : null}
            {graphOpen ? <Suspense fallback={<Spin />}><RunningHubGraphDialog open title={node.metadata?.rhWorkflowTitle || node.title} workflowId={workflowId} nodes={nodes} inputs={effectiveInputs} bindings={bindings} targets={node.metadata?.rhBindingTargets} previews={node.metadata?.rhInputPreviews} references={referenceEditor} layout={node.metadata?.rhLayout} disabled={editingLocked} uploadingIndex={uploadingIndex} onChange={updateInput} onUpload={(index, file) => void uploadInputFile(index, file)} onLayout={(rhLayout) => onChange(node.id, { rhLayout })} onClose={() => setGraphOpen(false)} /></Suspense> : null}

            {!graphOpen ? referenceEditor : null}

            {!hasKey ? (
                <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-dashed p-2 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    <span>{t("canvas.runningHub.configureKey")}</span>
                    <Button size="small" onClick={() => openConfigDialog(false, "preferences")}>{t("common.edit")}</Button>
                </div>
            ) : null}

            {error ? <div className="mb-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-300">{error}</div> : null}

            <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold opacity-75">{t("canvas.runningHub.workflowDetails")}</span>
                <div className="flex items-center gap-2">
                    <span className="text-[11px] opacity-45">{t("canvas.runningHub.editableInputs", { count: inputs.length })}</span>
                    {rawWorkflow ? (
                        <Button type="text" size="small" className="!h-6 !px-1.5 !text-[11px]" icon={<FileJson className="size-3.5" />} onClick={() => setRawOpen((value) => !value)}>
                            {rawOpen ? t("canvas.runningHub.hideJson") : t("canvas.runningHub.showJson")}
                        </Button>
                    ) : null}
                </div>
            </div>
            {rawOpen && rawWorkflow && !graphOpen ? (
                <div className="mb-2 space-y-2">
                    <Input.TextArea
                        className="font-mono text-[10px]"
                        value={rawDraft}
                        aria-label={t("canvas.runningHub.graph.json")}
                        disabled={editingLocked}
                        onChange={(event) => { setRawDraft(event.target.value); setRawDirty(true); }}
                        autoSize={{ minRows: 6, maxRows: 18 }}
                        spellCheck={false}
                    />
                    <div className="flex justify-end">
                        <Button size="small" type="primary" disabled={editingLocked} icon={<CheckCircle2 className="size-3.5" />} onClick={applyRawWorkflow}>
                            {t("canvas.runningHub.applyJson")}
                        </Button>
                    </div>
                </div>
            ) : null}
            {nodes.length ? (
                <Input
                    size="small"
                    allowClear
                    prefix={<Search className="size-3.5 opacity-50" />}
                    value={nodeSearch}
                    onChange={(event) => setNodeSearch(event.target.value)}
                    placeholder={t("canvas.runningHub.searchNodes")}
                    className="mb-2"
                />
            ) : null}
            {!graphOpen ? <div className="thin-scrollbar max-h-[300px] space-y-2 overflow-y-auto pr-1">
                {filteredNodes.length ? (
                    filteredNodes.map((workflowNode) => {
                        const fields = nodeGroups.get(workflowNode.nodeId) || [];
                        return (
                            <div key={workflowNode.nodeId} className="rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke, background: `${theme.node.fill}88` }}>
                                <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                                    <FileJson className="size-3.5 opacity-60" />
                                    <span className="truncate">{workflowNode.title}</span>
                                    <span className="ml-auto text-[10px] opacity-45">#{workflowNode.nodeId}</span>
                                </div>
                                <div className="mb-2 flex flex-wrap items-center gap-1 text-[10px] opacity-50">
                                    <Tag bordered={false} className="m-0 px-1.5 py-0 text-[10px]" color="blue">{workflowNode.classType}</Tag>
                                    {workflowNode.upstreamNodeIds?.length ? <span>{t("canvas.runningHub.dependsOn", { nodes: workflowNode.upstreamNodeIds.map((id) => `#${id}`).join(", ") })}</span> : null}
                                </div>
                                {fields.length ? (
                                    <div className="space-y-2">
                                        {fields.map((input) => {
                                            const index = inputs.indexOf(input);
                                            const match = bindingMatches.find((item) => item.inputIndex === index);
                                            const slot = mediaSlots.find((item) => item.inputIndex === index);
                                            return <RunningHubInputField key={`${input.nodeId}:${input.fieldName}`} input={effectiveInputs[index]} displayLabel={slot?.label || match?.binding.label} sourceLabel={match?.binding.sourceNodeTitle} disabled={editingLocked || rawDirty || Boolean(match)} uploading={uploadingIndex === index} uploadDisabled={uploadingIndex !== null} onChange={(value) => updateInput(index, value)} onUpload={(file) => void uploadInputFile(index, file)} />;
                                        })}
                                    </div>
                                ) : (
                                    <div className="text-[11px] opacity-45">{t("canvas.runningHub.noEditableInputs")}</div>
                                )}
                            </div>
                        );
                    })
                ) : (
                    <div className="rounded-xl border border-dashed p-5 text-center text-xs opacity-55" style={{ borderColor: theme.node.stroke }}>
                        {nodes.length && nodeSearch ? t("canvas.runningHub.noMatchingNodes") : loading ? t("canvas.runningHub.loading") : t("canvas.runningHub.empty")}
                    </div>
                )}
            </div> : null}

            <button type="button" className="mt-3 text-[11px] opacity-55 transition hover:opacity-100" onClick={() => setAdvancedOpen((value) => !value)}>
                {advancedOpen ? t("canvas.runningHub.hideAdvanced") : t("canvas.runningHub.showAdvanced")}
            </button>
            {advancedOpen ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                    <Input placeholder="accessPassword" value={String(node.metadata?.rhAccessPassword || "")} onChange={(event) => onChange(node.id, { rhAccessPassword: event.target.value })} />
                    <InputNumber className="w-full" min={10} max={180} placeholder={t("canvas.runningHub.retainSeconds")} value={node.metadata?.rhRetainSeconds} onChange={(value) => onChange(node.id, { rhRetainSeconds: value ?? undefined })} />
                    <Select className="col-span-2" allowClear placeholder={t("canvas.runningHub.queueMode")} value={node.metadata?.rhUsePersonalQueue ? "personal" : undefined} options={[{ value: "personal", label: t("canvas.runningHub.personalQueue") }]} onChange={(value) => onChange(node.id, { rhUsePersonalQueue: value === "personal" })} />
                </div>
            ) : null}

            {node.metadata?.content ? (
                <div className="mt-3 overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex items-center gap-2 border-b px-2.5 py-2 text-xs font-medium" style={{ borderColor: theme.node.stroke }}>
                        <ImageIcon className="size-3.5 opacity-60" />
                        {t("canvas.runningHub.result")}
                    </div>
                    <RunningHubResultPreview node={node} onPreview={(index) => {
                        const result = node.metadata?.rhResults?.[index];
                        if (!result) return;
                        onChange(node.id, { rhPreviewIndex: index, content: result.url, mimeType: result.outputType ? mimeFromOutputType(result.outputType) : node.metadata?.mimeType });
                    }} />
                </div>
            ) : null}
        </div>
    );
}

function RunningHubResultPreview({ node, onPreview, compact = false }: { node: CanvasNodeData; onPreview: (index: number) => void; compact?: boolean }) {
    const { message } = App.useApp();
    const [downloading, setDownloading] = useState(false);
    const results = node.metadata?.rhResults || [];
    const selected = node.metadata?.rhPreviewIndex || 0;
    const result = results[selected] || results[0];
    const url = result?.url || node.metadata?.content;
    const type = result?.outputType || (url ? outputTypeFromUrl(url) : undefined) || node.metadata?.mimeType || "";
    const kind = outputKind({ ...node, metadata: { ...node.metadata, mimeType: mimeFromOutputType(type) } });
    const download = async () => {
        if (!url) return;
        setDownloading(true);
        try {
            const response = await fetch(/^https?:/i.test(url) ? proxyApiUrl(url) : url);
            if (!response.ok) throw new Error(`下载失败 (${response.status})`);
            const blob = await response.blob();
            const extension = outputTypeFromUrl(url) || (kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "png");
            saveAs(blob, `runninghub-${node.metadata?.rhTaskId || node.id}-${selected + 1}.${extension}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载失败");
        } finally { setDownloading(false); }
    };
    return (
        <>
            <div className={compact ? "min-h-0 flex-1 overflow-hidden" : "max-h-56 overflow-hidden"}>
                {kind === "video" ? <video key={url} src={url} controls playsInline preload="metadata" className={compact ? "h-full w-full bg-black object-contain" : "max-h-56 w-full bg-black object-contain"} /> : kind === "audio" ? <audio key={url} src={url} controls className="w-full p-3" /> : kind === "text" ? <div className="max-h-40 overflow-y-auto whitespace-pre-wrap p-3 text-xs">{url}</div> : <img src={url} alt="RunningHub result" className={compact ? "h-full w-full object-contain" : "max-h-56 w-full object-contain"} />}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 p-1"><Button size="small" icon={<Download size={14} />} loading={downloading} disabled={!url} onClick={() => void download()}>{kind === "video" ? "下载视频" : "下载结果"}</Button></div>
            {results.length > 1 ? (
                <div className="flex flex-wrap gap-1 border-t p-2" style={{ borderColor: "inherit" }}>
                    {results.map((result, index) => (
                        <button type="button" key={`${result.url}-${index}`} className="rounded-md border px-2 py-1 text-[10px]" style={{ borderColor: index === selected ? "#0ea5e9" : "transparent", background: index === selected ? "rgba(14,165,233,.12)" : "transparent" }} onClick={() => onPreview(index)}>
                            {index + 1}
                        </button>
                    ))}
                </div>
            ) : null}
        </>
    );
}

function workflowIdFromUrl(url: string) {
    return url.match(/\/workflow\/([^/?]+)/i)?.[1] || "";
}

function mimeFromOutputType(outputType: string) {
    const normalized = outputType.toLowerCase();
    if (normalized.includes("/")) return outputType;
    if (normalized === "video") return "video/mp4";
    if (normalized === "audio") return "audio/mpeg";
    if (normalized === "image") return "image/png";
    if (["mp4", "webm", "mov", "mkv"].includes(normalized)) return `video/${normalized === "mov" ? "quicktime" : normalized}`;
    if (["mp3", "wav", "m4a", "aac", "ogg"].includes(normalized)) return `audio/${normalized === "mp3" ? "mpeg" : normalized}`;
    if (["txt", "json"].includes(normalized)) return "text/plain";
    return `image/${normalized || "png"}`;
}

function outputTypeFromUrl(url: string) {
    const extension = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1]?.toLowerCase();
    return extension || undefined;
}

let registered = false;
export function registerRunningHubNode() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions([
        {
            type: RUNNINGHUB_TYPE,
            title: i18n.t("canvas.runningHub.title"),
            description: i18n.t("canvas.runningHub.description"),
            icon: <Workflow className="size-5" />,
            minimapColor: "#0ea5e9",
            autoOpenPanel: true,
            defaultSize: { width: 420, height: 280 },
            defaultMetadata: {
                status: "idle",
                rhWorkflowId: DEFAULT_RUNNINGHUB_WORKFLOW_ID,
                rhWorkflowUrl: DEFAULT_RUNNINGHUB_WORKFLOW_URL,
            },
            resource: (node) => {
                if (!node.metadata?.content) return null;
                const kind = outputKind(node);
                return kind === "video" ? { kind: "video", url: node.metadata.content } : kind === "audio" ? { kind: "audio", url: node.metadata.content } : kind === "text" ? { kind: "text", text: node.metadata.content } : { kind: "image", url: node.metadata.content };
            },
        },
    ]);
}
