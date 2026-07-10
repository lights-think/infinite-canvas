import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let leaseModule = {};
try {
    leaseModule = await import("../src/services/canvas-generation-lease.ts");
} catch {
    // RED 阶段允许模块尚未创建。
}

assert.equal(typeof leaseModule.createCanvasGenerationLeaseManager, "function");

function memoryStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    };
}

const storage = memoryStorage();
let now = 1_000;
const owner = leaseModule.createCanvasGenerationLeaseManager({ storage, ownerId: "tab-a", now: () => now, ttlMs: 10_000 });
const observer = leaseModule.createCanvasGenerationLeaseManager({ storage, ownerId: "tab-b", now: () => now, ttlMs: 10_000 });

owner.begin("project-1", "node-1");
assert.equal(observer.isActive("project-1", "node-1"), true, "another tab must preserve a live generation node");

observer.end("project-1", "node-1");
assert.equal(owner.isActive("project-1", "node-1"), true, "a non-owner must not clear another tab's lease");

owner.end("project-1", "node-1");
assert.equal(observer.isActive("project-1", "node-1"), false);

owner.begin("project-1", "node-stale");
now += 10_001;
assert.equal(observer.isActive("project-1", "node-stale"), false, "a crashed tab's stale lease must expire");

const projectSource = readFileSync(new URL("../src/pages/canvas/project.tsx", import.meta.url), "utf8");
assert.ok(projectSource.includes("beginCanvasGenerationLease(projectId, targetNodeId)"));
assert.ok(projectSource.includes("endCanvasGenerationLease(projectId, targetNodeId)"));
assert.ok(projectSource.includes("resetInterruptedGeneration(project.nodes, projectId)"));
