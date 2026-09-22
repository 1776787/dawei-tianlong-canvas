import { nanoid } from "nanoid";
import type { CanvasNodeData } from "@/types/canvas";
import type { AgentApproval, AgentGenerationQuote, AgentRunState, AgentStep } from "@/types/agent";

export const AGENT_MAX_ROUNDS = 24;
export const AGENT_MAX_TOOL_CALLS = 80;

export function createAgentRun(options: {
    objective: string;
    selectedNodeIds?: string[];
    previous?: AgentRunState;
    signal: AbortSignal;
    approve?: (request: AgentApproval) => Promise<boolean>;
    onChange?: (state: AgentRunState) => void;
}) {
    const startedAt = new Date().toISOString();
    let state: AgentRunState = {
        id: nanoid(), objective: options.objective, status: "running",
        steps: options.previous?.steps.map(step => ({ ...step })) || [],
        createdNodeIds: [], changedNodeIds: options.previous ? [...new Set([...options.previous.createdNodeIds, ...options.previous.changedNodeIds])] : [], imageLimit: 4, imagesRequested: 0,
        videosRequested: 0, toolCalls: 0, round: 0, startedAt, updatedAt: startedAt,
        pendingImageReviews: [...(options.previous?.pendingImageReviews || [])],
    };
    const allowed = new Set(options.selectedNodeIds || []);
    const imageProfiles = new Set<string>();
    const imageAttempts = new Set<string>();
    const denied = new Set<string>();
    let canvasRead = false;

    const publish = (patch: Partial<AgentRunState> = {}) => {
        state = { ...state, ...patch, updatedAt: new Date().toISOString() };
        options.onChange?.(structuredClone(state));
    };
    const checkStopped = () => {
        if (options.signal.aborted) throw new DOMException("操作已停止", "AbortError");
    };
    const confirm = async (request: AgentApproval) => {
        checkStopped();
        const key = JSON.stringify(request);
        if (denied.has(key)) throw new Error("用户已拒绝这项操作，请调整计划，不要重复请求");
        if (!options.approve) throw new Error("这项操作需要用户确认");
        publish({ status: "waiting_approval" });
        let accepted = false;
        try {
            accepted = await options.approve(request);
            checkStopped();
        } finally {
            publish({ status: options.signal.aborted ? "stopped" : "running" });
        }
        if (!accepted) {
            denied.add(key);
            throw new Error("用户拒绝了这项操作，未执行");
        }
    };

    return {
        snapshot: () => structuredClone(state),
        start: () => publish(),
        markCanvasRead: () => { canvasRead = true; },
        setRound: (round: number) => publish({ round }),
        setPendingReviews: (pendingImageReviews: string[]) => publish({ pendingImageReviews }),
        finish: (status: AgentRunState["status"], error?: string) => publish({ status, error }),
        countTool: () => {
            checkStopped();
            if (state.toolCalls >= AGENT_MAX_TOOL_CALLS) throw new Error("已达到本轮工具调用上限，请检查成果后继续任务");
            publish({ toolCalls: state.toolCalls + 1 });
        },
        updatePlan: (steps: AgentStep[]) => {
            if (!steps.length || steps.length > 12 || steps.some(step => !step.id?.trim() || !step.title?.trim() || step.title.length > 160 || !["pending", "in_progress", "completed"].includes(step.status))) {
                throw new Error("计划需要 1–12 个有 id、标题和有效状态的步骤");
            }
            if (new Set(steps.map(step => step.id)).size !== steps.length || steps.filter(step => step.status === "in_progress").length > 1) {
                throw new Error("步骤 ID 必须唯一，最多一个步骤进行中");
            }
            publish({ steps: steps.map(step => ({ id: step.id, title: step.title, status: step.status })) });
        },
        authorizeMutation: async (name: string, ids: string[], nodes: CanvasNodeData[], details?: string) => {
            checkStopped();
            if (!canvasRead) throw new Error("请先读取 get_canvas_state，再操作画布");
            const force = name === "delete_nodes" || name === "arrange_all" || name === "replace_director_content";
            const outside = ids.filter(id => !allowed.has(id) && !state.createdNodeIds.includes(id));
            if (!force && !outside.length) return;
            const targetIds = force ? ids : outside;
            await confirm({
                kind: name === "delete_nodes" ? "delete" : name === "arrange_all" ? "layout" : "edit",
                title: name === "delete_nodes" ? "删除节点" : name === "arrange_all" ? "整理整个画布" : "修改已有内容",
                description: name === "delete_nodes" ? "将删除这些节点及其相关连线。" : "允许本轮任务修改以下节点。",
                nodeTitles: targetIds.map(id => nodes.find(node => node.id === id)?.title || id),
                details,
            });
            targetIds.forEach(id => allowed.add(id));
        },
        reserveGeneration: async (quote: AgentGenerationQuote, node: CanvasNodeData) => {
            checkStopped();
            if (!canvasRead) throw new Error("请先读取画布，再生成媒体");
            if (!Number.isInteger(quote.count) || quote.count < 1 || quote.count > 15) throw new Error("单次生成数量必须是 1–15");
            const profile = JSON.stringify({ ...quote, count: undefined });
            if (quote.mode === "video") {
                await confirm({
                    kind: "video", title: "生成视频", description: "将提交 1 个视频任务，可能产生 API 费用。停止等待不保证服务端停止计费。",
                    nodeTitles: [node.title], details: JSON.stringify(quote, null, 2),
                });
                publish({ videosRequested: state.videosRequested + 1 });
                return;
            }
            const nextCount = state.imagesRequested + quote.count;
            const nextLimit = Math.max(state.imageLimit, nextCount);
            if (!imageProfiles.has(profile) || nextCount > state.imageLimit || imageAttempts.has(node.id)) {
                await confirm({
                    kind: "image", title: imageAttempts.has(node.id) ? "确认再次生成图片" : "确认图片生成预算",
                    description: `本次请求 ${quote.count} 张；允许本轮在这些参数下累计提交最多 ${nextLimit} 张。已提交 ${state.imagesRequested} 张，失败请求也计入预算。`,
                    nodeTitles: [node.title], details: JSON.stringify(quote, null, 2),
                });
                imageProfiles.add(profile);
            }
            checkStopped();
            imageAttempts.add(node.id);
            publish({ imageLimit: nextLimit, imagesRequested: nextCount });
        },
        releaseUnsubmittedGeneration: (quote: AgentGenerationQuote) => {
            publish(quote.mode === "image"
                ? { imagesRequested: Math.max(0, state.imagesRequested - quote.count) }
                : { videosRequested: Math.max(0, state.videosRequested - 1) });
        },
        recordChanges: (before: CanvasNodeData[], after: CanvasNodeData[]) => {
            const old = new Map(before.map(node => [node.id, node]));
            const created = after.filter(node => !old.has(node.id)).map(node => node.id);
            const changed = after.filter(node => old.has(node.id) && old.get(node.id) !== node).map(node => node.id);
            const deleted = before.filter(node => !after.some(next => next.id === node.id)).map(node => node.id);
            if (created.length || changed.length || deleted.length) publish({
                createdNodeIds: [...new Set([...state.createdNodeIds, ...created])],
                changedNodeIds: [...new Set([...state.changedNodeIds, ...changed, ...deleted])],
            });
        },
        recordAffected: (ids: string[]) => {
            if (ids.length) publish({ changedNodeIds: [...new Set([...state.changedNodeIds, ...ids])] });
        },
    };
}

export type AgentRun = ReturnType<typeof createAgentRun>;
