import assert from "node:assert/strict";
import test from "node:test";

import {
    addConfigReferenceForConnection,
    appendConfigReferenceToken,
    removeConfigReferenceForConnection,
    removeConfigReferenceToken,
} from "../src/lib/canvas/canvas-config-reference-tokens.ts";
import type { CanvasConnection, CanvasNodeData } from "../src/types/canvas.ts";

const connection: CanvasConnection = { id: "connection", fromNodeId: "image", toNodeId: "config" };

function buildNodes(composerContent = ""): CanvasNodeData[] {
    return [
        {
            id: "image",
            type: "image" as CanvasNodeData["type"],
            title: "图片",
            position: { x: 0, y: 0 },
            width: 320,
            height: 320,
            metadata: {},
        },
        {
            id: "config",
            type: "config" as CanvasNodeData["type"],
            title: "生成配置",
            position: { x: 500, y: 0 },
            width: 320,
            height: 220,
            metadata: { composerContent },
        },
    ];
}

test("adds one token when a resource connects to a config node", () => {
    const next = addConfigReferenceForConnection(buildNodes(), connection);

    assert.equal(next.find((node) => node.id === "config")?.metadata?.composerContent, "@[node:image] ");
});

test("does not duplicate a token and removes it on disconnect", () => {
    const once = addConfigReferenceForConnection(buildNodes(), connection);
    const twice = addConfigReferenceForConnection(once, connection);

    assert.equal(twice.find((node) => node.id === "config")?.metadata?.composerContent, "@[node:image] ");
    assert.equal(removeConfigReferenceForConnection(twice, connection).find((node) => node.id === "config")?.metadata?.composerContent, "");
});

test("preserves prompt text while adding and removing a token", () => {
    const withToken = appendConfigReferenceToken("生成户外场景", "image");

    assert.equal(withToken, "生成户外场景 @[node:image] ");
    assert.equal(removeConfigReferenceToken(withToken, "image"), "生成户外场景");
});

test("does not restore a manually deleted token without reconnecting", () => {
    assert.equal(removeConfigReferenceToken("商品场景", "image"), "商品场景");
});

test("ignores connections whose target is not a config node", () => {
    const nodes = buildNodes();
    const nonConfigConnection = { ...connection, toNodeId: "image", fromNodeId: "config" };

    assert.strictEqual(addConfigReferenceForConnection(nodes, nonConfigConnection), nodes);
});
