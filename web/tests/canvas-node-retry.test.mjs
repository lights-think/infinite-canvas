import assert from "node:assert/strict";

let retryHelpers = {};
try {
    retryHelpers = await import("../src/components/canvas/canvas-node-retry.ts");
} catch {
    // RED 阶段允许模块尚未创建。
}

assert.equal(
    retryHelpers.retryGenerationContextPrompt?.(
        {
            metadata: {
                composerContent: "参考图片：@[node:image-1]",
                prompt: "参考图片：图片1",
            },
        },
        "child prompt",
    ),
    "参考图片：@[node:image-1]",
);

assert.equal(retryHelpers.retryGenerationContextPrompt?.({ metadata: { prompt: "saved prompt" } }, "child prompt"), "saved prompt");
assert.equal(retryHelpers.retryGenerationContextPrompt?.(undefined, "child prompt"), "child prompt");
