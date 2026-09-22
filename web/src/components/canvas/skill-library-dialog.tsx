import { useMemo, useState } from "react";
import { Button, Empty, Input, Modal, Switch, Tag, Tooltip, Upload, message } from "antd";
import { FilePlus2, Pencil, Plus, Trash2, Upload as UploadIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UploadProps } from "antd";

import { useSkillStore, type CanvasSkill } from "@/stores/use-skill-store";

type SkillLibraryDialogProps = {
    open: boolean;
    onClose: () => void;
};

type EditorState = { id: string | null; name: string; description: string; content: string } | null;

const MAX_SKILL_BYTES = 200 * 1024;

export function SkillLibraryDialog({ open, onClose }: SkillLibraryDialogProps) {
    const { t } = useTranslation();
    const skills = useSkillStore((state) => state.skills);
    const addSkill = useSkillStore((state) => state.addSkill);
    const updateSkill = useSkillStore((state) => state.updateSkill);
    const removeSkill = useSkillStore((state) => state.removeSkill);
    const toggleSkill = useSkillStore((state) => state.toggleSkill);

    const [editor, setEditor] = useState<EditorState>(null);

    const sorted = useMemo(() => [...skills].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [skills]);

    const startCreate = () => setEditor({ id: null, name: "", description: "", content: "" });
    const startEdit = (skill: CanvasSkill) => setEditor({ id: skill.id, name: skill.name, description: skill.description, content: skill.content });

    const saveEditor = () => {
        if (!editor) return;
        if (!editor.name.trim() || !editor.content.trim()) {
            void message.warning(t("canvas.skills.nameContentRequired"));
            return;
        }
        if (editor.id) {
            updateSkill(editor.id, { name: editor.name.trim(), description: editor.description.trim(), content: editor.content });
        } else {
            addSkill({ name: editor.name, description: editor.description, content: editor.content, source: "user" });
        }
        setEditor(null);
    };

    const uploadProps: UploadProps = {
        accept: ".md,.markdown,.txt,text/plain,text/markdown",
        showUploadList: false,
        multiple: true,
        beforeUpload: (file) => {
            if (file.size > MAX_SKILL_BYTES) {
                void message.error(t("canvas.skills.tooLarge"));
                return Upload.LIST_IGNORE;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const content = String(reader.result || "");
                const baseName = file.name.replace(/\.(md|markdown|txt)$/i, "");
                addSkill({ name: baseName, description: t("canvas.skills.importedFrom", { name: file.name }), content, source: "user" });
                void message.success(t("canvas.skills.imported", { name: baseName }));
            };
            reader.readAsText(file);
            return Upload.LIST_IGNORE;
        },
    };

    return (
        <Modal open={open} onCancel={onClose} title={t("canvas.skills.title")} footer={null} width={720} destroyOnClose>
            <div className="mb-3 flex items-center gap-2">
                <Button type="primary" icon={<Plus className="size-4" />} onClick={startCreate}>
                    {t("canvas.skills.new")}
                </Button>
                <Upload {...uploadProps}>
                    <Button icon={<UploadIcon className="size-4" />}>{t("canvas.skills.upload")}</Button>
                </Upload>
                <span className="ml-auto text-xs opacity-50">{t("canvas.skills.count", { count: skills.length, enabled: skills.filter((s) => s.enabled).length })}</span>
            </div>

            {sorted.length === 0 ? (
                <Empty description={t("canvas.skills.empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
                <div className="flex max-h-[52vh] flex-col gap-2 overflow-y-auto pr-1">
                    {sorted.map((skill) => (
                        <div key={skill.id} className="flex items-start gap-3 rounded-lg border border-black/10 px-3 py-2.5 dark:border-white/10">
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="truncate text-sm font-medium">{skill.name}</span>
                                    <Tag color={skill.source === "agent" ? "purple" : "blue"} className="!m-0">
                                        {skill.source === "agent" ? t("canvas.skills.byAgent") : t("canvas.skills.byUser")}
                                    </Tag>
                                </div>
                                {skill.description ? <div className="mt-0.5 truncate text-xs opacity-60">{skill.description}</div> : null}
                            </div>
                            <Tooltip title={skill.enabled ? t("canvas.skills.enabled") : t("canvas.skills.disabled")}>
                                <Switch size="small" checked={skill.enabled} onChange={(checked) => toggleSkill(skill.id, checked)} />
                            </Tooltip>
                            <Tooltip title={t("canvas.skills.edit")}>
                                <Button size="small" type="text" icon={<Pencil className="size-3.5" />} onClick={() => startEdit(skill)} />
                            </Tooltip>
                            <Tooltip title={t("canvas.skills.delete")}>
                                <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} onClick={() => removeSkill(skill.id)} />
                            </Tooltip>
                        </div>
                    ))}
                </div>
            )}

            <Modal
                open={!!editor}
                onCancel={() => setEditor(null)}
                onOk={saveEditor}
                okText={t("canvas.skills.save")}
                title={editor?.id ? t("canvas.skills.editTitle") : t("canvas.skills.newTitle")}
                width={640}
                destroyOnClose
            >
                {editor ? (
                    <div className="flex flex-col gap-3 py-1">
                        <div>
                            <div className="mb-1 flex items-center gap-1.5 text-xs opacity-70">
                                <FilePlus2 className="size-3.5" />
                                {t("canvas.skills.fieldName")}
                            </div>
                            <Input value={editor.name} maxLength={60} onChange={(e) => setEditor({ ...editor, name: e.target.value })} placeholder={t("canvas.skills.namePlaceholder")} />
                        </div>
                        <div>
                            <div className="mb-1 text-xs opacity-70">{t("canvas.skills.fieldDescription")}</div>
                            <Input value={editor.description} maxLength={120} onChange={(e) => setEditor({ ...editor, description: e.target.value })} placeholder={t("canvas.skills.descriptionPlaceholder")} />
                        </div>
                        <div>
                            <div className="mb-1 text-xs opacity-70">{t("canvas.skills.fieldContent")}</div>
                            <Input.TextArea value={editor.content} autoSize={{ minRows: 8, maxRows: 18 }} onChange={(e) => setEditor({ ...editor, content: e.target.value })} placeholder={t("canvas.skills.contentPlaceholder")} />
                        </div>
                    </div>
                ) : null}
            </Modal>
        </Modal>
    );
}
