import type { ComponentProps, ReactNode, SetStateAction } from "react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { AtelierCanvas } from "./atelier-canvas";

export type CanvasViewportStore = StoreApi<ViewportTransform>;

// A viewport frame must not rerender the project, its dialogs or generation panels.
export function createCanvasViewport(initial: ViewportTransform) {
    const store = createStore<ViewportTransform>(() => initial);
    const ref = { current: initial };
    const setViewport = (value: SetStateAction<ViewportTransform>) => {
        const next = typeof value === "function" ? value(ref.current) : value;
        const previous = ref.current;
        if (previous.x === next.x && previous.y === next.y && previous.k === next.k) return;
        ref.current = next;
        store.setState(next, true);
    };
    return { store, ref, setViewport };
}

export function CanvasViewportObserver({ store, children }: { store: CanvasViewportStore; children: (viewport: ViewportTransform) => ReactNode }) {
    return children(useStore(store));
}

export function CanvasViewportSurface({ store, ...props }: Omit<ComponentProps<typeof AtelierCanvas>, "viewport"> & { store: CanvasViewportStore }) {
    const viewport = useStore(store);
    return <AtelierCanvas {...props} viewport={viewport} />;
}

export function CanvasViewportNodes({ store, nodes, size, children }: {
    store: CanvasViewportStore;
    nodes: CanvasNodeData[];
    size: { width: number; height: number };
    children: (node: CanvasNodeData) => ReactNode;
}) {
    const viewport = useStore(store);
    const padding = 280;
    const left = -viewport.x / viewport.k - padding;
    const top = -viewport.y / viewport.k - padding;
    const right = left + size.width / viewport.k + padding * 2;
    const bottom = top + size.height / viewport.k + padding * 2;
    return nodes.filter((node) => node.position.x + node.width > left && node.position.x < right && node.position.y + node.height > top && node.position.y < bottom).map(children);
}
