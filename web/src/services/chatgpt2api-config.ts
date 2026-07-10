import { aicyAiFetch } from "@/services/aicy-integration";

const CHATGPT2API_FALLBACK_MODELS = ["gpt-image-2", "gpt-5-5"];

export function chatgpt2apiDefaultModels() {
    // 只静态读取模型白名单；动态遍历 import.meta.env 会把遗留的 VITE_* Key 一并打进浏览器。
    const configured = splitModels(import.meta.env.VITE_CHATGPT2API_MODELS || import.meta.env.VITE_AICY_IMAGE_MODELS);
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
    const response = await aicyAiFetch("/models");
    if (!response.ok) throw new Error(`读取 chatgpt2api 模型失败：${response.status}`);
    const payload = (await response.json()) as { data?: Array<{ id?: string }>; models?: Array<{ id?: string; name?: string }> };
    return uniqueModels([
        ...(payload.data || []).map((model) => model.id).filter((id): id is string => Boolean(id)),
        ...(payload.models || []).map((model) => model.id || model.name?.replace(/^models\//, "")).filter((id): id is string => Boolean(id)),
    ]).sort((a, b) => a.localeCompare(b));
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
