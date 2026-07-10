import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAicyCanvasSessionMessage } from "../src/services/aicy-integration.ts";

const validMessage = {
    aiBasePath: "/api/infinite-canvas/ai/v1",
    expiresAt: Date.now() + 60_000,
    filesPath: "/api/infinite-canvas/files",
    gatewayUrl: "https://aicy.example.test",
    protocolVersion: 2,
    statePath: "/api/infinite-canvas/state",
    stateWritePath: "/api/infinite-canvas/state/cas",
    token: "canvas-token",
    type: "aicy.canvas.session",
} as const;

test("accepts only protocol v2 canvas sessions with the secure facade paths", () => {
    const normalized = normalizeAicyCanvasSessionMessage(validMessage);

    assert.equal(normalized?.protocolVersion, 2);
    assert.equal(normalized?.aiBasePath, "/api/infinite-canvas/ai/v1");
    assert.equal(normalized?.stateWritePath, "/api/infinite-canvas/state/cas");
});

test("rejects missing and legacy canvas protocol versions", () => {
    const { protocolVersion: _protocolVersion, ...missingVersion } = validMessage;

    assert.equal(normalizeAicyCanvasSessionMessage(missingVersion), null);
    assert.equal(normalizeAicyCanvasSessionMessage({ ...validMessage, protocolVersion: 1 }), null);
});
