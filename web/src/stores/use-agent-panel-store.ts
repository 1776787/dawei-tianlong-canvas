import { create } from "zustand";

export const AGENT_PANEL_MOTION_MS = 400;
export const AGENT_PANEL_MIN_WIDTH = 280;
export const AGENT_PANEL_MAX_WIDTH = 560;
export const AGENT_PANEL_DEFAULT_WIDTH = 340;

const WIDTH_KEY = "canvas-agent-panel-width";
const OPEN_KEY = "canvas-agent-panel-open";

function initialWidth() {
    if (typeof window === "undefined") return AGENT_PANEL_DEFAULT_WIDTH;
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    if (!stored) return AGENT_PANEL_DEFAULT_WIDTH;
    return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, stored));
}

function initialOpen() {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(OPEN_KEY) === "1";
}

type AgentPanelStore = {
    width: number;
    panelOpen: boolean;
    setWidth: (width: number) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
};

export const useAgentPanelStore = create<AgentPanelStore>((set, get) => ({
    width: initialWidth(),
    panelOpen: initialOpen(),
    setWidth: (width) => {
        const next = Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, width));
        if (typeof window !== "undefined") localStorage.setItem(WIDTH_KEY, String(next));
        set({ width: next });
    },
    openPanel: () => {
        if (typeof window !== "undefined") localStorage.setItem(OPEN_KEY, "1");
        set({ panelOpen: true });
    },
    closePanel: () => {
        if (typeof window !== "undefined") localStorage.setItem(OPEN_KEY, "0");
        set({ panelOpen: false });
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
}));
