export const AICY_MANAGED_TEXT_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"] as const;
export const AICY_MANAGED_TEXT_DEFAULT = "gpt-5.6-terra";

export function isAicyManagedTextModel(model: string) {
    return (AICY_MANAGED_TEXT_MODELS as readonly string[]).includes(model.trim());
}

export function hasAvailableAicyManagedTextModel(models: string[]) {
    const available = new Set(models.map((model) => normalize(model)));
    return AICY_MANAGED_TEXT_MODELS.some((model) => available.has(normalize(model)));
}

export function resolveAicyManagedTextRequestModel(selectedModel: string, _availableModels: string[]) {
    const selected = selectedModel.trim() || AICY_MANAGED_TEXT_DEFAULT;
    // 托管文本固定走 Sub2API；模型发现失败不能静默改走网页兼容模型。
    return { model: isAicyManagedTextModel(selected) ? selected : AICY_MANAGED_TEXT_DEFAULT, fallback: false };
}

function normalize(model: string) {
    return model
        .trim()
        .toLowerCase()
        .replace(/[_\s.]+/g, "-");
}
