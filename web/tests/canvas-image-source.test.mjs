import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let imageSource = {};
try {
    imageSource = await import("../src/services/canvas-image-source.ts");
} catch {
    // RED 阶段允许模块尚未创建，下面的接口断言会给出明确失败原因。
}

assert.equal(typeof imageSource.resolveCanvasImageBlob, "function", "must expose one image source resolver");
assert.equal(typeof imageSource.canvasImageSourceFromAsset, "function", "must normalize image assets before insertion");

const storedBlob = new Blob(["stored"], { type: "image/png" });
const storedCalls = [];
const stored = await imageSource.resolveCanvasImageBlob(
    { storageKey: "image:stored", dataUrl: "blob:https://canvas.invalid/stale" },
    {
        readStoredFile: async (key) => {
            storedCalls.push(`read:${key}`);
            return storedBlob;
        },
        fetchBlob: async (url) => {
            storedCalls.push(`fetch:${url}`);
            throw new Error("stale blob must not be fetched");
        },
    },
);
assert.equal(stored.storageKey, "image:stored");
assert.equal(stored.blob, storedBlob);
assert.deepEqual(storedCalls, ["read:image:stored"]);

const fallbackCalls = [];
const fallbackBlob = new Blob(["cover"], { type: "image/webp" });
const fallback = await imageSource.resolveCanvasImageBlob(
    {
        storageKey: "image:missing",
        dataUrl: "blob:https://canvas.invalid/stale",
        coverUrl: "https://assets.example.com/cover.webp",
    },
    {
        readStoredFile: async (key) => {
            fallbackCalls.push(`read:${key}`);
            throw new Error("missing");
        },
        fetchBlob: async (url) => {
            fallbackCalls.push(`fetch:${url}`);
            if (url.startsWith("blob:")) throw new Error("stale");
            return fallbackBlob;
        },
    },
);
assert.equal(fallback.blob, fallbackBlob);
assert.deepEqual(fallbackCalls, ["read:image:missing", "fetch:https://assets.example.com/cover.webp"]);

const gatewayCalls = [];
const gateway = await imageSource.resolveCanvasImageBlob(
    { aicyFile: { storageKey: "image:gateway", mimeType: "image/png", size: 6 }, dataUrl: "data:image/png;base64,c3RhbGU=" },
    {
        readStoredFile: async (key) => {
            gatewayCalls.push(`read:${key}`);
            return new Blob(["gateway"]);
        },
        fetchBlob: async (url) => {
            gatewayCalls.push(`fetch:${url}`);
            throw new Error("must not upload or fetch the generated image again");
        },
    },
);
assert.equal(gateway.storageKey, "image:gateway");
assert.equal(gateway.blob.type, "image/png");
assert.deepEqual(gatewayCalls, ["read:image:gateway"]);

assert.deepEqual(imageSource.canvasImageSourceFromAsset({ dataUrl: "", storageKey: "image:asset" }, "https://assets.example.com/preview.png"), {
    storageKey: "image:asset",
    dataUrl: "",
    coverUrl: "https://assets.example.com/preview.png",
});

await assert.rejects(
    imageSource.resolveCanvasImageBlob(
        { dataUrl: "blob:https://canvas.invalid/missing" },
        {
            readStoredFile: async () => null,
            fetchBlob: async () => {
                throw new Error("Failed to fetch");
            },
        },
    ),
    /图片素材读取失败，请重新插入或刷新素材/,
);

const projectSource = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
assert.ok(projectSource.includes("await uploadImage({ storageKey: node.metadata.storageKey, dataUrl: content || \"\" })"), "history hydration must use the shared image source resolver");
