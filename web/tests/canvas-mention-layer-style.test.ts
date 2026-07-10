import assert from "node:assert/strict";
import test from "node:test";

import { buildMentionLayerStyles } from "../src/lib/canvas/canvas-mention-layer-style.ts";

test("keeps the caret above the reference highlight layer", () => {
    const layers = buildMentionLayerStyles({ background: "#222", color: "#eee" }, "#eee", true);

    assert.equal(layers.textareaStyle.color, "transparent");
    assert.equal(layers.textareaStyle.caretColor, "#eee");
    assert.equal(layers.textareaStyle.zIndex, 1);
    assert.equal(layers.overlayStyle.zIndex, 0);
});

test("keeps ordinary textarea text visible when the overlay is disabled", () => {
    const layers = buildMentionLayerStyles({ background: "#222", color: "#eee" }, "#eee", false);

    assert.equal(layers.textareaStyle.color, "#eee");
    assert.equal(layers.textareaStyle.background, "#222");
    assert.equal(layers.textareaStyle.caretColor, "#eee");
});
