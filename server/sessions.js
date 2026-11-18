// ============================================================
// sessions.js —— 对话上下文（任务4 的「连续 3 轮上下文接得上」）
//
// 为什么放内存不放数据库？
//   对话上下文是"会话态"，不是业务数据。任务书要求持久化的是 items，不是聊天记录。
//   放内存的好处：零 IO、重启即清空（演示时正好从干净状态开始）。
//   代价：服务重启 / 多实例部署会丢历史 —— 这是已知问题，写进 README。
//
// 【讲解点 B】"限制总长度（超长就丢最早的）"就实现在 trimHistory 里
// ============================================================

const MAX_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES || 12); // 约 6 轮
const MAX_CHARS_PER_MESSAGE = 2000;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 分钟不聊就清理

/** sessionId -> { messages: [{role, content}], touchedAt } */
const store = new Map();

export function getHistory(sessionId) {
  const s = store.get(sessionId);
  if (!s) return [];
  s.touchedAt = Date.now();
  return s.messages;
}

/**
 * 追加一轮对话（用户 + 助手），并立刻做一次截断
 * 只保留最近 MAX_MESSAGES 条，最早的先丢 —— 避免 token 越滚越贵
 */
export function appendTurn(sessionId, userMessage, assistantMessage) {
  const s = store.get(sessionId) || { messages: [], touchedAt: Date.now() };
  s.messages.push(
    { role: 'user', content: clip(userMessage) },
    { role: 'assistant', content: clip(assistantMessage) }
  );
  s.messages = trimHistory(s.messages, MAX_MESSAGES);
  s.touchedAt = Date.now();
  store.set(sessionId, s);
}

/** 截断：只留最近 maxMessages 条 */
export function trimHistory(messages, maxMessages = MAX_MESSAGES) {
  if (messages.length <= maxMessages) return messages;
  return messages.slice(messages.length - maxMessages);
}

/** 单条超长也截一下，防止用户粘贴一整篇文章 */
export function clip(text, max = MAX_CHARS_PER_MESSAGE) {
  const s = String(text ?? '');
  return s.length > max ? s.slice(0, max) + '……（已截断）' : s;
}

export function resetSession(sessionId) {
  store.delete(sessionId);
}

export function sessionCount() {
  return store.size;
}

// 定期清理闲置会话，防止内存无限增长
const cleaner = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of store) {
    if (now - s.touchedAt > SESSION_TTL_MS) store.delete(id);
  }
}, 5 * 60 * 1000);
cleaner.unref?.(); // 别让这个定时器拖住进程退出
