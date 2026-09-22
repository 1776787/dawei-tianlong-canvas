import { create } from "zustand";
import { nanoid } from "nanoid";

// Skill library: user-uploaded or agent-authored reusable instruction snippets.
// Enabled skills are injected into the canvas agent's system prompt so the agent
// follows them. Persisted to localStorage as JSON (skill bodies are plain text).
const STORAGE_KEY = "canvas-skill-library";

export type CanvasSkill = {
    id: string;
    name: string;
    description: string;
    content: string;
    enabled: boolean;
    source: "user" | "agent";
    createdAt: string;
    updatedAt: string;
};

function nowIso() {
    return new Date().toISOString();
}

function load(): CanvasSkill[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as CanvasSkill[];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item) => item && typeof item.id === "string" && typeof item.content === "string");
    } catch {
        return [];
    }
}

function persist(skills: CanvasSkill[]) {
    if (typeof window === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(skills));
    } catch {
        /* ignore quota errors */
    }
}

export type SkillDraft = { name: string; description?: string; content: string; source?: "user" | "agent"; enabled?: boolean };

type SkillStore = {
    skills: CanvasSkill[];
    addSkill: (draft: SkillDraft) => CanvasSkill;
    updateSkill: (id: string, patch: Partial<Pick<CanvasSkill, "name" | "description" | "content" | "enabled">>) => void;
    removeSkill: (id: string) => void;
    toggleSkill: (id: string, enabled?: boolean) => void;
};

export const useSkillStore = create<SkillStore>((set, get) => ({
    skills: load(),
    addSkill: (draft) => {
        const name = draft.name.trim() || "未命名 Skill";
        const skill: CanvasSkill = {
            id: nanoid(),
            name,
            description: (draft.description || "").trim(),
            content: draft.content,
            enabled: draft.enabled ?? true,
            source: draft.source ?? "user",
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        const next = [...get().skills, skill];
        persist(next);
        set({ skills: next });
        return skill;
    },
    updateSkill: (id, patch) => {
        const next = get().skills.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: nowIso() } : item));
        persist(next);
        set({ skills: next });
    },
    removeSkill: (id) => {
        const next = get().skills.filter((item) => item.id !== id);
        persist(next);
        set({ skills: next });
    },
    toggleSkill: (id, enabled) => {
        const next = get().skills.map((item) => (item.id === id ? { ...item, enabled: enabled ?? !item.enabled, updatedAt: nowIso() } : item));
        persist(next);
        set({ skills: next });
    },
}));

// Non-hook accessor for the agent tools layer (pure module, no React).
export function getSkillStore() {
    return useSkillStore.getState();
}

export function enabledSkills(): CanvasSkill[] {
    return getSkillStore().skills.filter((item) => item.enabled);
}
