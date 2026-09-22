// Canvas agent tools: definitions + executor. The agent controls the canvas through
// a toolkit of callbacks supplied by the canvas page (read refs, write setters).
import type { Dispatch, SetStateAction } from "react";
import { nanoid } from "nanoid";
import { buildDirectorShot, directorProjectRequest } from './director-agent';
import { DIRECTOR_TOOLS } from "./director-tool-definitions";
import { validateAgentArguments } from "./agent-tool-validation";
import type { AgentRun } from "./agent-run";
import type { AgentGenerationQuote, AgentStep, CanvasGenerationResult } from "@/types/agent";

import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { STORYBOARD_TYPE, composeShotPrompt, readStoryboardMeta, writeStoryboardMeta, type StoryboardMeta, type StoryboardShot } from "@/components/canvas/nodes/storyboard-node";
import { DOODLE_TYPE } from "@/components/canvas/nodes/doodle-node";
import { getSkillStore } from "@/stores/use-skill-store";
import type { ResponseFunctionTool } from "@/services/api/image";
import { normalizeConnection } from "@/lib/canvas/canvas-node-geometry";
import { AGENT_LAYOUT_GAP, agentLayoutSummary, arrangeAgentGrid, findAgentPosition, placeAgentBlock, rectanglesOverlap } from "@/lib/canvas/agent-layout";
import { ASSET_CATEGORIES, buildAgentAssetPlan } from "@/lib/canvas/agent-asset-plan";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData, type Position } from "@/types/canvas";

export type AgentToolkit = {
    getNodes: () => CanvasNodeData[];
    getConnections: () => CanvasConnection[];
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    getCanvasCenter: () => Position;
    getSelectedNodeIds?: () => string[];
    describeGeneration?: (nodeId: string, mode: "image" | "video") => AgentGenerationQuote;
    generateNode: (nodeId: string, mode: CanvasGenerationMode, prompt: string, signal?: AbortSignal) => Promise<CanvasGenerationResult>;
    focusNode: (nodeId: string) => void;
};

const AGENT_NODE_TYPES = ["text", "image", "video", "storyboard", "director", "doodle", "config", "runninghub"] as const;
type AgentNodeType = (typeof AGENT_NODE_TYPES)[number];

export const AGENT_TOOLS: ResponseFunctionTool[] = [
    ...DIRECTOR_TOOLS,
    { type: "function", function: {
        name: "update_task_plan", description: "记录并更新本轮导演任务的步骤。多镜头或多阶段任务先建立计划，按实际结果更新，最多一个步骤进行中。",
        parameters: { type: "object", properties: { steps: { type: "array", minItems: 1, maxItems: 12, items: {
            type: "object", properties: { id: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ["pending", "in_progress", "completed"] } },
            required: ["id", "title", "status"],
        } } }, required: ["steps"] },
    } },
    { type: "function", function: {
        name: "upsert_storyboard_shot", description: "按稳定 shotId 新增或修改一个分镜，保留其他镜头与已有生成节点关联。desc 写明景别、人物动作、机位运镜、时长、声音和连续性要求。nodeId 可关联已存在的图片或视频节点。",
        parameters: { type: "object", properties: { id: { type: "string" }, shotId: { type: "string" }, desc: { type: "string" }, nodeId: { type: "string" } }, required: ["id", "shotId", "desc"] },
    } },
    { type: "function", function: {
        name: "prepare_storyboard_shot", description: "为指定分镜准备图片或视频节点，继承分镜主题与生成参数，建立镜头关联和参考图连线。复用已有匹配节点；只准备，不生成媒体。参考图按 referenceIds 顺序使用。",
        parameters: { type: "object", properties: { id: { type: "string" }, shotId: { type: "string" }, mode: { type: "string", enum: ["image", "video"] }, referenceIds: { type: "array", maxItems: 8, items: { type: "string" } } }, required: ["id", "shotId"] },
    } },
    { type: "function", function: {
        name: "inspect_image", description: "查看图片节点的实际主图，交给当前支持视觉的模型验收构图、人物外观与连续性。仅在收到图像后作视觉判断；工具或模型不支持时明确说明。imageId 可选择节点中的其他成功图片。",
        parameters: { type: "object", properties: { id: { type: "string" }, imageId: { type: "string" } }, required: ["id"] },
    } },
    { type: "function", function: {
        name: "generate_video", description: "对 video 节点提交视频生成并等待结果，必须由用户逐次确认费用与参数。返回实际结果节点和状态。",
        parameters: { type: "object", properties: { id: { type: "string" }, prompt: { type: "string" } }, required: ["id"] },
    } },
    { type: "function", function: {
        name: "disconnect_nodes", description: "移除指定方向的连线，保留两端节点。",
        parameters: { type: "object", properties: { from: { type: "string" }, to: { type: "string" } }, required: ["from", "to"] },
    } },
    { type: "function", function: {
        name: "validate_canvas", description: "检查本次节点的布局、生成失败、分镜媒体关联和失效连线。只检查结构与状态，不能代替 inspect_image 的视觉验收。",
        parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } } },
    } },
    {
        type: "function",
        function: {
            name: "get_canvas_state",
            description: "获取画布上全部节点与连线的摘要。执行任何操作前先调用它了解现状。",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "create_node",
            description:
                "在画布上创建节点并返回其 id。类型：text=文本/提示词（content 为内容，连到 image 节点后并入提示词）；image=图片节点（prompt 为生成提示词，用 generate_image 执行生成）；storyboard=分镜（theme+shots）；director=导演台（3D 白模预演入口，可继续用 configure_director_shot 按分镜脚本编排人物、场景、相机和路径）；doodle=涂鸦画板（用户手绘草图/构图参考，画好后连到 image 节点可作参考图）；config=生成配置节点；runninghub=RunningHub 工作流节点（workflowId/workflowUrl 可选，打开节点后加载详情并编辑输入）。",
            parameters: {
                type: "object",
                properties: {
                    type: { type: "string", enum: [...AGENT_NODE_TYPES] },
                    title: { type: "string", description: "节点标题（可选）" },
                    x: { type: "number", description: "期望节点中心世界坐标 x，冲突时自动避让，使用返回的实际坐标" },
                    y: { type: "number" },
                    afterNodeId: { type: "string", description: "将新节点放在该节点右侧并自动避让，适合从左到右的工作流；不自动连线" },
                    content: { type: "string", description: "text 节点的文本内容" },
                    prompt: { type: "string", description: "image 节点的生成提示词" },
                    model: { type: "string", description: "生成模型（可选）" },
                    genMode: { type: "string", enum: ["image", "video"], description: "storyboard 的生成类型" },
                    resolution: { type: "string", enum: ["auto", "1k", "2k", "4k"], description: "图片分辨率档位" },
                    theme: { type: "string", description: "storyboard 的整体主题/风格基调" },
                    shots: { type: "array", items: { type: "string" }, description: "storyboard 的镜头描述列表" },
                    count: { type: "number", description: "图片生成张数" },
                    background: { type: "string", description: "图片背景模式" },
                    quality: { type: "string" },
                    size: { type: "string" },
                    seconds: { type: "string" },
                    vquality: { type: "string" },
                    generateAudio: { type: "string", description: "视频是否生成音频" },
                    watermark: { type: "string", description: "视频是否添加水印" },
                    videoQuality: { type: "string" },
                    videoResolution: { type: "string" },
                    workflowId: { type: "string", description: "runninghub 工作流 ID" },
                    workflowUrl: { type: "string", description: "runninghub 工作流地址" },
                },
                required: ["type"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "update_node",
            description: "更新节点标题、位置、文本或生成参数。修改已有分镜使用 upsert_storyboard_shot；保留已有媒体和镜头关联。位置冲突自动避让。",
            parameters: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    title: { type: "string" },
                    x: { type: "number", description: "节点左上角世界坐标 x" },
                    y: { type: "number" },
                    content: { type: "string" },
                    prompt: { type: "string" },
                    model: { type: "string" },
                    genMode: { type: "string", enum: ["image", "video"] },
                    resolution: { type: "string", enum: ["auto", "1k", "2k", "4k"] },
                    theme: { type: "string" },
                    shots: { type: "array", items: { type: "string" } },
                    count: { type: "number" },
                    background: { type: "string" },
                    quality: { type: "string" },
                    size: { type: "string" },
                    seconds: { type: "string" },
                    vquality: { type: "string" },
                    generateAudio: { type: "string" },
                    watermark: { type: "string" },
                    videoQuality: { type: "string" },
                    videoResolution: { type: "string" },
                    workflowId: { type: "string" },
                    workflowUrl: { type: "string" },
                },
                required: ["id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_asset_plan",
            description: "按剧本建立资产规划总览、分类索引及独立资产文本节点。每个角色、服装方案、具体场景和道具必须分别提供一条 asset，不能把多个人物写在同一个条目。自动分区避让；同一 source 或 planId 复用已有规划，同分类同名资产更新而不重复创建，不删除未提及资产。只规划，不生成媒体。",
            parameters: {
                type: "object",
                properties: {
                    source: { type: "string", description: "规划依据的剧本/分镜摘要" },
                    planId: { type: "string", description: "补充或修改已有规划时传入 get_canvas_state 或上次创建返回的 planId" },
                    assets: {
                        type: "array",
                        description: "独立资产条目数组，一项对应一个具体角色、一个具体场景或一套服装",
                        minItems: 1,
                        maxItems: 200,
                        items: {
                            type: "object",
                            properties: {
                                category: { type: "string", enum: ASSET_CATEGORIES },
                                name: { type: "string", description: "具体名称，例如林医生、诊室、林医生-白大褂，不写人物清单等大类名称" },
                                description: { type: "string" },
                                details: { type: "string" },
                            },
                            required: ["name"],
                        },
                    },
                },
                required: ["assets"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "delete_nodes",
            description: "删除若干节点及其相关连线。",
            parameters: {
                type: "object",
                properties: { ids: { type: "array", items: { type: "string" } } },
                required: ["ids"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "connect_nodes",
            description: "建立上游到下游的连线。上游 text/config 的内容会并入下游节点的生成提示词，上游 image 会成为下游图片生成的参考图。",
            parameters: {
                type: "object",
                properties: { from: { type: "string" }, to: { type: "string" } },
                required: ["from", "to"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "generate_image",
            description: "对 image 节点执行图片生成，受用户确认的本轮预算限制。空节点写回自身，已有图片产生新结果节点，必须使用返回 nodeIds 判断成果。partial 表示部分失败，不能声称全部完成。",
            parameters: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    prompt: { type: "string" },
                },
                required: ["id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "arrange_grid",
            description: "把指定节点排列成网格并避开未选节点。完成任务时只传本次创建或用户指定的 ids；只有用户明确要求整理整个画布才省略 ids。分组请保持原有包含关系，不用于组内重排。",
            parameters: {
                type: "object",
                properties: {
                    ids: { type: "array", items: { type: "string" } },
                    columns: { type: "integer", minimum: 1 },
                },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "focus_node",
            description: "把视图定位到某个节点，方便用户查看。",
            parameters: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "read_node_content",
            description: "读取某个节点的完整内容（文本节点的全文、图片节点的完整提示词、分镜的完整主题与镜头），用于超出画布摘要 200 字截断的详细查看。",
            parameters: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "list_skills",
            description: "列出 Skill 库中的技能（可复用的指令/方法卡片）。返回每个技能的 id、名称、描述与是否启用。需要按某方法做事、或用户提到某个技能时先调用它。",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "read_skill",
            description: "读取某个 Skill 的完整正文，据此执行其中的方法与步骤。",
            parameters: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "create_skill",
            description: "用户要求沉淀方法时，保存 Markdown Skill 草稿。默认停用，由用户审核后启用。",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "技能名称" },
                    description: { type: "string", description: "一句话说明何时使用" },
                    content: { type: "string", description: "Markdown 正文：适用场景 + 具体步骤" },
                },
                required: ["name", "content"],
            },
        },
    },
];

function nodeSummary(node: CanvasNodeData, connections: CanvasConnection[]) {
    const meta = node.metadata || {};
    const summary: Record<string, unknown> = {
        id: node.id,
        type: node.type,
        title: node.title,
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        width: node.width,
        height: node.height,
    };
    if (meta.content && node.type === CanvasNodeType.Text) summary.content = String(meta.content).slice(0, 200);
    if (meta.prompt) summary.prompt = String(meta.prompt).slice(0, 200);
    for (const key of ["model", "quality", "resolution", "size", "seconds", "vquality", "generateAudio", "watermark", "count", "background"] as const) {
        if (meta[key] !== undefined) summary[key] = meta[key];
    }
    if (meta.status && meta.status !== "idle") summary.status = meta.status;
    if (meta.assetPlan) {
        summary.assetPlan = true;
        summary.planId = meta.assetPlanId;
        summary.assetRole = meta.assetPlanRole;
        summary.assetCategory = meta.assetCategory;
        summary.assetName = meta.assetName;
        summary.parentId = meta.assetParentId;
    }
    if (meta.images?.length) summary.imageCount = meta.images.filter((image) => image.status === "success").length;
    if (meta.images?.length) summary.images = meta.images.map(image => ({ id: image.id, status: image.status }));
    if (node.type === CanvasNodeType.Image && meta.content && !meta.images?.length) summary.hasImage = true;
    if (node.type === "runninghub") {
        summary.workflowId = meta.rhWorkflowId;
        summary.workflowUrl = meta.rhWorkflowUrl;
        summary.workflowNodeCount = Array.isArray((meta.rhWorkflow as { nodes?: unknown } | undefined)?.nodes) ? ((meta.rhWorkflow as { nodes: unknown[] }).nodes.length) : 0;
    }
    if (node.type === STORYBOARD_TYPE) {
        const storyboard = readStoryboardMeta(node);
        summary.theme = storyboard.theme;
        summary.genMode = storyboard.genMode;
        summary.shots = storyboard.shots.map((shot) => ({ id: shot.id, desc: shot.desc.slice(0, 200), nodeId: shot.nodeId }));
        summary.model = storyboard.model;
        summary.size = storyboard.size;
        summary.seconds = storyboard.seconds;
        summary.resolution = storyboard.resolution;
        summary.quality = storyboard.quality;
        summary.videoQuality = storyboard.videoQuality;
        summary.videoResolution = storyboard.videoResolution;
        summary.generateAudio = storyboard.generateAudio;
        summary.watermark = storyboard.watermark;
    }
    const inputs = connections.filter((connection) => connection.toNodeId === node.id).map((connection) => connection.fromNodeId);
    if (inputs.length) summary.inputs = inputs;
    return summary;
}

function toShots(shots: string[] | undefined): StoryboardShot[] {
    return (shots || []).map((desc) => ({ id: nanoid(6), desc }));
}

function workflowIdFromUrl(url: string) {
    return url.match(/\/workflow\/([^/?]+)/i)?.[1] || "";
}

function isStoryboardQuality(value: string | undefined): value is StoryboardMeta["quality"] {
    return value === "auto" || value === "high" || value === "medium" || value === "low";
}

function normalizeStoryboardVideoResolution(value: string | undefined) {
    if (!value) return "";
    const normalized = value.trim().toLowerCase().replace(/p$/, "");
    if (normalized === "4k") return "2160";
    if (normalized === "2k") return "1440";
    return normalized;
}

export type AgentToolOptions = { signal?: AbortSignal; run?: AgentRun };

export async function executeAgentTool(toolkit: AgentToolkit, name: string, rawArgs: string, options?: AgentToolOptions): Promise<Record<string, unknown>> {
    const tracked: AgentToolkit = options?.run ? {
        ...toolkit,
        setNodes: update => {
            const before = toolkit.getNodes();
            toolkit.setNodes(update);
            options.run!.recordChanges(before, toolkit.getNodes());
        },
        setConnections: update => {
            const before = toolkit.getConnections();
            toolkit.setConnections(update);
            const after = toolkit.getConnections();
            const changed = [...before.filter(item => !after.some(next => next.id === item.id)), ...after.filter(item => !before.some(old => old.id === item.id))];
            options.run!.recordAffected([...new Set(changed.flatMap(item => [item.fromNodeId, item.toNodeId]))]);
        },
        generateNode: async (...args) => {
            const before = toolkit.getNodes();
            const result = await toolkit.generateNode(...args);
            const ids = new Set(result?.nodeIds || []);
            options.run!.recordChanges(before.filter(node => ids.has(node.id)), toolkit.getNodes().filter(node => ids.has(node.id)));
            return result;
        },
    } : toolkit;
    try {
        return await executeAgentToolImpl(tracked, name, rawArgs, options);
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error), ...(options?.signal?.aborted ? { canceled: true } : {}) };
    }
}

async function executeAgentToolImpl(toolkit: AgentToolkit, name: string, rawArgs: string, options?: AgentToolOptions): Promise<Record<string, unknown>> {
    options?.run?.countTool();
    let args: Record<string, unknown> = {};
    try {
        const parsed: unknown = JSON.parse(rawArgs || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "工具参数必须是 JSON 对象" };
        args = parsed as Record<string, unknown>;
    } catch {
        return { error: "参数不是合法 JSON" };
    }
    if (options?.signal?.aborted) return { error: "操作已停止" };
    const definition = AGENT_TOOLS.find(tool => tool.function.name === name);
    if (!definition) return { error: `未知工具 ${name}` };
    const validationError = validateAgentArguments(definition.function.parameters, args);
    if (validationError) return { error: validationError };
    const str = (key: string) => (typeof args[key] === "string" ? (args[key] as string) : undefined);
    const num = (key: string) => (typeof args[key] === "number" && Number.isFinite(args[key] as number) ? (args[key] as number) : undefined);
    const strArray = (key: string) => (Array.isArray(args[key]) ? (args[key] as unknown[]).filter((item): item is string => typeof item === "string") : undefined);

    const mutating = ["create_node", "update_node", "create_asset_plan", "delete_nodes", "connect_nodes", "disconnect_nodes", "arrange_grid", "configure_director_shot", "upsert_storyboard_shot", "prepare_storyboard_shot"];
    if (mutating.includes(name)) {
        const before = toolkit.getNodes();
        let ids = name === "connect_nodes" || name === "disconnect_nodes" ? [str("from") || "", str("to") || ""]
            : name === "delete_nodes" || name === "arrange_grid" ? strArray("ids") || before.map(node => node.id)
            : str("id") ? [str("id")!] : [];
        if (name === "create_asset_plan") ids = buildAgentAssetPlan(before, toolkit.getCanvasCenter(), args).updated.map(node => node.id);
        if (name === "prepare_storyboard_shot") {
            const board = before.find(node => node.id === str("id") && node.type === STORYBOARD_TYPE);
            const linked = board && readStoryboardMeta(board).shots.find(shot => shot.id === str("shotId"))?.nodeId;
            if (linked && before.some(node => node.id === linked)) ids.push(linked);
        }
        if (ids.some(id => !before.some(node => node.id === id))) return { error: "操作范围包含不存在的节点" };
        const destructiveDirector = name === "configure_director_shot" && (args.replaceObjects === true || Boolean(strArray("removeObjectIds")?.length));
        const operation = name === "arrange_grid" && args.ids === undefined ? "arrange_all" : destructiveDirector ? "replace_director_content" : name;
        if (!options?.run && ["delete_nodes", "arrange_all", "replace_director_content"].includes(operation)) return { error: "此操作需要任务中的用户确认" };
        await options?.run?.authorizeMutation(operation, ids, before, JSON.stringify(args, null, 2).slice(0, 5000));
        if (options?.signal?.aborted) return { error: "操作已停止" };
        if (ids.some(id => before.find(node => node.id === id) !== toolkit.getNodes().find(node => node.id === id))) {
            return { error: "确认期间节点已改变，请重新读取画布并重新计算操作" };
        }
    }

    switch (name) {
        case "update_task_plan": {
            if (!options?.run) return { error: "没有正在执行的任务" };
            options.run.updatePlan(args.steps as AgentStep[]);
            return { steps: options.run.snapshot().steps };
        }
        case "upsert_storyboard_shot": {
            const node = toolkit.getNodes().find(node => node.id === str("id") && node.type === STORYBOARD_TYPE);
            const shotId = str("shotId")?.trim(), desc = str("desc")?.trim();
            if (!node || !shotId || !desc) return { error: "分镜节点、shotId 和镜头描述不能为空" };
            const meta = readStoryboardMeta(node);
            const linkedId = str("nodeId");
            if (linkedId && !toolkit.getNodes().some(item => item.id === linkedId && [CanvasNodeType.Image, CanvasNodeType.Video].includes(item.type as CanvasNodeType))) return { error: "关联的媒体节点不存在" };
            const existing = meta.shots.find(shot => shot.id === shotId);
            if (!existing && meta.shots.length >= 200) return { error: "单个分镜表最多 200 个镜头" };
            const shot: StoryboardShot = { ...existing, id: shotId, desc, ...(linkedId ? { nodeId: linkedId } : {}) };
            toolkit.setNodes(prev => prev.map(item => item.id === node.id ? writeStoryboardMeta(item, {
                ...meta, shots: existing ? meta.shots.map(item => item.id === shotId ? shot : item) : [...meta.shots, shot],
            }) : item));
            return { updated: node.id, shot, createdShot: !existing };
        }
        case "prepare_storyboard_shot": {
            const all = toolkit.getNodes();
            const node = all.find(node => node.id === str("id") && node.type === STORYBOARD_TYPE);
            if (!node) return { error: "分镜节点不存在" };
            const meta = readStoryboardMeta(node);
            const shot = meta.shots.find(shot => shot.id === str("shotId"));
            if (!shot) return { error: "镜头不存在，请读取分镜中的 shotId" };
            const mode = str("mode") || meta.genMode;
            const refs = [...new Set(strArray("referenceIds") || [])];
            if (refs.some(id => !all.some(node => node.id === id && (node.type === CanvasNodeType.Image || node.type === DOODLE_TYPE) && node.metadata?.content))) return { error: "参考图必须是已有图片或已绘制的涂鸦节点" };
            const existing = all.find(node => node.id === shot.nodeId);
            if (existing) {
                if (existing.type !== mode) return { error: "镜头已关联其他媒体类型，请先用 upsert_storyboard_shot 明确关联目标媒体节点" };
                if (refs.includes(existing.id)) return { error: "图片不能作为自身的上游参考图" };
                if (existing.metadata?.status === "loading") return { error: "镜头媒体正在生成，暂不修改其提示词或参考图" };
                const prompt = composeShotPrompt(meta.theme, shot, meta.shots.indexOf(shot), meta.shots.length);
                toolkit.setNodes(prev => prev.map(item => item.id === existing.id ? { ...item, metadata: { ...item.metadata, prompt } } : item));
                toolkit.setConnections(prev => {
                    let next = args.referenceIds === undefined ? [...prev] : prev.filter(connection => connection.toNodeId !== existing.id || !all.some(node => node.id === connection.fromNodeId && (node.type === CanvasNodeType.Image || node.type === DOODLE_TYPE)));
                    for (const from of [node.id, ...refs]) if (!next.some(connection => connection.fromNodeId === from && connection.toNodeId === existing.id)) next.push({ id: nanoid(), fromNodeId: from, toNodeId: existing.id });
                    return next;
                });
                return { reused: true, nodeId: existing.id, shotId: shot.id, status: existing.metadata?.status, prompt, inputs: toolkit.getConnections().filter(connection => connection.toNodeId === existing.id).map(connection => connection.fromNodeId) };
            }
            const index = meta.shots.indexOf(shot);
            const media = createCanvasNode(mode as CanvasNodeType, toolkit.getCanvasCenter(), {
                prompt: composeShotPrompt(meta.theme, shot, index, meta.shots.length), model: meta.model,
                size: meta.size, count: 1, quality: mode === "image" ? meta.quality : meta.videoQuality,
                resolution: meta.resolution, seconds: meta.seconds, vquality: meta.videoResolution,
                generateAudio: meta.generateAudio, watermark: meta.watermark, status: "idle",
            });
            media.title = `镜头 ${String(index + 1).padStart(2, "0")} · ${mode === "image" ? "画面" : "视频"}`;
            media.position = { x: node.position.x + node.width + AGENT_LAYOUT_GAP, y: node.position.y + index * (media.height + AGENT_LAYOUT_GAP) };
            const [placed] = placeAgentBlock([media], all, media.position.x);
            toolkit.setNodes(prev => [...prev.map(item => item.id === node.id ? writeStoryboardMeta(item, {
                ...meta, shots: meta.shots.map(item => item.id === shot.id ? { ...item, nodeId: placed.id } : item),
            }) : item), placed]);
            toolkit.setConnections(prev => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: placed.id }, ...refs.map(id => ({ id: nanoid(), fromNodeId: id, toNodeId: placed.id }))]);
            return { created: nodeSummary(placed, toolkit.getConnections()), nodeId: placed.id, shotId: shot.id, generatedMedia: false };
        }
        case "inspect_image": {
            const node = toolkit.getNodes().find(node => node.id === str("id") && (node.type === CanvasNodeType.Image || node.type === DOODLE_TYPE));
            if (!node) return { error: "图片节点不存在" };
            const imageId = str("imageId");
            const image = imageId ? node.metadata?.images?.find(image => image.id === imageId && image.status === "success") : undefined;
            if (imageId && !image) return { error: "指定图片尚未成功生成或不存在" };
            const data = image || node.metadata;
            if (!data?.content || !String(data.mimeType || "image/png").startsWith("image/")) return { error: "没有可读取的图片" };
            if ((data.bytes || 0) > 6 * 1024 * 1024) return { error: "图片超过 6 MiB，请先缩小后再验收" };
            const { imageToDataUrl } = await import("@/services/image-storage");
            const dataUrl = await imageToDataUrl({ url: data.content, storageKey: data.storageKey });
            if (options?.signal?.aborted) return { error: "操作已停止" };
            if (!dataUrl.startsWith("data:image/") || dataUrl.length > 8 * 1024 * 1024) return { error: "图片读取失败或超出视觉输入大小限制" };
            return { id: node.id, title: node.title, imageId: image?.id || node.metadata?.primaryImageId || node.metadata?.images?.find(image => image.status === "success")?.id, prompt: node.metadata?.prompt,
                _image: { dataUrl, nodeId: node.id }, visualReviewRequired: true };
        }
        case "validate_canvas": {
            const all = toolkit.getNodes(), connections = toolkit.getConnections();
            const requested = strArray("ids") ?? (options?.run ? [...new Set([...options.run.snapshot().createdNodeIds, ...options.run.snapshot().changedNodeIds])] : all.map(node => node.id));
            const ids = new Set(requested);
            const targets = all.filter(node => ids.has(node.id));
            const issues: { nodeId?: string; message: string }[] = [];
            for (const node of targets) {
                if (node.metadata?.status === "error" || node.metadata?.status === "loading") issues.push({ nodeId: node.id, message: node.metadata.status === "loading" ? "生成仍在进行" : node.metadata.errorDetails || "生成失败" });
                if (node.metadata?.images?.some(image => image.status === "error")) issues.push({ nodeId: node.id, message: "部分图片生成失败" });
                if (node.type === STORYBOARD_TYPE) for (const shot of readStoryboardMeta(node).shots) {
                    if (shot.nodeId && !all.some(item => item.id === shot.nodeId)) issues.push({ nodeId: node.id, message: `镜头 ${shot.id} 的媒体关联已失效` });
                }
            }
            for (const connection of connections) if ((ids.has(connection.fromNodeId) || ids.has(connection.toNodeId)) && (!all.some(node => node.id === connection.fromNodeId) || !all.some(node => node.id === connection.toNodeId))) issues.push({ message: `连线 ${connection.id} 指向不存在的节点` });
            for (const node of all.filter(node => node.type === STORYBOARD_TYPE && !ids.has(node.id))) {
                for (const shot of readStoryboardMeta(node).shots) if (shot.nodeId && ids.has(shot.nodeId) && !all.some(item => item.id === shot.nodeId)) {
                    issues.push({ nodeId: node.id, message: `镜头 ${shot.id} 的媒体关联已失效` });
                }
            }
            const pairs = new Set<string>();
            for (const target of targets.filter(node => node.type !== CanvasNodeType.Group)) for (const other of all) {
                if (target.id === other.id || other.type === CanvasNodeType.Group || !rectanglesOverlap(target, other, 0)) continue;
                const key = [target.id, other.id].sort().join(":");
                if (!pairs.has(key)) issues.push({ nodeId: target.id, message: `与节点 ${other.id} 重叠` });
                pairs.add(key);
            }
            return { checked: targets.map(node => node.id), issues, passed: issues.length === 0, visualChecked: false };
        }
        case 'get_director_scene':
        case 'configure_director_shot': {
            const id = str('id');
            const node = toolkit.getNodes().find(item => item.id === id && item.type === CanvasNodeType.Director);
            if (!id || !node) return { error: '导演台节点不存在' };
            try {
                const project = await directorProjectRequest(id, undefined, options?.signal);
                if (name === 'get_director_scene') return { project, coordinateSystem: '米；Y向上；人物朝+Z；rotation为弧度；camera.target为注视点' };
                const next = buildDirectorShot(project, args);
                await directorProjectRequest(id, next, options?.signal);
                options?.run?.recordAffected([id]);
                return { updated: id, shotId: next.activeShotId, shots: next.shots.length, objects: next.objects.length, pathPoints: next.keyframes.length };
            } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
        }
        case "get_canvas_state": {
            options?.run?.markCanvasRead();
            const connections = toolkit.getConnections();
            const nodes = toolkit.getNodes();
            return {
                nodes: nodes.map((node) => nodeSummary(node, connections)),
                connections: connections.map((connection) => ({ from: connection.fromNodeId, to: connection.toNodeId })),
                layout: agentLayoutSummary(nodes),
                selectedNodeIds: toolkit.getSelectedNodeIds?.() || [],
                task: options?.run?.snapshot(),
            };
        }
        case "create_node": {
            const type = str("type") as AgentNodeType | undefined;
            if (!type || !AGENT_NODE_TYPES.includes(type)) return { error: `未知节点类型 ${String(args.type)}` };
            const existing = toolkit.getNodes();
            const afterId = str("afterNodeId");
            const anchor = afterId ? existing.find(node => node.id === afterId) : undefined;
            if (afterId && !anchor) return { error: "布局参照节点不存在" };
            const center = toolkit.getCanvasCenter();
            const position = { x: num("x") ?? center.x, y: num("y") ?? center.y };
            const typeId = type === "storyboard" ? STORYBOARD_TYPE : type === "doodle" ? DOODLE_TYPE : (type as CanvasNodeType);
            const workflowUrl = str("workflowUrl");
            const workflowId = str("workflowId") || workflowIdFromUrl(workflowUrl || "") || (workflowUrl !== undefined ? "" : undefined);
            let node = createCanvasNode(typeId, position, {
                ...(type === "image" ? { count: 1 } : {}),
                ...(str("content") !== undefined ? { content: str("content") } : {}),
                ...(str("prompt") !== undefined ? { prompt: str("prompt") } : {}),
                ...(str("model") !== undefined ? { model: str("model") } : {}),
                ...(str("resolution") && ["auto", "1k", "2k", "4k"].includes(str("resolution") as string) ? { resolution: str("resolution") as "auto" | "1k" | "2k" | "4k" } : {}),
                ...(str("quality") !== undefined ? { quality: str("quality") } : {}),
                ...(str("size") !== undefined ? { size: str("size") } : {}),
                ...(str("seconds") !== undefined ? { seconds: str("seconds") } : {}),
                ...(str("vquality") !== undefined ? { vquality: str("vquality") } : {}),
                ...(num("count") !== undefined ? { count: Math.max(1, Math.min(15, Math.floor(num("count") as number))) } : {}),
                ...(str("background") !== undefined ? { background: str("background") } : {}),
                ...(str("generateAudio") !== undefined ? { generateAudio: str("generateAudio") } : {}),
                ...(str("watermark") !== undefined ? { watermark: str("watermark") } : {}),
                ...(workflowId !== undefined ? { rhWorkflowId: workflowId } : {}),
                ...(workflowUrl !== undefined ? { rhWorkflowUrl: workflowUrl } : {}),
            });
            if (str("title")) node = { ...node, title: str("title") as string };
            if (type === "storyboard") {
                const current = readStoryboardMeta(node);
                node = writeStoryboardMeta(node, {
                    ...current,
                    theme: str("theme") || "",
                    shots: toShots(strArray("shots")),
                    genMode: str("genMode") === "video" ? "video" : str("genMode") === "image" ? "image" : current.genMode,
                    model: str("model") ?? current.model,
                    size: str("size") ?? current.size,
                    seconds: str("seconds") ?? current.seconds,
                    quality: isStoryboardQuality(str("quality")) ? str("quality") as StoryboardMeta["quality"] : current.quality,
                    resolution: str("resolution") === "auto" || str("resolution") === "1k" || str("resolution") === "2k" || str("resolution") === "4k" ? str("resolution") as StoryboardMeta["resolution"] : current.resolution,
                    videoQuality: isStoryboardQuality(str("videoQuality")) ? str("videoQuality") as StoryboardMeta["videoQuality"] : current.videoQuality,
                    videoResolution: normalizeStoryboardVideoResolution(str("videoResolution")) || current.videoResolution,
                    generateAudio: str("generateAudio") === "false" ? "false" : str("generateAudio") === "true" ? "true" : current.generateAudio,
                    watermark: str("watermark") === "true" ? "true" : str("watermark") === "false" ? "false" : current.watermark,
                });
            }
            if (anchor) node.position = { x: anchor.position.x + anchor.width + AGENT_LAYOUT_GAP, y: anchor.position.y };
            const preferred = node.position;
            [node] = placeAgentBlock([node], existing, anchor ? preferred.x : -Infinity);
            toolkit.setNodes((prev) => [...prev, node]);
            return { created: nodeSummary(node, []), layoutAdjusted: node.position.x !== preferred.x || node.position.y !== preferred.y };
        }
        case "update_node": {
            const id = str("id");
            const target = toolkit.getNodes().find((node) => node.id === id);
            if (!id || !target) return { error: "节点不存在" };
            if (str("content") !== undefined && target.type !== CanvasNodeType.Text && target.type !== CanvasNodeType.Config) return { error: "content 只用于文本节点。分镜请用 upsert_storyboard_shot；媒体内容不可直接覆盖" };
            if (target.type === STORYBOARD_TYPE && args.shots !== undefined && readStoryboardMeta(target).shots.length) {
                return { error: "已有镜头必须用 upsert_storyboard_shot 按稳定 shotId 修改，保留媒体关联" };
            }
            let position: Position | undefined;
            if (num("x") !== undefined || num("y") !== undefined) {
                if (target.type === CanvasNodeType.Group || target.metadata?.groupId) return { error: "请先解除分组，再移动单个节点，以免破坏分组关系" };
                position = findAgentPosition({ ...target, position: { x: num("x") ?? target.position.x, y: num("y") ?? target.position.y } }, toolkit.getNodes().filter(node => node.id !== id));
            }
            toolkit.setNodes((prev) =>
                prev.map((node) => {
                    if (node.id !== id) return node;
                    const metadata = { ...node.metadata };
                    if (str("content") !== undefined) metadata.content = str("content");
                    if (str("prompt") !== undefined) metadata.prompt = str("prompt");
                    if (str("model") !== undefined) metadata.model = str("model");
                    if (str("resolution") !== undefined && ["auto", "1k", "2k", "4k"].includes(str("resolution") as string)) metadata.resolution = str("resolution") as "auto" | "1k" | "2k" | "4k";
                    for (const key of ["quality", "size", "seconds", "vquality", "generateAudio", "watermark", "background"] as const) {
                        if (str(key) !== undefined) metadata[key] = str(key);
                    }
                    if (num("count") !== undefined) metadata.count = Math.max(1, Math.min(15, Math.floor(num("count") as number)));
                    const workflowUrl = str("workflowUrl");
                    if (str("workflowId") !== undefined || workflowUrl !== undefined) metadata.rhWorkflowId = str("workflowId") || workflowIdFromUrl(workflowUrl || "") || "";
                    if (workflowUrl !== undefined) metadata.rhWorkflowUrl = workflowUrl;
                    let next: CanvasNodeData = { ...node, metadata };
                    if (str("title") !== undefined) next.title = str("title") as string;
                    if (position) next.position = position;
                    if (
                        node.type === STORYBOARD_TYPE &&
                        (str("theme") !== undefined ||
                            strArray("shots") ||
                            str("genMode") !== undefined ||
                            str("model") !== undefined ||
                            str("size") !== undefined ||
                            str("seconds") !== undefined ||
                            str("quality") !== undefined ||
                            str("resolution") !== undefined ||
                            str("videoQuality") !== undefined ||
                            str("videoResolution") !== undefined ||
                            str("generateAudio") !== undefined ||
                            str("watermark") !== undefined)
                    ) {
                        const current = readStoryboardMeta(node);
                        next = writeStoryboardMeta(next, {
                            ...current,
                            theme: str("theme") ?? current.theme,
                            shots: strArray("shots") ? toShots(strArray("shots")) : current.shots,
                            genMode: str("genMode") === "video" ? "video" : str("genMode") === "image" ? "image" : current.genMode,
                            model: str("model") ?? current.model,
                            size: str("size") ?? current.size,
                            seconds: str("seconds") ?? current.seconds,
                            quality: isStoryboardQuality(str("quality")) ? str("quality") as StoryboardMeta["quality"] : current.quality,
                            resolution: str("resolution") === "1k" || str("resolution") === "2k" || str("resolution") === "4k" || str("resolution") === "auto" ? str("resolution") as StoryboardMeta["resolution"] : current.resolution,
                            videoQuality: isStoryboardQuality(str("videoQuality")) ? str("videoQuality") as StoryboardMeta["videoQuality"] : current.videoQuality,
                            videoResolution: normalizeStoryboardVideoResolution(str("videoResolution")) || current.videoResolution,
                            generateAudio: str("generateAudio") === "false" ? "false" : str("generateAudio") === "true" ? "true" : current.generateAudio,
                            watermark: str("watermark") === "true" ? "true" : str("watermark") === "false" ? "false" : current.watermark,
                        });
                    }
                    return next;
                }),
            );
            return { updated: id, position: position || target.position };
        }
        case "create_asset_plan": {
            try {
                const result = buildAgentAssetPlan(toolkit.getNodes(), toolkit.getCanvasCenter(), args);
                toolkit.setNodes(result.nodes);
                return {
                    planId: result.planId, overviewId: result.overviewId, assetCount: result.assetCount,
                    created: result.created.map(node => nodeSummary(node, [])),
                    updated: result.updated.map(node => nodeSummary(node, [])),
                    generatedMedia: false,
                };
            } catch (error) {
                return { error: error instanceof Error ? error.message : String(error) };
            }
        }
        case "delete_nodes": {
            const ids = new Set(strArray("ids") || []);
            if (!ids.size) return { error: "ids 为空" };
            if (toolkit.getNodes().some(node => ids.has(node.id) && (node.type === CanvasNodeType.Group || node.metadata?.groupId))) return { error: "请先在画布解除分组，再删除节点" };
            toolkit.setNodes((prev) => prev.filter((node) => !ids.has(node.id)));
            toolkit.setConnections((prev) => prev.filter((connection) => !ids.has(connection.fromNodeId) && !ids.has(connection.toNodeId)));
            return { deleted: [...ids] };
        }
        case "connect_nodes": {
            const from = str("from");
            const to = str("to");
            const nodes = toolkit.getNodes();
            if (!from || !to || from === to) return { error: "from/to 无效" };
            if (!nodes.some((node) => node.id === from) || !nodes.some((node) => node.id === to)) return { error: "节点不存在" };
            const normalized = normalizeConnection(from, to, nodes, "source");
            if (!normalized) return { error: "这两个节点不能建立有效连线" };
            if (toolkit.getConnections().some((connection) => connection.fromNodeId === normalized.fromNodeId && connection.toNodeId === normalized.toNodeId)) return { connected: normalized, reused: true };
            toolkit.setConnections((prev) => [...prev, { id: nanoid(), ...normalized }]);
            return { connected: normalized };
        }
        case "disconnect_nodes": {
            const from = str("from"), to = str("to");
            const matches = toolkit.getConnections().filter(connection => connection.fromNodeId === from && connection.toNodeId === to);
            toolkit.setConnections(prev => prev.filter(connection => !matches.some(match => match.id === connection.id)));
            return { disconnected: matches.length, from, to };
        }
        case "generate_image":
        case "generate_video": {
            const id = str("id");
            const target = toolkit.getNodes().find((node) => node.id === id);
            if (!id || !target) return { error: "节点不存在" };
            const mode = name === "generate_video" ? "video" : "image";
            if (target.type !== mode) return { error: `只能对 ${mode} 节点执行生成` };
            if (target.metadata?.status === "loading") return { error: "节点已有生成任务，请等待完成" };
            const prompt = str("prompt") || target.metadata?.prompt || "";
            if (!prompt.trim()) return { error: "提示词为空" };
            if (!options?.run || !toolkit.describeGeneration) return { error: "媒体生成需要任务预算与用户确认" };
            const quote = toolkit.describeGeneration(id, mode);
            await options.run.reserveGeneration(quote, target);
            if (options?.signal?.aborted) return { error: "操作已停止" };
            if (target !== toolkit.getNodes().find(node => node.id === id) || JSON.stringify(quote) !== JSON.stringify(toolkit.describeGeneration(id, mode))) {
                options.run.releaseUnsubmittedGeneration(quote);
                return { error: "确认期间节点或生成参数已改变，未提交请求，请重新检查" };
            }
            const result = await toolkit.generateNode(id, mode, prompt, options?.signal);
            if (result?.requested === 0 && result.nodeIds?.length === 0) options.run.releaseUnsubmittedGeneration(quote);
            if (!result || !result.nodeIds?.length || !["success", "partial", "failed", "canceled"].includes(result.status)) return { ok: false, error: result?.error || "生成没有返回有效结果节点" };
            if (result.status === "success" && result.succeeded === 0) return { ok: false, error: "没有生成成功的媒体" };
            if (result.status === "success" && result.nodeIds.some(id => !toolkit.getNodes().some(node => node.id === id))) {
                return { ...result, ok: false, error: "请求已完成，但结果节点已被移除或不可用，请检查生成历史" };
            }
            return { ...result, ok: result.status === "success", ...(mode === "image" ? { images: result.succeeded } : {}) };
        }
        case "arrange_grid": {
            if (args.ids !== undefined && (!Array.isArray(args.ids) || args.ids.some(id => typeof id !== "string" || !id.trim()))) return { error: "ids 必须是节点 ID 数组；不会因无效参数重排整个画布" };
            const idsInput = strArray("ids");
            const all = toolkit.getNodes();
            const targets = idsInput ? all.filter((node) => idsInput.includes(node.id)) : all;
            if (!targets.length) return { error: "没有可排列的节点" };
            if (idsInput?.some(id => !all.some(node => node.id === id))) return { error: "排列列表包含不存在的节点" };
            if (targets.some(node => node.type === CanvasNodeType.Group || node.metadata?.groupId)) return { error: "请只选择未分组节点排列，分组内容保持原位" };
            const ids = new Set(targets.map(node => node.id));
            const arranged = arrangeAgentGrid(targets, all.filter(node => !ids.has(node.id)), num("columns"));
            const replacements = new Map(arranged.map(node => [node.id, node]));
            toolkit.setNodes((prev) => prev.map(node => replacements.get(node.id) || node));
            return { arranged: targets.length, nodes: arranged.map(node => ({ id: node.id, ...node.position, width: node.width, height: node.height })) };
        }
        case "focus_node": {
            const id = str("id");
            if (!id || !toolkit.getNodes().some((node) => node.id === id)) return { error: "节点不存在" };
            toolkit.focusNode(id);
            return { focused: id };
        }
        case "read_node_content": {
            const id = str("id");
            const node = toolkit.getNodes().find((item) => item.id === id);
            if (!id || !node) return { error: "节点不存在" };
            const meta = node.metadata || {};
            if (node.type === STORYBOARD_TYPE) {
                const storyboard = readStoryboardMeta(node);
                return {
                    id: node.id,
                    type: node.type,
                    title: node.title,
                    theme: storyboard.theme,
                    genMode: storyboard.genMode,
                    shots: storyboard.shots,
                    model: storyboard.model,
                    quality: storyboard.quality,
                    resolution: storyboard.resolution,
                    videoQuality: storyboard.videoQuality,
                    videoResolution: storyboard.videoResolution,
                    generateAudio: storyboard.generateAudio,
                    watermark: storyboard.watermark,
                    size: storyboard.size,
                    seconds: storyboard.seconds,
                };
            }
            if (node.type === "runninghub") {
                const workflow = meta.rhWorkflow && typeof meta.rhWorkflow === "object" ? (meta.rhWorkflow as { nodes?: unknown[] }) : {};
                return {
                    id: node.id,
                    type: node.type,
                    title: node.title,
                    workflowId: meta.rhWorkflowId,
                    workflowUrl: meta.rhWorkflowUrl,
                    workflowNodeCount: Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
                    inputs: Array.isArray(meta.rhInputs)
                        ? meta.rhInputs.map((input) => ({
                              nodeId: input.nodeId,
                              nodeTitle: input.nodeTitle,
                              fieldName: input.fieldName,
                              fieldValue: input.fieldValue,
                              valueType: input.valueType,
                          }))
                        : [],
                    status: meta.status,
                    taskId: meta.rhTaskId,
                };
            }
            return {
                id: node.id,
                type: node.type,
                title: node.title,
                content: node.type === CanvasNodeType.Text && typeof meta.content === "string" ? meta.content : undefined,
                prompt: typeof meta.prompt === "string" ? meta.prompt : undefined,
                ...(meta.assetPlan ? { planId: meta.assetPlanId, assetRole: meta.assetPlanRole, assetCategory: meta.assetCategory, assetName: meta.assetName, parentId: meta.assetParentId } : {}),
                status: meta.status,
                imageCount: meta.images?.filter((image) => image.status === "success").length,
            };
        }
        case "list_skills": {
            return {
                skills: getSkillStore().skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, enabled: skill.enabled, source: skill.source })),
            };
        }
        case "read_skill": {
            const id = str("id");
            const skill = getSkillStore().skills.find((item) => item.id === id);
            if (!id || !skill) return { error: "技能不存在" };
            if (!skill.enabled) return { error: "技能尚未启用，请由用户审核启用后再读取执行" };
            return { id: skill.id, name: skill.name, description: skill.description, content: skill.content, enabled: skill.enabled };
        }
        case "create_skill": {
            const name = str("name");
            const content = str("content");
            if (!name || !content?.trim()) return { error: "name 与 content 不能为空" };
            if (content.length > 24000 || name.length > 100) return { error: "技能名称最多 100 字符，正文最多 24,000 字符" };
            const skill = getSkillStore().addSkill({ name, description: str("description"), content, source: "agent", enabled: false });
            return { created: { id: skill.id, name: skill.name, enabled: false }, reviewRequired: true };
        }
        default:
            return { error: `未知工具 ${name}` };
    }
}
