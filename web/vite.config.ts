import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { parseChangelog } from "./src/lib/release";

const webDir = dirname(fileURLToPath(import.meta.url));
const localVersion = readFileSync(resolve(webDir, "../VERSION"), "utf8").trim() || "dev";
const localChangelog = readFileSync(resolve(webDir, "../CHANGELOG.md"), "utf8");
const defaultPreviewAllowedHosts = ["canvas.aicy.uniclife.cn"];
const previewAllowedHosts = (process.env.VITE_PREVIEW_ALLOWED_HOSTS || process.env.PREVIEW_ALLOWED_HOSTS || "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);

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
    },
    preview: {
        // 生产入口经 nginx 反代到 Vite preview，需要允许外部域名 Host。
        allowedHosts: previewAllowedHosts.length > 0 ? previewAllowedHosts : defaultPreviewAllowedHosts,
    },
});
