// ============================================================
// llm.js —— 模型调用的唯一出口（任务4：后端转发）
//
// 三条铁律：
//   1. Key 只从 process.env 读，绝不出现在任何返回给前端的数据里
//   2. 上游用 stream:true，再把字节流原样往上抛 —— 这才是真流式
//   3. 上游所有非 2xx 都翻译成「人话」，交给上层发 SSE error 帧
//
// 换平台只需要改 .env 的三个变量（DeepSeek / 智谱 / 百炼 / 豆包 都兼容 OpenAI 协议）
// ============================================================

const DEFAULTS = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
};

/**
 * 上游流式调用。异步生成器，yield 三种事件：
 *   { type:'text',        text }                     —— 一段正文增量
 *   { type:'tool_delta',  index, id?, name?, argumentsText? } —— 工具调用的碎片
 *   { type:'error',       status, message }          —— 上游报错
 *   { type:'aborted' }                               —— 用户点了「停止生成」
 */
export async function* streamCompletion({ messages, tools, signal, temperature = 0.2 }) {
  const baseUrl = (process.env.LLM_BASE_URL || DEFAULTS.baseUrl).replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || DEFAULTS.model;

  const payload = {
    model,
    messages,
    stream: true,
    temperature,
    max_tokens: 800,
  };
  // 有工具就带上。tool_choice:'auto' 表示让模型自己决定调不调
  if (tools?.length) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

  let upstream;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.LLM_API_KEY || ''}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      yield { type: 'aborted' };
      return;
    }
    yield { type: 'error', status: 502, message: `连不上模型服务：${err.message}` };
    return;
  }

  if (!upstream.ok) {
    let detail = '';
    try {
      detail = (await upstream.text()).slice(0, 300);
    } catch {
      /* 读不出正文就算了 */
    }
    yield { type: 'error', status: upstream.status, message: `模型服务返回 ${upstream.status}`, detail };
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for await (const chunk of upstream.body) {
      // 统一换行：上游可能用 \r\n\r\n 分帧
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r/g, '');

      let splitAt;
      while ((splitAt = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, splitAt);
        buffer = buffer.slice(splitAt + 2);

        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          if (raw === '[DONE]') return;

          let json;
          try {
            json = JSON.parse(raw);
          } catch {
            continue; // 半帧或心跳，跳过
          }

          if (json.error) {
            yield {
              type: 'error',
              status: json.error.code || json.error.status || 502,
              message: json.error.message || '模型返回了错误',
            };
            return;
          }

          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;

          if (typeof delta.content === 'string' && delta.content) {
            yield { type: 'text', text: delta.content };
          }

          // 工具调用是分片到达的：name 和 arguments 都会一段一段给
          for (const tc of delta.tool_calls || []) {
            yield {
              type: 'tool_delta',
              index: tc.index ?? 0,
              id: tc.id,
              name: tc.function?.name,
              argumentsText: tc.function?.arguments,
            };
          }
        }
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      yield { type: 'aborted' };
      return;
    }
    yield { type: 'error', status: 502, message: `读取模型响应失败：${err.message}` };
  }
}

/** 把 HTTP 状态码翻译成用户看得懂的一句话（任务书：不能白屏） */
export function humanizeError(status, rawMessage = '') {
  const map = {
    401: 'API Key 无效或已失效，请检查服务器 .env 里的 LLM_API_KEY',
    402: '模型账户余额不足，请到平台充值后再试',
    403: '这个 Key 没有调用该模型的权限，请检查模型名或开通权限',
    404: '模型名或接口地址不对，请检查 LLM_MODEL / LLM_BASE_URL',
    429: '请求太频繁或已到速率上限，缓几秒再试',
    500: '模型服务内部错误，请稍后重试',
    502: '模型服务暂时不可用，请稍后重试',
    503: '模型服务忙，请稍后重试',
  };
  return map[status] || rawMessage || `调用失败（HTTP ${status}）`;
}

/** 这个实例到底有没有配 Key —— 给 /api/health 和前端提示用 */
export function llmConfigured() {
  return Boolean(process.env.LLM_API_KEY);
}
