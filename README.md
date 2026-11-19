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
├── public/                  # 前端（纯静态、零构建，直接丢 Vercel / Pages）
│   ├── index.html           # 三个视图：清单 / AI 助手 / 关于
│   ├── 404.html             # 真 404 页面（Pages 也认这个约定）
│   ├── style.css            # 设计变量 + 响应式
│   ├── config.js            # ★ API_BASE 唯一配置点
│   └── app.js               # 路由 / 三态 / SSE 读取 / 工具卡片
├── server/
│   ├── app.js               # ★ 入口：CORS → body → 路由 → 静态 → 404 → 错误
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
│   ├── network.md           # 抓包记录（含真实耗时）
│   ├── incidents.md         # 事故日志（4 个真实踩坑）
│   └── checklist.md         # 交付清单（对着打勾）
├── .github/workflows/
│   └── pages.yml            # GitHub Pages 自动部署（推 main 就发）
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

### 本地打开方式（两种，别用错）

| 方式 | 命令 | 能做什么 |
|---|---|---|
| ✅ 推荐 | `npm start` → 访问 `http://localhost:3000` | 全部功能：列表、增删改查、AI 助手 |
| ⚠️ 只能看样式 | 双击 `public/index.html`（`file://` 协议） | 只有静态布局，列表会显示"加载失败" |

**为什么不能双击 html 文件？**
页面一加载就 `fetch('/api/items')`，`file://` 协议下这个请求会被浏览器直接拦掉
（Origin 是 `null`，服务端也不存在）。这是**正常现象**，不是 bug ——
所以验收和截图一律走 `npm start` 那条路。

> 想验证这个说法：双击打开后按 F12 → Console，会看到
> `Fetch API cannot load file:///api/items` 之类的报错。

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

任务要求前端必须有一个 **https 公网地址**，托管在 GitHub Pages / Vercel / Cloudflare Pages 之一。
本项目的 `public/` 是**纯静态、零构建**的，可以原样丢到任何一个静态托管上；
后端单独放 Render。两边靠 `public/config.js` 里的 `API_BASE` 连起来。

**顺序很重要：先部署后端，拿到地址，再部署前端。**

### 第 1 步：后端 → Render（约 8 分钟）

1. 仓库推到 GitHub
2. Render → **New → Web Service** → 选这个仓库
3. 填：

   | 项 | 值 |
   |---|---|
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
   | Health Check Path | `/api/health` |

4. Environment 里加三个变量（`LLM_API_KEY` 可以留空，只影响 AI）：

   ```
   LLM_API_KEY=sk-xxxxxxxx
   LLM_BASE_URL=https://api.deepseek.com
   LLM_MODEL=deepseek-chat
   SEED=1
   ```

5. Deploy → 打开 `https://xxx.onrender.com/api/health`，能看到 JSON 就成功了

### 第 2 步：前端 → 静态托管（二选一）

`public/` 是零构建的纯静态站，下面两个平台都能直接托管，**选一个就行**。
区别只有一点：Vercel 的地址是根路径，GitHub Pages 的地址带仓库名子路径。

#### 方案 A：Vercel（最省事，5 分钟）

1. Vercel → **Add New → Project** → 选同一个仓库
2. 关键一步：**Root Directory 选 `public`**（不选的话 Vercel 会把它当 Node 项目去 build，然后失败）
3. Framework Preset 选 **Other**，Build Command 和 Output Directory 都留空
4. Deploy → 拿到 `https://your-app.vercel.app`

#### 方案 B：GitHub Pages（仓库本来就在 GitHub 上时最顺）

**两个前置条件，缺一个就失败：**

- 仓库必须是 **public** —— 免费账号的 Pages 只对公开仓库开放
- 必须先在仓库里打开开关：**Settings → Pages → Build and deployment → Source 选 `GitHub Actions`**
  （不能选 "Deploy from a branch"，因为仓库根目录没有 `index.html`，前端在 `public/` 子目录里，
   而 branch 模式只能发布根目录或 `/docs`）

**步骤：**

1. 改 `public/config.js`，把后端地址填进去（**这一步不能省**，否则页面会去请求
   `github.io/api/items`，必然 404）：

   ```js
   window.APP_CONFIG = {
     API_BASE: 'https://xxx.onrender.com',
   };
   ```

2. 确认 `.github/workflows/pages.yml` 已经在仓库里（本项目自带，不用自己写）
3. `git push` 到 `main` 分支
4. 打开仓库的 **Actions** 页，会看到一个叫 `Deploy to GitHub Pages` 的任务在跑，等 1~2 分钟变绿
5. 地址是：`https://<你的用户名>.github.io/<仓库名>/`
6. 回 Render，把这个域名加进 `ALLOWED_ORIGINS`：

   ```
   ALLOWED_ORIGINS=http://localhost:3000,https://你的用户名.github.io
   ```

   > ⚠️ **只写到 `github.io` 为止，不要带仓库路径。**
   > CORS 的 `Origin` 请求头里没有路径，写成 `https://user.github.io/web-phase4-xxx` 会一直报
   > `blocked by CORS policy` —— 这是 GitHub Pages 部署最容易卡住的一步。

7. 保存后 Render 会自动重启，打开 Pages 地址验收

**GitHub Pages 专属的三个坑：**

| 坑 | 表现 | 原因 / 解法 |
|---|---|---|
| 子路径 | CSS/JS 全 404，页面裸奔 | 地址带 `/仓库名/` 前缀。所有资源必须用相对路径 —— 本项目已经是 `./style.css` 这种写法，`404.html` 的返回链接也是 `./` |
| 404 页 | 访问 `/仓库名/xxx` 能显示 404 页 | 这是 Pages 的约定：站点根目录的 `404.html` 会自动接管未知路径，状态码也是 404，正好满足任务1 的截图要求 |
| CDN 缓存 | 改完 `config.js` 刷新还是旧的 | Pages 的 CDN 缓存约 10 分钟。用 `Ctrl + Shift + R` 强制刷新，或者改文件名（`config.js?v=2`）绕过 |

#### 方案 C：Cloudflare Pages

连仓库 → Build output directory 填 `public` → 构建命令留空。和 Vercel 基本一样。

> **唯一不能做的**：把 Express 后端部署到 Vercel / Pages。
> serverless 有执行时长上限，SSE 流式对话会被掐断。

### 第 3 步：验收三件事

```bash
# ① 后端活着
curl https://xxx.onrender.com/api/health

# ② 前端能拿到数据（浏览器打开你的静态站点地址，列表要出来）
#    GitHub Pages 的话记得带结尾斜杠：https://用户名.github.io/仓库名/

# ③ 404 是真的 404（任务1 要截图的就是这个）
curl -o NUL -w "%{http_code}\n" https://你的前端地址/not-exist
# 应该输出 404
```

### 最省事的偷懒方案（不满足任务1 的静态托管要求）

只部署 Render 那一个服务，Express 会顺带托管 `public/`，一个地址跑全套。
好处是零 CORS、零配置；坏处是没有独立的静态站点地址，任务1 的"部署到 Pages/Vercel/Cloudflare"这一条就不成立。
**建议还是按上面两步走**，多花 10 分钟，验收点就齐了。

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

**Q：访问 `/not-exist` 为什么是 404，而不是回到首页？**
因为本项目用 hash 路由（`#/chat` 这种），服务端不需要认识任何前端路径，所以没有做 SPA 兜底。
好处有两个：① 未知路径返回**真正的 404 状态码**，任务1 要的 404 截图才截得出来；
② `public/404.html` 正好是 GitHub Pages 的约定文件，静态部署后行为和本地一致。
（早期版本有兜底，结果任何路径都 200，那张截图永远截不出来 —— 已删。）

**Q：部署到 Vercel 后页面出来了，但列表一直"加载失败"**
三个检查点，按顺序看：① `public/config.js` 的 `API_BASE` 填了没 ② 地址末尾有没有多余的斜杠
③ Render 的 `ALLOWED_ORIGINS` 里有没有你这个 Vercel 域名。Console 报 `blocked by CORS policy` 就是第 ③ 条。

**Q：Vercel 构建失败，提示找不到输出目录**
Root Directory 没设成 `public`。Vercel 看到 `package.json` 就会当成 Node 项目去 build，
但 `public/` 是零构建的静态站，设置见上面「部署 → 第 2 步」。

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
| 任务1 静态页 + 语义化 + 响应式 + JS 交互 | `public/index.html`（header/nav/main/section/footer + ul/li）/ `style.css` 的 640px 断点 / `app.js` |
| 任务1 部署到 Pages / Vercel / Cloudflare | 见上面「部署」：`public/` 零构建直接托管，`config.js` 填后端地址 |
| 任务1 404 截图 | 删掉了 SPA 兜底，`/not-exist` 返回真 404 + `public/404.html` |
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
