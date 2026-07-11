let activeTab = 'contacts';
let activeChatUserId = null;
let selectedIds = new Set();
let friendList = [];
let newMsgCounts = {};
let pollTimer = null;

const DELAY_OPTIONS = [
  { label: '立即发送', value: 0 },
  { label: '30分钟', value: 0.5 },
  { label: '1小时', value: 1 },
  { label: '2小时', value: 2 },
  { label: '3小时', value: 3 },
  { label: '6小时', value: 6 },
  { label: '12小时', value: 12 },
  { label: '1天', value: 24 },
  { label: '2天', value: 48 },
  { label: '3天', value: 72 },
  { label: '5天', value: 120 },
  { label: '7天', value: 168 },
];

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return `${hours}:${mins}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hours}:${mins}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hours}:${mins}`;
}

function getInitial(name) {
  return name.charAt(0).toUpperCase();
}

function renderChatApp() {
  return `
    <div class="chat-app">
      <div class="sidebar">
        <div class="sidebar-header">
          <div class="user-info">
            <div class="avatar" style="background:#07C160">${getInitial(currentUser.username)}</div>
            <span class="username-text">${escapeHtml(currentUser.username)}</span>
          </div>
          <button class="btn btn-danger" id="logout-btn" style="padding:6px 12px;font-size:13px;border-radius:8px">退出</button>
        </div>

        <div class="tabs">
          <div class="tab ${activeTab === 'contacts' ? 'active' : ''}" data-tab="contacts">
            联系人
          </div>
          <div class="tab ${activeTab === 'chats' ? 'active' : ''}" data-tab="chats">
            消息 <span id="new-msg-badge" style="display:none"></span>
          </div>
        </div>

        <div class="search-box search-wrapper" id="search-wrapper" ${activeTab !== 'contacts' ? 'style="display:none"' : ''}>
          <input type="text" id="search-input" placeholder="搜索邮箱或用户名..." autocomplete="off">
          <div class="search-results" id="search-results" style="display:none"></div>
        </div>

        <div class="sidebar-body" id="sidebar-body"></div>
      </div>

      <div class="chat-panel">
        <div class="chat-placeholder" id="chat-placeholder">
          <div class="placeholder-icon">🌳</div>
          <p>选择一个好友开始写信</p>
        </div>

        <div class="chat-area" id="chat-area" style="display:none">
          <div class="chat-header">
            <div class="chat-partner">
              <div class="avatar" id="partner-avatar">?</div>
              <span class="name" id="partner-name">用户</span>
            </div>
            <button class="close-chat" id="close-chat-btn">✕</button>
          </div>
          <div class="messages-container" id="messages-container">
            <div class="messages-list" id="messages-list"></div>
          </div>
          <div class="delay-bar" id="delay-bar" style="display:none">
            <span class="delay-bar-text">已选择 <span id="selected-count">0</span> 条</span>
            <div class="delay-options" id="delay-options">
              ${DELAY_OPTIONS.map(o => `<button class="delay-btn" data-hours="${o.value}">${o.label}</button>`).join('')}
            </div>
          </div>
          <div class="message-input-area">
            <input type="text" id="message-input" placeholder="输入草稿内容..." autocomplete="off">
            <button class="btn btn-secondary" id="add-draft-btn" style="padding:10px 16px;font-size:13px;border-radius:20px;flex-shrink:0">+ 添加草稿</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function initChatApp() {
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('close-chat-btn').addEventListener('click', closeChat);
  document.getElementById('add-draft-btn').addEventListener('click', addDraft);
  document.getElementById('message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addDraft();
    }
  });
  document.getElementById('search-input')?.addEventListener('input', handleSearch);

  document.querySelectorAll('.tab').forEach(el => {
    el.addEventListener('click', () => switchTab(el.dataset.tab));
  });

  selectedIds = new Set();
  loadContacts();
  loadNewDelivered();
  pollTimer = setInterval(loadNewDelivered, 15000);
}

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.getElementById('search-wrapper').style.display = tab === 'contacts' ? 'block' : 'none';
  if (tab === 'contacts') loadContacts();
  else loadChats();
}

function handleLogout() {
  clearInterval(pollTimer);
  clearToken();
  currentUser = null;
  activeChatUserId = null;
  showLogin();
}

function closeChat() {
  activeChatUserId = null;
  selectedIds = new Set();
  document.getElementById('chat-area').style.display = 'none';
  document.getElementById('chat-placeholder').style.display = 'flex';
  document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
}

// ===== Contacts Tab =====
async function loadContacts() {
  const body = document.getElementById('sidebar-body');
  body.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:14px">加载中...</div>';

  try {
    const [friends, pendingReceived] = await Promise.all([
      apiFetch('/friends/list'),
      apiFetch('/friends/requests/received'),
    ]);
    friendList = friends;

    let html = '';

    // Pending friend requests received
    if (pendingReceived.length) {
      html += '<div class="section-label">好友请求</div>';
      html += pendingReceived.map(r => `
        <div class="sidebar-item request-item">
          <div class="avatar">${getInitial(r.username)}</div>
          <div class="info">
            <div class="name">${escapeHtml(r.username)}</div>
            <div class="hint">请求加你为好友</div>
          </div>
          <div class="actions">
            <button class="btn btn-primary accept-btn" data-request-id="${r.id}" style="padding:6px 14px;font-size:12px;border-radius:8px">同意</button>
            <button class="btn reject-btn" data-request-id="${r.id}" style="padding:6px 14px;font-size:12px;border-radius:8px;background:transparent;color:#999;border:1px solid #e8e8e8">拒绝</button>
          </div>
        </div>
      `).join('');
    }

    // Friends list
    html += '<div class="section-label">我的联系人</div>';
    if (!friends.length) {
      html += '<div style="padding:40px 20px;text-align:center;color:#999;font-size:14px">暂无联系人<br>搜索用户添加好友吧</div>';
    } else {
      html += friends.map(f => {
        const newCount = newMsgCounts[f.id] || 0;
        return `
          <div class="sidebar-item" data-user-id="${f.id}">
            <div class="avatar">${getInitial(f.username)}</div>
            <div class="info">
              <div class="name">${escapeHtml(f.username)}</div>
              <div class="hint">${escapeHtml(f.email)}</div>
            </div>
            ${newCount > 0 ? `<span class="unread-badge">${newCount}</span>` : ''}
          </div>
        `;
      }).join('');
    }

    body.innerHTML = html;

    body.querySelectorAll('.sidebar-item:not(.request-item)').forEach(el => {
      el.addEventListener('click', () => {
        const userId = parseInt(el.dataset.userId);
        openChat(userId);
      });
    });

    body.querySelectorAll('.accept-btn').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await apiFetch('/friends/respond', {
            method: 'POST',
            body: JSON.stringify({ requestId: parseInt(el.dataset.requestId), action: 'accept' }),
          });
          showToast('已同意好友请求');
          loadContacts();
        } catch (err) {
          showToast(err.message);
        }
      });
    });

    body.querySelectorAll('.reject-btn').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await apiFetch('/friends/respond', {
            method: 'POST',
            body: JSON.stringify({ requestId: parseInt(el.dataset.requestId), action: 'reject' }),
          });
          showToast('已拒绝');
          loadContacts();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  } catch (err) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:#999">加载失败</div>';
  }
}

// ===== Search =====
let searchTimeout = null;

function handleSearch() {
  clearTimeout(searchTimeout);
  const q = document.getElementById('search-input').value.trim();
  const results = document.getElementById('search-results');

  if (!q) {
    results.style.display = 'none';
    return;
  }

  searchTimeout = setTimeout(async () => {
    try {
      const users = await apiFetch(`/users/search?q=${encodeURIComponent(q)}`);
      if (!users.length) {
        results.innerHTML = '<div style="padding:16px;text-align:center;color:#999;font-size:13px">未找到用户</div>';
        results.style.display = 'block';
        return;
      }

      results.innerHTML = users.map(u => {
        const isFriend = friendList.some(f => f.id === u.id);
        return `
          <div class="search-result-item" data-user-id="${u.id}">
            <div class="avatar">${getInitial(u.username)}</div>
            <div class="info">
              <div class="name">${escapeHtml(u.username)}</div>
              <div class="hint">${escapeHtml(u.email)}</div>
            </div>
            ${isFriend ? '<span class="friend-tag">好友</span>' : `<button class="add-friend-btn" data-user-id="${u.id}">+ 加好友</button>`}
          </div>
        `;
      }).join('');

      results.querySelectorAll('.add-friend-btn').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await apiFetch('/friends/request', {
              method: 'POST',
              body: JSON.stringify({ receiverId: parseInt(el.dataset.userId) }),
            });
            showToast('好友请求已发送');
            el.textContent = '已发送';
            el.disabled = true;
          } catch (err) {
            showToast(err.message);
          }
        });
      });

      results.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', () => {
          const userId = parseInt(el.dataset.userId);
          const isFriend = friendList.some(f => f.id === userId);
          if (isFriend) {
            document.getElementById('search-input').value = '';
            results.style.display = 'none';
            openChat(userId);
          }
        });
      });

      results.style.display = 'block';
    } catch {
      results.style.display = 'none';
    }
  }, 300);
}

document.addEventListener('click', (e) => {
  const results = document.getElementById('search-results');
  if (results && !e.target.closest('.search-wrapper')) {
    results.style.display = 'none';
  }
});

// ===== Chats Tab =====
function loadChats() {
  const body = document.getElementById('sidebar-body');
  body.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:14px">加载中...</div>';

  try {
    const delivered = [];
    for (const friend of friendList) {
      const count = newMsgCounts[friend.id] || 0;
      if (count > 0) delivered.push(friend);
    }

    if (!delivered.length) {
      body.innerHTML = '<div style="padding:40px 20px;text-align:center;color:#999;font-size:14px">暂无新消息</div>';
      return;
    }

    body.innerHTML = delivered.map(f => `
      <div class="sidebar-item" data-user-id="${f.id}">
        <div class="avatar">${getInitial(f.username)}</div>
        <div class="info">
          <div class="name">${escapeHtml(f.username)}</div>
          <div class="hint">有新消息</div>
        </div>
        <span class="unread-badge">${newMsgCounts[f.id]}</span>
      </div>
    `).join('');

    body.querySelectorAll('.sidebar-item').forEach(el => {
      el.addEventListener('click', () => {
        const userId = parseInt(el.dataset.userId);
        switchTab('contacts');
        openChat(userId);
      });
    });
  } catch {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:#999">加载失败</div>';
  }
}

// ===== New Message Polling =====
async function loadNewDelivered() {
  try {
    const counts = await apiFetch('/messages/new');
    newMsgCounts = {};
    let total = 0;
    for (const c of counts) {
      newMsgCounts[c.senderId] = c.count;
      total += c.count;
    }

    // Update badge
    const badge = document.getElementById('new-msg-badge');
    if (total > 0) {
      badge.textContent = total;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }

    // Update contacts list if visible
    if (activeTab === 'contacts') {
      const body = document.getElementById('sidebar-body');
      body.querySelectorAll('.sidebar-item').forEach(el => {
        const userId = parseInt(el.dataset.userId);
        const count = newMsgCounts[userId] || 0;
        const existing = el.querySelector('.unread-badge');
        if (count > 0) {
          if (existing) existing.textContent = count;
          else el.insertAdjacentHTML('beforeend', `<span class="unread-badge">${count}</span>`);
        } else if (existing) {
          existing.remove();
        }
      });
    }
  } catch {
    // silent
  }
}

// ===== Chat / Message System =====
async function openChat(userId) {
  activeChatUserId = userId;
  selectedIds = new Set();
  document.getElementById('delay-bar').style.display = 'none';

  document.querySelectorAll('.sidebar-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.userId) === userId);
  });

  document.getElementById('chat-placeholder').style.display = 'none';
  document.getElementById('chat-area').style.display = 'flex';

  try {
    const user = await apiFetch(`/users/${userId}`);
    document.getElementById('partner-name').textContent = user.username;
    document.getElementById('partner-avatar').textContent = getInitial(user.username);

    const [drafts, delivered] = await Promise.all([
      apiFetch(`/messages/drafts/${userId}`),
      apiFetch(`/messages/delivered/${userId}`),
    ]);

    renderMessages(drafts, delivered);

    // Reset new badge for this user
    if (newMsgCounts[userId]) {
      delete newMsgCounts[userId];
      loadNewDelivered();
    }
  } catch (err) {
    showToast('加载失败');
    closeChat();
  }
}

function renderMessages(drafts, delivered) {
  const list = document.getElementById('messages-list');

  const all = [
    ...drafts.map(d => ({ ...d, _type: 'draft' })),
    ...delivered.map(d => ({ ...d, _type: 'delivered' })),
  ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  if (!all.length) {
    list.innerHTML = '<div style="text-align:center;color:#ccc;font-size:13px;padding:40px 20px">写一封树洞信吧</div>';
    return;
  }

  list.innerHTML = all.map(m => {
    const isSent = m.senderId === currentUser.id;
    const name = isSent ? currentUser.username : (document.getElementById('partner-name')?.textContent || '用户');

    if (m._type === 'delivered') {
      // Delivered messages (only sender name shown for sent ones)
      return `
        <div class="message ${isSent ? 'sent' : 'received'}">
          <div class="msg-avatar">${getInitial(name)}</div>
          <div>
            <div class="bubble">
              ${m.status === 'delivered' && !isSent ? '<div class="delivery-tag">📬 新消息</div>' : ''}
              ${escapeHtml(m.content)}
            </div>
            <div class="time-label">${formatTime(m.deliveredAt || m.createdAt)}</div>
          </div>
        </div>
      `;
    }

    // Drafts: show checkbox for selection
    const checked = selectedIds.has(m.id) ? 'checked' : '';
    const statusLabel = m.status === 'scheduled'
      ? `<div class="status-tag">⏰ 将在 ${formatTime(m.sendAt)} 发送</div>`
      : '';

    return `
      <div class="message sent draft-msg">
        <div class="msg-avatar">${getInitial(name)}</div>
        <div>
          <div class="bubble">
            <label class="draft-checkbox" style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" class="msg-checkbox" data-msg-id="${m.id}" ${checked} ${m.status !== 'draft' ? 'disabled' : ''}>
              <span>${escapeHtml(m.content)}</span>
            </label>
          </div>
          <div class="time-label">
            ${formatTime(m.createdAt)}
            ${statusLabel}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Bind checkbox events
  list.querySelectorAll('.msg-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const msgId = parseInt(cb.dataset.msgId);
      if (cb.checked) selectedIds.add(msgId);
      else selectedIds.delete(msgId);
      updateDelayBar();
    });
  });

  scrollToBottom();
}

function updateDelayBar() {
  const bar = document.getElementById('delay-bar');
  const count = selectedIds.size;
  document.getElementById('selected-count').textContent = count;
  bar.style.display = count > 0 ? 'flex' : 'none';

  document.querySelectorAll('.delay-btn').forEach(btn => {
    btn.onclick = async () => {
      const hours = parseInt(btn.dataset.hours);
      btn.disabled = true;
      btn.textContent = '处理中...';
      try {
        await apiFetch('/messages/schedule', {
          method: 'POST',
          body: JSON.stringify({
            messageIds: Array.from(selectedIds),
            delayHours: hours,
            receiverId: activeChatUserId,
          }),
        });
        showToast(`已定时，${DELAY_OPTIONS.find(o => o.value === hours).label}后送达`);
        selectedIds = new Set();
        bar.style.display = 'none';
        // Reload
        const [drafts] = await Promise.all([
          apiFetch(`/messages/drafts/${activeChatUserId}`),
        ]);
        renderMessages(drafts, []);
      } catch (err) {
        showToast(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = DELAY_OPTIONS.find(o => o.value === hours).label;
      }
    };
  });
}

async function addDraft() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content || !activeChatUserId) return;

  try {
    const msg = await apiFetch('/messages/draft', {
      method: 'POST',
      body: JSON.stringify({ receiverId: activeChatUserId, content }),
    });
    input.value = '';
    // Reload messages
    const drafts = await apiFetch(`/messages/drafts/${activeChatUserId}`);
    renderMessages(drafts, []);
    showToast('草稿已添加');
  } catch (err) {
    showToast(err.message);
  }
}

function scrollToBottom() {
  const container = document.getElementById('messages-container');
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}
