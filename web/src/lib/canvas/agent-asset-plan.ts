import { nanoid } from "nanoid";
import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { AGENT_LAYOUT_GAP, placeAgentBlock } from "@/lib/canvas/agent-layout";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type Position } from "@/types/canvas";

export const ASSET_CATEGORIES = ["人物", "服装", "场景", "道具", "镜头连续性", "其他"];
type Asset = { category: string; name: string; description?: string; details?: string };
const normalize = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const assetKey = (category: string, name: string) => JSON.stringify([normalize(category), normalize(name)]);

export function buildAgentAssetPlan(nodes: CanvasNodeData[], center: Position, args: Record<string, unknown>) {
    if (!Array.isArray(args.assets) || !args.assets.length || args.assets.length > 200) throw new Error("assets 必须包含 1–200 个独立资产条目");
    const assets = new Map<string, Asset>();
    for (const item of args.assets) {
        if (!item || typeof item !== "object" || typeof item.name !== "string" || !item.name.trim()) throw new Error("每个资产必须有具体名称，例如角色名或场景名");
        const category = typeof item.category === "string" && ASSET_CATEGORIES.includes(item.category.trim()) ? item.category.trim() : "其他";
        const name = item.name.trim();
        if (ASSET_CATEGORIES.some(label => name === label || name === `${label}资产` || name === `${label}清单`)) throw new Error(`“${name}”是分类名称，请把每个具体角色、场景或物件分别列为一条资产`);
        const key = assetKey(category, name);
        assets.set(key, {
            ...assets.get(key), category, name,
            ...(typeof item.description === "string" ? { description: item.description.trim() } : {}),
            ...(typeof item.details === "string" ? { details: item.details.trim() } : {}),
        });
    }
    const source = typeof args.source === "string" ? args.source.trim() : "";
    const fingerprint = JSON.stringify([...assets.keys()].sort());
    const requestedId = typeof args.planId === "string" ? args.planId : undefined;
    const existingOverview = nodes.find(node =>
        node.metadata?.assetPlanRole === "overview" &&
        (requestedId ? node.metadata.assetPlanId === requestedId
            : source ? normalize(node.metadata.assetSource || "") === normalize(source)
                : !node.metadata.assetSource && node.metadata.assetFingerprint === fingerprint),
    );
    if (requestedId && !existingOverview) throw new Error("资产规划不存在，请先读取画布并使用有效的 planId");
    const planId = existingOverview?.metadata?.assetPlanId || nanoid();
    const existing = nodes.filter(node => node.metadata?.assetPlanId === planId);
    const planned: CanvasNodeData[] = [];
    const upsert = (old: CanvasNodeData | undefined, title: string, metadata: CanvasNodeMetadata) => {
        const node = old
            ? { ...old, metadata: { ...old.metadata, ...metadata } }
            : { ...createCanvasNode(CanvasNodeType.Text, center, metadata), title };
        planned.push(node);
        return node;
    };
    const base = { assetPlan: true, assetPlanId: planId, status: "success" as const };
    const overview = upsert(existingOverview, "资产规划总览", {
        ...base, assetPlanRole: "overview", assetCategory: "资产规划",
        assetSource: source || existingOverview?.metadata?.assetSource || "", assetFingerprint: fingerprint,
    });
    const categories = ASSET_CATEGORIES.filter(category =>
        [...assets.values()].some(asset => asset.category === category) ||
        existing.some(node => node.metadata?.assetPlanRole === "asset" && node.metadata.assetCategory === category),
    );
    for (const category of categories) {
        const categoryNode = upsert(existing.find(node => node.metadata?.assetPlanRole === "category" && node.metadata.assetCategory === category), `${category}资产`, {
            ...base, assetPlanRole: "category", assetCategory: category, assetParentId: overview.id,
        });
        const items = existing.filter(node => node.metadata?.assetPlanRole === "asset" && node.metadata.assetCategory === category);
        for (const [key, asset] of assets) {
            if (asset.category !== category) continue;
            const old = items.find(node => node.metadata?.assetKey === key);
            const description = asset.description ?? old?.metadata?.assetDescription ?? "";
            const details = asset.details ?? old?.metadata?.assetDetails ?? "";
            const leaf = upsert(old, `${category} · ${asset.name}`, {
                ...base, assetPlanRole: "asset", assetCategory: category, assetParentId: categoryNode.id,
                assetKey: key, assetName: asset.name, assetDescription: description, assetDetails: details,
                content: [`${category}：${asset.name}`, description && `描述：${description}`, details && `细节：${details}`].filter(Boolean).join("\n\n"),
            });
            const index = items.findIndex(node => node.id === leaf.id);
            if (index >= 0) items[index] = leaf;
            else items.push(leaf);
        }
        categoryNode.metadata = { ...categoryNode.metadata, content: [`${category}资产（${items.length}）`, ...items.map((node, index) => `${index + 1}. ${node.metadata?.assetName}`)].join("\n") };
    }
    const byId = new Map(existing.map(node => [node.id, node]));
    planned.forEach(node => byId.set(node.id, node));
    const allAssets = [...byId.values()].filter(node => node.metadata?.assetPlanRole === "asset");
    overview.metadata = {
        ...overview.metadata,
        assetFingerprint: JSON.stringify(allAssets.map(node => node.metadata?.assetKey).sort()),
        content: ["资产规划", overview.metadata?.assetSource && `依据：${overview.metadata.assetSource}`, ...categories.map(category => `${category}：${allAssets.filter(node => node.metadata?.assetCategory === category).length} 项`)].filter(Boolean).join("\n\n"),
    };
    // New plans use separate category rows with the index on the left and one node per asset.
    // On updates only new nodes are placed; existing nodes keep user-arranged positions.
    const existingIds = new Set(nodes.map(node => node.id));
    const added = planned.filter(node => !existingIds.has(node.id));
    const rowX = center.x - overview.width / 2;
    let rowY = existing.length ? Math.max(...existing.map(node => node.position.y + node.height)) + AGENT_LAYOUT_GAP : center.y - overview.height / 2;
    if (!existingOverview) {
        overview.position = { x: rowX, y: rowY };
        rowY += overview.height + AGENT_LAYOUT_GAP;
    }
    for (const category of categories) {
        const categoryNodes = added.filter(node => node.metadata?.assetCategory === category);
        const header = categoryNodes.find(node => node.metadata?.assetPlanRole === "category");
        const leaves = categoryNodes.filter(node => node.metadata?.assetPlanRole === "asset");
        if (!categoryNodes.length) continue;
        if (header) header.position = { x: rowX, y: rowY };
        const columnWidth = Math.max(overview.width, ...leaves.map(node => node.width));
        const rowHeight = Math.max(overview.height, ...leaves.map(node => node.height));
        leaves.forEach((node, index) => {
            node.position = { x: rowX + (1 + index % 3) * (columnWidth + AGENT_LAYOUT_GAP), y: rowY + Math.floor(index / 3) * (rowHeight + AGENT_LAYOUT_GAP) };
        });
        rowY += Math.max(1, Math.ceil(leaves.length / 3)) * (rowHeight + AGENT_LAYOUT_GAP);
    }
    const placed: CanvasNodeData[] = [];
    if (!existingOverview) {
        placed.push(...placeAgentBlock(added, nodes));
    } else {
        for (const node of added) {
            const category = node.metadata?.assetCategory;
            const categoryNode = existing.find(item => item.metadata?.assetPlanRole === "category" && item.metadata.assetCategory === category);
            if (categoryNode && node.metadata?.assetPlanRole === "asset") {
                const siblingCount = [...existing, ...placed].filter(item => item.metadata?.assetPlanRole === "asset" && item.metadata.assetCategory === category).length;
                const rowWidth = Math.max(categoryNode.width, node.width);
                const rowHeight = Math.max(categoryNode.height, node.height);
                node.position = {
                    x: categoryNode.position.x + categoryNode.width + AGENT_LAYOUT_GAP + (siblingCount % 3) * (rowWidth + AGENT_LAYOUT_GAP),
                    y: categoryNode.position.y + Math.floor(siblingCount / 3) * (rowHeight + AGENT_LAYOUT_GAP),
                };
            }
            placed.push(...placeAgentBlock([node], [...nodes, ...placed], categoryNode ? categoryNode.position.x + categoryNode.width + AGENT_LAYOUT_GAP : -Infinity));
        }
    }
    const replacements = new Map(planned.filter(node => existingIds.has(node.id)).map(node => [node.id, node]));
    return {
        nodes: [...nodes.map(node => replacements.get(node.id) || node), ...placed],
        planId, overviewId: overview.id, created: placed, updated: [...replacements.values()], assetCount: allAssets.length,
    };
}
