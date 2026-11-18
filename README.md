# 一句话清单（One-line Todo）

> 说一句话，它就记下来。
> 26 级第五阶段 Web + AI 应用 · 软件工程实验室

手动操作走 REST 接口，自然语言走大模型 + 工具调用，**两条路写的是同一张表**。

---

## 它解决什么问题

小组里派活全靠口头和群消息，三天后就没人记得谁要交什么。
这个应用让你用**一句人话**把事记进清单：

> 「帮我加一条明天交实验报告」

模型判断要调 `add_item` 工具 → 后端真的往数据库插一条 → 返回结果给模型 → 模型用自然话回答。
不是聊天机器人假装记住了，是**数据库里真的多了一行**。

---

## 功能

| 功能 | 说明 |
|---|---|
| 增删改查 | 新增、勾选完成、二次确认删除、按状态筛选 |
| 三态渲染 | 加载中（骨架屏）/ 空数据 / 请求失败 + 重试 |
| 流式对话 | SSE 逐字输出，字是一个一个蹦出来的，不是转圈后整段刷屏 |
| 工具调用 | `add_item` / `query_items`，前端能看到调了哪个工具、传了什么参数、返回了什么 |
| 多轮上下文 | 按 sessionId 维持，超长自动丢最早的（控制 token 成本） |
| 停止生成 | 前端 abort → 后端掐断到模型的上游请求（不然钱还在烧） |
| 错误兜底 | 401 / 402 / 429 / 超时 / 余额不足都有中文提示，不会白屏 |
| 响应式 | 375px（iPhone SE 宽度）不出横向滚动条 |

### 功能截图

> 把截图放进 `docs/screenshots/` 后，下面的图会自动显示出来。

| 场景 | 文件 |
|---|---|
| 清单首页（桌面） | `docs/screenshots/01-list-desktop.png` |
| 清单首页（手机 375px） | `docs/screenshots/02-list-mobile.png` |
| 加载中 / 空 / 失败 三态 | `docs/screenshots/03-states.png` |
| 流式对话 + 工具调用卡片 | `docs/screenshots/04-chat-toolcall.png` |
| Network 抓包 | `docs/screenshots/05-network.png` |

```markdown
![清单首页](docs/screenshots/01-list-desktop.png)
![工具调用](docs/screenshots/04-chat-toolcall.png)
```

---

## 技术栈

| 环节 | 用了什么 | 为什么选它 |
|---|---|---|
| 页面 | 原生 HTML / CSS / JS | 任务书限制；也想把 DOM、请求、事件这些原语讲清楚 |
| 后端 | Node 22+ / Express 4 | 生态熟，SSE 转发最省事 |
| 存储 | SQLite（Node 内置 `node:sqlite`） | 零原生编译，部署不会卡在 node-gyp；单文件即库 |
| 流式 | SSE（`text/event-stream`） | 单向推送场景，不需要 WebSocket 的双向和心跳 |
| 模型 | OpenAI 兼容协议（默认 DeepSeek） | 换平台只改三个环境变量 |
| 工具 | function calling | 让模型能"动手改数据" |
| 版本管理 | Git + GitHub | 每完成一个任务提交一次 |

**唯一的生产依赖是 `express`**。没有 cors、没有 dotenv、没有 better-sqlite3 ——
CORS 手写了 15 行，.env 用 Node 20.12+ 内置的 `process.loadEnvFile()`，SQLite 用内置模块。
不是炫技，是为了部署时少三个可能失败的地方。

---

## 目录结构

```
web-phase4-todo/
├── public/                  # 前端（纯静态，可直接丢 Vercel）
│   ├── index.html           # 三个视图：清单 / AI 助手 / 关于
│   ├── style.css            # 设计变量 + 响应式
│   ├── config.js            # ★ API_BASE 唯一配置点
│   └── app.js               # 路由 / 三态 / SSE 读取 / 工具卡片
├── server/
│   ├── app.js               # ★ 入口：CORS → body → 路由 → 静态 → 兜底 → 错误
│   ├── env.js               # 加载 .env（必须第一个 import）
│   ├── db.js                # SQLite 建表 + 播种 + DAO
│   ├── utils.js             # 统一响应 / AppError / catchAsync / 校验
│   ├── llm.js               # 模型调用唯一出口 + 错误翻译
│   ├── tools.js             # ★ 工具定义（JSON Schema）+ 工具执行
│   ├── sessions.js          # 对话上下文 + 截断
│   └── routes/
│       ├── items.js         # 4 个数据接口
│       └── chat.js          # ★ SSE 流式 + 工具循环
├── scripts/
│   ├── smoke.mjs            # 接口验收脚本（19 项检查）
│   └── mock-llm.js          # 假模型服务：不花钱也能演示流式和工具调用
├── docs/
│   ├── api.md               # 接口文档表（方法/路径/参数/返回示例）
│   ├── network.md           # 抓包记录
│   ├── incidents.md         # 事故日志（4 个真实踩坑）
│   └── checklist.md         # 交付清单（对着打勾）
├── data/                    # SQLite 文件（.gitignore，不进仓库）
├── .env.example
└── package.json
```

带 ★ 的文件是答辩最可能被抽到的，先读它们。

---

## 本地运行

**环境要求：Node.js ≥ 22.5**（内置 `node:sqlite` 需要这个版本）

```bash
node -v     # 必须 v22.5 以上，推荐 v22 或 v24 LTS
```

```bash
# 1. 进目录
cd web-phase4-todo

# 2. 装依赖（就一个 express）
npm install

# 3. 配置环境变量
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
# 打开 .env，至少看一眼 LLM_API_KEY（不填也能启动）

# 4. 启动
npm start
```

看到下面这几行就成功了：

```
  一句话清单 已启动
  本地地址   http://localhost:3000
  数据库     .../data/app.db
  AI 助手    已配置 Key（或：未配置 Key）
```

浏览器打开 <http://localhost:3000>。

### 环境变量示例

```ini
PORT=3000

# 大模型（任务4 / 任务5 需要；不填只影响 AI 助手，清单功能全部可用）
LLM_API_KEY=sk-xxxxxxxxxxxxxxxx
LLM_BASE_URL=https://api.deepseek.com
LLM_MODEL=deepseek-chat

# 跨域白名单，逗号分隔。前后端分开部署时，把前端域名加进来
ALLOWED_ORIGINS=http://localhost:3000,https://your-app.vercel.app

DB_PATH=./data/app.db
SEED=1              # 表为空时自动播种 3 条演示数据
MAX_TOOL_ROUNDS=3   # 模型最多连续调几轮工具
```

> `.env` 已在 `.gitignore` 里。**如果哪天不小心提交了，立刻去平台吊销重发**（任务书坑二）。

### 没有 API Key 也能演示

```bash
# 终端 A：起一个假的模型服务（233 行，行为可预测）
npm run mock

# 终端 B：把 .env 改成
#   LLM_BASE_URL=http://127.0.0.1:5010
#   LLM_API_KEY=mock-key
npm start
```

mock 支持这些台词，用来稳定复现各种场景：

| 你说 | 会发生什么 |
|---|---|
| 「帮我加一条明天交实验报告」 | 触发 `add_item`，数据库真多一条 |
| 「我还有什么没做」 | 触发 `query_items` |
| 「触发401」 | 模拟 Key 失效，看错误提示 |
| 「触发429」 | 模拟限流 |
| 「只聊不调工具」 | 复现"该调用没调用"的失败案例 |

### 接口验收

```bash
npm run smoke
# 19 项检查全 PASS 就是当天可以交差的状态
```

---

## 接口文档

见 [`docs/api.md`](docs/api.md) —— 方法、路径、参数、返回示例四列齐全，还附了错误码表。

```bash
# 三个接口的 curl 速查
curl http://localhost:3000/api/items

curl -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"明天交实验报告\",\"due\":\"2026-11-19\"}"

curl -X PUT http://localhost:3000/api/items/1 \
  -H "Content-Type: application/json" -d "{\"done\":true}"

curl -X DELETE http://localhost:3000/api/items/1

# 故意少传字段：必须返回 400 而不是 500
curl -i -X POST http://localhost:3000/api/items \
  -H "Content-Type: application/json" -d "{}"
```

---

## 部署

### 方式 A：一个服务全搞定（推荐，10 分钟）

前端由 Express 一起托管，只部署后端。

1. 把仓库推到 GitHub
2. Render → New → Web Service → 选这个仓库
3. 填：

   | 项 | 值 |
   |---|---|
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Health Check Path | `/api/health` |

4. Environment 里加 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` / `SEED=1`
5. Deploy → 拿到 `https://xxx.onrender.com`，打开就是完整应用

### 方式 B：前后端分开（任务3 说的那种，CORS 就派上用场了）

1. **后端**照方式 A 部署到 Render，拿到地址 `https://xxx.onrender.com`
2. **前端**推 Vercel：New Project → 选仓库 → **Root Directory 选 `public`** → Framework 选 Other
3. 改 `public/config.js`：

   ```js
   window.APP_CONFIG = {
     API_BASE: 'https://xxx.onrender.com',
   };
   ```

4. 回 Render，把 Vercel 域名加进环境变量：

   ```
   ALLOWED_ORIGINS=http://localhost:3000,https://your-app.vercel.app
   ```

5. 重新部署，打开 Vercel 地址

> **本地好好的、线上白屏** —— 九成是第 3 步忘了改，前端还在请求 `127.0.0.1`（任务书坑三）。

---

## 常见问题

**Q：启动报 `Cannot find module 'node:sqlite'`**
Node 版本太低。`node -v` 必须 ≥ 22.5，去 nodejs.org 装 LTS。

**Q：页面能开，但列表一直"加载失败"**
看浏览器 Console 和 Network。如果是 CORS 报错 → 检查 `ALLOWED_ORIGINS` 有没有把你的前端域名写进去。
如果是 502/连接拒绝 → 后端没起来，或 Render 在冷启动（免费实例闲置 15 分钟会睡，唤醒要 30~50 秒）。

**Q：AI 助手说"服务端未配置 LLM_API_KEY"**
`.env` 里没填，或者填了但没重启服务（`.env` 只在启动时读一次）。

**Q：流式输出不是一个个蹦，而是转圈后整段出来**
三个常见原因：① 服务端没 `res.flushHeaders()` ② 中间挂了 `compression` 中间件（会把 SSE 缓冲住）
③ 反代缓冲，需要 `X-Accel-Buffering: no`。本项目三个都处理了。

**Q：点了停止，但好像没停**
前端 `abort()` 只能停浏览器这一侧。必须后端也 abort 上游请求 —— 见 `server/routes/chat.js`
里 `res.on('close')` 那一段。

**Q：重启 Render 后数据没了**
免费实例的磁盘是临时的。本项目用 `SEED=1` 在启动时补演示数据。要真持久化得上付费磁盘或外部数据库，
这个取舍写进了下面的「已知问题」。

---

## 已知问题

1. **免费实例休眠**：Render 免费 web service 闲置 15 分钟休眠，冷启动 30~50 秒。演示前先访问一次唤醒。
2. **部署后数据会重置**：免费实例磁盘非持久。`SEED=1` 只保证"有演示数据"，不保证"记住你昨天加的"。
3. **对话上下文在内存**：服务重启 / 多实例部署会丢历史。要持久化得把 `sessions.js` 换成 Redis 或建一张表。
4. **SQLite 单写锁**：`node:sqlite` 是同步 API，会阻塞事件循环；并发写入会排队。几百条数据没问题，上千并发要换 Postgres。
5. **没有鉴权**：任何人拿到地址都能读写同一份清单。`sessionId` 只是随机串，不是身份。
6. **工具轮次上限 3**：防止模型死循环，代价是极复杂的多步任务会被截断。
7. **mock 服务只用于本地**：它不校验 Key，也不做真正的模型推理。

---

## 验收对照

| 任务书要求 | 在哪实现 |
|---|---|
| 任务1 静态页 + 语义化 + 响应式 + JS 交互 | `public/index.html` / `style.css` / `app.js` |
| 任务2 3 个接口 + 落盘 + 统一格式 + 400 校验 | `server/routes/items.js` / `db.js` / `utils.js` |
| 任务3 三态 + 自动刷新 + 配置项 + CORS | `public/app.js` 的 `renderList()` / `config.js` / `server/app.js` |
| 任务4 后端转发 + 流式 + 3 轮上下文 + 停止 | `server/routes/chat.js` / `llm.js` / `sessions.js` |
| 任务5 工具调用 + 参数可见 + 失败案例 | `server/tools.js` / `chat.js` / `docs/incidents.md` 事故 2 |
| 任务6 四者打通 + README + 录屏 | 清单和助手共用 `items` 表；本文件；见下方脚本 |
| 任务7 周记 | 建议四段式，见 `docs/checklist.md` |

---

## 2 分钟演示脚本

> 录屏前练两遍，别即兴，会超时。

**0:00–0:20 问题背景**
"我们组派活靠口头，三天就没人记得。所以做了个能听懂人话的清单。"

**0:20–1:05 功能演示**
① 手动加一条 → 列表出现 → 按 F5，还在（证明落盘）
② 对助手说「帮我加一条明天交实验报告」→ 看 `🔧 add_item` 卡片和参数 → 列表真的多一条
③ 打开数据库查给你看

**1:05–1:40 技术要点**
原生前端 / Express + SQLite / SSE 流式 / function calling 两轮循环（模型决定 → 后端执行 → 结果回填 → 自然话总结）

**1:40–2:00 踩过的坑**
"CORS 那次卡了两小时，还有一次模型只回'好的'却不调工具，我把工具描述重写才解决。"

---

## 我踩过的坑

见 [`docs/incidents.md`](docs/incidents.md)，四个都是真事：

1. CORS —— 前端报 `blocked by CORS policy`
2. 模型只回"好的"，根本没调工具（任务5 要求的失败案例）
3. `req.on('close')` 导致每句话都"已停止生成"
4. 合法日期全被判非法（时区陷阱）

---

## 许可

教学项目，随意取用。
