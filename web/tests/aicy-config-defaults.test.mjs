import assert from "node:assert/strict";

let defaults = {};
try {
    defaults = await import("../src/services/aicy-config-defaults.ts");
} catch {
    // RED 阶段允许模块尚未创建，下面的接口断言会给出明确失败原因。
}

assert.equal(defaults.AICY_CONFIG_DEFAULTS_VERSION, 1);
assert.deepEqual(defaults.migrateAicyConfigDefaults({ size: "1:1" }), { size: "auto" });
assert.deepEqual(defaults.migrateAicyConfigDefaults({ size: "1:1", defaultsVersion: 1 }), { size: "1:1", defaultsVersion: 1 });
assert.deepEqual(defaults.migrateAicyConfigDefaults({ size: "16:9" }), { size: "16:9" });
assert.deepEqual(defaults.withAicyConfigDefaultsVersion({ size: "auto" }), { size: "auto", defaultsVersion: 1 });
