# 抓包记录（任务1 的顺带练习）

> 任务书要求：F12 → Network，记录 3 条请求 —— **页面主文档、一个 CSS 或 JS、一次你自己写的 fetch**，
> 写清各自的方法、状态码、耗时；再故意请求一个不存在的路径，截图看看 404 长什么样。
> 这份记录**同时要写进周记**（任务书原话："要写进周记"）。

## 怎么取数据

1. F12 打开 DevTools → Network 面板
2. 勾上 **Preserve log**，刷新页面（Ctrl+R）
3. 点某一行 → 右侧看 **Headers**（Request Method / Status Code）和 **Timing**（总耗时）
4. 右键该行 → **Copy → Copy as cURL**，存到 `docs/` 下，就是可复现的证据

---

## 实测记录（服务端视角）

下面这组数字是脚本打出来的**纯服务端耗时**（本地 Express、热连接、取 5 次中位数）：

| # | 请求 | 方法 | 状态码 | 耗时 | 大小 | Content-Type |
|---|---|---|---|---|---|---|
| 1 | `/` | GET | **200** | 2.6 ms | 8.8 KB | `text/html` |
| 2 | `/app.js` | GET | **200** | 1.8 ms | 22.0 KB | `application/javascript` |
| 3 | `/style.css` | GET | **200** | 1.4 ms | 17.9 KB | `text/css` |
| 4 | `/api/items` | GET | **200** | 0.9 ms | 0.3 KB | `application/json` |
| 5 | `/not-exist` | GET | **404** | 1.3 ms | 3.2 KB | `text/html` |
| 6 | `/api/not-exist` | GET | **404** | 1.0 ms | 0.1 KB | `application/json` |

> ⚠️ **你自己在 DevTools 里看到的数字会比这个大 5~20 倍**（通常 10~30 ms），这是正常的：
> 浏览器面板算的是"从发起请求到响应体收完"，包含 DNS、TCP 建连、TLS 握手（https）、请求排队。
> 脚本里是复用了已经建好的连接，所以只剩服务端处理时间。
> **交作业要用你自己 DevTools 里的数字**，别抄这张表 —— 老师和同学一对比就看出来了。

建议在表里补上你自己实测的那一版，例如：

```
| 1 | /            | GET | 200 | 18 ms | 页面主文档 |
| 2 | /app.js      | GET | 200 | 12 ms | 前端逻辑   |
| 3 | /api/items   | GET | 200 | 34 ms | 自己写的 fetch |
| 4 | /not-exist   | GET | 404 | 11 ms | 故意制造   |
```

---

## 三条请求的补充说明（答辩可能会问）

**① 为什么主文档第一次是 200，刷新后可能变 304？**
第一次没有缓存，服务端返回 200 + `ETag`。刷新时浏览器带 `If-None-Match`，服务端发现没变就回 304，
响应体是空的，只花几十字节 —— 这叫**协商缓存**。本地开发我把 `maxAge` 设成 0，就是为了改代码即时生效。

**② `/app.js` 的 Content-Type 为什么是 `application/javascript` 而不是 `text/javascript`？**
两个都能跑，前者是 RFC 9239 的推荐值，`express.static` 默认给的就是它。
写错 MIME 类型会让浏览器**拒绝执行**脚本（控制台报 `Refused to execute script because its MIME type ...`），
这也是"页面白屏"的常见原因之一。

**③ 那条 `/api/items` 的耗时花在哪？**
路由匹配 → 参数校验 → SQLite 查询（要打开 WAL、准备语句）→ JSON 序列化 → 写响应。
第一次查询最慢，之后 SQLite 会复用预编译语句，耗时明显下降。

**④ 404 长什么样？这是重点**

我把 SPA 兜底删掉了，所以现在**未知路径返回的是真 404**，不是"200 + 首页"：

- 浏览器访问 `/not-exist` → 状态码 **404**，返回一张专用的 `public/404.html` 页面
- 接口访问 `/api/not-exist` → 状态码 **404**，返回**统一 JSON**：

```json
{ "code": 40400, "data": null, "msg": "接口不存在：GET /api/not-exist" }
```

为什么要区分这两种？因为前端只会对 `/api/*` 调 `res.json()`。
如果接口 404 返回的是 HTML，`res.json()` 会抛 `Unexpected token '<'` —— 这是很常见的翻车现场。

> **这段要截图**：F12 → Network → 访问 `/not-exist` → 点那一行 → Headers 里能看到 `Status Code: 404`。

---

## 截图清单

- [ ] `docs/screenshots/T1-05-network.png` —— Network 面板 5 条请求全览（要能看到 Method / Status / Time 三列）
- [ ] `docs/screenshots/T1-06-network-fetch.png` —— `/api/items` 那条的 Headers 详情
- [ ] `docs/screenshots/T1-07-404.png` —— `/not-exist` 的 404（Headers 面板要有 `Status Code: 404`）
- [ ] `docs/screenshots/T1-08-console.png` —— Console 面板全绿、没有红色报错

## 顺手可以做的 curl 版（和 DevTools 互相印证）

```bash
curl -s -o NUL -w "status=%{http_code} time=%{time_total}s size=%{size_download}B\n" http://localhost:3000/not-exist
# status=404 time=0.0018s size=3277B
```

`-w` 这个参数能直接把状态码、耗时、字节数打出来，比 DevTools 更适合贴进报告里。
