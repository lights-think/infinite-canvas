import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let managedModels = {};
try {
    managedModels = await import("../src/services/aicy-managed-text-models.ts");
} catch {
    // RED 阶段允许模块尚未创建，下面的接口断言会给出明确失败原因。
}

assert.deepEqual(managedModels.AICY_MANAGED_TEXT_MODELS, ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]);
assert.equal(managedModels.AICY_MANAGED_TEXT_MODELS.includes("gpt-5-5"), false);
assert.equal(managedModels.AICY_MANAGED_TEXT_FALLBACK, undefined);
assert.equal(managedModels.AICY_MANAGED_TEXT_DEFAULT, "gpt-5.6-terra");

assert.deepEqual(managedModels.resolveAicyManagedTextRequestModel("gpt-5.6-terra", ["gpt-5.6-terra", "gpt-5-5"]), {
    model: "gpt-5.6-terra",
    fallback: false,
});
assert.deepEqual(managedModels.resolveAicyManagedTextRequestModel("gpt-5.6-luna", ["gpt-5-5"]), {
    model: "gpt-5.6-luna",
    fallback: false,
});

const responsesApiSource = readFileSync(new URL("../src/services/api/responses-protocol.ts", import.meta.url), "utf8");
assert.ok(responsesApiSource.includes('effort: "medium"'), "every text Responses request must use medium reasoning");

const configModalSource = readFileSync(new URL("../src/components/layout/app-config-modal.tsx", import.meta.url), "utf8");
assert.ok(configModalSource.includes("const effectiveConfig = useEffectiveConfig();"));
assert.ok(configModalSource.includes("effectiveConfig.textModels.map"), "managed model summary must not expose the persisted legacy text model while the Aicy session initializes");

const configStoreSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");
assert.match(configStoreSource, /size:\s*"auto"/);
assert.ok(configStoreSource.includes("AICY_MANAGED_TEXT_DEFAULT"));
assert.equal(configStoreSource.includes("AICY_MANAGED_TEXT_MODELS[0]"), false);
