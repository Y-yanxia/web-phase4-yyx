// ============================================================
// env.js —— 加载 .env
//
// 为什么单独一个文件、并且必须第一个 import？
//   ESM 的 import 是「先全部求值、再执行本模块」。
//   如果在 app.js 里写 process.loadEnvFile()，它会在 db.js 读完 DB_PATH 之后才执行 —— 太晚了。
//   把加载动作放进模块顶层，再让 app.js 第一行 import 它，顺序才正确。
//
// 为什么不装 dotenv？
//   Node 20.12+ 内置了 process.loadEnvFile()，少一个依赖。
//   线上（Render）的变量由平台注入，根本不需要 .env，所以这段只在本地生效。
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env');

if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
  console.log('[env] 已加载 .env');
} else {
  console.log('[env] 未找到 .env，使用系统环境变量或默认值（清单功能可用，AI 需配置 LLM_API_KEY）');
}
