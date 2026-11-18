// ============================================================
// routes/chat.js —— 流式对话 + 工具调用（任务4 和 任务5 合成一条路由）
//
// 为什么合成一条？
//   任务书要"四者打通"，不希望用户看到两个割裂的助手。
//   所以：模型判断要不要调工具 → 调完 → 继续把最终答案流式吐给前端。
//
// 【讲解点 D】SSE 是单向的，前端点「停止生成」后端是收不到的。
//   必须监听 req 的 close 事件去 abort 上游请求，否则用户点了停止，钱还在烧。
// ============================================================

import express from 'express';
import { catchAsync, assertString, AppError, todayString } from '../utils.js';
import { getHistory, appendTurn } from '../sessions.js';
import { streamCompletion, humanizeError, llmConfigured } from '../llm.js';
import { TOOLS, executeTool } from '../tools.js';

const router = express.Router();

const MAX_ROUNDS = Number(process.env.MAX_TOOL_ROUNDS || 3);

/**
 * 系统提示词：四段式 —— 角色 / 能力边界 / 行为约束 / 输出风格
 * 第三段是解决「模型只答应不动手」的关键
 */
function systemPrompt() {
  return [
    '你是「一句话清单」的助理，负责帮用户记录和查询待办事项。',
    '',
    '【能力范围】',
    '你只有两个工具：add_item（新增一条待办）、query_items（查询待办）。除这两个工具外，你没有其他权限。',
    '',
    '【必须遵守】',
    '1. 只要用户表达了"新增/记一下/提醒我"的意图，必须先调用 add_item；不要只用文字回答"好的"，也不要说"我记住了"却不调用。',
    '2. 只要用户问"有哪些任务/还有什么没做/记过没有"，必须先调用 query_items，再根据返回结果回答，不要凭印象编。',
    '3. add_item 的 title 只保留事情本身，去掉"帮我加""记一下"这类指令词。',
    `4. 今天的日期是 ${todayString()}。用户说"明天""后天""下周一"时换算成 YYYY-MM-DD 传 due；没说时间就不要传 due。`,
    '5. 工具返回 ok:false 时，把 error 读懂，改正参数后重新调用一次；还是失败就如实告诉用户哪里不对。',
    '6. 与待办清单无关的请求（写代码、闲聊、讲笑话），用一句话说明你只负责清单，并提示用户可以说什么。',
    '',
    '【输出风格】',
    '中文，口语，一句话说清结果。例如"记下了：明天交实验报告"。不要复述工具返回的 JSON，不要用 Markdown 表格。',
  ].join('\n');
}

/** 写一帧 SSE */
function send(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** 合并 tool_calls 的分片（name 和 arguments 都是流式拼出来的） */
function mergeToolDelta(map, ev) {
  const cur = map.get(ev.index) || { id: '', name: '', arguments: '' };
  if (ev.id) cur.id = ev.id;
  if (ev.name) cur.name += ev.name;
  if (ev.argumentsText) cur.arguments += ev.argumentsText;
  map.set(ev.index, cur);
}

router.post(
  '/chat',
  catchAsync(async (req, res) => {
    const body = req.body ?? {};
    const message = assertString(body, 'message', { max: 2000, label: 'message' });
    const sessionId =
      typeof body.sessionId === 'string' && body.sessionId
        ? body.sessionId.slice(0, 64)
        : 'default';

    // 没配 Key：直接返回 JSON 错误，让前端显示配置提示（此时还没写响应头，可以正常 503）
    if (!llmConfigured()) {
      res.status(503).json({
        code: 50301,
        data: null,
        msg: '服务端未配置 LLM_API_KEY。清单功能不受影响；要启用 AI，请复制 .env.example 为 .env 并填入 Key。',
      });
      return;
    }

    // ---- 从这里开始进入 SSE，后面所有错误都只能发 error 帧，不能再改状态码 ----
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // 让 Nginx / Render 的反代别缓冲
    });
    res.flushHeaders?.();

    const controller = new AbortController();
    // 【讲解点 D 的坑】这里必须监听 res 的 close，不能监听 req 的 close。
    // 因为 express.json() 已经把请求体读完了，req 的 close 会立刻触发，
    // 结果是刚建立连接就被 abort，前端只能收到「已停止生成」。
    // res 的 close 才代表「这条响应连接断了」；writableEnded 为 true 说明是我们自己 end 的，不算中断。
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const messages = [
      { role: 'system', content: systemPrompt() },
      ...getHistory(sessionId),
      { role: 'user', content: message },
    ];

    let answer = '';
    let lastError = null;

    try {
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const turn = { text: '', toolCalls: new Map() };

        for await (const ev of streamCompletion({
          messages,
          tools: TOOLS,
          signal: controller.signal,
        })) {
          if (ev.type === 'text') {
            turn.text += ev.text;
            send(res, 'delta', { text: ev.text });
          } else if (ev.type === 'tool_delta') {
            mergeToolDelta(turn.toolCalls, ev);
          } else if (ev.type === 'error') {
            throw new AppError(ev.status, 50200, ev.message, ev.detail);
          } else if (ev.type === 'aborted') {
            throw new AppError(499, 49900, '已停止生成');
          }
        }

        // 规范化：有些兼容实现不返回 id，这里补一个，后面 tool_call_id 必须对得上
        const calls = [...turn.toolCalls.values()]
          .filter((c) => c.name)
          .map((c, i) => ({ ...c, id: c.id || `call_${Date.now()}_${i}` }));

        // 没有工具调用 → 这一轮就是最终答案
        if (calls.length === 0) {
          answer = turn.text.trim();
          break;
        }

        // 有工具调用：先把 assistant 的 tool_calls 消息补进上下文，否则下一轮会 400
        messages.push({
          role: 'assistant',
          content: turn.text || null,
          tool_calls: calls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: c.arguments || '{}' },
          })),
        });

        for (const call of calls) {
          let args = {};
          let parseError = null;
          try {
            args = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            parseError = `参数不是合法 JSON：${call.arguments}`;
          }

          // 先把「要调什么工具、传什么参数」推给前端 —— 这就是调试面板的数据来源
          send(res, 'tool', { phase: 'call', name: call.name, args: parseError ? call.arguments : args });

          const result = parseError
            ? { ok: false, error: parseError }
            : executeTool(call.name, args);

          send(res, 'tool', {
            phase: 'result',
            name: call.name,
            args: parseError ? call.arguments : args,
            result,
          });

          // 工具结果回填给模型。截断一下，防止一次查太多把上下文撑爆
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result).slice(0, 4000),
          });
        }

        if (round === MAX_ROUNDS - 1) {
          answer = '（工具调用轮次达到上限，已停止）';
        }
      }
    } catch (err) {
      lastError = err;
    }

    if (lastError) {
      const status = lastError.status || 500;
      const isAbort = status === 499;
      send(res, 'error', {
        code: lastError.code || status,
        status,
        msg: isAbort ? '已停止生成' : humanizeError(status, lastError.message),
        detail: process.env.NODE_ENV === 'production' ? undefined : lastError.detail,
      });
      res.end();
      return;
    }

    if (answer) {
      appendTurn(sessionId, message, answer); // 记住这一轮，下一轮才有上下文
      send(res, 'final', { text: answer });
    }
    send(res, 'done', { ok: true });
    res.end();
  })
);

/** 清空某个会话的上下文（前端"新对话"按钮用） */
router.delete(
  '/chat/:sessionId',
  catchAsync(async (req, res) => {
    const { resetSession } = await import('../sessions.js');
    resetSession(req.params.sessionId);
    res.json({ code: 0, data: null, msg: '会话已清空' });
  })
);

export default router;
