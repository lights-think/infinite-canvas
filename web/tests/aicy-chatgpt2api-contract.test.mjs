import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path) {
    return readFileSync(new URL(path, import.meta.url), "utf8");
}

const chatgpt2apiSource = source("../src/services/chatgpt2api-config.ts");
const aicyIntegrationSource = source("../src/services/aicy-integration.ts");
const configStoreSource = source("../src/stores/use-config-store.ts");
const imageApiSource = source("../src/services/api/image.ts");
const responsesApiSource = source("../src/services/api/responses.ts");
const canvasProjectSource = source("../src/pages/canvas/project.tsx");
const remoteStateSource = source("../src/services/aicy-remote-state.ts");
const viteConfigSource = source("../vite.config.ts");

assert.equal(viteConfigSource.includes("/__chatgpt2api"), false);
assert.equal(viteConfigSource.includes("AICY_IMAGE_API_KEY"), false);
assert.equal(viteConfigSource.includes("CHATGPT2API_API_KEY"), false);
assert.equal(viteConfigSource.includes("server: {\n        proxy"), false);
assert.equal(viteConfigSource.includes("preview: {\n        proxy"), false);

assert.ok(aicyIntegrationSource.includes("aiBasePath: string"));
assert.ok(aicyIntegrationSource.includes("stateWritePath: string"));
assert.ok(aicyIntegrationSource.includes("protocolVersion: 2"));
assert.ok(aicyIntegrationSource.includes('"/api/infinite-canvas/ai/v1"'));
assert.ok(aicyIntegrationSource.includes('"/api/infinite-canvas/state/cas"'));
assert.ok(aicyIntegrationSource.includes("export async function aicyAiFetch"));
assert.ok(aicyIntegrationSource.includes("Bearer ${value.token}"));
assert.equal(aicyIntegrationSource.includes("MANAGED_AICY_CANVAS_HOSTS"), false);
assert.equal(aicyIntegrationSource.includes("canvas.aicy.uniclife.cn"), false);
assert.ok(remoteStateSource.includes("activeSession.stateWritePath"));
assert.equal(remoteStateSource.includes("sessionWithWritePath"), false);

assert.ok(chatgpt2apiSource.includes('aicyAiFetch("/models")'));
assert.equal(chatgpt2apiSource.includes("VITE_CHATGPT2API_BASE_URL"), false);
assert.equal(chatgpt2apiSource.includes("VITE_CHATGPT2API_API_KEY"), false);
assert.equal(chatgpt2apiSource.includes("VITE_AICY_IMAGE_API_KEY"), false);
assert.equal(chatgpt2apiSource.includes("chatgpt2apiAuthHeaders"), false);
assert.equal(chatgpt2apiSource.includes("chatgpt2apiBrowserBaseUrl"), false);

assert.ok(responsesApiSource.includes('aicyAiFetch("/responses"'));
assert.ok(imageApiSource.includes('aicyAiFetch("/images/generations"'));
assert.ok(imageApiSource.includes('aicyAiFetch("/images/edits"'));
assert.ok(imageApiSource.includes('aicyAiFetch("/models")'));
assert.equal(imageApiSource.includes("chatgpt2apiAuthHeaders"), false);
assert.equal(imageApiSource.includes("chatgpt2apiBrowserBaseUrl"), false);
assert.equal(imageApiSource.includes("/__chatgpt2api"), false);
assert.ok(canvasProjectSource.includes("buildReturnedImageBatch"));
assert.ok(canvasProjectSource.includes("const count = aicyMode ? 1 : getGenerationCount(generationConfig.count);"));

assert.ok(configStoreSource.includes('baseUrl: ""'));
assert.ok(configStoreSource.includes('apiKey: ""'));
assert.equal(configStoreSource.includes("chatgpt2apiConfiguredBaseUrl"), false);
assert.equal(configStoreSource.includes("chatgpt2apiConfiguredApiKey"), false);
assert.ok(configStoreSource.includes("const requestedModel = modelOptionName(value || config.model || config.imageModel);"));
assert.ok(configStoreSource.includes("resolveAicyManagedTextRequestModel(requestedModel, availableModels).model"));
assert.ok(configStoreSource.includes("normalizeChatgpt2apiModelName(requestedModel, availableModels)"));
assert.ok(configStoreSource.includes("availableModels"));

console.log("aicy chatgpt2api contract tests passed");
