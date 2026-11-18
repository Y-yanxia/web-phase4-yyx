// ============================================================
// routes/items.js —— 4 个数据接口（任务2：GET 列表 / POST 新增 / PUT 修改 / DELETE 删除）
//
// 每个接口都遵守三件事：
//   1. 返回统一 {code, data, msg}
//   2. 参数校验失败 → 400（不是 500），并说清哪一项错了
//   3. 所有 SQL 都走 db.js，路由层不出现 SQL
// ============================================================

import express from 'express';
import { catchAsync, ok, fail, AppError, assertString, assertId, assertDate } from '../utils.js';
import { listItems, createItem, updateItem, deleteItem, getItem, stats } from '../db.js';

const router = express.Router();

/**
 * GET /api/items —— 列表
 * query: ?done=0|1 （可选，不传=全部）  ?keyword=xxx （可选，标题模糊匹配）
 */
router.get(
  '/items',
  catchAsync(async (req, res) => {
    // 演示开关：?fail=1 强制返回 500，用来截「请求失败 + 重试按钮」那张三态图。
    // 只影响这一个接口，前端其他部分照常，截图才有说服力。
    if (req.query.fail === '1') {
      throw new AppError(500, 50001, '演示用的 500：这是 ?fail=1 故意触发的');
    }

    const doneRaw = req.query.done;
    let done;
    if (doneRaw === '0' || doneRaw === '1') done = Number(doneRaw);
    else if (doneRaw !== undefined && doneRaw !== '') {
      throw new AppError(400, 40006, 'query 参数 done 只能是 0 或 1');
    }

    const keyword = typeof req.query.keyword === 'string' ? req.query.keyword.trim().slice(0, 50) : '';

    res.json(ok(listItems({ done, keyword })));
  })
);

/** GET /api/items/:id —— 单条（顺手做，代价 5 行） */
router.get(
  '/items/:id',
  catchAsync(async (req, res) => {
    const id = assertId(req.params.id);
    const item = getItem(id);
    if (!item) throw new AppError(404, 40401, `条目 ${id} 不存在`);
    res.json(ok(item));
  })
);

/**
 * POST /api/items —— 新增
 * body: { title: string 必填, due?: 'YYYY-MM-DD' }
 */
router.post(
  '/items',
  catchAsync(async (req, res) => {
    const body = req.body ?? {};
    const title = assertString(body, 'title', { max: 120, label: 'title' });
    const due = assertDate(body.due, 'due');

    const item = createItem({ title, due });
    res.status(201).json(ok(item, '新增成功'));
  })
);

/**
 * PUT /api/items/:id —— 修改（部分更新，只改传进来的字段）
 * body: { title?, done?, due? } 至少要传一个
 * 任务书说 PUT 不强求，但任务3 要求"增删改查闭环"，缺了"改"会被问
 */
router.put(
  '/items/:id',
  catchAsync(async (req, res) => {
    const id = assertId(req.params.id);
    const body = req.body ?? {};

    const patch = {};
    if (body.title !== undefined) patch.title = assertString(body, 'title', { max: 120, label: 'title' });
    if (body.done !== undefined) {
      if (typeof body.done !== 'boolean') {
        throw new AppError(400, 40002, `字段 done 必须是布尔值 true/false，收到的是 ${typeof body.done}`);
      }
      patch.done = body.done;
    }
    if (body.due !== undefined) patch.due = assertDate(body.due, 'due');

    if (Object.keys(patch).length === 0) {
      throw new AppError(400, 40007, '没有要修改的字段：至少要传 title、done、due 其中一个');
    }

    const item = updateItem(id, patch);
    if (!item) throw new AppError(404, 40401, `条目 ${id} 不存在`);
    res.json(ok(item, '修改成功'));
  })
);

/** DELETE /api/items/:id —— 删除 */
router.delete(
  '/items/:id',
  catchAsync(async (req, res) => {
    const id = assertId(req.params.id);
    const item = deleteItem(id);
    if (!item) throw new AppError(404, 40401, `条目 ${id} 不存在`);
    res.json(ok(item, '删除成功'));
  })
);

/** GET /api/stats —— 统计（给「关于」页和 AI 提示词用） */
router.get(
  '/stats',
  catchAsync(async (req, res) => {
    res.json(ok(stats()));
  })
);

export default router;
