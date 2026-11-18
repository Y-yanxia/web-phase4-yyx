// ============================================================
// app.js —— 前端全部逻辑，原生 JS，没有框架
//
// 结构：
//   1. 工具函数
//   2. 路由（hash 三个视图互相跳转）
//   3. 清单：三态渲染 + 增删改查
//   4. AI 助手：读 SSE + 工具调用卡片
//   5. 关于页
//
// 【讲解点 E】清单的三态不是三个 if 各自改 DOM，而是一个 status 驱动一次渲染。
//   改状态 → 重新渲染，永远不会出现"骨架屏和列表同时存在"这种脏状态。
// ============================================================

(() => {
  'use strict';

  // ---------- 1. 工具函数 ----------

  /** API 前缀：空 = 同源；填了 = 跨域（config.js 里改） */
  const API_BASE = (window.APP_CONFIG?.API_BASE || '').replace(/\/+$/, '');
  const apiUrl = (path) => `${API_BASE}${path}`;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /** 转义：所有用户输入拼进 innerHTML 前必须过一遍，防 XSS */
  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);

  const todayString = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };

  /** 统一请求：所有接口都返回 {code,data,msg}，这里只把 data 交出去 */
  async function request(path, { method = 'GET', body } = {}) {
    const res = await fetch(apiUrl(path), {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* 服务端没返回 JSON（比如网关 502 的 HTML 页） */
    }

    if (!res.ok || !payload || payload.code !== 0) {
      const error = new Error(payload?.msg || `请求失败（HTTP ${res.status}）`);
      error.status = res.status;
      error.code = payload?.code;
      throw error;
    }
    return payload.data;
  }

  // ---------- Toast ----------

  const toastEl = $('#toast');
  let toastTimer = null;

  function toast(message, type = 'ok') {
    toastEl.textContent = message;
    toastEl.classList.toggle('is-error', type === 'error');
    toastEl.hidden = false;
    // 下一帧再加 class，才有过渡动画
    requestAnimationFrame(() => toastEl.classList.add('is-show'));

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('is-show');
      setTimeout(() => {
        toastEl.hidden = true;
      }, 220);
    }, 2400);
  }

  // ---------- 2. 路由 ----------

  const ROUTES = ['list', 'chat', 'about'];

  function currentRoute() {
    const raw = location.hash.replace(/^#\/?/, '').replace(/\/$/, '');
    return ROUTES.includes(raw) ? raw : 'list';
  }

  function applyRoute() {
    const route = currentRoute();

    for (const name of ROUTES) {
      $(`#view-${name}`).hidden = name !== route;
    }
    for (const tab of $$('.tab')) {
      if (tab.dataset.tab === route) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }

    if (route === 'list') loadItems();
    if (route === 'about') loadStats();
    if (route === 'chat') $('#chat-input').focus({ preventScroll: true });

    window.scrollTo(0, 0);
  }

  // 三个视图靠 hash 互相跳转：点导航改 hash → 浏览器发 hashchange → 重新渲染
  // 少了这一行，Tab 点下去地址变了但页面不动（踩过一次，被 jsdom 测出来的）
  window.addEventListener('hashchange', applyRoute);

  // ============================================================
  // 3. 清单
  // ============================================================

  const listArea = $('#list-area');
  const countEl = $('#count');
  const addForm = $('#add-form');
  const titleInput = $('#title');
  const dueInput = $('#due');
  const submitBtn = $('#submit-btn');
  const titleError = $('#title-error');

  /** 单一状态源：status 决定渲染哪一态 */
  const listState = {
    status: 'idle', // idle | loading | ok | error
    items: [],
    error: '',
    filter: 'all', // all | open | done
    failDemo: sessionStorage.getItem('todo:fail') === '1',
  };

  function renderList() {
    listArea.setAttribute('aria-busy', String(listState.status === 'loading'));

    if (listState.status === 'loading') {
      listArea.innerHTML = Array.from({ length: 3 })
        .map(
          () => `<div class="skeleton-row">
                   <div class="sk sk-box"></div>
                   <div class="sk sk-line"></div>
                 </div>`
        )
        .join('');
      countEl.textContent = '加载中…';
      return;
    }

    if (listState.status === 'error') {
      listArea.innerHTML = `
        <div class="state state-error">
          <svg class="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
            <circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16.2v.1" stroke-linecap="round"></path>
          </svg>
          <p class="state-title">列表没加载出来</p>
          <p class="state-desc">${esc(listState.error)}</p>
          <button class="btn btn-ghost btn-small" type="button" data-action="retry">重试</button>
        </div>`;
      countEl.textContent = '加载失败';
      return;
    }

    if (listState.status === 'ok' && listState.items.length === 0) {
      const filtered = listState.filter !== 'all';
      listArea.innerHTML = `
        <div class="state">
          <svg class="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
            <rect x="4" y="3.5" width="16" height="17" rx="2.5"></rect>
            <path d="M8.5 9.5h7M8.5 13.5h7M8.5 17.5h4" stroke-linecap="round"></path>
          </svg>
          <p class="state-title">${filtered ? '这个筛选下没有任务' : '还没有任何任务'}</p>
          <p class="state-desc">${
            filtered
              ? '换个筛选条件看看，或者新加一条。'
              : '上面输入框写一句「明天交实验报告」，或者去 AI 助手说一句话。'
          }</p>
          ${filtered ? '' : '<button class="btn btn-ghost btn-small" type="button" data-action="focus-add">加第一条</button>'}
        </div>`;
      countEl.textContent = '0 条';
      return;
    }

    if (listState.status === 'ok') {
      const items = listState.items;
      const today = todayString();

      listArea.innerHTML = `<ul class="item-list">${items
        .map((item) => {
          const overdue = item.due && !item.done && item.due < today;
          return `
            <li class="item ${item.done ? 'is-done' : ''}" data-id="${item.id}">
              <button
                class="check"
                type="button"
                role="checkbox"
                aria-checked="${item.done}"
                aria-label="${item.done ? '标记为未完成' : '标记为已完成'}：${esc(item.title)}"
                data-action="toggle"
                data-id="${item.id}"
              ></button>
              <div class="item-body">
                <span class="item-title">${esc(item.title)}</span>
                <p class="item-meta">
                  ${item.due ? `<span class="due ${overdue ? 'is-overdue' : ''}">${overdue ? '已逾期 ' : ''}${esc(item.due)}</span>` : ''}
                  <span>#${item.id}</span>
                </p>
              </div>
              <button class="del" type="button" data-action="delete" data-id="${item.id}" aria-label="删除：${esc(item.title)}">删除</button>
            </li>`;
        })
        .join('')}</ul>`;

      const openCount = items.filter((i) => !i.done).length;
      countEl.textContent = `${items.length} 条 · 未完 ${openCount}`;
      return;
    }

    countEl.textContent = '';
  }

  /** 拉列表。silent=true 时不显示骨架屏（用于增删后的静默刷新） */
  async function loadItems({ silent = false } = {}) {
    if (!silent) {
      listState.status = 'loading';
      renderList();
    }

    const qs = new URLSearchParams();
    if (listState.filter === 'open') qs.set('done', '0');
    if (listState.filter === 'done') qs.set('done', '1');
    if (listState.failDemo) qs.set('fail', '1');

    const query = qs.toString();

    try {
      const data = await request(`/api/items${query ? `?${query}` : ''}`);
      listState.items = Array.isArray(data) ? data : [];
      listState.status = 'ok';
      listState.error = '';
    } catch (err) {
      listState.status = 'error';
      listState.error = err.message;
    }
    renderList();
  }

  // ---------- 表单校验 ----------

  function showTitleError(message) {
    titleError.textContent = message;
    titleError.hidden = false;
    titleInput.classList.add('is-invalid');
    titleInput.setAttribute('aria-invalid', 'true');
    titleInput.focus();
  }

  function clearTitleError() {
    titleError.hidden = true;
    titleError.textContent = '';
    titleInput.classList.remove('is-invalid');
    titleInput.removeAttribute('aria-invalid');
  }

  /** 返回错误文案，没问题返回空字符串 */
  function validateTitle(raw) {
    const title = raw.trim();
    if (!title) return '先写点东西再点「加入清单」';
    if (title.length > 120) return `太长了，最多 120 个字符（现在 ${title.length}）`;
    const dup = listState.items.some((i) => !i.done && i.title.trim() === title);
    if (dup) return '清单里已经有一条一模一样的未完成任务了';
    return '';
  }

  titleInput.addEventListener('input', () => {
    if (!titleError.hidden) clearTitleError();
  });

  // ---------- 新增 ----------

  addForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const title = titleInput.value.trim();
    const problem = validateTitle(title);
    if (problem) {
      showTitleError(problem);
      return;
    }
    clearTitleError();

    submitBtn.disabled = true;
    submitBtn.textContent = '加入中…';

    try {
      await request('/api/items', {
        method: 'POST',
        body: { title, due: dueInput.value || undefined },
      });

      titleInput.value = '';
      dueInput.value = '';
      // 如果当前停在「已完成」筛选，新加的任务会看不见，自动切回全部
      if (listState.filter === 'done') setFilter('all', { reload: false });

      toast('已加入清单');
      await loadItems({ silent: true });
    } catch (err) {
      showTitleError(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '加入清单';
    }
  });

  // ---------- 筛选 ----------

  function setFilter(filter, { reload = true } = {}) {
    listState.filter = filter;
    for (const chip of $$('.chip')) {
      chip.classList.toggle('is-active', chip.dataset.filter === filter);
    }
    if (reload) loadItems();
  }

  for (const chip of $$('.chip')) {
    chip.addEventListener('click', () => setFilter(chip.dataset.filter));
  }

  // ---------- 勾选 / 删除（事件委托，列表重渲染后依然有效） ----------

  let armedDelete = { id: null, timer: null };

  function disarmDelete(button) {
    clearTimeout(armedDelete.timer);
    armedDelete = { id: null, timer: null };
    if (button) {
      button.classList.remove('is-confirm');
      button.textContent = '删除';
    }
  }

  async function toggleItem(button) {
    const id = Number(button.dataset.id);
    const item = listState.items.find((i) => i.id === id);
    if (!item) return;

    const next = !item.done;

    // 乐观更新：先改界面，失败再回滚。体验比转圈好，但要记得回滚
    item.done = next;
    renderList();

    try {
      await request(`/api/items/${id}`, { method: 'PUT', body: { done: next } });
      await loadItems({ silent: true });
    } catch (err) {
      item.done = !next;
      renderList();
      toast(err.message, 'error');
    }
  }

  async function deleteItem(button) {
    const id = Number(button.dataset.id);
    button.disabled = true;
    button.textContent = '删除中';

    try {
      await request(`/api/items/${id}`, { method: 'DELETE' });
      toast('已删除');
      await loadItems({ silent: true });
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
      button.textContent = '删除';
    }
  }

  listArea.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const action = button.dataset.action;

    if (action === 'retry') {
      loadItems();
      return;
    }
    if (action === 'focus-add') {
      titleInput.focus();
      return;
    }
    if (action === 'toggle') {
      toggleItem(button);
      return;
    }
    if (action === 'delete') {
      const id = Number(button.dataset.id);
      // 第一次点：变成「确认？」，3 秒内再点才真删
      if (armedDelete.id !== id) {
        disarmDelete($('.del.is-confirm'));
        armedDelete.id = id;
        button.classList.add('is-confirm');
        button.textContent = '确认?';
        armedDelete.timer = setTimeout(() => disarmDelete(button), 3000);
        return;
      }
      disarmDelete(button);
      deleteItem(button);
    }
  });

  // ============================================================
  // 4. AI 助手
  // ============================================================

  const chatLog = $('#chat-log');
  const chatForm = $('#chat-form');
  const chatInput = $('#chat-input');
  const sendBtn = $('#send-btn');
  const stopBtn = $('#stop-btn');
  const toolBadge = $('#tool-badge');

  const chatState = {
    busy: false,
    controller: null,
    toolCount: 0,
    // 会话 id 只放内存：刷新即新会话，不污染 localStorage
    sessionId: `sess-${Math.random().toString(36).slice(2, 10)}`,
  };

  function scrollChatToBottom() {
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  /** 新增一条消息，返回可操作的节点 */
  function appendMessage(role, text = '') {
    const wrap = document.createElement('div');
    wrap.className = `msg msg-${role}`;

    const toolStack = document.createElement('div');
    toolStack.className = 'tool-stack';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;

    wrap.append(toolStack, bubble);
    chatLog.appendChild(wrap);
    scrollChatToBottom();

    return { wrap, bubble, toolStack };
  }

  /** 工具调用卡片：任务书要的「能看到调了哪个工具、传了什么参数」 */
  function createToolCard(name, args) {
    const card = document.createElement('div');
    card.className = 'tool-card';

    const head = document.createElement('div');
    head.className = 'tool-head';
    head.innerHTML = `<span aria-hidden="true">🔧</span><code>${esc(name)}</code><span class="tool-status">调用中…</span>`;

    const argsBody = document.createElement('pre');
    argsBody.className = 'tool-body';
    argsBody.textContent = `参数 ${JSON.stringify(args ?? {}, null, 2)}`;

    card.append(head, argsBody);
    return card;
  }

  function finishToolCard(card, result) {
    if (!card) return;
    const status = card.querySelector('.tool-status');
    const ok = result?.ok !== false;
    card.classList.add(ok ? 'is-ok' : 'is-error');
    if (status) status.textContent = ok ? '成功' : '失败';

    const body = document.createElement('pre');
    body.className = 'tool-body';
    const text = JSON.stringify(result, null, 2);
    body.textContent = `结果 ${text.length > 600 ? `${text.slice(0, 600)}\n…（已截断）` : text}`;
    card.appendChild(body);
  }

  function setChatBusy(busy) {
    chatState.busy = busy;
    // 「发送」和「停止」互斥显示：同时出现两个按钮在小屏上会挤成一团
    sendBtn.hidden = busy;
    stopBtn.hidden = !busy;
    chatInput.disabled = false; // 保持可输入，只是发不出去
  }

  /** 解析一帧 SSE（event: xxx \n data: {...}） */
  function parseFrame(raw) {
    let event = 'message';
    const dataLines = [];

    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return null;

    try {
      return { event, data: JSON.parse(dataLines.join('\n')) };
    } catch {
      return { event, data: {} };
    }
  }

  async function readSSE(body, onEvent) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let splitAt;
      while ((splitAt = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, splitAt);
        buffer = buffer.slice(splitAt + 2);
        const frame = parseFrame(raw);
        if (frame) onEvent(frame);
      }
    }
    // 服务端最后一帧可能没有以空行结尾
    if (buffer.trim()) {
      const frame = parseFrame(buffer);
      if (frame) onEvent(frame);
    }
  }

  async function sendMessage(text) {
    if (chatState.busy) return;

    appendMessage('user', text);
    const { wrap, bubble, toolStack } = appendMessage('assistant', '');
    bubble.classList.add('is-typing');

    chatState.toolCount = 0;
    toolBadge.hidden = true;
    setChatBusy(true);

    const controller = new AbortController();
    chatState.controller = controller;

    let lastToolCard = null;

    const handleEvent = ({ event, data }) => {
      if (event === 'delta') {
        bubble.textContent += data.text || '';
        scrollChatToBottom();
        return;
      }

      if (event === 'tool') {
        if (data.phase === 'call') {
          lastToolCard = createToolCard(data.name, data.args);
          toolStack.appendChild(lastToolCard);
          chatState.toolCount += 1;
          toolBadge.hidden = false;
          toolBadge.textContent = `已调用 ${chatState.toolCount} 个工具`;
          scrollChatToBottom();
        } else if (data.phase === 'result') {
          finishToolCard(lastToolCard, data.result);
          scrollChatToBottom();
        }
        return;
      }

      if (event === 'final') {
        // 最终文本以服务端为准，防止流式拼接有缺字
        bubble.textContent = data.text || bubble.textContent;
        return;
      }

      if (event === 'error') {
        bubble.classList.remove('is-typing');
        wrap.classList.add('error');
        bubble.textContent = data.msg || '出错了，请重试';
        return;
      }
    };

    try {
      const res = await fetch(apiUrl('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: chatState.sessionId, message: text }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let msg = `请求失败（HTTP ${res.status}）`;
        try {
          const payload = await res.json();
          msg = payload?.msg || msg;
        } catch {
          /* 忽略 */
        }
        throw new Error(msg);
      }

      await readSSE(res.body, handleEvent);
    } catch (err) {
      bubble.classList.remove('is-typing');
      if (err.name === 'AbortError') {
        if (!bubble.textContent) bubble.textContent = '（已停止生成）';
        else bubble.textContent += '\n（已停止生成）';
      } else {
        wrap.classList.add('error');
        bubble.textContent = err.message || '网络异常，请重试';
      }
    } finally {
      bubble.classList.remove('is-typing');
      setChatBusy(false);
      chatState.controller = null;
      scrollChatToBottom();
      chatInput.focus({ preventScroll: true });
    }
  }

  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    if (chatState.busy) {
      toast('上一条还在生成，先点停止', 'error');
      return;
    }
    chatInput.value = '';
    chatInput.style.height = '';
    sendMessage(text);
  });

  stopBtn.addEventListener('click', () => {
    chatState.controller?.abort();
  });

  // Enter 发送，Shift+Enter 换行
  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      chatForm.requestSubmit();
    }
  });

  // 输入框随内容长高，最多 120px
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 120)}px`;
  });

  // ============================================================
  // 5. 关于页
  // ============================================================

  const statNodes = {
    total: $('#stat-total'),
    open: $('#stat-open'),
    done: $('#stat-done'),
  };

  async function loadStats() {
    try {
      const s = await request('/api/stats');
      statNodes.total.textContent = s.total;
      statNodes.open.textContent = s.open;
      statNodes.done.textContent = s.done;
    } catch {
      statNodes.total.textContent = '–';
      statNodes.open.textContent = '–';
      statNodes.done.textContent = '–';
    }
  }

  const failToggle = $('#fail-toggle');
  failToggle.checked = listState.failDemo;
  failToggle.addEventListener('change', () => {
    listState.failDemo = failToggle.checked;
    sessionStorage.setItem('todo:fail', failToggle.checked ? '1' : '0');
    toast(failToggle.checked ? '已开启：列表接口会返回 500' : '已关闭演示开关');
    if (failToggle.checked) location.hash = '#/list';
    else loadItems({ silent: true });
  });

  // ============================================================
  // 6. 启动
  // ============================================================

  applyRoute();

  // 暴露一点点东西方便在控制台演示（答辩时可以现场敲）
  window.todoApp = {
    reload: loadItems,
    stats: loadStats,
    state: listState,
  };
})();
