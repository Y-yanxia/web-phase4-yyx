// ============================================================
// tools.js —— 工具定义 + 工具执行（任务5：让模型操作你的数据）
//
// 这一层是整个项目"含金量最高"的地方，答辩一定会问。
// 两个工具：
//   add_item   —— 写：模型听懂了就去数据库插一条
//   query_items —— 读：模型能按条件查
//
// 【讲解点 C】description 为什么写这么长？
//   模型只能靠 description 判断"该不该调、参数怎么填"。
//   我第一版写的是 "新增" 两个字，结果模型只回"好的，已帮你记下"，根本没调用工具。
//   把触发条件和参数含义写清之后才稳定 —— 这就是任务书要求的那个「失败案例」。
// ============================================================

import { createItem, listItems } from './db.js';
import { assertString, assertDate } from './utils.js';

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_item',
      description:
        '在待办清单中新增一条任务，并立即写入数据库。' +
        '当用户表达「帮我记一下 / 加一条 / 记个事 / 提醒我 / 别忘了我」这类意图时，必须调用本工具；' +
        '不要只用文字回复“好的，已帮你记下”而不调用。',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description:
              '要做的事情本身。必须去掉“帮我加”“记一下”这类指令词，只保留事情内容。' +
              '例：用户说“帮我加一条明天交实验报告”，title 就是“明天交实验报告”。',
          },
          due: {
            type: 'string',
            description:
              '截止日期，格式必须是 YYYY-MM-DD。用户明确说了时间才传；说“明天/后天”时按系统提示词给的今天日期换算。没说就不要传这个字段。',
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_items',
      description:
        '按条件查询用户的待办清单。' +
        '当用户问「我还有哪些没做 / 今天有什么任务 / 我是不是记过 xx / 一共几条」时调用本工具，再根据返回结果回答。',
      parameters: {
        type: 'object',
        properties: {
          done: {
            type: 'boolean',
            description: 'true=只看已完成的，false=只看未完成的。不传=全部。',
          },
          keyword: {
            type: 'string',
            description: '标题关键词，模糊匹配。用户提到具体事情（如“实验报告”）时才传。',
          },
        },
      },
    },
  },
];

/**
 * 执行工具。返回值会被 JSON.stringify 后作为 role:"tool" 的消息回填给模型。
 *
 * 设计要点：出错也返回结果，不抛到外层。
 *   因为模型自己会看 tool 结果 —— 参数不对时把原因回给它，它下一轮能自己改。
 * （这就是答辩题「模型不按格式返回怎么办」的答案之一）
 */
export function executeTool(name, args = {}) {
  try {
    if (name === 'add_item') {
      const title = assertString(args, 'title', { max: 120, label: 'title' });
      const due = assertDate(args.due, 'due');
      const item = createItem({ title, due });
      return { ok: true, action: 'add_item', item, note: `已写入数据库，新条目 id=${item.id}` };
    }

    if (name === 'query_items') {
      let done;
      if (typeof args.done === 'boolean') done = args.done ? 1 : 0;
      else if (args.done === 'true' || args.done === 'false') done = args.done === 'true' ? 1 : 0;

      const keyword = typeof args.keyword === 'string' ? args.keyword.trim().slice(0, 50) : '';
      const items = listItems({ done, keyword });
      return { ok: true, action: 'query_items', count: items.length, items };
    }

    return { ok: false, error: `未知工具：${name}。可用工具只有 add_item / query_items` };
  } catch (err) {
    // 校验失败 → 把错误原文回给模型，它下一轮通常会自己修参数
    return { ok: false, action: name, error: err.message };
  }
}

/** 给前端调试面板用的中文短名 */
export const TOOL_LABELS = {
  add_item: '新增一条',
  query_items: '查询清单',
};
