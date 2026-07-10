# Canvas Reference and Sequential Multi-Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复画布提示词光标、配置卡片连接引用同步，以及 chatgpt2api 同轮顺序多图过早返回。

**Architecture:** Canvas 把输入层级和配置引用同步拆成可测试的纯工具，`project.tsx` 只在连接增删边界调用。chatgpt2api 从最新 `working_turn` 的全部 assistant JSON code 消息计算动态计划数，并用轮状态阻止单计划推理期间提前稳定收口。

**Tech Stack:** React 19、TypeScript、Node test runner、Python unittest、chatgpt2api requests backend。

## Global Constraints

- 不解析“生成两张”等自然语言，不在 Canvas 拆分请求。
- 不改变 `/v1/images/generations`、`/v1/images/edits` 或 Aicy Canvas AI 路由协议。
- Aicy 网关不修改；Canvas 按上游实际返回数组展示。
- 保留两个仓库的现有未提交改动；本计划不要求提交实现文件，避免把同文件历史改动混入提交。
- `web/src/pages/canvas/project.tsx` 已超过 1200 行，连接引用逻辑必须放入新的纯工具文件，页面只添加调用点。

---

### Task 1: 提示词输入光标层级

**Files:**
- Create: `web/src/lib/canvas/canvas-mention-layer-style.ts`
- Modify: `web/src/components/canvas/canvas-resource-mention-textarea.tsx`
- Test: `web/tests/canvas-mention-layer-style.test.ts`

**Interfaces:**
- Produces: `buildMentionLayerStyles(style: CSSProperties | undefined, textColor: string, showOverlay: boolean): { textareaStyle: CSSProperties; overlayStyle: CSSProperties }`

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildMentionLayerStyles } from "../src/lib/canvas/canvas-mention-layer-style.ts";

test("keeps the caret above the reference highlight layer", () => {
    const layers = buildMentionLayerStyles({ background: "#222", color: "#eee" }, "#eee", true);
    assert.equal(layers.textareaStyle.color, "transparent");
    assert.equal(layers.textareaStyle.caretColor, "#eee");
    assert.equal(layers.textareaStyle.zIndex, 1);
    assert.equal(layers.overlayStyle.zIndex, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/canvas-mention-layer-style.test.ts`

Expected: FAIL because `canvas-mention-layer-style.ts` does not exist.

- [ ] **Step 3: Implement the pure layer styles and use them**

```ts
export function buildMentionLayerStyles(style: CSSProperties | undefined, textColor: string, showOverlay: boolean) {
    return {
        textareaStyle: {
            ...(style || {}),
            position: "relative",
            zIndex: 1,
            color: showOverlay ? "transparent" : style?.color,
            caretColor: style?.color || textColor,
            ...(showOverlay ? { background: "transparent", backgroundColor: "transparent" } : {}),
        },
        overlayStyle: { ...(style || {}), zIndex: 0, color: textColor },
    };
}
```

`CanvasResourceMentionTextarea` 使用返回的两份样式；高亮层在下、真实 textarea 在上。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/canvas-mention-layer-style.test.ts`

Expected: PASS.

---

### Task 2: 配置卡片连接自动引用

**Files:**
- Create: `web/src/lib/canvas/canvas-config-reference-tokens.ts`
- Modify: `web/src/pages/canvas/project.tsx:609-645,841-891`
- Test: `web/tests/canvas-config-reference-tokens.test.ts`

**Interfaces:**
- Produces: `appendConfigReferenceToken`, `removeConfigReferenceToken`, `addConfigReferenceForConnection`, `removeConfigReferenceForConnection`。
- Consumes: `CanvasNodeData[]` and `CanvasConnection` from `@/types/canvas`。

- [ ] **Step 1: Write failing token and node-update tests**

```ts
test("adds one token when a resource connects to a config node", () => {
    const next = addConfigReferenceForConnection(nodes, connection);
    assert.equal(next.find((node) => node.id === "config")?.metadata?.composerContent, "@[node:image] ");
});

test("does not duplicate a token and removes it on disconnect", () => {
    const once = addConfigReferenceForConnection(nodes, connection);
    const twice = addConfigReferenceForConnection(once, connection);
    assert.equal(twice.find((node) => node.id === "config")?.metadata?.composerContent, "@[node:image] ");
    assert.equal(removeConfigReferenceForConnection(twice, connection).find((node) => node.id === "config")?.metadata?.composerContent, "");
});

test("does not restore a manually deleted token without reconnecting", () => {
    assert.equal(removeConfigReferenceToken("商品场景", "image"), "商品场景");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/canvas-config-reference-tokens.test.ts`

Expected: FAIL because the token helper does not exist.

- [ ] **Step 3: Implement minimal pure helpers**

```ts
export function appendConfigReferenceToken(content: string, nodeId: string) {
    const token = `@[node:${nodeId}]`;
    if (content.includes(token)) return content;
    const prefix = content.trimEnd();
    return prefix ? `${prefix} ${token} ` : `${token} `;
}

export function removeConfigReferenceToken(content: string, nodeId: string) {
    return content.replaceAll(`@[node:${nodeId}]`, "").replace(/[ \t]{2,}/g, " ").trim();
}
```

节点更新函数仅接受来源类型 `Image | Text | Video | Audio` 且目标类型为 `Config` 的连接，并更新目标节点 `metadata.composerContent`。

- [ ] **Step 4: Integrate connection boundaries**

在 `connectNodes` 与 `createConnectedNode` 成功新增连接时调用 `addConfigReferenceForConnection`。在 `deleteConnection` 和 `deleteNodes` 移除连接前调用 `removeConfigReferenceForConnection`。不在每次渲染时自动补齐，因此用户手动删除引用会被保留。

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/canvas-config-reference-tokens.test.ts`

Expected: PASS.

---

### Task 3: chatgpt2api 同轮顺序计划计数

**Files:**
- Modify: `/Users/youliu/Documents/uflow_system/repos/chatgpt2api-backoff-worktree/services/openai_backend_api.py:2082-2112,2280-2435`
- Modify: `/Users/youliu/Documents/uflow_system/repos/chatgpt2api-backoff-worktree/test/test_multi_image_results.py`

**Interfaces:**
- Produces: `_extract_image_plan_state(data) -> dict` with `working_turn_id`, `expected_count`, `explicit_batch`, and `turn_active`.
- Consumes: ChatGPT conversation `mapping` with assistant JSON code messages and reasoning metadata.

- [ ] **Step 1: Write failing extraction tests**

```py
def test_counts_sequential_single_image_plans_in_latest_working_turn(self):
    state = OpenAIBackendAPI._extract_image_plan_state(conversation_with_two_single_plans())
    self.assertEqual(state["expected_count"], 2)
    self.assertFalse(state["explicit_batch"])

def test_ignores_plans_from_older_working_turns(self):
    state = OpenAIBackendAPI._extract_image_plan_state(conversation_with_old_and_new_turns())
    self.assertEqual(state["expected_count"], 1)
```

- [ ] **Step 2: Write a failing polling test**

模拟同一轮状态：第一次对话只有一条普通计划且 `turn_active=True`、一张结果；第二次出现两条计划但仍只有一张；第三次有两张。断言轮询不会在第一次稳定结果时返回，并最终返回两个唯一 ID。

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run python -m unittest test.test_multi_image_results`

Expected: FAIL because `_extract_image_plan_state` and active-turn gating are missing.

- [ ] **Step 4: Implement current-turn plan extraction**

遍历 assistant `content_type=code` 且 `language=json` 的消息，解析 `content.text` 与 `content.parts`。以最新 code 消息的 `working_turn_id` 为范围；`batch_requests` 按长度计数，普通含字符串 `prompt` 的计划计一。根据同轮最新 reasoning 消息判断 `turn_active`，同时保留显式批次标记。

- [ ] **Step 5: Gate polling without slowing explicit batches**

显式批次达到目标立即返回；同轮普通计划达到至少两条后按动态目标返回；只有一条普通计划且 `turn_active=True` 时继续轮询，禁止未知数量稳定收口。轮结束、无轮状态或超时时沿用既有稳定/部分结果语义，并记录 `expected_count`、`actual_count`、`turn_active`。

- [ ] **Step 6: Run tests to verify they pass**

Run: `uv run python -m unittest test.test_multi_image_results`

Expected: PASS.

---

### Task 4: 文档与回归验证

**Files:**
- Modify: `docs/content/docs/progress/pending-test.mdx`

**Interfaces:**
- Consumes: Tasks 1-3 complete behavior.
- Produces: user-testable pending-test entry.

- [ ] **Step 1: Record the three user-visible fixes**

在 `pending-test.mdx` 的当前待测区加入：引用高亮时光标可见、连接/断开配置卡自动同步引用、图片节点顺序多图完整返回。

- [ ] **Step 2: Run Canvas targeted tests**

Run: `node --test tests/canvas-mention-layer-style.test.ts tests/canvas-config-reference-tokens.test.ts tests/canvas-returned-image-batch.test.ts`

Expected: all PASS.

- [ ] **Step 3: Run Canvas typecheck**

Run: `npm run typecheck`

Expected: exit 0.

- [ ] **Step 4: Run chatgpt2api targeted regression**

Run: `/Users/youliu/Library/uflow_system/pm2-runtime/state/chatgpt2api/.venv/bin/python -m unittest test.test_multi_image_results test.test_config`

Expected: all PASS.

- [ ] **Step 5: Review worktree boundaries**

确认 `README.md` 删除和 chatgpt2api 其他既有修改未被覆盖；列出本轮实际文件，不部署、不重启生产，除非用户随后明确要求。
