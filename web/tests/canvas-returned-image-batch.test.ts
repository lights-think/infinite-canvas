import assert from "node:assert/strict";
import test from "node:test";

import { buildReturnedImageBatch, isBatchChildHidden } from "../src/lib/canvas/canvas-returned-image-batch.ts";
import type { CanvasNodeData } from "../src/types/canvas.ts";

test("keeps every returned image in order under one batch root", () => {
    const root: CanvasNodeData = {
        id: "root",
        type: "image" as CanvasNodeData["type"],
        title: "钥匙箱户外场景",
        position: { x: 100, y: 200 },
        width: 360,
        height: 360,
        metadata: { prompt: "钥匙箱户外场景", status: "loading", model: "gpt-image-2", count: 1 },
    };

    const batch = buildReturnedImageBatch({
        root,
        images: [
            { width: 300, height: 200, metadata: { content: "first", storageKey: "image:first" } },
            { width: 200, height: 300, metadata: { content: "second", storageKey: "image:second" } },
        ],
        childIds: ["child-first", "child-second"],
        connectionIds: ["connection-first", "connection-second"],
        defaultImageSize: { width: 360, height: 360 },
    });

    assert.equal(batch.root.metadata?.content, "first");
    assert.equal(batch.root.metadata?.count, 2);
    assert.equal(batch.root.metadata?.isBatchRoot, true);
    assert.deepEqual(batch.root.metadata?.batchChildIds, ["child-first", "child-second"]);
    assert.equal(batch.root.metadata?.primaryImageId, "child-first");
    assert.deepEqual(batch.children.map((node) => node.metadata?.content), ["first", "second"]);
    assert.deepEqual(batch.children.map((node) => node.metadata?.batchRootId), ["root", "root"]);
    assert.deepEqual(batch.connections, [
        { id: "connection-first", fromNodeId: "root", toNodeId: "child-first" },
        { id: "connection-second", fromNodeId: "root", toNodeId: "child-second" },
    ]);
});

test("uses the root directly when chatgpt2api returns one image", () => {
    const root: CanvasNodeData = {
        id: "root",
        type: "image" as CanvasNodeData["type"],
        title: "钥匙箱",
        position: { x: 0, y: 0 },
        width: 360,
        height: 360,
        metadata: { status: "loading", count: 1 },
    };

    const batch = buildReturnedImageBatch({
        root,
        images: [{ width: 320, height: 240, metadata: { content: "only", storageKey: "image:only" } }],
        childIds: [],
        connectionIds: [],
        defaultImageSize: { width: 360, height: 360 },
    });

    assert.equal(batch.root.metadata?.content, "only");
    assert.equal(batch.root.metadata?.isBatchRoot, undefined);
    assert.deepEqual(batch.children, []);
    assert.deepEqual(batch.connections, []);
});

test("shows exactly one visual per returned image when a batch is expanded", () => {
    const root: CanvasNodeData = {
        id: "root",
        type: "image" as CanvasNodeData["type"],
        title: "场景图",
        position: { x: 0, y: 0 },
        width: 360,
        height: 360,
        metadata: {
            content: "first",
            isBatchRoot: true,
            batchChildIds: ["child-first", "child-second"],
            primaryImageId: "child-first",
            imageBatchExpanded: true,
        },
    };
    const first: CanvasNodeData = {
        id: "child-first",
        type: root.type,
        title: root.title,
        position: { x: 480, y: 0 },
        width: 360,
        height: 360,
        metadata: { content: "first", batchRootId: root.id },
    };
    const second: CanvasNodeData = {
        ...first,
        id: "child-second",
        position: { x: 876, y: 0 },
        metadata: { content: "second", batchRootId: root.id },
    };
    const nodes = [root, first, second];

    assert.equal(isBatchChildHidden(first, nodes), true);
    assert.equal(isBatchChildHidden(second, nodes), false);
});

test("hides every child when collapsed and follows primary-image changes", () => {
    const first: CanvasNodeData = {
        id: "child-first",
        type: "image" as CanvasNodeData["type"],
        title: "场景图",
        position: { x: 480, y: 0 },
        width: 360,
        height: 360,
        metadata: { content: "first", batchRootId: "root" },
    };
    const second: CanvasNodeData = {
        ...first,
        id: "child-second",
        metadata: { content: "second", batchRootId: "root" },
    };
    const collapsedRoot: CanvasNodeData = {
        id: "root",
        type: first.type,
        title: first.title,
        position: { x: 0, y: 0 },
        width: 360,
        height: 360,
        metadata: {
            content: "first",
            isBatchRoot: true,
            batchChildIds: [first.id, second.id],
            primaryImageId: first.id,
            imageBatchExpanded: false,
        },
    };

    assert.equal(isBatchChildHidden(first, [collapsedRoot, first, second]), true);
    assert.equal(isBatchChildHidden(second, [collapsedRoot, first, second]), true);

    const switchedRoot: CanvasNodeData = {
        ...collapsedRoot,
        metadata: { ...collapsedRoot.metadata, primaryImageId: second.id, imageBatchExpanded: true },
    };
    assert.equal(isBatchChildHidden(first, [switchedRoot, first, second]), false);
    assert.equal(isBatchChildHidden(second, [switchedRoot, first, second]), true);
});
