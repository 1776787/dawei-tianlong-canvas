import axios from "axios";

import { proxyApiUrl } from "@/lib/api-proxy";
import { normalizeRunningHubBaseUrl, RUNNINGHUB_BASE_URL } from "@/lib/runninghub-config";

export { normalizeRunningHubBaseUrl, RUNNINGHUB_BASE_URL };

export type RunningHubNode = {
    nodeId: string;
    classType: string;
    title: string;
    inputs: Record<string, unknown>;
    upstreamNodeIds?: string[];
};

export type RunningHubInput = {
    nodeId: string;
    nodeTitle: string;
    fieldName: string;
    fieldValue: unknown;
    valueType: "string" | "number" | "boolean" | "json";
};

export type RunningHubWorkflowDetail = {
    workflowId: string;
    nodes: RunningHubNode[];
    inputs: RunningHubInput[];
    raw: Record<string, unknown>;
};

export type RunningHubResult = {
    url: string;
    outputType?: string;
    nodeId?: string;
};

export class RunningHubTaskFailedError extends Error {}
export class RunningHubQueryPendingError extends Error {}
class RunningHubTransientQueryError extends Error {}

export function normalizeRunningHubTaskResponse(value: unknown) {
    const data = unwrapData(value);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new RunningHubQueryPendingError("RunningHub 查询返回格式异常，请继续查询已有任务");
    const response = data as Record<string, unknown>;
    const status = String(response.status || response.taskStatus || "").trim().toUpperCase();
    const items = response.results ?? response.outputs ?? [];
    if (!Array.isArray(items)) throw new RunningHubQueryPendingError("RunningHub 结果格式异常，请继续查询已有任务");
    const results: RunningHubResult[] = items.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const url = item.url || item.fileUrl;
        if (typeof url !== "string" || !url.trim()) return [];
        return [{ url, outputType: typeof (item.outputType || item.fileType) === "string" ? item.outputType || item.fileType : undefined, nodeId: item.nodeId == null ? undefined : String(item.nodeId) }];
    });
    return { status, results, error: String(response.errorMessage || response.message || response.msg || response.errorCode || `RunningHub task ${status.toLowerCase()}`) };
}

type RunningHubResponse = {
    code?: number | string;
    msg?: string;
    message?: string;
    data?: unknown;
};

function endpoint(baseUrl: string, path: string) {
    return proxyApiUrl(`${normalizeRunningHubBaseUrl(baseUrl).replace(/\/+$/, "")}${path}`);
}

function unwrapData(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    const response = value as RunningHubResponse;
    if (response.code !== undefined && response.code !== 0 && response.code !== "0") {
        throw new Error(response.msg || response.message || `RunningHub request failed (${response.code})`);
    }
    return response.data ?? value;
}

function readError(error: unknown) {
    if (axios.isAxiosError(error)) {
        const response = error.response?.data as RunningHubResponse | undefined;
        return response?.msg || response?.message || error.message;
    }
    return error instanceof Error ? error.message : String(error);
}

async function postJson(baseUrl: string, path: string, apiKey: string, body: unknown, signal?: AbortSignal) {
    if (!apiKey.trim()) throw new Error("RunningHub API key is required");
    try {
        const response = await axios.post(endpoint(baseUrl, path), body, {
            timeout: path === "/openapi/v2/query" ? 30000 : 0,
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            signal,
        });
        return unwrapData(response.data);
    } catch (error) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        if (path === "/openapi/v2/query" && axios.isAxiosError(error) && (!error.response || error.response.status === 408 || error.response.status === 429 || error.response.status >= 500)) {
            throw new RunningHubTransientQueryError(readError(error));
        }
        throw new Error(readError(error));
    }
}

export function parseRunningHubWorkflowJson(raw: unknown): Record<string, unknown> {
    if (typeof raw === "string") {
        try {
            raw = JSON.parse(raw);
        } catch {
            throw new Error("RunningHub returned an invalid workflow JSON");
        }
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("RunningHub returned an empty workflow");
    return raw as Record<string, unknown>;
}

export function isRunningHubLink(value: unknown): value is [string | number, number] {
    return Array.isArray(value) && value.length === 2 && (typeof value[0] === "string" || typeof value[0] === "number") && Number.isInteger(value[1]) && value[1] >= 0;
}

function inputType(value: unknown): RunningHubInput["valueType"] {
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "string") return "string";
    return "json";
}

export function workflowInputsFromNodes(nodes: RunningHubNode[]): RunningHubInput[] {
    return nodes.flatMap((node) =>
        Object.entries(node.inputs).flatMap(([fieldName, fieldValue]) => {
            if (isRunningHubLink(fieldValue)) return [];
            return [{ nodeId: node.nodeId, nodeTitle: node.title, fieldName, fieldValue, valueType: inputType(fieldValue) }];
        }),
    );
}

export async function fetchRunningHubWorkflow(options: { workflowId: string; apiKey: string; baseUrl?: string; signal?: AbortSignal }): Promise<RunningHubWorkflowDetail> {
    const workflowId = options.workflowId.trim();
    if (!workflowId) throw new Error("RunningHub workflow ID is required");
    const data = (await postJson(options.baseUrl || RUNNINGHUB_BASE_URL, "/api/openapi/getJsonApiFormat", options.apiKey, { apiKey: options.apiKey, workflowId }, options.signal)) as { prompt?: unknown } | Record<string, unknown>;
    const raw = parseRunningHubWorkflowJson((data as { prompt?: unknown }).prompt ?? data);
    return runningHubWorkflowDetailFromRaw(workflowId, raw);
}

export function runningHubWorkflowDetailFromRaw(workflowId: string, rawValue: unknown): RunningHubWorkflowDetail {
    const raw = parseRunningHubWorkflowJson(rawValue);
    const nodes = Object.entries(raw)
        .filter(([, value]) => value && typeof value === "object" && !Array.isArray(value) && typeof (value as { class_type?: unknown }).class_type === "string")
        .map(([nodeId, value]) => {
            const node = value as { class_type?: unknown; inputs?: unknown; _meta?: { title?: unknown } };
            const inputs = node.inputs && typeof node.inputs === "object" && !Array.isArray(node.inputs) ? (node.inputs as Record<string, unknown>) : {};
            return {
                nodeId,
                classType: typeof node.class_type === "string" ? node.class_type : "Node",
                title: typeof node._meta?.title === "string" ? node._meta.title : typeof node.class_type === "string" ? node.class_type : `Node ${nodeId}`,
                inputs,
                upstreamNodeIds: [...new Set(Object.values(inputs).flatMap((input) => (isRunningHubLink(input) ? [String(input[0])] : [])))],
            };
        });
    if (!nodes.length) throw new Error("RunningHub returned an empty workflow");
    return { workflowId: workflowId.trim(), nodes, inputs: workflowInputsFromNodes(nodes), raw };
}

export function valueForRunningHubInput(input: RunningHubInput) {
    if (input.valueType === "number") {
        if (input.fieldValue === null || String(input.fieldValue).trim() === "") throw new Error(`${input.fieldName}: a number is required`);
        const value = Number(input.fieldValue);
        if (!Number.isFinite(value)) throw new Error(`${input.fieldName}: invalid number`);
        // Keep large integer seeds as strings instead of rounding them in JavaScript.
        return Number.isInteger(value) && !Number.isSafeInteger(value) ? String(input.fieldValue) : value;
    }
    if (input.valueType === "boolean") return input.fieldValue === true || input.fieldValue === "true";
    if (input.valueType === "json" && typeof input.fieldValue === "string") {
        try {
            return JSON.parse(input.fieldValue);
        } catch {
            throw new Error(`${input.fieldName}: invalid JSON`);
        }
    }
    return input.fieldValue;
}

export function toRunningHubNodeInfoList(inputs: RunningHubInput[]) {
    return inputs.map((input) => ({ nodeId: input.nodeId, fieldName: input.fieldName, fieldValue: valueForRunningHubInput(input) }));
}

export function runningHubRawWithInputs(raw: Record<string, unknown>, inputs: RunningHubInput[]): Record<string, unknown> {
    const next = { ...raw };
    for (const input of inputs) {
        const node = next[input.nodeId] as { inputs?: Record<string, unknown> } | undefined;
        if (!node?.inputs || !Object.hasOwn(node.inputs, input.fieldName) || isRunningHubLink(node.inputs[input.fieldName])) continue;
        try {
            next[input.nodeId] = { ...node, inputs: { ...node.inputs, [input.fieldName]: valueForRunningHubInput(input) } };
        } catch {
            // Invalid drafts stay editable; the executable JSON keeps its last valid value.
        }
    }
    return next;
}

export function sameRunningHubStructure(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
    const signature = (raw: Record<string, unknown>) => Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => {
        const node = value as { class_type?: unknown; inputs?: Record<string, unknown> };
        return [id, node?.class_type, Object.entries(node?.inputs || {}).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [name, isRunningHubLink(value) ? value : null])];
    });
    return JSON.stringify(signature(before)) === JSON.stringify(signature(after));
}

export async function runRunningHubWorkflow(options: {
    workflow?: Record<string, unknown>;
    workflowId: string;
    apiKey: string;
    inputs: RunningHubInput[];
    baseUrl?: string;
    accessPassword?: string;
    instanceType?: string;
    usePersonalQueue?: boolean;
    retainSeconds?: number;
    signal?: AbortSignal;
    intervalMs?: number;
    timeoutMs?: number;
    onTaskCreated?: (taskId: string) => void;
    getQuerySignal?: () => AbortSignal | undefined;
}) {
    const body: Record<string, unknown> = {
        apiKey: options.apiKey,
        workflowId: options.workflowId.trim(),
        nodeInfoList: toRunningHubNodeInfoList(options.inputs),
    };
    if (options.accessPassword?.trim()) body.accessPassword = options.accessPassword.trim();
    if (options.workflow) body.workflow = JSON.stringify(options.workflow);
    // Standard uses the API's default instance; other tiers are explicit.
    const instanceType = options.instanceType?.trim().toLowerCase();
    if (instanceType && instanceType !== "standard") body.instanceType = instanceType;
    if (options.usePersonalQueue) body.usePersonalQueue = true;
    if (options.retainSeconds && Number.isFinite(options.retainSeconds)) body.retainSeconds = options.retainSeconds;

    const response = (await postJson(options.baseUrl || RUNNINGHUB_BASE_URL, "/task/openapi/create", options.apiKey, body, options.signal)) as { taskId?: string; taskStatus?: string } | Record<string, unknown>;
    const taskId = String((response as { taskId?: unknown }).taskId || "");
    if (!taskId) throw new Error("RunningHub did not return a task ID");
    options.onTaskCreated?.(taskId);
    return pollRunningHubTask({
        taskId,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        signal: options.getQuerySignal?.() || options.signal,
        intervalMs: options.intervalMs,
        timeoutMs: options.timeoutMs,
    });
}

export async function pollRunningHubTask(options: { taskId: string; apiKey: string; baseUrl?: string; signal?: AbortSignal; intervalMs?: number; timeoutMs?: number }): Promise<{ taskId: string; results: RunningHubResult[] }> {
    const intervalMs = options.intervalMs ?? 2500;
    const deadline = options.timeoutMs === undefined ? Infinity : Date.now() + options.timeoutMs;
    let retryCount = 0;
    const wait = (milliseconds: number) => new Promise<void>((resolve, reject) => {
        if (options.signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
        const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
        const timer = setTimeout(() => { options.signal?.removeEventListener("abort", abort); resolve(); }, milliseconds);
        options.signal?.addEventListener("abort", abort, { once: true });
    });
    for (;;) {
        if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        // The current V2 API authenticates with the Bearer header; its JSON body
        // intentionally contains only the task ID (the desktop app has no RH
        // endpoint to reuse here, so do not invent a second key transport).
        let response: ReturnType<typeof normalizeRunningHubTaskResponse>;
        try {
            response = normalizeRunningHubTaskResponse(await postJson(options.baseUrl || RUNNINGHUB_BASE_URL, "/openapi/v2/query", options.apiKey, { taskId: options.taskId }, options.signal));
        } catch (error) {
            if (options.signal?.aborted) throw error;
            if (error instanceof RunningHubTransientQueryError && Date.now() < deadline) {
                await wait(Math.min(30000, intervalMs * 2 ** Math.min(retryCount++, 4)));
                continue;
            }
            throw new RunningHubQueryPendingError(`任务已提交，查询暂未完成：${readError(error)}`);
        }
        retryCount = 0;
        const { status, results } = response;
        if (status === "SUCCESS" || status === "COMPLETED") {
            return { taskId: options.taskId, results };
        }
        if (status === "FAILED" || status === "ERROR" || status === "CANCELED" || status === "CANCELLED" || status === "ABORTED") {
            throw new RunningHubTaskFailedError(response.error);
        }
        if (Date.now() >= deadline) throw new RunningHubQueryPendingError("查询等待已结束，远端任务状态尚未确认。请继续查询已有任务，无需重新执行。");
        await wait(intervalMs);
    }
}

export async function uploadRunningHubFile(file: Blob, apiKey: string, baseUrl = RUNNINGHUB_BASE_URL, signal?: AbortSignal) {
    if (!apiKey.trim()) throw new Error("RunningHub API key is required");
    const form = new FormData();
    form.append("file", file);
    try {
        // RunningHub's current upload API authenticates with the Bearer header;
        // the multipart body only needs the file itself.
        const response = await axios.post(endpoint(baseUrl, "/openapi/v2/media/upload/binary"), form, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
        });
        return unwrapData(response.data) as { download_url?: string; fileUrl?: string; fileName?: string; type?: string };
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error(readError(error));
    }
}
