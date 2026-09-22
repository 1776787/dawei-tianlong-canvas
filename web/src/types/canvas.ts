import type { AgentRunState } from "./agent";

export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Group = "group",
    Director = "director",
}

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";
export type CanvasImageResolution = "auto" | "1k" | "2k" | "4k";

export type CanvasNodeImage = {
    id: string;
    status: CanvasNodeStatus;
    pendingImageUrl?: string;
    errorDetails?: string;
    content: string;
    storageKey: string;
    naturalWidth: number;
    naturalHeight: number;
    bytes: number;
    mimeType: string;
};

export type CanvasNodeMetadata = {
    content?: string;
    pendingImageUrl?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    quality?: string;
    resolution?: CanvasImageResolution;
    background?: string;
    count?: number;
    textCount?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    images?: CanvasNodeImage[];
    primaryImageId?: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    groupId?: string;
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
    assetCategory?: string;
    assetPlan?: boolean;
    assetPlanId?: string;
    assetPlanRole?: "overview" | "category" | "asset";
    assetParentId?: string;
    assetName?: string;
    assetKey?: string;
    assetDescription?: string;
    assetDetails?: string;
    assetSource?: string;
    assetFingerprint?: string;
    rhWorkflowId?: string;
    rhWorkflowUrl?: string;
    rhWorkflowTitle?: string;
    rhWorkflow?: { nodes?: unknown[]; raw?: unknown };
    rhLayout?: { positions: Record<string, Position>; viewport?: { x: number; y: number; zoom: number } };
    rhInputs?: Array<{ nodeId: string; nodeTitle: string; fieldName: string; fieldValue: unknown; valueType: "string" | "number" | "boolean" | "json" }>;
    rhBindings?: Array<{ sourceNodeId: string; sourceNodeTitle: string; kind: "text" | "image" | "video"; label: string; value?: string; previewUrl?: string }>;
    rhBindingOrder?: string[];
    rhBindingTargets?: Record<string, string>;
    rhDisabledBindings?: string[];
    rhReferenceSwitchTargets?: Record<string, string>;
    rhDisabledReferencePorts?: string[];
    rhInputPreviews?: Record<string, { value: string; storageKey: string; name: string; kind: "image" | "video" }>;
    rhTaskId?: string;
    rhQueryWarning?: string;
    rhResults?: Array<{ url: string; outputType?: string; nodeId?: string }>;
    rhPreviewIndex?: number;
    rhAccessPassword?: string;
    rhInstanceType?: string;
    rhUsePersonalQueue?: boolean;
    rhRetainSeconds?: number;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
    agentRun?: AgentRunState;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
