import { Button, Select, Switch, Tooltip } from "antd";
import { ArrowDown, ArrowUp, Upload } from "lucide-react";
import { matchRunningHubBindings, runningHubInputKey, runningHubMediaSlots, runningHubReferenceSwitch, type RunningHubCanvasBinding } from "@/lib/runninghub-bindings";
import type { RunningHubInput, RunningHubNode } from "@/services/api/runninghub";
import type { CanvasNodeMetadata } from "@/types/canvas";
import { RunningHubMediaPreview } from "./runninghub-media-preview";
import "./runninghub-references.css";
import { runningHubReferencePorts } from "@/lib/runninghub-reference-ports";

export type RunningHubReferencesProps = {
    inputs: RunningHubInput[]; nodes: RunningHubNode[]; bindings: RunningHubCanvasBinding[];
    previews?: CanvasNodeMetadata["rhInputPreviews"]; targets?: Record<string, string>; disabled: boolean;
    switchTargets?: Record<string, string>;
    disabledPorts?: string[];
    onPortSwitch?: (key: string, enabled: boolean) => void;
    onSwitch: (index: number, enabled: boolean) => void;
    onSwitchTarget: (key: string, target: string) => void;
    onTarget: (slotKey: string, target: string) => void; onMove: (id: string, direction: -1 | 1) => void;
    onSwap: (left: number, right: number) => void; onUpload: (index: number, file: File) => void;
};

export function RunningHubReferences(props: RunningHubReferencesProps) {
    const matches = matchRunningHubBindings(props.inputs, props.bindings, props.nodes, props.targets);
    const slots = runningHubMediaSlots(props.inputs, props.nodes);
    const ports = runningHubReferencePorts(props.nodes);
    const switchControl = (mediaIndex: number, label: string) => {
        if (ports.length) return null;
        const media = props.inputs[mediaIndex];
        const index = runningHubReferenceSwitch(props.inputs, mediaIndex, label, props.switchTargets);
        const input = props.inputs[index];
        const options = props.inputs.filter((field) => field.valueType === "boolean").map((field) => ({ value: runningHubInputKey(field), label: `#${field.nodeId} ${field.nodeTitle} / ${field.fieldName}` }));
        if (!options.length) return <small role="status">分组开关未包含在 API 工作流中，状态未知</small>;
        return <div className="rh-reference-switch">
            <Tooltip title={index < 0 ? "尚未关联工作流开关" : `${input.nodeTitle} / ${input.fieldName}`}><Switch aria-label={`${label}启用`} checked={index >= 0 && (input.fieldValue === true || input.fieldValue === "true")} disabled={props.disabled || index < 0} checkedChildren="开" unCheckedChildren="关" onChange={(enabled) => props.onSwitch(index, enabled)} /></Tooltip>
            <Select size="small" showSearch allowClear optionFilterProp="label" aria-label={`${label}开关字段`} placeholder="关联工作流开关" disabled={props.disabled || !media} value={input ? runningHubInputKey(input) : undefined} options={options} onChange={(value) => { if (media) props.onSwitchTarget(runningHubInputKey(media), value || ""); }} />
        </div>;
    };
    const options = props.inputs.filter((input) => input.valueType === "string").map((input) => ({ value: runningHubInputKey(input), label: `#${input.nodeId} ${input.nodeTitle} / ${input.fieldName}` }));
    const targetSelect = (match: typeof matches[number]) => <Select size="small" showSearch optionFilterProp="label" aria-label={`${match.binding.label}目标字段`} placeholder={match.overLimit ? "超过数量限制" : "请选择目标字段"} disabled={props.disabled || match.overLimit} value={match.inputIndex >= 0 ? runningHubInputKey(props.inputs[match.inputIndex]) : undefined} options={options} onChange={(value) => props.onTarget(match.slotKey, value)} />;
    return <div className="rh-references">
        {ports.length > 0 && <section><h4>参考分组</h4>{(["image", "audio", "video"] as const).map((kind) => <div key={kind} className="rh-reference-grid">{ports.filter((port, index) => port.kind === kind && ports.findIndex((other) => other.key === port.key) === index).map((port) => <div key={port.key} className="rh-reference-switch"><strong>{port.label}</strong><Tooltip title={port.available ? port.field : "远端 API 未包含此分支，请先在 RunningHub 启用并刷新工作流"}><Switch aria-label={`${port.label}分组启用`} checked={port.available && !props.disabledPorts?.includes(port.key)} disabled={props.disabled || !port.available || !props.onPortSwitch} onChange={(enabled) => props.onPortSwitch?.(port.key, enabled)} /></Tooltip>{!port.available && <small>远端分支不可用</small>}</div>)}</div>)}</section>}
        {matches.filter((match) => match.binding.kind === "text").map((match) => <div className="rh-prompt-source" key={match.binding.sourceNodeId}><strong>提示词 · {match.binding.sourceNodeTitle}</strong>{targetSelect(match)}<p>{match.binding.value || "来源内容为空"}</p></div>)}
        {(["image", "video"] as const).map((kind) => {
            const sources = matches.filter((match) => match.binding.kind === kind);
            const fields = slots.filter((slot) => slot.kind === kind);
            const manual = fields.filter((slot) => !matches.some((match) => match.inputIndex === slot.inputIndex));
            if (!sources.length && !manual.length) return null;
            return <section key={kind}><h4>{kind === "image" ? "参考图片" : "参考视频"}</h4><div className="rh-reference-grid">
                {sources.map((match, index) => <article key={match.binding.sourceNodeId} data-source-id={match.binding.sourceNodeId}>
                    <header><strong>{match.binding.label}</strong><div>{([-1, 1] as const).map((direction) => {
                        const label = `${match.binding.label}${direction < 0 ? "上移" : "下移"}`;
                        return <Tooltip title={label} key={direction}><Button type="text" size="small" aria-label={label} icon={direction < 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />} disabled={props.disabled || index + direction < 0 || index + direction >= sources.length} onClick={() => props.onMove(match.binding.sourceNodeId, direction)} /></Tooltip>;
                    })}</div></header>
                    <RunningHubMediaPreview kind={kind} url={match.binding.previewUrl} label={match.binding.label} />
                    <small title={match.binding.sourceNodeTitle}>{match.binding.sourceNodeTitle}</small>{targetSelect(match)}
                    <small>目标：{slots.find((slot) => slot.inputIndex === match.inputIndex)?.label || "待确认"}</small>
                    {switchControl(match.inputIndex, slots.find((slot) => slot.inputIndex === match.inputIndex)?.label || match.binding.label)}
                </article>)}
                {manual.map((slot, index) => {
                    const key = runningHubInputKey(slot.input);
                    const preview = props.previews?.[key];
                    const activePreview = preview?.value === slot.input.fieldValue ? preview : undefined;
                    return <article key={key} data-input-key={key}><header><strong>{slot.label}</strong><div>{([-1, 1] as const).map((direction) => {
                        const label = `${slot.label}${direction < 0 ? "上移" : "下移"}`;
                        return <Tooltip title={label} key={direction}><Button type="text" size="small" aria-label={label} icon={direction < 0 ? <ArrowUp size={16} /> : <ArrowDown size={16} />} disabled={props.disabled || index + direction < 0 || index + direction >= manual.length} onClick={() => props.onSwap(slot.inputIndex, manual[index + direction].inputIndex)} /></Tooltip>;
                    })}<Tooltip title={`上传${slot.label}`}><label className="rh-upload-button"><Upload size={16} /><input type="file" accept={`${kind}/*`} aria-label={`上传${slot.label}`} disabled={props.disabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) props.onUpload(slot.inputIndex, file); }} /></label></Tooltip></div></header>
                    <RunningHubMediaPreview kind={kind} url={String(slot.input.fieldValue || "")} storageKey={activePreview?.storageKey} label={slot.label} />
                    <small title={activePreview?.name || String(slot.input.fieldValue || "")}>{activePreview?.name || String(slot.input.fieldValue || "未添加素材")}</small><small>#{slot.input.nodeId} {slot.input.nodeTitle} / {slot.input.fieldName}</small>
                    {switchControl(slot.inputIndex, slot.label)}
                    </article>;
                })}
            </div></section>;
        })}
    </div>;
}
