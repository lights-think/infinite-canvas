export type AiTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;
};

export type ResponseToolCall = {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
    thoughtSignature?: string;
};

export type ResponseInputMessage = AiTextMessage | { type: "function_call"; call_id: string; name: string; arguments: string; thoughtSignature?: string } | { role: "tool"; tool_call_id: string; content: string };

export type ResponseFunctionTool = {
    type: "function";
    function: {
        name: string;
        description?: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
};

export type ToolResponseResult = {
    content: string;
    toolCalls: ResponseToolCall[];
};

export type ToolChoice = "auto" | "required" | { type: "function"; name: string };
type ResponseMessageContent = AiTextMessage["content"] | string;
type ResponseInputContent = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };
type ResponseInputItem = { role: "user" | "assistant"; content: string | ResponseInputContent[] } | { type: "function_call"; call_id: string; name: string; arguments: string } | { type: "function_call_output"; call_id: string; output: string };
type ResponseApiToolDefinition = {
    type: "function";
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
};
type ResponseApiOutputItem = { type?: "message"; id?: string; content?: Array<{ type?: string; text?: string }> } | { type?: "function_call"; id?: string; call_id?: string; name?: string; arguments?: string };
export type ResponseApiPayload = {
    id?: string;
    output?: ResponseApiOutputItem[];
    output_text?: string;
    error?: { message?: string };
    code?: number;
    msg?: string;
};
export type ResponseStreamState = {
    buffer: string;
    text: string;
    payload?: ResponseApiPayload;
    error?: string;
    terminal?: boolean;
    outputItems?: ResponseApiOutputItem[];
};

const DEFAULT_CANVAS_INSTRUCTIONS = "You are a helpful assistant for an infinite canvas.";

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown) {
    return typeof value === "string" ? value : "";
}

function systemText(content: AiTextMessage["content"]) {
    if (!Array.isArray(content)) return content.trim();
    return content.flatMap((item) => (item.type === "text" && item.text.trim() ? [item.text.trim()] : [])).join("\n");
}

function toResponseContent(content: ResponseMessageContent): string | ResponseInputContent[] {
    if (!Array.isArray(content)) return String(content || "");
    return content.map((item) => (item.type === "text" ? { type: "input_text" as const, text: item.text } : { type: "input_image" as const, image_url: item.image_url.url }));
}

function toResponseInput(messages: ResponseInputMessage[]): ResponseInputItem[] {
    return messages.flatMap((message): ResponseInputItem[] => {
        if ("type" in message) return [message];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        if (message.role === "system") return [];
        return [{ role: message.role, content: toResponseContent(message.content || "") }];
    });
}

function toResponseTool(tool: ResponseFunctionTool): ResponseApiToolDefinition {
    return {
        type: "function",
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
        strict: tool.function.strict,
    };
}

export function buildResponseRequestBody(config: { model: string; systemPrompt: string }, messages: ResponseInputMessage[], options: { tools?: ResponseFunctionTool[]; toolChoice?: ToolChoice } = {}) {
    const instructions = [config.systemPrompt.trim(), ...messages.flatMap((message) => (!("type" in message) && message.role === "system" ? [systemText(message.content)] : []))].filter(Boolean).join("\n\n") || DEFAULT_CANVAS_INSTRUCTIONS;
    const tools = options.tools?.map(toResponseTool) || [];
    return {
        model: config.model,
        instructions,
        input: toResponseInput(messages),
        reasoning: { effort: "medium" as const },
        ...(tools.length
            ? {
                  tools,
                  tool_choice: options.toolChoice || "auto",
                  parallel_tool_calls: false,
              }
            : {}),
    };
}

export function responseErrorMessage(value: unknown) {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : undefined;
    const response = isRecord(value.response) ? value.response : undefined;
    const responseError = response && isRecord(response.error) ? response.error : undefined;
    return stringValue(value.msg) || stringValue(error?.message) || stringValue(responseError?.message);
}

function validateResponsePayload(payload: ResponseApiPayload) {
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function parseToolResponse(payload: ResponseApiPayload): ToolResponseResult {
    const output = payload.output || [];
    const content =
        payload.output_text ||
        output
            .flatMap((item) => (item.type === "message" ? item.content || [] : []))
            .map((item) => item.text || "")
            .join("");
    const toolCalls = output
        .filter((item): item is Extract<ResponseApiOutputItem, { type?: "function_call" }> => item.type === "function_call")
        .map((item) => ({
            id: item.call_id || item.id || "",
            type: "function" as const,
            function: { name: item.name || "", arguments: item.arguments || "{}" },
        }))
        .filter((item) => item.id && item.function.name);
    return { content, toolCalls };
}

function consumeResponseStreamBlock(block: string, state: ResponseStreamState, onDelta?: (text: string) => void) {
    const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n")
        .trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as Record<string, unknown>;
    const type = stringValue(event.type);
    const errorMessage = responseErrorMessage(event);
    if (errorMessage) state.error = errorMessage;
    if (type === "response.output_text.delta" && typeof event.delta === "string") {
        state.text += event.delta;
        onDelta?.(state.text);
    }
    if (type === "response.output_text.done" && !state.text && typeof event.text === "string") {
        state.text = event.text;
        onDelta?.(state.text);
    }
    if (type === "response.completed") {
        state.terminal = true;
        if (isRecord(event.response)) state.payload = event.response as ResponseApiPayload;
    } else if (type === "response.failed" || type === "response.incomplete" || type === "error") {
        state.terminal = true;
        if (!state.error) state.error = "文本响应生成失败，请重试";
    } else if (Array.isArray(event.output)) {
        state.payload = event as ResponseApiPayload;
    }
    if (type === "response.output_item.done" && isRecord(event.item) && event.item.type === "function_call") {
        const item = event.item as ResponseApiOutputItem;
        state.outputItems = [...(state.outputItems || []).filter((existing) => existing.id !== item.id), item];
    }
}

export function consumeResponseStreamText(state: ResponseStreamState, text: string, onDelta?: (text: string) => void, flush = false) {
    state.buffer += text;
    for (;;) {
        const match = state.buffer.match(/\r?\n\r?\n/);
        if (!match) break;
        const index = match.index ?? 0;
        consumeResponseStreamBlock(state.buffer.slice(0, index), state, onDelta);
        state.buffer = state.buffer.slice(index + match[0].length);
    }
    if (flush && state.buffer.trim()) {
        consumeResponseStreamBlock(state.buffer, state, onDelta);
        state.buffer = "";
    }
}

export function finalizeResponseStream(state: ResponseStreamState): ToolResponseResult {
    if (state.error) throw new Error(state.error);
    if (!state.terminal) throw new Error("响应流异常中断，请重试");
    if (!state.payload && !state.outputItems?.length) return { content: state.text, toolCalls: [] };
    const payload = state.payload || {};
    validateResponsePayload(payload);
    const finalIds = new Set((payload.output || []).map((item) => item.id).filter(Boolean));
    const mergedPayload = {
        ...payload,
        output: [...(payload.output || []), ...(state.outputItems || []).filter((item) => !item.id || !finalIds.has(item.id))],
    };
    const result = parseToolResponse(mergedPayload);
    return { ...result, content: state.text || result.content };
}

export function parseResponsePayload(payload: ResponseApiPayload) {
    validateResponsePayload(payload);
    return parseToolResponse(payload);
}
