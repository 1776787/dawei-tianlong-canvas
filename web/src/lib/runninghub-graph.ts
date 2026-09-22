import dagre from "@dagrejs/dagre";
import { isRunningHubLink, type RunningHubNode } from "@/services/api/runninghub";
import type { Position } from "@/types/canvas";

export const RH_NODE_WIDTH = 300;
export type RunningHubGraphLink = { id: string; source: string; target: string; slot: number; field: string };

export function runningHubGraphLinks(nodes: RunningHubNode[]) {
    const ids = new Set(nodes.map((node) => node.nodeId));
    const links: RunningHubGraphLink[] = [];
    const missing: string[] = [];
    for (const node of nodes) {
        for (const [field, value] of Object.entries(node.inputs)) {
            if (!isRunningHubLink(value)) continue;
            if (!ids.has(String(value[0]))) {
                missing.push(`${node.nodeId}.${field} -> ${value[0]}`);
                continue;
            }
            links.push({ id: JSON.stringify([node.nodeId, field]), source: String(value[0]), target: node.nodeId, slot: value[1], field });
        }
    }
    return { links, missing };
}

export function runningHubNodeHeight(node: RunningHubNode, links: RunningHubGraphLink[]) {
    const incoming = links.filter((link) => link.target === node.nodeId).length;
    const outgoing = new Set(links.filter((link) => link.source === node.nodeId).map((link) => link.slot)).size;
    const fields = Object.values(node.inputs).filter((value) => !isRunningHubLink(value)).length;
    return 84 + Math.max(incoming, outgoing) * 24 + (fields ? 224 : 36);
}

export function layoutRunningHubNodes(nodes: RunningHubNode[]): Record<string, Position> {
    const { links } = runningHubGraphLinks(nodes);
    const graph = new dagre.graphlib.Graph({ multigraph: true });
    graph.setGraph({ rankdir: "LR", nodesep: 56, ranksep: 100, marginx: 32, marginy: 32 });
    graph.setDefaultEdgeLabel(() => ({}));
    nodes.forEach((node) => graph.setNode(node.nodeId, { width: RH_NODE_WIDTH, height: runningHubNodeHeight(node, links) }));
    links.forEach((link) => graph.setEdge(link.source, link.target, {}, link.id));
    dagre.layout(graph);
    return Object.fromEntries(nodes.map((node) => {
        const placed = graph.node(node.nodeId);
        return [node.nodeId, { x: placed.x - placed.width / 2, y: placed.y - placed.height / 2 }];
    }));
}
