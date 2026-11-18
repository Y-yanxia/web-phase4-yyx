# 接口文档表

> 任务书要求：方法、路径、参数、返回示例，**四个字段一个不能少**。
> 所有接口统一返回 `{ code, data, msg }`：`code === 0` 表示成功，非 0 是业务错误码。
> 本地地址：`http://localhost:3000`；线上地址替换域名即可。

## 错误码约定

| code | HTTP | 含义 |
|---|---|---|
| 0 | 200 / 201 | 成功 |
| 40001 | 400 | 缺少必填字段 |
| 40002 | 400 | 字段类型不对（比如 title 传了数字） |
| 40003 | 400 | 字段超长（title > 120 字符） |
| 40004 | 400 | 路径参数 id 不是正整数 |
| 40005 | 400 | 日期格式不对或不是真实日期 |
| 40006 | 400 | query 参数非法（done 只能是 0 / 1） |
| 40007 | 400 | PUT 没传任何可修改字段 |
| 40401 | 404 | 条目不存在 |
| 40400 | 404 | 接口不存在 |
| 50001 | 500 | 演示开关 `?fail=1` |
| 50200 | 200（SSE 帧内） | 模型服务报错 |
| 50301 | 503 | 服务端未配置 LLM_API_KEY |

---

## 1. 列表

| 项 | 内容 |
|---|---|
| **方法** | `GET` |
| **路径** | `/api/items` |
| **参数** | `done`（可选，`0`=未完成 / `1`=已完成，不传=全部）<br>`keyword`（可选，标题模糊匹配，最长 50 字）<br>`fail`（可选，传 `1` 强制返回 500，仅用于演示三态） |

**返回示例**

```json
{
  "code": 0,
  "data": [
    {
      "id": 6,
      "title": "明天交实验报告",
      "done": false,
      "due": "2026-11-19",
      "created_at": "2026-11-18 20:48:09"
    }
  ],
  "msg": "ok"
}
```

**错误示例**

```json
{ "code": 40006, "data": null, "msg": "query 参数 done 只能是 0 或 1" }
```

---

## 2. 新增

| 项 | 内容 |
|---|---|
| **方法** | `POST` |
| **路径** | `/api/items` |
| **参数** | body（JSON）：<br>`title` **必填**，字符串，1~120 字符<br>`due` 可选，字符串，格式 `YYYY-MM-DD` |

**返回示例**（HTTP 201）

```json
{
  "code": 0,
  "data": {
    "id": 7,
    "title": "明天交实验报告",
    "done": false,
    "due": null,
    "created_at": "2026-11-18 21:02:11"
  },
  "msg": "新增成功"
}
```

**错误示例**（少传 title，HTTP 400 —— 注意是 400 不是 500）

```json
{ "code": 40001, "data": null, "msg": "缺少必填字段：title" }
```

```json
{ "code": 40002, "data": null, "msg": "字段 title 必须是字符串，收到的是 number" }
```

```json
{ "code": 40005, "data": null, "msg": "字段 due 不是有效日期：2026-02-30" }
```

---

## 3. 修改

| 项 | 内容 |
|---|---|
| **方法** | `PUT` |
| **路径** | `/api/items/:id` |
| **参数** | `id`（路径参数，正整数）<br>body（JSON）：`title` / `done` / `due` 至少传一个<br>`done` 必须是布尔值 |

**返回示例**

```json
{
  "code": 0,
  "data": { "id": 6, "title": "明天交实验报告", "done": true, "due": null, "created_at": "2026-11-18 20:48:09" },
  "msg": "修改成功"
}
```

**错误示例**

```json
{ "code": 40007, "data": null, "msg": "没有要修改的字段：至少要传 title、done、due 其中一个" }
```

```json
{ "code": 40401, "data": null, "msg": "条目 999 不存在" }
```

---

## 4. 删除

| 项 | 内容 |
|---|---|
| **方法** | `DELETE` |
| **路径** | `/api/items/:id` |
| **参数** | `id`（路径参数，正整数） |

**返回示例**（返回被删掉的那一行，方便前端回滚）

```json
{
  "code": 0,
  "data": { "id": 6, "title": "明天交实验报告", "done": true, "due": null, "created_at": "2026-11-18 20:48:09" },
  "msg": "删除成功"
}
```

---

## 5. 统计（附带）

| 项 | 内容 |
|---|---|
| **方法** | `GET` |
| **路径** | `/api/stats` |
| **参数** | 无 |

```json
{ "code": 0, "data": { "total": 6, "done": 2, "open": 4 }, "msg": "ok" }
```

---

## 6. 健康检查（附带）

| 项 | 内容 |
|---|---|
| **方法** | `GET` |
| **路径** | `/api/health` |
| **参数** | 无 |

```json
{
  "code": 0,
  "data": {
    "ok": true,
    "uptime": 128,
    "node": "v24.21.0",
    "db": "data\\app.db",
    "stats": { "total": 6, "done": 2, "open": 4 },
    "llmConfigured": true,
    "llmModel": "deepseek-chat"
  },
  "msg": "ok"
}
```

---

## 7. 对话（流式，SSE）

| 项 | 内容 |
|---|---|
| **方法** | `POST` |
| **路径** | `/api/chat` |
| **参数** | body（JSON）：<br>`message` **必填**，字符串，1~2000 字符<br>`sessionId` 可选，字符串，用于维持多轮上下文 |
| **响应** | `Content-Type: text/event-stream`，不是 JSON |

**正常时的事件序列**

```
event: tool
data: {"phase":"call","name":"add_item","args":{"title":"明天交实验报告"}}

event: tool
data: {"phase":"result","name":"add_item","args":{...},"result":{"ok":true,"item":{...}}}

event: delta
data: {"text":"记"}

event: delta
data: {"text":"下"}

event: final
data: {"text":"记下了：明天交实验报告。"}

event: done
data: {"ok":true}
```

**出错时的帧**（HTTP 状态码已经是 200 了，只能靠帧告诉前端）

```
event: error
data: {"code":50200,"status":429,"msg":"请求太频繁或已到速率上限，缓几秒再试"}
```

**用 curl 看原始流**

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"demo\",\"message\":\"帮我加一条明天交实验报告\"}"
```
