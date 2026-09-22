import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import type { RunningHubInput, RunningHubNode } from "@/services/api/runninghub";
import { isRunningHubLink } from "@/services/api/runninghub";

export type RunningHubBindingKind = "text" | "image" | "video";

export type RunningHubCanvasBinding = {
    sourceNodeId: string;
    sourceNodeTitle: string;
    kind: RunningHubBindingKind;
    label: string;
    value?: string;
    previewUrl?: string;
    storageKey?: string;
};

const chineseNumbers = ["一", "二", "三", "四", "五", "六", "七", "八", "九"];

function numberLabel(index: number) {
    return chineseNumbers[index] || String(index + 1);
}

function sourceKind(node: CanvasNodeData): RunningHubBindingKind | null {
    if (node.type === CanvasNodeType.Text) return "text";
    if (node.type === CanvasNodeType.Image) return "image";
    if (node.type === CanvasNodeType.Video) return "video";
    return null;
}

export function buildRunningHubBindings(targetNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], order: string[] = []): RunningHubCanvasBinding[] {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const counts: Record<RunningHubBindingKind, number> = { text: 0, image: 0, video: 0 };
    const orderedSources = connections
        .filter((connection) => connection.toNodeId === targetNodeId)
        .map((connection) => connection.fromNodeId)
        .sort((a, b) => {
            const ai = order.indexOf(a);
            const bi = order.indexOf(b);
            if (ai < 0 && bi < 0) return 0;
            if (ai < 0) return 1;
            if (bi < 0) return -1;
            return ai - bi;
        });
    return orderedSources
        .map((sourceId) => byId.get(sourceId))
        .filter((node): node is CanvasNodeData => Boolean(node))
        .flatMap((node) => {
            const kind = sourceKind(node);
            if (!kind) return [];
            const index = counts[kind]++;
            const label = kind === "text" ? "提示词" : kind === "image" ? `参考图${numberLabel(index)}` : `参考视频${numberLabel(index)}`;
            const value = node.metadata?.content || node.metadata?.prompt || "";
            return [{ sourceNodeId: node.id, sourceNodeTitle: node.title || label, kind, label, value, previewUrl: kind === "text" ? undefined : value, storageKey: node.metadata?.storageKey }];
        });
}

export const runningHubInputKey = (input: RunningHubInput) => JSON.stringify([input.nodeId, input.fieldName]);

export function runningHubReferenceSwitch(inputs: RunningHubInput[], mediaIndex: number, label: string, targets: Record<string, string> = {}) {
    const media = inputs[mediaIndex];
    if (!media) return -1;
    const explicit = targets[runningHubInputKey(media)];
    if (explicit !== undefined) return inputs.findIndex((input) => input.valueType === "boolean" && runningHubInputKey(input) === explicit);
    const normalize = (value: string) => value.toLowerCase().replace(/[一二三四五六七八九]/g, (number) => String(chineseNumbers.indexOf(number) + 1)).replace(/reference\s*image|参考图片|参考图像|参考图|图片|图像|image|picture/g, "image").replace(/reference\s*video|参考视频|video/g, "video").replace(/[\s_-]/g, "");
    const target = normalize(label);
    const candidates = inputs.map((input, index) => ({ input, index })).filter(({ input }) => input.valueType === "boolean");
    const named = candidates.filter(({ input }) => [input.fieldName, input.nodeTitle].some((value) => normalize(value) === target));
    if (named.length === 1) return named[0].index;
    const local = candidates.filter(({ input }) => input.nodeId === media.nodeId && /^(enabled?|active|use)$/i.test(input.fieldName));
    return local.length === 1 ? local[0].index : -1;
}

export function runningHubReferenceEnabled(inputs: RunningHubInput[], mediaIndex: number, label: string, targets: Record<string, string> = {}) {
    const index = runningHubReferenceSwitch(inputs, mediaIndex, label, targets);
    return index < 0 || inputs[index].fieldValue === true || inputs[index].fieldValue === "true";
}

export function runningHubInputKind(input: RunningHubInput, nodes: RunningHubNode[] = []): RunningHubBindingKind | null {
    if (input.valueType !== "string") return null;
    const name = input.fieldName.toLowerCase();
    const context = `${nodes.find((node) => node.nodeId === input.nodeId)?.classType || ""} ${input.nodeTitle}`;
    if (/negative|负面|反向/i.test(`${context} ${name}`)) return null;
    if (/^(text|prompt|positive|caption|description)(_[0-9]+)?$/.test(name)) return "text";
    if (/^(video|video_url|reference_video|ref_video|movie)([_0-9]*)$/.test(name)) return "video";
    if (/^(image|image_url|reference_image|ref_image|img)([_0-9]*)$/.test(name)) return "image";
    if (/^(file|path|filename|input|url)$/.test(name) && /load|upload|input/i.test(context)) {
        if (/video/i.test(context)) return "video";
        if (/image/i.test(context)) return "image";
    }
    return null;
}

export function runningHubMediaSlots(inputs: RunningHubInput[], nodes: RunningHubNode[] = []) {
    const counts = { image: 0, video: 0 };
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const destinations = new Map<string, Set<number>>();
    const numberedKinds = new Set<string>();
    // Reference ports are zero-based. Follow media links, not node enumeration order.
    for (const consumer of nodes) for (const [field, value] of Object.entries(consumer.inputs)) {
        const port = field.match(/^(?:ref_images\.)?ref_image_(\d+)$|^(?:ref_videos\.)?ref_video_(\d+)$/);
        if (!port || !isRunningHubLink(value)) continue;
        const kind = port[1] !== undefined ? "image" : "video";
        const ordinal = Number(port[1] ?? port[2]);
        numberedKinds.add(kind);
        const visited = new Set<string>();
        const walk = (id: string) => {
            if (visited.has(id)) return;
            visited.add(id);
            const node = byId.get(id);
            if (!node) return;
            const media = inputs.filter((input) => input.nodeId === id && runningHubInputKind(input, nodes) === kind);
            if (media.length) {
                for (const input of media) {
                    const key = runningHubInputKey(input);
                    const numbers = destinations.get(key) || new Set<number>();
                    numbers.add(ordinal);
                    destinations.set(key, numbers);
                }
                return;
            }
            const links = Object.entries(node.inputs).filter((entry): entry is [string, [string | number, number]] => isRunningHubLink(entry[1]));
            const mediaLinks = links.filter(([name]) => /^(images?|pixels|video|frames|samples|input|value)(?:_\d+)?$/i.test(name));
            // Unknown multi-input processors need explicit mapping rather than a guess.
            for (const [, link] of mediaLinks.length ? mediaLinks : links.length === 1 ? links : []) walk(String(link[0]));
        };
        walk(String(value[0]));
    }
    const referenceNumber = (input: RunningHubInput) => {
        const match = input.fieldName.match(/(?:^|[_\s-])([1-9])$/);
        if (match) return Number(match[1]);
        return /^(image|img|video|movie|clip|reference|ref)$/i.test(input.fieldName) ? 1 : 100;
    };
    return inputs.map((input, inputIndex) => ({ input, inputIndex, kind: runningHubInputKind(input, nodes) }))
        .filter((item): item is { input: RunningHubInput; inputIndex: number; kind: "image" | "video" } => item.kind === "image" || item.kind === "video")
        .sort((a, b) => referenceNumber(a.input) - referenceNumber(b.input) || a.inputIndex - b.inputIndex)
        .map((item) => {
            const numbers = destinations.get(runningHubInputKey(item.input));
            const ordinal = numberedKinds.has(item.kind) ? numbers?.size === 1 ? [...numbers][0] : -1 : counts[item.kind]++;
            const prefix = item.kind === "image" ? "参考图" : "参考视频";
            return { ...item, ordinal, label: ordinal >= 0 ? `${prefix}${numberLabel(ordinal)}` : `${prefix}（待确认）` };
        })
        .sort((a, b) => (a.ordinal < 0 ? Infinity : a.ordinal) - (b.ordinal < 0 ? Infinity : b.ordinal) || a.inputIndex - b.inputIndex);
}

export function matchRunningHubBindings(inputs: RunningHubInput[], bindings: RunningHubCanvasBinding[], nodes: RunningHubNode[] = [], targets: Record<string, string> = {}) {
    const counts = { text: 0, image: 0, video: 0 };
    const slots = runningHubMediaSlots(inputs, nodes);
    const text = inputs.map((input, index) => ({ input, index })).filter(({ input }) => runningHubInputKind(input, nodes) === "text");
    const promptIndex = text.length === 1 ? text[0].index : text.find(({ input }) => /^(text|提示词|正向提示词)$/i.test(input.nodeTitle))?.index ?? -1;
    return bindings.map((binding) => {
        const ordinal = counts[binding.kind]++;
        const slotKey = `${binding.kind}:${binding.kind === "text" ? 0 : ordinal}`;
        const target = targets[slotKey];
        const overLimit = binding.kind === "image" && ordinal >= 9 || binding.kind === "video" && ordinal >= 3;
        const candidates = slots.filter((slot) => slot.kind === binding.kind && slot.ordinal === ordinal);
        const inputIndex = overLimit ? -1 : target !== undefined ? inputs.findIndex((input) => runningHubInputKey(input) === target && input.valueType === "string") : binding.kind === "text" ? promptIndex : candidates.length === 1 ? candidates[0].inputIndex : -1;
        return { binding, inputIndex, slotKey, overLimit };
    });
}

export function applyRunningHubBindings(inputs: RunningHubInput[], bindings: RunningHubCanvasBinding[], overwrite = false, nodes: RunningHubNode[] = [], targets: Record<string, string> = {}) {
    const matches = matchRunningHubBindings(inputs, bindings, nodes, targets);
    const next = inputs.map((input, index) => {
        const assigned = matches.filter((item) => item.inputIndex === index);
        if (!assigned.length || (!overwrite && String(input.fieldValue ?? "").trim())) return input;
        return { ...input, fieldValue: assigned.map((item) => item.binding.value || "").join("\n\n") };
    });
    return { inputs: next, matches, changed: next.some((input, index) => input.fieldValue !== inputs[index].fieldValue) };
}

export async function prepareRunningHubInputs(inputs: RunningHubInput[], bindings: RunningHubCanvasBinding[], nodes: RunningHubNode[], targets: Record<string, string>, upload: (binding: RunningHubCanvasBinding) => Promise<string>, switchTargets: Record<string, string> = {}, disabledPorts: string[] = []) {
    const slots = runningHubMediaSlots(inputs, nodes);
    const matches = matchRunningHubBindings(inputs, bindings, nodes, targets).filter((match) => {
        const slot = slots.find((item) => item.inputIndex === match.inputIndex);
        return match.binding.kind === "text" || (!disabledPorts.includes(slot ? `${slot.kind}:${slot.ordinal}` : match.slotKey) && runningHubReferenceEnabled(inputs, match.inputIndex, slot?.label || match.binding.label, switchTargets));
    });
    for (const match of matches) {
        if (match.inputIndex < 0 || !match.binding.value) throw new Error(`${match.binding.label}：${match.overLimit ? "超过数量限制" : match.inputIndex < 0 ? "请选择目标字段" : "来源内容为空"}`);
        if (matches.some((other) => other !== match && other.inputIndex === match.inputIndex && (other.binding.kind !== "text" || match.binding.kind !== "text"))) throw new Error(`${match.binding.label}：目标字段重复`);
    }
    const values = new Map<number, string[]>();
    for (const match of matches) {
        const value = match.binding.kind === "text" ? match.binding.value || "" : await upload(match.binding);
        values.set(match.inputIndex, [...(values.get(match.inputIndex) || []), value]);
    }
    return inputs.map((input, index) => values.has(index) ? { ...input, fieldValue: values.get(index)!.join("\n\n") } : input);
}
