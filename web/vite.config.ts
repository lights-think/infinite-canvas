import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");
const chatgpt2apiProxyPrefix = "/__chatgpt2api";

function normalizeProxyTarget(value: string | undefined) {
    const raw = (value || "http://127.0.0.1:8018").trim().replace(/\/+$/, "");
    const absolute = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    return absolute.replace(/\/v1$/i, "");
}

const chatgpt2apiProxyTarget = normalizeProxyTarget(process.env.CHATGPT2API_BASE_URL || process.env.AICY_IMAGE_API_BASE_URL || process.env.VITE_CHATGPT2API_BASE_URL || process.env.VITE_AICY_IMAGE_API_BASE_URL);
const chatgpt2apiProxyKey = (process.env.CHATGPT2API_API_KEY || process.env.AICY_IMAGE_API_KEY || process.env.VITE_CHATGPT2API_API_KEY || process.env.VITE_AICY_IMAGE_API_KEY || "").trim();
const chatgpt2apiConfiguredBaseUrl = `${chatgpt2apiProxyTarget}/v1`;

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react()],
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(localVersion),
        __APP_RELEASES__: JSON.stringify(parseChangelog(localChangelog)),
        __CHATGPT2API_CONFIGURED_BASE_URL__: JSON.stringify(chatgpt2apiConfiguredBaseUrl),
        __CHATGPT2API_HAS_SERVER_API_KEY__: JSON.stringify(Boolean(chatgpt2apiProxyKey)),
    },
    server: {
        proxy: {
            // 浏览器只打同源代理；chatgpt2api 真实地址和 key 留在 infinite-canvas 服务侧。
            [chatgpt2apiProxyPrefix]: {
                target: chatgpt2apiProxyTarget,
                changeOrigin: true,
                secure: false,
                rewrite: (path) => path.replace(new RegExp(`^${chatgpt2apiProxyPrefix}`), ""),
                ...(chatgpt2apiProxyKey ? { headers: { Authorization: `Bearer ${chatgpt2apiProxyKey}` } } : {}),
            },
        },
    },
    preview: {
        proxy: {
            [chatgpt2apiProxyPrefix]: {
                target: chatgpt2apiProxyTarget,
                changeOrigin: true,
                secure: false,
                rewrite: (path) => path.replace(new RegExp(`^${chatgpt2apiProxyPrefix}`), ""),
                ...(chatgpt2apiProxyKey ? { headers: { Authorization: `Bearer ${chatgpt2apiProxyKey}` } } : {}),
            },
        },
    },
});
