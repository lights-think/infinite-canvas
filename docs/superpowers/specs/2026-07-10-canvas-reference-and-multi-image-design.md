# 画布引用、输入光标与顺序多图收集设计

## 目标

- 图片节点的提示词输入框在启用引用高亮时仍显示文本插入光标。
- 图片、文本、视频或音频节点连接到生成配置卡片时，自动加入对应 `@[node:<id>]` 引用；断开连接或删除来源节点时同步移除引用。
- chatgpt2api 能识别 ChatGPT 在同一 `working_turn` 内顺序发出的多条单图 JSON 计划，并等待全部图片，不要求提示词解析或前端拆请求。
- Canvas 继续按上游实际返回数组创建一个可折叠批次，不推断或伪造图片数量。

## 已确认根因

### 输入光标

`CanvasResourceMentionTextarea` 在存在有效引用时，用绝对定位的高亮层显示文字，并把真实 `textarea` 的文字设为透明。高亮层带有不透明背景且位于输入层上方，因此真实输入光标被遮住。修复应明确两层顺序：高亮层在下，透明文字的 `textarea` 在上，`caret-color` 始终使用主题文字色。

### 配置卡片引用

配置卡片只会把 `composerContent` 中出现的 `@[node:<id>]` 转换成真实附件。当前连线只更新 `connections`，不会同步更新 `composerContent`，所以用户连接素材后直接输入普通提示词时，连接存在但附件可能未进入生成请求。

### 顺序多图

配置卡片成功的生产会话由一条 JSON `batch_requests` 计划描述四张图片，现有 chatgpt2api 能得到 `expected_count=4`。图片节点失败的生产会话在同一个 `working_turn` 中顺序出现两条普通 JSON 生图计划，每条各代表一张图片。现有逻辑只读取 `batch_requests`，因此 `expected_count=null`，第一张稳定后提前返回，第二张稍后才在 ChatGPT 网页完成。

## 设计

### Canvas 输入层

在 `canvas-resource-mention-textarea.tsx` 中将高亮层固定为底层，将真实 `textarea` 固定为上层。高亮开启时，真实文字保持透明、背景保持透明，但光标色不透明。抽出一个纯样式计算函数，使用 Node 测试覆盖层级、透明文字和光标色，避免仅依赖人工截图。

### Canvas 连接引用同步

新增 `web/src/lib/canvas/canvas-config-reference-tokens.ts`，只负责纯字符串和节点更新逻辑：

- `appendConfigReferenceToken(content, nodeId)`：不存在时追加一个引用，不重复添加。
- `removeConfigReferenceToken(content, nodeId)`：删除对应引用并收敛多余空白。
- `addConfigReferenceForConnection(nodes, connection)`：仅当目标是配置节点、来源是可引用节点时写入 `composerContent`。
- `removeConfigReferenceForConnection(nodes, connection)`：连接删除或来源节点删除时清理对应引用。

用户新建或重连时自动添加一次。用户之后手动删除引用时不持续强制补回；只有再次断开并重连才重新加入。删除连接、删除来源节点都视为断开并同步移除引用。批次内部连接、生成结果连接和非配置节点连接不改写提示词。

### chatgpt2api 计划状态

在 `services/openai_backend_api.py` 中把单一批次数量提取扩展为当前轮计划状态：

1. 找到最新 assistant JSON `code` 消息的 `working_turn_id`；只统计该轮，避免历史图片污染。
2. 每个 `batch_requests` 元素计一张；普通包含 `prompt` 的生图 JSON 计一张。
3. 同一轮出现两条普通计划时，目标数变为二；轮询看到一张时继续等待，看到两张立即返回。
4. 只有一条普通计划且该轮仍处于 `reasoning_status=is_reasoning` 时，不允许用“结果稳定”提前收口；出现第二条计划后按目标数等待，或在该轮结束后按最终计划数收口。
5. 缺少 `working_turn_id` 或推断不到计划时保留现有未知数量稳定策略；120 秒到期仍按现有规则返回部分结果，零张才报超时。
6. URL 解析前继续执行最终会话刷新和内容字节去重。

不解析用户提示词，不使用 Canvas 的数量选择推测 ChatGPT 网页计划，不新增前端扇出，也不改变 `/v1/images/generations`、`/v1/images/edits` 或 Aicy Canvas AI 路由协议。

## 测试与验收

- Canvas 样式测试：存在引用高亮时，高亮层位于输入层下方且 `caretColor` 为主题文字色。
- Canvas 引用测试：连接自动添加、重复连接不重复、手动删除不自动恢复、断线删除、来源节点删除清理。
- chatgpt2api 测试：单条 `batch_requests`、同轮两条普通计划、不同轮历史隔离、第一张稳定但第二条计划仍在进行时不提前返回、最终两张返回。
- 运行 chatgpt2api 定向 unittest、Canvas 定向 Node 测试和 TypeScript 检查。
- 本轮不修改 Aicy 网关；若用户要求部署，再执行运行副本备份、空闲门禁、仅重启 `chatgpt2api-web-image` 与 `infinite-canvas`，并做真实图片节点两图验收。

## 非目标

- 不通过正则解析“生成两张”等自然语言。
- 不让 Canvas 代替 ChatGPT 拆成多次请求。
- 不改变配置卡片已有的手动 `@引用` 选择能力。
- 不处理与本次三个问题无关的画布重构。
