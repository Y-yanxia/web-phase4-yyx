// ============================================================
// utils.js —— 全站统一的三件事：响应格式、业务错误、async 兜底
// 任务2 的硬性要求全部落在这个文件里：{code,data,msg} / 400 校验 / 不崩进程
// ============================================================

/**
 * 业务错误：带 HTTP 状态码 + 业务码
 * 作用：让「校验失败」变成一个可以 throw 的东西，而不是层层 if return
 * 例：throw new AppError(400, 40001, '缺少必填字段：title')
 */
export class AppError extends Error {
  constructor(status, code, message, detail) {
    super(message);
    this.name = 'AppError';
    this.status = status; // HTTP 状态码：400 / 404 / 500 ...
    this.code = code;     // 业务码：40001 缺字段 ...
    this.detail = detail; // 上游原始报错，只在开发环境回传
  }
}

/** 成功响应：三个字段一个都不能少 */
export const ok = (data = null, msg = 'ok') => ({ code: 0, data, msg });

/** 失败响应：data 恒为 null，保证前端只判断 code */
export const fail = (code, msg) => ({ code, data: null, msg });

/**
 * 【讲解点 A】async 路由兜底
 * Express 4 不会捕获 async 函数里 throw 的错误：
 * 它会变成 unhandledRejection，Node 15+ 默认直接杀掉进程 —— 也就是任务书说的「整个服务崩掉」。
 * 套一层 catch(next) 之后，错误才会交给最后那个全局错误中间件。
 */
export const catchAsync = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * 字符串字段校验：缺字段 → 40001，类型不对 → 40002，超长 → 40003
 * 全部返回 400（不是 500），并且说清是哪一项错了
 */
export function assertString(body, field, { required = true, max = 120, label = field } = {}) {
  const value = body?.[field];

  if (value === undefined || value === null || String(value).trim() === '') {
    if (!required) return null;
    throw new AppError(400, 40001, `缺少必填字段：${label}`);
  }
  if (typeof value !== 'string') {
    throw new AppError(400, 40002, `字段 ${label} 必须是字符串，收到的是 ${typeof value}`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new AppError(400, 40003, `字段 ${label} 太长，最多 ${max} 个字符（当前 ${trimmed.length}）`);
  }
  return trimmed;
}

/** 路径参数 :id 校验：必须是正整数 */
export function assertId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, 40004, `路径参数 id 必须是正整数，收到的是 "${raw}"`);
  }
  return id;
}

/** 日期校验：允许空，非空必须是 YYYY-MM-DD 且真实存在 */
export function assertDate(value, field = 'due') {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(400, 40005, `字段 ${field} 必须形如 YYYY-MM-DD，收到 "${value}"`);
  }
  // 注意必须带 Z 按 UTC 解析：
  // 写成 new Date('2026-12-31T00:00:00') 会按本地时区解析，
  // 再 toISOString() 转回 UTC 就变成 2026-12-30，合法的日期全被判非法（踩过一次）
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new AppError(400, 40005, `字段 ${field} 不是有效日期：${value}`);
  }
  return value;
}

/** 今天的日期（本地时区），给系统提示词换算「明天/后天」用 */
export function todayString() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
