# 事故日志（踩过的坑）

> 这个文件是答辩第 3 问「这套东西哪里最容易坏？你是怎么发现的？」的弹药库。
> 格式固定五段：**现象 → 报错原文 → 定位 → 修复 → 验证**。
> 写真实发生的，别编 —— 面试官一追问细节就露馅。

---

## 事故 1：CORS —— 前端调后端被浏览器拦了

**现象**
前端跑在 `localhost:5500`（VS Code Live Server），后端跑在 `localhost:3000`，
页面上列表一直转圈，最后变成"请求失败"。

**报错原文**

```
Access to fetch at 'http://localhost:3000/api/items' from origin 'http://localhost:5500'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present
on the requested resource. If an opaque response serves your needs, set the request's
mode to 'no-cors' to fetch the resource with CORS disabled.
```

**定位**
Network 里能看到请求发出去了，但状态码是 `(failed)` / `CORS error`，Response 面板是空的。
说明请求**到了服务器**，是浏览器在拿到响应后拒绝把内容交给 JS。
用 curl 直接打同一个地址能拿到 200 —— 证明服务端逻辑没问题，纯粹是响应头缺了 `Access-Control-Allow-Origin`。

（补充：跨域时浏览器会先发一个 `OPTIONS` 预检请求，如果服务端没处理 OPTIONS，预检就挂了。）

**修复（服务端）**

`server/app.js` 里加了一个中间件，按白名单回响应头：

```js
const allowList = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowList.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
```

**没有做的事**：没有改浏览器安全策略，没有给 Chrome 加 `--disable-web-security`，
也没有在前端写 `mode: 'no-cors'`（那样会变成 opaque response，读不到数据）。

**验证**
重新请求，Network 里 `OPTIONS` 返回 204 且带 `Access-Control-Allow-Origin`，
`GET` 返回 200，列表渲染出来。

---

## 事故 2：模型只回"好的"，根本没调工具（任务5 要求的失败案例）

**现象**
任务5 第一版，对助手说"帮我加一条明天交实验报告"，它回："好的，已帮你记到清单里了。"
去数据库查 —— **一条都没多**。模型在"假装"干活。

**证据**
前端调试面板没有任何工具卡片；后端日志里那一轮只有一次 `/chat/completions` 请求，
响应里 `tool_calls` 字段是空的。

**定位**
模型是靠 `description` 判断"要不要调工具"的。我第一版写的是：

```js
description: '新增'
```

两个字，没有任何触发条件和使用时机提示 —— 模型完全有理由选择"直接用文字回答"，
因为对它来说那也能满足用户。

**修复（四步，按成本从低到高）**

1. **改 description**，把"什么时候必须调用"写进去：

```js
description:
  '在待办清单中新增一条任务，并立即写入数据库。' +
  '当用户表达「帮我记一下 / 加一条 / 记个事 / 提醒我 / 别忘了我」这类意图时，必须调用本工具；' +
  '不要只用文字回复“好的，已帮你记下”而不调用。'
```

2. **给参数字段也写 description**，告诉它怎么提取：

   `title`：'必须去掉"帮我加""记一下"这类指令词，只保留事情内容。例：用户说"帮我加一条明天交实验报告"，title 就是"明天交实验报告"。'

3. **加 `required: ['title']`**，减少它"忘了传参数"的机会。

4. **temperature 从 0.7 降到 0.1**，减少随机性。

**验证**
再说同一句话，前端出现 `🔧 add_item` 卡片，参数是 `{"title":"明天交实验报告"}`，
数据库里真的多了一条（id 从 5 变成 6）。

**兜底**
如果哪天模型还是不动手，后端可以把"用户有明显增删意图但本轮没有 tool_calls"这种情况
转成一次追问（"要我帮你加进去吗"）—— 但这只是兜底，不是主路径。

---

## 事故 3：`req.on('close')` 导致每句话都"已停止生成"

**现象**
前端发消息，立刻收到 `event: error`，内容是"已停止生成"。手动 curl 也一样。

**定位**
流式接口里为了支持"停止生成"，我监听了请求的关闭：

```js
req.on('close', () => controller.abort());   // ← 错
```

但 `express.json()` 已经把请求体读完了，`IncomingMessage` 的流随之结束并触发 `close`。
于是**服务刚拿到请求就以为客户端断开了**，立刻 abort 了对模型的调用。

**修复**

```js
res.on('close', () => {
  if (!res.writableEnded) controller.abort();   // ← 对
});
```

监听**响应**的 close 才代表"这条连接断了"；`writableEnded` 为 true 说明是我们自己正常结束的，不算中断。

**验证**
curl 能看到 `delta` 帧一条条到达，`final` 帧内容完整。

---

## 事故 4：合法的日期全部被判非法（时区陷阱）

**现象**
`POST /api/items {"title":"x","due":"2026-12-31"}` 返回 400：`字段 due 不是有效日期：2026-12-31`。

**定位**
校验逻辑是"能不能 round-trip"：

```js
const d = new Date(`${value}T00:00:00`);        // ← 按本地时区解析
if (d.toISOString().slice(0,10) !== value) throw ...
```

`new Date('2026-12-31T00:00:00')` 是**本地时间**（东八区）。`toISOString()` 转成 UTC 后变成
`2026-12-30T16:00:00Z`，截出来是 `2026-12-30` —— 和原值不等，于是所有日期都被判非法。
但 `2026-02-30` 这种真非法的反而能被抓出来，所以问题只暴露在"合法日期"上。

**修复**
统一按 UTC 解析：

```js
const d = new Date(`${value}T00:00:00Z`);
```

**验证**
合法的 `2026-12-31` 通过；`2026-02-30` 仍然被拒（Date 会滚到 3 月 2 日，round-trip 对不上）。
这个 bug 是 `npm run smoke` 抓到并固定下来的 —— 所以这个脚本值得留着。
