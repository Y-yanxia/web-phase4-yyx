// ============================================================
// scripts/smoke.mjs —— 接口验收脚本（任务2 的「一天的成绩单」）
//
// 用法：npm run smoke        （服务要先跑起来：npm start）
// 或者：node scripts/smoke.mjs http://localhost:3000
//
// 它覆盖了任务书要求的全部验收点：
//   3 个接口调通 / 统一格式 / 缺字段返回 400 而不是 500 / 404 / 不存在的接口返回 JSON
// 最后打印 PASS/FAIL 汇总 —— 直接截图就能当测试证据。
// ============================================================

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

let pass = 0;
let fail = 0;
const created = [];

const color = (code) => process.stdout.isTTY;
const green = (s) => (color() ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s) => (color() ? `\x1b[31m${s}\x1b[0m` : s);
const dim = (s) => (color() ? `\x1b[2m${s}\x1b[0m` : s);

function check(name, condition, extra = '') {
  if (condition) {
    pass += 1;
    console.log(`${green('PASS')}  ${name}`);
  } else {
    fail += 1;
    console.log(`${red('FAIL')}  ${name}  ${dim(extra)}`);
  }
}

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, json };
}

/** 统一响应格式：必须刚好有三个字段 code/data/msg */
const isEnvelope = (j) =>
  j && typeof j === 'object' && 'code' in j && 'data' in j && 'msg' in j && Object.keys(j).length === 3;

console.log(`\n对 ${BASE} 执行接口验收\n${'-'.repeat(60)}`);

// 0. 健康检查
{
  const { status, json } = await call('GET', '/api/health');
  check('健康检查返回 200 且格式统一', status === 200 && isEnvelope(json), `status=${status}`);
}

// 1. 三个接口调通
{
  const { status, json } = await call('GET', '/api/items');
  check('GET /api/items 返回 200 + 数组', status === 200 && Array.isArray(json?.data), `status=${status}`);
}

{
  const { status, json } = await call('POST', '/api/items', {
    title: '验收脚本创建的条目',
    due: '2026-12-31',
  });
  const item = json?.data;
  if (item?.id) created.push(item.id);
  check(
    'POST /api/items 返回 201 + 新条目（带 id）',
    status === 201 && item && item.id > 0 && item.title === '验收脚本创建的条目',
    `status=${status} body=${JSON.stringify(json)}`
  );
  check('POST 返回值里 due 被正确保存', item?.due === '2026-12-31', `due=${item?.due}`);
  check('POST 返回的 done 是布尔 false，不是 0', item?.done === false, `done=${item?.done}`);
}

{
  const { json } = await call('GET', '/api/items');
  const found = json?.data?.some((i) => i.title === '验收脚本创建的条目');
  check('GET 里能查到刚创建的条目（列表与写入一致）', found);
}

{
  const id = created[0];
  const { status, json } = await call('PUT', `/api/items/${id}`, { done: true });
  check('PUT /api/items/:id 能改状态', status === 200 && json?.data?.done === true, `status=${status}`);
}

{
  const id = created[0];
  const { status, json } = await call('DELETE', `/api/items/${id}`);
  if (status === 200) created.shift();
  check('DELETE /api/items/:id 能删掉', status === 200 && json?.data?.id === id, `status=${status}`);
}

// 2. 校验：必须是 400，不能是 500
{
  const { status, json } = await call('POST', '/api/items', { due: '2026-01-01' });
  check('缺 title 返回 400（不是 500）', status === 400, `status=${status}`);
  check('缺 title 的报错说明了缺哪个字段', /title/.test(json?.msg || ''), `msg=${json?.msg}`);
}

{
  const { status } = await call('POST', '/api/items', { title: 123 });
  check('title 类型不对返回 400', status === 400, `status=${status}`);
}

{
  const { status } = await call('POST', '/api/items', { title: '' });
  check('title 是空字符串返回 400', status === 400, `status=${status}`);
}

{
  const { status } = await call('POST', '/api/items', { title: 'x'.repeat(200) });
  check('title 超长返回 400', status === 400, `status=${status}`);
}

{
  const { status } = await call('POST', '/api/items', { title: 'ok', due: '2026-02-30' });
  check('非法日期（2月30日）返回 400', status === 400, `status=${status}`);
}

{
  const { status } = await call('GET', '/api/items?done=9');
  check('query 参数 done 非法返回 400', status === 400, `status=${status}`);
}

// 3. 404 与错误格式
{
  const { status, json } = await call('DELETE', '/api/items/999999');
  check('删除不存在的条目返回 404', status === 404, `status=${status}`);
  check('404 也是统一 JSON 格式（不是 HTML）', isEnvelope(json));
}

{
  const { status, json } = await call('GET', '/api/not-exist');
  check('不存在的接口返回 404 + JSON', status === 404 && isEnvelope(json), `status=${status}`);
}

{
  const { status, json } = await call('GET', '/api/items?fail=1');
  check('演示开关 ?fail=1 返回 500 + JSON（用于截三态图）', status === 500 && isEnvelope(json), `status=${status}`);
}

// 4. 清理
for (const id of created) await call('DELETE', `/api/items/${id}`);

console.log('-'.repeat(60));
console.log(`${pass + fail} 项检查：${green(pass + ' PASS')}${fail ? '，' + red(fail + ' FAIL') : ''}`);
console.log('提示：重启服务后再跑一次 GET /api/items，能查到数据 → 说明落盘成功（任务2 最后一条验收）\n');

process.exit(fail ? 1 : 0);
