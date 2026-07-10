import assert from "node:assert/strict";

const responsesApi = await import("../src/services/api/responses-protocol.ts");

const config = {
    model: "gpt-5.6-terra",
    systemPrompt: "保持简洁",
};

const body = responsesApi.buildResponseRequestBody(config, [
    { role: "system", content: "只返回结果" },
    {
        role: "user",
        content: [
            { type: "text", text: "描述图片" },
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
        ],
    },
]);

assert.equal(body.model, "gpt-5.6-terra");
assert.equal(body.instructions, "保持简洁\n\n只返回结果");
assert.deepEqual(body.reasoning, { effort: "medium" });
assert.equal(
    body.input.some((item) => item.role === "system"),
    false,
);
assert.equal(body.input[0].content[1].type, "input_image");

const defaultBody = responsesApi.buildResponseRequestBody({ model: "gpt-5.6-terra", systemPrompt: "" }, [{ role: "user", content: "hello" }]);
assert.equal(defaultBody.instructions, "You are a helpful assistant for an infinite canvas.");

const failed = { buffer: "", text: "" };
responsesApi.consumeResponseStreamText(failed, 'data: {"type":"response.failed","response":{"error":{"message":"upstream failed"}}}\n\n', undefined, true);
assert.throws(() => responsesApi.finalizeResponseStream(failed), /upstream failed/);

const truncated = { buffer: "", text: "" };
responsesApi.consumeResponseStreamText(truncated, 'data: {"type":"response.output_text.delta","delta":"partial"}\n\n', undefined, true);
assert.throws(() => responsesApi.finalizeResponseStream(truncated), /响应流异常中断/);

const toolStream = { buffer: "", text: "" };
responsesApi.consumeResponseStreamText(
    toolStream,
    [
        'data: {"type":"response.output_item.done","output_index":1,"item":{"id":"fc_1","type":"function_call","status":"completed","arguments":"{\\"key\\":\\"canvas-test\\"}","call_id":"call_1","name":"lookup_canvas_test_value"}}',
        'data: {"type":"response.completed","response":{"output":[]}}',
        "",
    ].join("\n\n"),
    undefined,
    true,
);
assert.deepEqual(responsesApi.finalizeResponseStream(toolStream).toolCalls, [
    {
        id: "call_1",
        type: "function",
        function: { name: "lookup_canvas_test_value", arguments: '{"key":"canvas-test"}' },
    },
]);

console.log("aicy responses api tests passed");
