import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Segmented, Select, Tooltip, Upload, message } from "antd";
import { BookOpen, Bot, Check, Circle, Clapperboard, Loader2, MessageCircle, Paperclip, Play, Send, ShieldCheck, Square, Trash2, Wrench, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { nanoid } from "nanoid";
import type { UploadProps } from "antd";

import { requestToolChat } from "@/services/api/image";
import type { AgentToolkit } from "@/lib/canvas/agent-tools";
import { buildAgentContext, persistableToolDetail, type AgentAttachment } from "@/lib/canvas/agent-context";
import { createAgentRun } from "@/lib/canvas/agent-run";
import { executeAgentTask } from "@/lib/canvas/agent-execution";
import type { AgentApproval, AgentRunState } from "@/types/agent";
import { AGENT_TOOL_LABELS, agentToolFeedback } from "@/lib/canvas/agent-feedback";
import { SkillLibraryDialog } from "@/components/canvas/skill-library-dialog";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { useAgentPanelStore, AGENT_PANEL_MAX_WIDTH, AGENT_PANEL_MIN_WIDTH } from "@/stores/use-agent-panel-store";
import { useSkillStore } from "@/stores/use-skill-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasAssistantMessage, CanvasAssistantSession } from "@/types/canvas";
import { ModelPicker } from "@/components/model-picker";
import type { ReasoningEffort } from "@/stores/use-config-store";

const AGENT_SESSION_TITLE = "Canvas Agent";
const CHAT_SESSION_TITLE = "普通对话";
const MAX_ATTACHMENT_BYTES = 200 * 1024;
const MAX_ATTACHMENT_CHARS = 24000;
const AGENT_MODE_KEY = "canvas-agent-mode";
const AGENT_MODEL_KEY = "canvas-agent-model";
const AGENT_THINKING_KEY = "canvas-agent-thinking";
type AgentMode = "agent" | "chat";

function readStoredValue(key: string) {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(key) || "";
}

type CanvasAgentPanelProps = {
    toolkit: AgentToolkit;
    chatSessions: CanvasAssistantSession[];
    setChatSessions: React.Dispatch<React.SetStateAction<CanvasAssistantSession[]>>;
    requestChat?: typeof requestToolChat;
};

function nowIso() {
    return new Date().toISOString();
}

export function CanvasAgentPanel({ toolkit, chatSessions, setChatSessions, requestChat = requestToolChat }: CanvasAgentPanelProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const { width, panelOpen, setWidth, openPanel, closePanel } = useAgentPanelStore();
    const skills = useSkillStore((state) => state.skills);

    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [mode, setMode] = useState<AgentMode>(() => (readStoredValue(AGENT_MODE_KEY) === "chat" ? "chat" : "agent"));
    const [agentModel, setAgentModel] = useState(() => readStoredValue(AGENT_MODEL_KEY) || effectiveConfig.textModel || effectiveConfig.model);
    const [thinking, setThinking] = useState<ReasoningEffort>(() => {
        const value = readStoredValue(AGENT_THINKING_KEY);
        return ["auto", "low", "medium", "high", "xhigh"].includes(value) ? (value as ReasoningEffort) : effectiveConfig.reasoningEffort;
    });
    const [skillDialogOpen, setSkillDialogOpen] = useState(false);
    const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
    const [approval, setApproval] = useState<AgentApproval | null>(null);
    const approvalRef = useRef<((accepted: boolean) => void) | null>(null);
    const mountedRef = useRef(true);
    const abortRef = useRef<AbortController | null>(null);
    const logRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        mountedRef.current = true;
        return () => { mountedRef.current = false; abortRef.current?.abort(); approvalRef.current?.(false); };
    }, []);

    const sessionTitle = mode === "agent" ? AGENT_SESSION_TITLE : CHAT_SESSION_TITLE;
    const session = chatSessions.find((item) => item.title === sessionTitle) || null;
    const messages = session?.messages || [];
    const task = session?.agentRun;
    useEffect(() => {
        if (busy || abortRef.current || !session || !task || !["running", "waiting_approval"].includes(task.status)) return;
        setChatSessions(prev => prev.map(item => item.id === session.id ? {
            ...item, agentRun: item.agentRun ? { ...item.agentRun, status: "needs_followup", error: "任务已中断，请重新核对画布后继续" } : undefined,
            messages: item.messages.map(message => message.role === "tool" && message.meta === "running"
                ? { ...message, meta: "failed", text: "操作已中断，结果待复核" } : message),
        } : item));
    }, [busy, session?.id, task?.status, setChatSessions]);

    useEffect(() => {
        const el = logRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, panelOpen]);

    const patchSession = useCallback(
        (updater: (messages: CanvasAssistantMessage[]) => CanvasAssistantMessage[], title = sessionTitle) => {
            setChatSessions((prev) => {
                const existing = prev.find((item) => item.title === title);
                if (!existing) {
                    const created: CanvasAssistantSession = { id: nanoid(), title, messages: updater([]), createdAt: nowIso(), updatedAt: nowIso() };
                    return [...prev, created];
                }
                return prev.map((item) => (item.id === existing.id ? { ...item, messages: updater(item.messages), updatedAt: nowIso() } : item));
            });
        },
        [sessionTitle, setChatSessions],
    );

    const appendMessage = useCallback((message: CanvasAssistantMessage) => patchSession((prev) => [...prev, message]), [patchSession]);
    useEffect(() => {
        if (!agentModel) setAgentModel(effectiveConfig.textModel || effectiveConfig.model);
    }, [agentModel, effectiveConfig.model, effectiveConfig.textModel]);

    const changeMode = useCallback((next: AgentMode) => {
        setMode(next);
        if (typeof window !== "undefined") localStorage.setItem(AGENT_MODE_KEY, next);
    }, []);
    const changeAgentModel = useCallback((next: string) => {
        setAgentModel(next);
        if (typeof window !== "undefined") localStorage.setItem(AGENT_MODEL_KEY, next);
    }, []);
    const changeThinking = useCallback((next: ReasoningEffort) => {
        setThinking(next);
        if (typeof window !== "undefined") localStorage.setItem(AGENT_THINKING_KEY, next);
    }, []);

    const stop = useCallback(() => {
        abortRef.current?.abort();
        approvalRef.current?.(false);
    }, []);

    const send = useCallback(async (resume = false) => {
        const question = resume && task ? `继续上次任务：${task.objective}。先检查现有成果，继续未完成步骤。` : input.trim();
        if (!question || busy || abortRef.current) return;
        const selectedModel = agentModel || effectiveConfig.textModel || effectiveConfig.model;
        const requestConfig = { ...effectiveConfig, model: selectedModel, textModel: selectedModel, reasoningEffort: thinking };
        if (!isAiConfigReady(requestConfig, selectedModel)) {
            openConfigDialog(false, "channels");
            return;
        }
        setInput("");
        setBusy(true);
        const controller = new AbortController();
        abortRef.current = controller;
        appendMessage({ id: nanoid(), role: "user", text: question });

        const working = buildAgentContext({ mode, question, messages, attachments, skills, previous: task });
        const assistantMessage = (id: string, text: string) => {
            if (mountedRef.current) patchSession(prev => prev.some(item => item.id === id) ? prev.map(item => item.id === id ? { ...item, text } : item) : [...prev, { id, role: "assistant", text }]);
        };
        try {
            if (mode === "chat") {
                const id = nanoid();
                const result = await requestChat(requestConfig, working, [], text => assistantMessage(id, text), "auto", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) });
                if (result.content.trim()) assistantMessage(id, result.content);
                return;
            }
            const run = createAgentRun({
                objective: resume && task ? task.objective : question,
                previous: resume ? task : undefined,
                selectedNodeIds: toolkit.getSelectedNodeIds?.(), signal: controller.signal,
                approve: request => new Promise<boolean>(resolve => {
                    if (controller.signal.aborted || !mountedRef.current) { resolve(false); return; }
                    const decide = (accepted: boolean) => {
                        controller.signal.removeEventListener("abort", cancel);
                        approvalRef.current = null;
                        if (mountedRef.current) setApproval(null);
                        resolve(accepted);
                    };
                    const cancel = () => decide(false);
                    approvalRef.current = decide;
                    controller.signal.addEventListener("abort", cancel, { once: true });
                    openPanel();
                    setApproval(request);
                }),
                onChange: (agentRun: AgentRunState) => {
                    if (mountedRef.current) setChatSessions(prev => prev.map(item => item.title === sessionTitle ? { ...item, agentRun, updatedAt: nowIso() } : item));
                },
            });
            await executeAgentTask({
                toolkit, run, signal: controller.signal, messages: working,
                request: (messages, tools, onDelta) => requestChat(requestConfig, messages, tools, onDelta, "auto", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]) }),
                events: {
                    assistant: assistantMessage,
                    toolStart: (id, name) => {
                        if (mountedRef.current) appendMessage({ id, role: "tool", title: name, meta: "running", text: `正在${AGENT_TOOL_LABELS[name] || name}…` });
                    },
                    toolEnd: (id, name, args, output) => {
                        const feedback = agentToolFeedback(name, output);
                        if (mountedRef.current) patchSession(prev => prev.map(item => item.id === id ? { ...item, text: feedback.text,
                            meta: feedback.failed ? "failed" : "success", detail: persistableToolDetail(name, args, output) } : item));
                    },
                },
            });
            const final = run.snapshot();
            if (final.error && !controller.signal.aborted && mountedRef.current) appendMessage({ id: nanoid(), role: final.status === "failed" ? "error" : "assistant", text: final.error });
        } catch (error) {
            if (!controller.signal.aborted && mountedRef.current) {
                appendMessage({ id: nanoid(), role: "error", text: error instanceof Error ? error.message : String(error) });
            }
        } finally {
            if (controller.signal.aborted && mountedRef.current) appendMessage({ id: nanoid(), role: "assistant", text: mode === "agent" ? "已停止，已完成的画布修改已保留。已经提交的媒体请求可能仍在服务端执行。" : "已停止回复。" });
            abortRef.current = null;
            if (mountedRef.current) setBusy(false);
        }
    }, [agentModel, appendMessage, attachments, busy, effectiveConfig, input, isAiConfigReady, messages, mode, openConfigDialog, openPanel, patchSession, skills, thinking, toolkit, task, setChatSessions, sessionTitle, requestChat]);

    const attachProps: UploadProps = {
        accept: ".md,.markdown,.txt,.json,.csv,.js,.ts,.tsx,.py,.html,.css,text/plain",
        showUploadList: false,
        multiple: true,
        disabled: busy,
        beforeUpload: (file) => {
            if (file.size > MAX_ATTACHMENT_BYTES) {
                void message.error(t("canvas.agent.attachTooLarge"));
                return Upload.LIST_IGNORE;
            }
            const reader = new FileReader();
            reader.onload = () => {
                let content = String(reader.result || "");
                if (content.length > MAX_ATTACHMENT_CHARS) content = `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n…（内容过长已截断）`;
                setAttachments((prev) => {
                    const next = [...prev.filter((item) => item.name !== file.name), { id: nanoid(6), name: file.name, content }];
                    if (next.length > 8 || next.reduce((sum, item) => sum + item.content.length, 0) > 96000) {
                        void message.error("附件最多 8 个，总正文不超过 96,000 字符");
                        return prev;
                    }
                    return next;
                });
            };
            reader.onerror = () => { void message.error(`无法读取附件：${file.name}`); };
            reader.readAsText(file);
            return Upload.LIST_IGNORE;
        },
    };

    const startResize = useCallback(
        (event: React.PointerEvent) => {
            event.preventDefault();
            const startX = event.clientX;
            const startWidth = width;
            const onMove = (moveEvent: PointerEvent) => setWidth(Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, startWidth + (startX - moveEvent.clientX))));
            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        },
        [setWidth, width],
    );

    if (!panelOpen) {
        return (
            <Tooltip title={t("canvas.agent.open")} placement="left">
                <button
                    type="button"
                    onClick={openPanel}
                    className="fixed bottom-24 right-4 z-40 grid size-11 place-items-center rounded-full border shadow-lg transition-transform hover:scale-105"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                >
                    <Bot className="size-5" />
                </button>
            </Tooltip>
        );
    }

    return (
        <aside aria-label="画布导演" className="relative flex h-full min-h-0 shrink-0 flex-col border-l max-sm:fixed max-sm:inset-y-0 max-sm:right-0 max-sm:z-50" style={{ width, maxWidth: "100vw", background: theme.node.panel, borderColor: theme.toolbar.border, color: theme.node.text, overflowWrap: "anywhere" }}>
            <div className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize" onPointerDown={startResize} />
            <header className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: theme.toolbar.border }}>
                <Clapperboard className="size-4" />
                <span className="flex-1 text-sm font-semibold">画布导演</span>
                <Tooltip title={t("canvas.skills.title")}>
                    <Button size="small" type="text" aria-label="技能库" icon={<BookOpen className="size-3.5" />} onClick={() => setSkillDialogOpen(true)}>
                        {skills.filter((skill) => skill.enabled).length ? <span className="text-[10px]">{skills.filter((skill) => skill.enabled).length}</span> : null}
                    </Button>
                </Tooltip>
                <Tooltip title={t("canvas.agent.clear")}>
                    <Button size="small" type="text" aria-label="清空对话" icon={<Trash2 className="size-3.5" />} disabled={busy || !messages.length} onClick={() => setChatSessions(prev => prev.map(item => item.title === sessionTitle ? { ...item, messages: [], agentRun: undefined, updatedAt: nowIso() } : item))} />
                </Tooltip>
                <Button size="small" type="text" aria-label="关闭导演面板" icon={<X className="size-4" />} onClick={closePanel} />
            </header>
            <div className="space-y-2 border-b px-3 py-2" style={{ borderColor: theme.toolbar.border }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <Segmented
                    block
                    size="small"
                    value={mode}
                    options={[
                        { value: "agent", label: <span className="inline-flex items-center gap-1"><Clapperboard className="size-3.5" />导演 Agent</span> },
                        { value: "chat", label: <span className="inline-flex items-center gap-1"><MessageCircle className="size-3.5" />普通对话</span> },
                    ]}
                    disabled={busy}
                    onChange={(value) => changeMode(value as AgentMode)}
                />
                <div className="flex min-w-0 items-center gap-2">
                    <span className={`min-w-0 flex-1 ${busy ? "pointer-events-none opacity-60" : ""}`}><ModelPicker config={{ ...effectiveConfig, model: agentModel, textModel: agentModel }} value={agentModel} onChange={changeAgentModel} capability="text" className="h-8 min-w-0 !w-full" fullWidth onMissingConfig={() => openConfigDialog(false, "channels")} /></span>
                    <Select
                        size="small"
                        className="w-28 shrink-0"
                        value={thinking}
                        onChange={(value) => changeThinking(value as ReasoningEffort)}
                        options={["auto", "low", "medium", "high", "xhigh"].map((value) => ({ value, label: t(`settingsPanels.common.${value}`) }))}
                        disabled={busy}
                        aria-label="Thinking intensity"
                    />
                </div>
            </div>
            {mode === "agent" && task ? (
                <section aria-label="当前任务" className="shrink-0 border-b px-3 py-2 text-xs" style={{ borderColor: theme.toolbar.border }}>
                    <div className="flex items-center gap-2">
                        {busy ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : task.status === "completed" ? <Check className="size-3.5 shrink-0 text-emerald-500" /> : <Circle className="size-3.5 shrink-0 text-amber-500" />}
                        <span role="status" className="flex-1 font-medium">
                            {busy ? task.status === "waiting_approval" ? "等待确认" : "执行中" : ({
                                completed: "已完成", stopped: "已停止", failed: "执行失败", needs_followup: "待继续", running: "已中断", waiting_approval: "已中断",
                            })[task.status]}
                        </span>
                        {!busy && task.status !== "completed" ? <Tooltip title="继续任务"><Button aria-label="继续任务" size="small" type="text" icon={<Play className="size-3.5" />} onClick={() => void send(true)} /></Tooltip> : null}
                    </div>
                    <div className="mt-1 line-clamp-2 leading-relaxed opacity-80" title={task.objective}>{task.objective}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] opacity-60">
                        <span>第 {task.round} 轮</span><span>图片 {task.imagesRequested}/{task.imageLimit}</span><span>视频 {task.videosRequested}</span><span>工具 {task.toolCalls}</span>
                        {task.pendingImageReviews?.length ? <span className="text-amber-500">待验收 {task.pendingImageReviews.length}</span> : null}
                    </div>
                    {task.steps.length ? <ol aria-label="任务步骤" className="mt-2 max-h-32 space-y-1.5 overflow-y-auto">
                        {task.steps.map(step => <li key={step.id} className="flex items-start gap-1.5">
                            {step.status === "completed" ? <Check className="mt-0.5 size-3 shrink-0 text-emerald-500" /> : step.status === "in_progress" && busy ? <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" /> : <Circle className="mt-0.5 size-3 shrink-0 opacity-50" />}
                            <span className={step.status === "completed" ? "opacity-60" : ""}>{step.title}</span>
                        </li>)}
                    </ol> : null}
                </section>
            ) : null}
            <div ref={logRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-3">
                {!messages.length ? <div className="py-8 text-center text-xs opacity-50">{mode === "agent" ? "暂无导演任务" : "暂无对话"}</div> : null}
                {messages.map((message) =>
                    message.role === "tool" ? (
                        <div key={message.id} className={`flex max-w-full items-start gap-1.5 self-start rounded-md px-2 py-1 text-[11px] ${message.meta === "failed" ? "bg-red-500/10 text-red-500" : "bg-teal-500/10 text-teal-500"}`}>
                            {message.meta === "running" && busy ? <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin" /> : <Wrench className="mt-0.5 size-3 shrink-0" />}
                            {message.detail ? <details className="min-w-0">
                                <summary className="cursor-pointer whitespace-pre-wrap break-words">{message.text}</summary>
                                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[10px]">{JSON.stringify(message.detail, null, 2)}</pre>
                            </details> : <span className="min-w-0 whitespace-pre-wrap break-words">{message.text}</span>}
                        </div>
                    ) : (
                        <div
                            key={message.id}
                            className={`max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-xs leading-relaxed ${message.role === "user" ? "self-end" : "self-start border"} ${message.role === "error" ? "text-red-500" : ""}`}
                            style={message.role === "user" ? { background: theme.toolbar.activeBg } : { borderColor: theme.toolbar.border, background: theme.node.fill }}
                        >
                            {message.text}
                        </div>
                    ),
                )}
                {busy ? (
                    <div className="flex items-center gap-2 self-start text-xs opacity-60">
                        <Loader2 className="size-3.5 animate-spin" />
                        {t("canvas.agent.thinking")}
                    </div>
                ) : null}
            </div>
            <footer className="border-t p-3" style={{ borderColor: theme.toolbar.border }}>
                {attachments.length ? (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                        {attachments.map((file) => (
                            <span key={file.id} className="flex items-center gap-1 rounded-md bg-teal-500/10 px-2 py-0.5 text-[11px] text-teal-600">
                                <Paperclip className="size-3" />
                                {file.name}
                                <button type="button" disabled={busy} aria-label={`移除附件 ${file.name}`} className="opacity-60 hover:opacity-100" onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== file.id))}>
                                    <X className="size-3" />
                                </button>
                            </span>
                        ))}
                    </div>
                ) : null}
                <div className="flex items-end gap-2">
                    <Upload {...attachProps}>
                        <Tooltip title={t("canvas.agent.attach")}>
                            <Button type="text" disabled={busy} aria-label="添加附件" icon={<Paperclip className="size-4" />} />
                        </Tooltip>
                    </Upload>
                    <Input.TextArea
                        value={input}
                        placeholder={mode === "agent" ? "描述你的分镜或画面…" : "输入消息…"}
                        autoSize={{ minRows: 1, maxRows: 5 }}
                        onChange={(event) => setInput(event.target.value)}
                        onPressEnter={(event) => {
                            if (event.shiftKey || event.nativeEvent.isComposing) return;
                            event.preventDefault();
                            void send();
                        }}
                    />
                    {busy ? <Button type="primary" danger aria-label="停止任务" icon={<Square className="size-3.5" />} onClick={stop} /> : <Button type="primary" aria-label="发送" icon={<Send className="size-3.5" />} disabled={!input.trim()} onClick={() => void send()} />}
                </div>
            </footer>
            <SkillLibraryDialog open={skillDialogOpen} onClose={() => setSkillDialogOpen(false)} />
            <Modal open={Boolean(approval)} title={<span className="inline-flex items-center gap-2"><ShieldCheck className="size-4" />{approval?.title}</span>}
                centered width={520} styles={{ body: { maxHeight: "65vh", overflow: "auto", overflowWrap: "anywhere" } }}
                okText="允许" cancelText="拒绝" okButtonProps={{ danger: approval?.kind === "delete" }}
                onOk={() => approvalRef.current?.(true)} onCancel={() => approvalRef.current?.(false)} mask={{ closable: false }}>
                <p className="mb-3">{approval?.description}</p>
                <ul className="mb-3 list-inside list-disc">{approval?.nodeTitles.slice(0, 20).map((title, index) => <li key={index}>{title}</li>)}</ul>
                {(approval?.nodeTitles.length || 0) > 20 ? <p>共 {approval?.nodeTitles.length} 个节点</p> : null}
                {approval?.details ? <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs">{approval.details}</pre> : null}
            </Modal>
        </aside>
    );
}
