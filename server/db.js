// ============================================================
// db.js —— SQLite 存储层（任务2 的「数据落盘」）
//
// 为什么用 node:sqlite 而不是 better-sqlite3？
//   1. Node 22.5+ 内置，零依赖、零原生编译 —— 部署到 Render 不会卡在 node-gyp
//   2. API 几乎一样（DatabaseSync / prepare / run / all / get）
//   3. 答辩可以讲：我查了 Node 官方文档，内置模块省掉一个原生依赖
//
// 为什么用 SQLite 而不是 JSON 文件？（答辩题）
//   1. 写并发安全：JSON 要整文件重写，两个请求同时写就丢数据
//   2. 事务和条件查询是现成的，不用自己遍历数组
//   3. 单文件即库，备份 = 复制一个文件
// ============================================================

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// 允许用环境变量换路径：本地 ./data/app.db，线上可以指到挂载盘
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.db');

// 目录不存在就建（第一次跑、或线上清盘后重启都会用到）
fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// WAL 模式：读不阻塞写。代价是多两个附属文件（*.db-wal / *.db-shm）
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// 建表：字段就是任务书里那张清单的最小可用集
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT    NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0,
    due        TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// 常用查询的索引：按状态筛、按时间排序
db.exec('CREATE INDEX IF NOT EXISTS idx_items_done ON items(done);');

// ------------------------------------------------------------
// 播种：表为空时塞 3 条演示数据
// 线上免费实例重启会清空磁盘，靠这段代码恢复，答辩时可以直接讲
// ------------------------------------------------------------
const seedEnabled = process.env.SEED !== '0';
const rowCount = Number(db.prepare('SELECT COUNT(*) AS c FROM items').get().c);

if (seedEnabled && rowCount === 0) {
  const insert = db.prepare('INSERT INTO items (title, done, due) VALUES (?, ?, ?)');
  const seeds = [
    ['交第四阶段任务书', 0, null],
    ['读一遍 Fetch API 文档', 0, null],
    ['把页面部署到 Vercel', 1, null],
  ];
  for (const s of seeds) insert.run(...s);
  console.log(`[db] 表为空，已播种 ${seeds.length} 条演示数据`);
}

// ------------------------------------------------------------
// 数据访问函数（DAO）：所有 SQL 只出现在这个文件里
// 好处：路由层读起来是 listItems() / createItem()，不用看 SQL
// ------------------------------------------------------------

/** 列表：可按 done 过滤、按关键词模糊匹配 */
export function listItems({ done, keyword } = {}) {
  let sql = 'SELECT id, title, done, due, created_at FROM items';
  const where = [];
  const params = [];

  if (done === 0 || done === 1) {
    where.push('done = ?');
    params.push(done);
  }
  if (keyword) {
    where.push('title LIKE ?');
    params.push(`%${keyword}%`);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY done ASC, id DESC';

  return db.prepare(sql).all(...params).map(normalize);
}

/** 单条：不存在返回 undefined */
export function getItem(id) {
  const row = db.prepare('SELECT id, title, done, due, created_at FROM items WHERE id = ?').get(id);
  return row ? normalize(row) : undefined;
}

/** 新增：返回完整的这一行（前端拿它直接插到列表里） */
export function createItem({ title, due = null }) {
  const info = db.prepare('INSERT INTO items (title, due) VALUES (?, ?)').run(title, due);
  return getItem(Number(info.lastInsertRowid));
}

/** 修改：只改传进来的字段（部分更新） */
export function updateItem(id, patch) {
  const fields = [];
  const params = [];

  if (patch.title !== undefined) {
    fields.push('title = ?');
    params.push(patch.title);
  }
  if (patch.done !== undefined) {
    fields.push('done = ?');
    params.push(patch.done ? 1 : 0);
  }
  if (patch.due !== undefined) {
    fields.push('due = ?');
    params.push(patch.due);
  }
  if (!fields.length) return getItem(id);

  params.push(id);
  db.prepare(`UPDATE items SET ${fields.join(', ')} WHERE id = ?`).run(...params);
  return getItem(id);
}

/** 删除：返回被删掉的那一行，方便前端做乐观更新回滚 */
export function deleteItem(id) {
  const existing = getItem(id);
  if (!existing) return undefined;
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  return existing;
}

/** 统计：给「关于」页和 AI 的系统提示词用 */
export function stats() {
  const total = Number(db.prepare('SELECT COUNT(*) AS c FROM items').get().c);
  const done = Number(db.prepare('SELECT COUNT(*) AS c FROM items WHERE done = 1').get().c);
  return { total, done, open: total - done };
}

/**
 * SQLite 没有布尔类型，done 存的是 0/1。
 * 出库时统一转成真正的 boolean，前端就不必到处写 `done === 1`
 */
function normalize(row) {
  return { ...row, done: Boolean(row.done) };
}

export { DB_PATH };
