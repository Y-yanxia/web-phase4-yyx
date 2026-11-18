// ============================================================
// app.js —— 服务入口
//
// 装配顺序就是这个文件从上往下的顺序，答辩时可以照着讲：
//   .env → CORS → body 解析 → 业务路由 → 静态文件 → SPA 兜底 → API 404 → 全局错误
// 顺序错了会出两类经典 bug：
//   1. 全局错误中间件写在路由前面 → 永远不生效
//   2. SPA 兜底写在 API 路由前面 → 所有 /api 请求都返回 index.html
// ============================================================

import './env.js'; // 必须是第一个：后面 db.js 一加载就要读 DB_PATH

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import itemsRouter from './routes/items.js';
import chatRouter from './routes/chat.js';
import { llmConfigured } from './llm.js';
import { stats, DB_PATH } from './db.js';
import { fail } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');

// ------------------------------------------------------------
// 1. CORS：跨域必须在服务端解决（任务书的坑一）
// 白名单从 ALLOWED_ORIGINS 读，逗号分隔。
// 故意没引入 cors 包 —— 手写这 15 行，答辩时每一行都能讲。
// ------------------------------------------------------------
const allowList = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && (allowList.includes(origin) || allowList.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin'); // 让 CDN 按 Origin 分别缓存
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400'); // 预检结果缓存一天，少一半请求
  }

  // 预检请求：直接 204，不进业务逻辑
  if (req.method === 'OPTIONS') return res.status(204).end();

  next();
});

// ------------------------------------------------------------
// 2. body 解析：限制大小，防止有人传 10MB JSON 把内存撑爆
// ------------------------------------------------------------
app.use(express.json({ limit: '256kb' }));

// ------------------------------------------------------------
// 3. 健康检查：部署平台和演示前都用它探活
// ------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    code: 0,
    data: {
      ok: true,
      uptime: Math.round(process.uptime()),
      node: process.version,
      db: path.relative(ROOT, DB_PATH) || DB_PATH,
      stats: stats(),
      llmConfigured: llmConfigured(),
      llmModel: process.env.LLM_MODEL || 'deepseek-chat',
    },
    msg: 'ok',
  });
});

// ------------------------------------------------------------
// 4. 业务路由
// ------------------------------------------------------------
app.use('/api', itemsRouter);
app.use('/api', chatRouter);

// ------------------------------------------------------------
// 5. 静态文件（前端由 Express 一起托管，本地一条命令就够）
//    分开部署时（Vercel 放前端），这一段不影响，前端照样能调 Render 的接口
// ------------------------------------------------------------
app.use(
  express.static(PUBLIC_DIR, {
    etag: true,
    lastModified: true,
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  })
);

// ------------------------------------------------------------
// 6. API 的 404：必须返回 JSON，不能把 HTML 兜底页甩给前端
// ------------------------------------------------------------
app.use('/api', (req, res) => {
  res.status(404).json(fail(40400, `接口不存在：${req.method} ${req.originalUrl}`));
});

// 浏览器会自动请求 favicon；返回 204，别让它落进 SPA 兜底返回一整页 HTML
app.get('/favicon.ico', (req, res) => res.status(204).end());

// ------------------------------------------------------------
// 7. 前端路由兜底：hash 路由其实用不到，但留着防手滑刷新 /chat
// ------------------------------------------------------------
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ------------------------------------------------------------
// 8. 全局错误处理 —— 必须是最后一个 use（4 个参数 express 才认）
//    任务书要求：任何异常都返回 JSON，不把 HTML 报错栈甩给前端
// ------------------------------------------------------------
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err); // SSE 已经开始写了，只能提前 return

  // express.json() 解析失败
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json(fail(40000, '请求体不是合法的 JSON'));
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json(fail(41300, '请求体太大，上限 256KB'));
  }

  const status = Number(err.status) || 500;
  const isKnown = Boolean(err.status); // AppError 带的 status
  const message = isKnown ? err.message : '服务器开小差了，请稍后再试';

  if (status >= 500) console.error('[500]', req.method, req.originalUrl, err);

  res.status(status).json(fail(err.code || status, message));
});

app.listen(PORT, () => {
  console.log('');
  console.log('  一句话清单 已启动');
  console.log(`  本地地址   http://localhost:${PORT}`);
  console.log(`  数据库     ${DB_PATH}`);
  console.log(`  AI 助手    ${llmConfigured() ? '已配置 Key' : '未配置 Key（清单功能正常，AI 会提示配置）'}`);
  console.log('');
});
