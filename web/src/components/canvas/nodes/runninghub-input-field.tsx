import { Input, InputNumber, Switch, Tooltip } from "antd";
import { Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type RunningHubInput, valueForRunningHubInput } from "@/services/api/runninghub";

type Props = {
    input: RunningHubInput;
    displayLabel?: string;
    sourceLabel?: string;
    disabled?: boolean;
    uploading?: boolean;
    uploadDisabled?: boolean;
    onChange: (value: unknown) => void;
    onUpload: (file: File) => void;
};

export function RunningHubInputField({ input, displayLabel, sourceLabel, disabled, uploading, uploadDisabled, onChange, onUpload }: Props) {
    const { t } = useTranslation();
    const label = `${input.nodeId}.${input.fieldName}`;
    let error = "";
    try { valueForRunningHubInput(input); } catch (valueError) { error = valueError instanceof Error ? valueError.message : String(valueError); }
    const value = input.valueType === "json" && typeof input.fieldValue !== "string" ? JSON.stringify(input.fieldValue, null, 2) : String(input.fieldValue ?? "");
    const isFile = input.valueType === "string" && /(^|_)(image|mask|video|audio|file|path|filename|input)(_|$)/i.test(input.fieldName);
    return (
        <div className="rh-input-field nodrag nowheel nopan">
            <label htmlFor={`rh-input-${label}`} className="mb-1 block truncate text-[11px] opacity-65" title={input.fieldName}>{displayLabel || input.fieldName}</label>
            {sourceLabel ? <div className="mb-1 truncate text-[10px] text-sky-500/80" title={sourceLabel}>← {sourceLabel}</div> : null}
            {input.valueType === "boolean" ? (
                <Switch id={`rh-input-${label}`} size="small" aria-label={label} disabled={disabled} checked={input.fieldValue === true || input.fieldValue === "true"} onChange={onChange} />
            ) : input.valueType === "number" ? (
                <InputNumber stringMode id={`rh-input-${label}`} aria-label={label} style={{ width: "100%" }} size="small" value={value} status={error ? "error" : undefined} disabled={disabled} onChange={onChange} />
            ) : (
                <div className="flex min-w-0 items-start gap-1">
                    <Input.TextArea id={`rh-input-${label}`} aria-label={label} value={value} disabled={disabled} status={error ? "error" : undefined} rows={input.valueType === "json" || /text|prompt/i.test(input.fieldName) ? 3 : 1} style={{ resize: "vertical", minWidth: 0 }} onChange={(event) => onChange(event.target.value)} />
                    {isFile ? <Tooltip title={t("canvas.runningHub.upload")}><label className="grid size-7 shrink-0 cursor-pointer place-items-center rounded border border-current/20">
                        <Upload className={`size-3.5 ${uploading ? "animate-pulse" : ""}`} />
                        <input aria-label={`${t("canvas.runningHub.upload")} ${label}`} type="file" className="sr-only" disabled={disabled || uploadDisabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onUpload(file); }} />
                    </label></Tooltip> : null}
                </div>
            )}
            {error ? <div role="alert" className="mt-1 break-words text-[10px] text-red-500">{error}</div> : null}
        </div>
    );
}
