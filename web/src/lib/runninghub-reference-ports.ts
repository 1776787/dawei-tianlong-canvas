import { isRunningHubLink, runningHubWorkflowDetailFromRaw } from "@/services/api/runninghub";
import type { RunningHubNode } from "@/services/api/runninghub";

export function runningHubReferencePorts(nodes: RunningHubNode[]) {
    return nodes.filter((node) => node.classType === "MiniMaxH3ReferenceToVideo").flatMap((node) =>
        (["image", "video", "audio"] as const).flatMap((kind) => Array.from({ length: kind === "image" ? 9 : 3 }, (_, ordinal) => {
            const field = `ref_${kind}s.ref_${kind}_${ordinal}`;
            return { key: `${kind}:${ordinal}`, kind, ordinal, nodeId: node.nodeId, field, available: isRunningHubLink(node.inputs[field]), label: `参考${kind === "image" ? "图像" : kind === "video" ? "视频" : "音频"}${ordinal + 1}` };
        })));
}

export function runningHubWorkflowWithReferencePorts(raw: Record<string, unknown>, disabled: string[]) {
    const detail = runningHubWorkflowDetailFromRaw("local", raw);
    const ports = runningHubReferencePorts(detail.nodes).filter((port) => port.available && disabled.includes(port.key));
    const next = structuredClone(raw);
    const byId = new Map(detail.nodes.map((node) => [node.nodeId, node]));
    const candidates = new Set<string>();
    const ancestors = (id: string, set: Set<string>) => {
        if (set.has(id)) return;
        set.add(id);
        for (const value of Object.values(byId.get(id)?.inputs || {})) if (isRunningHubLink(value)) ancestors(String(value[0]), set);
    };
    for (const port of ports) {
        const node = next[port.nodeId] as { inputs: Record<string, unknown> };
        const value = node.inputs[port.field];
        if (isRunningHubLink(value)) ancestors(String(value[0]), candidates);
        delete node.inputs[port.field];
    }
    // Keep shared upstream branches; only remove ancestors made unused by these ports.
    const retained = new Set<string>();
    for (const node of detail.nodes) if (!candidates.has(node.nodeId)) {
        const current = next[node.nodeId] as { inputs: Record<string, unknown> };
        for (const value of Object.values(current.inputs)) if (isRunningHubLink(value)) ancestors(String(value[0]), retained);
    }
    for (const id of candidates) if (!retained.has(id)) delete next[id];
    return next;
}
