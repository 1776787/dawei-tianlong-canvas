type ClipboardConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export function copyIncomingConnections<T extends ClipboardConnection>(
    connections: readonly T[],
    selectedIds: ReadonlySet<string>,
): T[] {
    return connections.filter((connection) => selectedIds.has(connection.toNodeId))
        .map((connection) => ({ ...connection }));
}

export function pasteIncomingConnections<T extends ClipboardConnection>(
    connections: readonly T[],
    idMap: ReadonlyMap<string, string>,
    existingNodeIds: ReadonlySet<string>,
    createId: () => string,
): T[] {
    return connections.flatMap((connection) => {
        const copiedSourceId = idMap.get(connection.fromNodeId);
        const toNodeId = idMap.get(connection.toNodeId);
        if (!toNodeId || (!copiedSourceId && !existingNodeIds.has(connection.fromNodeId))) return [];
        return [{
            ...connection,
            id: createId(),
            fromNodeId: copiedSourceId ?? connection.fromNodeId,
            toNodeId,
        }];
    });
}
