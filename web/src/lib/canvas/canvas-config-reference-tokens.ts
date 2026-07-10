import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

const referenceSourceTypes = new Set(["image", "text", "video", "audio"]);

export function appendConfigReferenceToken(content: string, nodeId: string) {
    const token = referenceToken(nodeId);
    if (content.includes(token)) return content;
    const prefix = content.trimEnd();
    return prefix ? `${prefix} ${token} ` : `${token} `;
}

export function removeConfigReferenceToken(content: string, nodeId: string) {
    return content
        .replaceAll(referenceToken(nodeId), "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .trim();
}

export function addConfigReferenceForConnection(nodes: CanvasNodeData[], connection: CanvasConnection) {
    const source = nodes.find((node) => node.id === connection.fromNodeId);
    const target = nodes.find((node) => node.id === connection.toNodeId);
    if (!source || !target || !referenceSourceTypes.has(String(source.type)) || String(target.type) !== "config") return nodes;

    const content = target.metadata?.composerContent ?? target.metadata?.prompt ?? "";
    const composerContent = appendConfigReferenceToken(content, source.id);
    if (composerContent === content) return nodes;
    return nodes.map((node) => (node.id === target.id ? { ...node, metadata: { ...node.metadata, composerContent } } : node));
}

export function removeConfigReferenceForConnection(nodes: CanvasNodeData[], connection: CanvasConnection) {
    const target = nodes.find((node) => node.id === connection.toNodeId);
    if (!target || String(target.type) !== "config") return nodes;

    const content = target.metadata?.composerContent ?? target.metadata?.prompt ?? "";
    const composerContent = removeConfigReferenceToken(content, connection.fromNodeId);
    if (composerContent === content) return nodes;
    return nodes.map((node) => (node.id === target.id ? { ...node, metadata: { ...node.metadata, composerContent } } : node));
}

function referenceToken(nodeId: string) {
    return `@[node:${nodeId}]`;
}
