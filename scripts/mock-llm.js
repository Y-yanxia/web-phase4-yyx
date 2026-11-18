// ============================================================
// scripts/mock-llm.js —— 假的「OpenAI 兼容」模型服务（本地调试神器）
//
// 为什么需要它？
//   1. 没有 API Key 也能把任务4（流式）和任务5（工具调用）的整条链路跑通
//   2. 能稳定复现 401 / 429，用来截「出错给人话」的截图
//   3. 能稳定复现「模型只回文字、不调工具」的失败案例 —— 任务5 要的就是这个
//
// 用法：
//   终端 A：npm run mock
//   终端 B：把 .env 改成
//       LLM_BASE_URL=http://127.0.0.1:5010
//       LLM_API_KEY=mock-key
//   然后 npm run dev，在前端对着助手说：
//       "帮我加一条明天交实验报告"   → 触发 add_item 工具调用
//       "我还有什么没做"             → 触发 query_items
//       "触发401"                    → 模拟 Key 失效
//       "触发429"                    → 模拟限流
//       "只聊不调工具"               → 复现「该调用没调用」的失败案例
// ============================================================

import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 5010);
const TOOL_CALL_ID = 'call_mock_0001';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 写一帧 OpenAI 格式的 SSE */
function chunk(res, delta, finishReason = null) {
  const payload = {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'mock-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/** 把一段文本按字切开慢慢吐，模拟真实的逐字流式 */
async function streamText(res, text) {
  for (const ch of text) {
    chunk(res, { content: ch });
    await sleep(18);
  }
  chunk(res, {}, 'stop');
  res.write('data: [DONE]\n\n');
  res.end();
}

/** 把工具参数切成两段发，模拟真实的 arguments 分片 */
async function streamToolCall(res, name, args) {
  const argsText = JSON.stringify(args);
  const mid = Math.floor(argsText.length / 2);

  chunk(res, {
    tool_calls: [{ index: 0, id: TOOL_CALL_ID, type: 'function', function: { name, arguments: '' } }],
  });
  await sleep(60);
  chunk(res, { tool_calls: [{ index: 0, function: { arguments: argsText.slice(0, mid) } }] });
  await sleep(60);
  chunk(res, { tool_calls: [{ index: 0, function: { arguments: argsText.slice(mid) } }] });
  chunk(res, {}, 'tool_calls');
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/chat/completions')) {
    res.writeHead(404).end('mock: only /chat/completions');
    return;
  }

  let raw = '';
  for await (const c of req) raw += c;
  let body = {};
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    /* ignore */
  }

  const messages = body.messages || [];
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const hasToolMessage = messages.some((m) => m.role === 'tool');
  const lastToolName = [...messages].reverse().find((m) => m.role === 'tool');

  console.log(`[mock] ${messages.length} 条消息 | user: ${lastUser.slice(0, 40)}`);

  // --- 错误模拟 ---
  if (lastUser.includes('触发401')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Authentication Fails (mock)', code: 401 } }));
    return;
  }
  if (lastUser.includes('触发429')) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Rate limit reached (mock)', code: 429 } }));
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // --- 第二轮：已经有工具结果了，根据结果用自然话总结 ---
  if (hasToolMessage) {
    let parsed = {};
    try {
      parsed = JSON.parse(lastToolName.content);
    } catch {
      /* ignore */
    }
    const reply = parsed.ok
      ? parsed.action === 'add_item'
        ? `记下了：${parsed.item?.title ?? '这条任务'}。已经放进清单，编号 ${parsed.item?.id ?? '?'}。`
        : `你目前有 ${parsed.count ?? 0} 条相关任务。`
      : `这条我没加成功，原因是：${parsed.error ?? '参数不对'}。你再换个说法试试？`;
    await streamText(res, reply);
    return;
  }

  // --- 第一轮：决定调不调工具 ---
  if (/加一条|帮我记|记一下|提醒我|别忘了/.test(lastUser) && !lastUser.includes('只聊')) {
    const title = lastUser
      .replace(/帮我|加一条|记一下|提醒我|别忘了|。|，/g, '')
      .replace(/^(加|记)+/, '')
      .trim();
    await streamToolCall(res, 'add_item', { title: title || '一件没说清的事' });
    return;
  }

  if (/没做|有哪些|还剩|查一下|记过/.test(lastUser) && !lastUser.includes('只聊')) {
    await streamToolCall(res, 'query_items', {});
    return;
  }

  // 默认：只回文字
  await streamText(
    res,
    '我是「一句话清单」的助手。你可以说「帮我加一条明天交实验报告」，我会直接把它写进清单。'
  );
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  mock 模型服务已启动：http://127.0.0.1:${PORT}`);
  console.log('  把 .env 改成 LLM_BASE_URL=http://127.0.0.1:5010 和 LLM_API_KEY=mock-key 即可使用\n');
});
