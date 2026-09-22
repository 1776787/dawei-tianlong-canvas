export type AgentStep = {
    id: string;
    title: string;
    status: "pending" | "in_progress" | "completed";
};

export type AgentRunState = {
    id: string;
    objective: string;
    status: "running" | "waiting_approval" | "completed" | "stopped" | "failed" | "needs_followup";
    steps: AgentStep[];
    createdNodeIds: string[];
    changedNodeIds: string[];
    imageLimit: number;
    imagesRequested: number;
    videosRequested: number;
    toolCalls: number;
    round: number;
    startedAt: string;
    updatedAt: string;
    error?: string;
    pendingImageReviews?: string[];
};

export type AgentApproval = {
    title: string;
    description: string;
    nodeTitles: string[];
    kind: "edit" | "delete" | "layout" | "image" | "video";
    details?: string;
};

export type AgentGenerationQuote = {
    mode: "image" | "video";
    count: number;
    model: string;
    size: string;
    quality: string;
    resolution?: string;
    seconds?: string;
};

export type CanvasGenerationResult = {
    status: "success" | "partial" | "failed" | "canceled";
    sourceNodeId: string;
    nodeIds: string[];
    requested: number;
    succeeded: number;
    failed: number;
    error?: string;
};
