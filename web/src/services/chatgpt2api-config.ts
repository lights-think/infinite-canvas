const DEFAULT_CHATGPT2API_BASE_URL = "/__chatgpt2api/v1";
const CHATGPT2API_FALLBACK_MODELS = ["gpt-image-2", "gpt-5-5"];

declare const __CHATGPT2API_CONFIGURED_BASE_URL__: string | undefined;
declare const __CHATGPT2API_HAS_SERVER_API_KEY__: boolean | undefined;

function runtimeEnv() {
    return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env || {};
}

function normalizedBaseUrl(value: string | undefined) {
    const trimmed = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
    if (!trimmed) return DEFAULT_CHATGPT2API_BASE_URL;
    if (trimmed.startsWith("/")) return trimmed;
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `http://${trimmed}`;
}

export function chatgpt2apiBaseUrl() {
    return chatgpt2apiBrowserBaseUrl();
}

export function chatgpt2apiBrowserBaseUrl() {
    const env = runtimeEnv();
    // VITE_CHATGPT2API_BASE_URL / VITE_AICY_IMAGE_API_BASE_URL 是 Vite 代理目标；浏览器默认只访问同源代理。
    return normalizedBaseUrl(env.VITE_CHATGPT2API_BROWSER_BASE_URL);
}

function injectedConfiguredBaseUrl() {
    return typeof __CHATGPT2API_CONFIGURED_BASE_URL__ === "string" ? __CHATGPT2API_CONFIGURED_BASE_URL__ : "";
}

function hasServerSideApiKey() {
    return typeof __CHATGPT2API_HAS_SERVER_API_KEY__ === "boolean" ? __CHATGPT2API_HAS_SERVER_API_KEY__ : false;
}

export function chatgpt2apiConfiguredBaseUrl() {
    const env = runtimeEnv();
    return withOpenAiV1Base(normalizedBaseUrl(env.VITE_CHATGPT2API_BASE_URL || env.VITE_AICY_IMAGE_API_BASE_URL || injectedConfiguredBaseUrl() || chatgpt2apiBrowserBaseUrl()));
}

function withOpenAiV1Base(value: string) {
    if (value.startsWith("/")) return value;
    return /\/v1(?:\/)?$/i.test(value) ? value.replace(/\/$/, "") : `${value.replace(/\/+$/, "")}/v1`;
}

export function chatgpt2apiConfiguredApiKey() {
    const env = runtimeEnv();
    return (env.VITE_CHATGPT2API_API_KEY || env.VITE_AICY_IMAGE_API_KEY || "").trim();
}

export function chatgpt2apiApiKey() {
    return chatgpt2apiConfiguredApiKey();
}

function chatgpt2apiRequestApiKey() {
    if (chatgpt2apiBrowserBaseUrl().startsWith("/")) return "";
    return chatgpt2apiConfiguredApiKey();
}

export function chatgpt2apiKeyStatus() {
    if (chatgpt2apiConfiguredApiKey()) return "browser";
    if (hasServerSideApiKey()) return "server";
    return "missing";
}

export function chatgpt2apiDefaultModels() {
    const env = runtimeEnv();
    const configured = splitModels(env.VITE_CHATGPT2API_MODELS || env.VITE_AICY_IMAGE_MODELS);
    return configured.length ? configured : CHATGPT2API_FALLBACK_MODELS;
}

export function chatgpt2apiImageModel(models = chatgpt2apiDefaultModels()) {
    return preferredModel(models, ["gpt-image-2"], (model) => model.includes("image") || model.includes("dall") || model.includes("imagen"));
}

export function chatgpt2apiTextModel(models = chatgpt2apiDefaultModels()) {
    return preferredModel(models, ["gpt-5-5", "gpt5.5", "gpt-5.5", "gpt-5"], (model) => !model.includes("image") && !model.includes("video") && !model.includes("tts") && !model.includes("audio"));
}

export function normalizeChatgpt2apiModelName(model: string, availableModels = chatgpt2apiDefaultModels()) {
    const value = model.trim();
    if (!value) return "";
    if (availableModels.includes(value)) return value;
    const alias = value
        .toLowerCase()
        .replace(/[_\s.]+/g, "-")
        .replace(/^gpt5-/, "gpt-5-");
    const matched = availableModels.find((item) => item.toLowerCase() === alias);
    return matched || value;
}

export async function fetchChatgpt2apiModels() {
    const response = await fetch(chatgpt2apiModelsUrl(), { headers: chatgpt2apiAuthHeaders() });
    if (!response.ok) throw new Error(`读取 chatgpt2api 模型失败：${response.status}`);
    const payload = (await response.json()) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; name?: string }> };
    return uniqueModels([
        ...(payload.data || []).map((model) => model.id).filter((id): id is string => Boolean(id)),
        ...(payload.models || []).map((model) => model.id || model.name?.replace(/^models\//, "")).filter((id): id is string => Boolean(id)),
    ]).sort((a, b) => a.localeCompare(b));
}

export function chatgpt2apiAuthHeaders(contentType?: string) {
    const apiKey = chatgpt2apiRequestApiKey();
    return {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

export function isChatgpt2apiConfigured() {
    return Boolean(chatgpt2apiBaseUrl());
}

function chatgpt2apiModelsUrl() {
    return `${withOpenAiV1Base(chatgpt2apiBrowserBaseUrl()).replace(/\/+$/, "")}/models`;
}

function splitModels(value: string | undefined) {
    return uniqueModels((value || "").split(/[\n,]+/).map((item) => item.trim()));
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.filter(Boolean)));
}

function preferredModel(models: string[], preferred: string[], predicate: (model: string) => boolean) {
    const normalized = uniqueModels(models);
    const exact = preferred.map((name) => normalizeChatgpt2apiModelName(name, normalized)).find((name) => normalized.includes(name));
    return exact || normalized.find((model) => predicate(model.toLowerCase())) || normalized[0] || "";
}
