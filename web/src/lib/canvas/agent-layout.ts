import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";
import { nodeBounds } from "@/lib/canvas/canvas-node-geometry";

// Leave room for node titles, ports, and hover controls outside the node body.
export const AGENT_LAYOUT_GAP = 96;
type Rect = { position: Position; width: number; height: number };

export function rectanglesOverlap(a: Rect, b: Rect, gap = AGENT_LAYOUT_GAP) {
    return a.position.x < b.position.x + b.width + gap &&
        a.position.x + a.width + gap > b.position.x &&
        a.position.y < b.position.y + b.height + gap &&
        a.position.y + a.height + gap > b.position.y;
}

export function findAgentPosition(rect: Rect, obstacles: CanvasNodeData[], minX = -Infinity): Position {
    const origin = rect.position;
    const candidates: Position[] = [{ ...origin }];
    const visited = new Set<string>();
    const distance = (p: Position) => (p.x - origin.x) ** 2 + (p.y - origin.y) ** 2;
    // Search obstacle edges near the requested position, then fall back to open canvas.
    for (let attempt = 0; candidates.length && attempt < 512; attempt++) {
        candidates.sort((a, b) => distance(a) - distance(b) || a.y - b.y || a.x - b.x);
        const position = candidates.shift()!;
        if (position.x < minX) continue;
        const key = `${position.x},${position.y}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const blocking = obstacles.find(node => rectanglesOverlap({ ...rect, position }, node));
        if (!blocking) return position;
        candidates.push(
            { x: blocking.position.x + blocking.width + AGENT_LAYOUT_GAP, y: position.y },
            { x: position.x, y: blocking.position.y + blocking.height + AGENT_LAYOUT_GAP },
            { x: blocking.position.x - rect.width - AGENT_LAYOUT_GAP, y: position.y },
            { x: position.x, y: blocking.position.y - rect.height - AGENT_LAYOUT_GAP },
        );
    }
    return { x: Math.max(origin.x, nodeBounds(obstacles).right + AGENT_LAYOUT_GAP), y: origin.y };
}

/** Translate a planned block intact; never rearrange existing canvas content. */
export function placeAgentBlock(planned: CanvasNodeData[], obstacles: CanvasNodeData[], minX = -Infinity) {
    if (!planned.length) return planned;
    const bounds = nodeBounds(planned);
    const position = findAgentPosition({
        position: { x: bounds.left, y: bounds.top },
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
    }, obstacles, minX);
    return planned.map(node => ({
        ...node,
        position: { x: node.position.x + position.x - bounds.left, y: node.position.y + position.y - bounds.top },
    }));
}

export function arrangeAgentGrid(targets: CanvasNodeData[], obstacles: CanvasNodeData[], requestedColumns?: number) {
    if (!targets.length) return [];
    const columns = Math.min(targets.length, Math.max(1, Math.floor(
        Number.isFinite(requestedColumns) ? requestedColumns! : Math.ceil(Math.sqrt(targets.length)),
    )));
    const bounds = nodeBounds(targets);
    const colWidths = Array<number>(columns).fill(0);
    const rowHeights: number[] = [];
    targets.forEach((node, index) => {
        colWidths[index % columns] = Math.max(colWidths[index % columns], node.width);
        const row = Math.floor(index / columns);
        rowHeights[row] = Math.max(rowHeights[row] || 0, node.height);
    });
    const planned = targets.map((node, index) => ({
        ...node,
        position: {
            x: bounds.left + colWidths.slice(0, index % columns).reduce((sum, width) => sum + width + AGENT_LAYOUT_GAP, 0),
            y: bounds.top + rowHeights.slice(0, Math.floor(index / columns)).reduce((sum, height) => sum + height + AGENT_LAYOUT_GAP, 0),
        },
    }));
    return placeAgentBlock(planned, obstacles);
}

export function agentLayoutSummary(nodes: CanvasNodeData[]) {
    const content = nodes.filter(node => node.type !== CanvasNodeType.Group);
    const overlaps: { first: string; second: string }[] = [];
    let overlapCount = 0;
    for (let i = 0; i < content.length; i++) for (let j = i + 1; j < content.length; j++) {
        if (!rectanglesOverlap(content[i], content[j], 0)) continue;
        overlapCount++;
        if (overlaps.length < 20) overlaps.push({ first: content[i].id, second: content[j].id });
    }
    return { bounds: nodes.length ? nodeBounds(nodes) : null, gap: AGENT_LAYOUT_GAP, overlapCount, overlaps };
}
