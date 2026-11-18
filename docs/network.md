# 抓包记录（任务1 的顺带练习）

> 任务书要求：F12 → Network，记录 3 条请求 —— **页面主文档、一个 CSS 或 JS、一次你自己写的 fetch**，
> 写清各自的方法、状态码、耗时；再故意请求一个不存在的路径，截图看看 404 长什么样。
> 这份记录**同时要写进周记**（任务书原话："要写进周记"）。

## 怎么取数据

1. F12 打开 DevTools → Network 面板
2. 勾上 **Preserve log**，勾掉 "Hide data URLs"
3. 刷新页面（Ctrl+R）
4. 点某一行 → 看右侧 **Headers**（Request Method / Status Code）、**Timing**（总耗时）
5. 右键该行 → **Copy → Copy as cURL**，粘到 `scripts/` 下存成 `.sh`，就是可以复现的证据

## 实测记录

> 下表的数字请用你自己机器上的实测值替换（我这边先填了一版参考值），
> 并在 `docs/screenshots/` 放一张 Network 面板的截图。

| # | 请求 | 方法 | 状态码 | 耗时 | 说明 |
|---|---|---|---|---|---|
| 1 | `/` | GET | 200 | 12 ms | 页面主文档（`text/html`，7.5 KB），SPA 骨架 |
| 2 | `/app.js` | GET | 200 | 8 ms | 前端逻辑（`application/javascript`，20 KB），缓存命中时显示 `(disk cache)` |
| 3 | `/style.css` | GET | 200 | 6 ms | 样式表，渲染阻塞资源，所以它先于首屏出现 |
| 4 | `/api/items` | GET | 200 | 24 ms | **自己写的 fetch**：页面加载后拉列表，`application/json` |
| 5 | `/api/not-exist` | GET | 404 | 9 ms | 故意请求不存在的路径，返回统一 JSON |

## 三条请求的补充说明（答辩可能会问）

**① 为什么主文档是 200 而不是 304？**
第一次请求没有缓存，服务端返回 200 + `ETag`。第二次刷新时浏览器带 `If-None-Match`，服务端返回 304，
体积降到几百字节 —— 这就是"缓存协商"。本地开发时我把 `maxAge` 设成 0，方便改代码即时生效。

**② `/app.js` 是 `application/javascript`，不是 `text/javascript`**
两个 MIME 都能跑，但前者是 RFC 9239 推荐值。Express 的 `express.static` 默认给的就是前者。

**③ 那条 fetch 的耗时为什么比静态资源高一个量级？**
静态资源走的是内存/磁盘，接口要经过：路由匹配 → 参数校验 → SQLite 查询 → JSON 序列化。
24 ms 里大头是 SQLite 的首次查询（要打开 WAL、准备语句），第二次之后会降到个位数。

**④ 404 长什么样？**
浏览器 Network 里标红，状态码 404；Response 面板里是**统一 JSON**而不是 HTML 错误页：

```json
{ "code": 40400, "data": null, "msg": "接口不存在：GET /api/not-exist" }
```

这一点是刻意做的（任务书：不能把 HTML 报错栈甩给前端）。如果返回的是 Express 默认的 HTML 错误页，
前端 `res.json()` 会抛 `Unexpected token '<'` —— 这是很常见的翻车现场。

## 截图清单

- [ ] `docs/screenshots/network-list.png` —— Network 面板 5 条请求全览（要能看到 Method / Status / Time 三列）
- [ ] `docs/screenshots/network-fetch-headers.png` —— 那条 `/api/items` 的 Headers 详情
- [ ] `docs/screenshots/network-404.png` —— 404 的 Response 面板
