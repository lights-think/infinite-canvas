type RetryPromptNode = {
    metadata?: {
        composerContent?: string;
        prompt?: string;
    };
};

export function retryGenerationContextPrompt(sourceNode: RetryPromptNode | undefined, childPrompt = "") {
    // 编排内容保留节点引用 token；已展开的 prompt 只适合展示，不能用于重建参考素材上下文。
    return sourceNode?.metadata?.composerContent?.trim() || sourceNode?.metadata?.prompt || childPrompt;
}
