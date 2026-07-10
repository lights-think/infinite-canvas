import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let toolbarLayout = {};
try {
    toolbarLayout = await import("../src/components/canvas/canvas-hover-toolbar-layout.ts");
} catch {
    // RED 阶段允许模块尚未创建，下面的接口断言会给出明确失败原因。
}

assert.equal(typeof toolbarLayout.canvasHoverToolbarMaxWidth, "function", "must expose the toolbar max-width calculation");
assert.equal(typeof toolbarLayout.clampCanvasHoverToolbarCenter, "function", "must expose the toolbar horizontal clamp");
assert.equal(toolbarLayout.canvasHoverToolbarMaxWidth(360), 336);
assert.equal(toolbarLayout.clampCanvasHoverToolbarCenter(180, 300, 360), 180);
assert.equal(toolbarLayout.clampCanvasHoverToolbarCenter(20, 300, 360), 162);
assert.equal(toolbarLayout.clampCanvasHoverToolbarCenter(350, 300, 360), 198);

const toolbarSource = readFileSync(new URL("../src/components/canvas/canvas-node-hover-toolbar.tsx", import.meta.url), "utf8");
assert.ok(toolbarSource.includes("flex-wrap"), "toolbar must wrap on narrow canvases");
assert.ok(toolbarSource.includes("viewportWidth"), "toolbar must respect the visible canvas width");
assert.equal(toolbarSource.includes("flex h-12"), false, "toolbar must not keep the old 48px fixed height");
