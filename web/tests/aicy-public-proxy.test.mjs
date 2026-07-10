import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createServer as createViteServer } from "vite";

async function listen(server) {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    return server.address().port;
}

const upstreamRequests = [];
const upstream = http.createServer((request, response) => {
    upstreamRequests.push({ method: request.method, url: request.url });
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ role: "admin" }));
});
const upstreamPort = await listen(upstream);
const previousBaseUrl = process.env.AICY_IMAGE_API_BASE_URL;
const previousApiKey = process.env.AICY_IMAGE_API_KEY;
const cacheDir = await mkdtemp(path.join(os.tmpdir(), "infinite-canvas-vite-test-"));
process.env.AICY_IMAGE_API_BASE_URL = `http://127.0.0.1:${upstreamPort}`;
process.env.AICY_IMAGE_API_KEY = "must-stay-out-of-vite";

let vite;
try {
    vite = await createViteServer({
        configFile: new URL("../vite.config.ts", import.meta.url).pathname,
        cacheDir,
        logLevel: "silent",
        server: { host: "127.0.0.1", port: 0 },
    });
    await vite.listen();
    const address = vite.httpServer.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/__chatgpt2api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "anonymous" }),
    });
    await response.arrayBuffer();
    assert.equal(upstreamRequests.length, 0, "public Vite route must never reach chatgpt2api");
} finally {
    await vite?.close();
    await rm(cacheDir, { recursive: true, force: true });
    await new Promise((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
    if (previousBaseUrl === undefined) delete process.env.AICY_IMAGE_API_BASE_URL;
    else process.env.AICY_IMAGE_API_BASE_URL = previousBaseUrl;
    if (previousApiKey === undefined) delete process.env.AICY_IMAGE_API_KEY;
    else process.env.AICY_IMAGE_API_KEY = previousApiKey;
}

console.log("aicy public proxy behavior test passed");
