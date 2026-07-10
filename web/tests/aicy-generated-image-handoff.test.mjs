import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

const imageApiSource = source("../src/services/api/image.ts");
const imageStorageSource = source("../src/services/image-storage.ts");
const imageSourceCore = source("../src/services/canvas-image-source.ts");
const projectSource = source("../src/pages/canvas/project.tsx");
const imagePageSource = source("../src/pages/image/index.tsx");

assert.ok(imageApiSource.includes("aicy_file"), "Aicy file references must be parsed from the Gateway result");
assert.ok(imageApiSource.includes("aicyFile"), "parsed image results must retain the Aicy file reference");
assert.ok(imageStorageSource.includes("resolveCanvasImageBlob"), "storage must use the shared source resolver");
assert.ok(imageSourceCore.includes("source.aicyFile"), "the resolver must recognize an already-persisted Aicy image");
assert.ok(imageSourceCore.includes("dependencies.readStoredFile(stored.storageKey)"), "the resolver must read the Gateway file by its original key");
assert.ok(imageStorageSource.includes("if (resolved.storageKey) return createUploadedImage"), "persisted images must not be uploaded again");
assert.ok(projectSource.includes("uploadImage(image)"), "canvas generation must pass the full Gateway result to storage");
assert.ok((projectSource.match(/uploadImage\(image\)/g) || []).length >= 4, "every canvas generation/edit entry point must pass the full Gateway result to storage");
assert.ok(imagePageSource.includes("const stored = await uploadImage(image);"), "image page must materialize the persisted Gateway result directly");

console.log("aicy generated image handoff contract tests passed");
