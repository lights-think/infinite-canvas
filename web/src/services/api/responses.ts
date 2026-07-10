import { buildApiUrl, type AiConfig } from "@/stores/use-config-store";
import { aicyAiFetch, isAicyManagedCanvasMode } from "@/services/aicy-integration";
import { consumeResponseStreamText, finalizeResponseStream, parseResponsePayload, responseErrorMessage, type ResponseApiPayload, type ResponseStreamState, type ToolResponseResult } from "@/services/api/responses-protocol";

export type { AiTextMessage, ResponseFunctionTool, ResponseInputMessage, ResponseToolCall, ToolChoice, ToolResponseResult } from "@/services/api/responses-protocol";
export { buildResponseRequestBody, responseErrorMessage } from "@/services/api/responses-protocol";

async function readFetchError(response: Response, fallback: string) {
    const text = await response.text();
    if (!text) return response.status ? `${fallback}：${response.status}` : fallback;
    try {
        return responseErrorMessage(JSON.parse(text)) || `${fallback}：${response.status}`;
    } catch {
        return text.slice(0, 300) || `${fallback}：${response.status}`;
    }
}

export async function requestStreamingResponse(config: AiConfig, body: Record<string, unknown>, onDelta?: (text: string) => void, options?: { signal?: AbortSignal }): Promise<ToolResponseResult> {
    const requestInit: RequestInit = {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
        signal: options?.signal,
    };
    const response = isAicyManagedCanvasMode() ? await aicyAiFetch("/responses", requestInit) : await fetch(buildApiUrl(config.baseUrl, "/responses"), requestInit);
    if (!response.ok) throw new Error(await readFetchError(response, "请求失败"));
    if (!response.body) return parseResponsePayload((await response.json()) as ResponseApiPayload);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: ResponseStreamState = { buffer: "", text: "" };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        consumeResponseStreamText(state, decoder.decode(value, { stream: true }), onDelta);
        if (state.error) throw new Error(state.error);
    }
    consumeResponseStreamText(state, decoder.decode(), onDelta, true);
    return finalizeResponseStream(state);
}
