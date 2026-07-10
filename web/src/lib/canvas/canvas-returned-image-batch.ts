import type { CanvasConnection, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

type ReturnedImageNode = {
    width: number;
    height: number;
    metadata: CanvasNodeMetadata;
};

type ReturnedImageBatchOptions = {
    root: CanvasNodeData;
    images: ReturnedImageNode[];
    childIds: string[];
    connectionIds: string[];
    defaultImageSize: { width: number; height: number };
};

export function isBatchChildHidden(node: CanvasNodeData, nodes: CanvasNodeData[], collapsingBatchIds?: Set<string>) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    if (!root || collapsingBatchIds?.has(rootId)) return false;
    if (!root.metadata?.imageBatchExpanded) return true;
    // 根节点已经展示当前主图；展开时隐藏对应子节点，确保 N 个结果只出现 N 个可见图片。
    return root.metadata.primaryImageId === node.id;
}

export function buildReturnedImageBatch({ root, images, childIds, connectionIds, defaultImageSize }: ReturnedImageBatchOptions) {
    if (!images.length) throw new Error("图片接口没有返回结果");
    const isBatch = images.length > 1;
    if (isBatch && (childIds.length !== images.length || connectionIds.length !== images.length)) {
        throw new Error("多图节点标识数量不匹配");
    }

    const first = images[0];
    const center = { x: root.position.x + root.width / 2, y: root.position.y + root.height / 2 };
    const rootNode: CanvasNodeData = {
        ...root,
        position: { x: center.x - first.width / 2, y: center.y - first.height / 2 },
        width: first.width,
        height: first.height,
        metadata: {
            ...root.metadata,
            ...first.metadata,
            status: "success",
            count: images.length,
            isBatchRoot: isBatch || undefined,
            batchRootId: undefined,
            batchChildIds: isBatch ? childIds : undefined,
            primaryImageId: isBatch ? childIds[0] : undefined,
            imageBatchExpanded: isBatch || undefined,
        },
    };
    if (!isBatch) return { root: rootNode, children: [], connections: [] };

    const children = images.map((image, index): CanvasNodeData => ({
        id: childIds[index],
        type: root.type,
        title: root.title,
        position: {
            x: root.position.x + root.width + 120 + (index % 2) * (defaultImageSize.width + 36),
            y: root.position.y + Math.floor(index / 2) * (defaultImageSize.height + 36),
        },
        width: image.width,
        height: image.height,
        metadata: {
            ...root.metadata,
            ...image.metadata,
            status: "success",
            count: images.length,
            isBatchRoot: undefined,
            batchRootId: root.id,
            batchChildIds: undefined,
            primaryImageId: undefined,
            imageBatchExpanded: undefined,
        },
    }));
    const connections: CanvasConnection[] = childIds.map((childId, index) => ({
        id: connectionIds[index],
        fromNodeId: root.id,
        toNodeId: childId,
    }));
    return { root: rootNode, children, connections };
}
