import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { build } from "vite";

async function filesUnder(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return (
        await Promise.all(
            entries.map(async (entry) => {
                const entryPath = path.join(directory, entry.name);
                return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
            }),
        )
    ).flat();
}

const canaries = {
    VITE_AICY_IMAGE_API_KEY: "CANARY_AICY_IMAGE_KEY_MUST_NOT_REACH_BROWSER",
    VITE_CHATGPT2API_API_KEY: "CANARY_CHATGPT2API_KEY_MUST_NOT_REACH_BROWSER",
};
const previous = Object.fromEntries(Object.keys(canaries).map((name) => [name, process.env[name]]));
const root = await mkdtemp(path.join(os.tmpdir(), "infinite-canvas-secret-build-"));
const outDir = path.join(root, "dist");

try {
    Object.assign(process.env, canaries);
    await build({
        configFile: new URL("../vite.config.ts", import.meta.url).pathname,
        cacheDir: path.join(root, "cache"),
        logLevel: "silent",
        build: { outDir, emptyOutDir: true },
    });
    const output = (await Promise.all((await filesUnder(outDir)).map((file) => readFile(file, "utf8")))).join("\n");
    for (const [name, canary] of Object.entries(canaries)) {
        assert.equal(output.includes(name), false, `${name} must not be bundled`);
        assert.equal(output.includes(canary), false, `${name} value must not be bundled`);
    }
} finally {
    for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
}

console.log("aicy Vite secret leak test passed");
