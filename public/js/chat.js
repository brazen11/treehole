let activeChatUserId = null;

function renderChatApp() {
  return `
    <div class="chat-app">
      <div class="sidebar">
        <div class="sidebar-header">
          <div class="user-info">
            <div class="avatar" style="background:#07C160">${currentUser.username.charAt(0).toUpperCase()}</div>
            <span class="username-text">${escapeHtml(currentUser.username)}</span>
          </div>
          <button class="btn btn-danger" id="logout-btn" style="padding:6px 12px;font-size:13px;border-radius:8px">退出</button>
        </div>

        <div class="search-box search-wrapper">
          <input type="text" id="search-input" placeholder="搜索用户..." autocomplete="off">
          <div class="search-results" id="search-results" style="display:none"></div>
        </div>

        <div class="conversation-list" id="conversation-list"></div>
      </div>

      <div class="chat-panel">
        <div class="chat-placeholder" id="chat-placeholder">
          <div class="placeholder-icon">💬</div>
          <p>选择一个对话开始聊天</p>
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
            <div class="typing-indicator" id="typing-indicator" style="display:none">
              <span></span><span></span><span></span>
            </div>
          </div>
          <div class="message-input-area">
            <input type="text" id="message-input" placeholder="输入消息..." autocomplete="off">
            <button class="btn-send" id="send-btn">发送</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

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

function initChatApp() {
  document.getElementById('my-username') && (document.getElementById('my-username').textContent = currentUser.username);
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('close-chat-btn').addEventListener('click', closeChat);
  document.getElementById('send-btn').addEventListener('click', sendMessage);
  document.getElementById('message-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  document.getElementById('message-input').addEventListener('input', handleTyping);
  document.getElementById('search-input').addEventListener('input', handleSearch);

  loadConversations();
}

function handleLogout() {
  disconnectSocket();
  clearToken();
  currentUser = null;
  activeChatUserId = null;
  showLogin();
}

function closeChat() {
  activeChatUserId = null;
  document.getElementById('chat-area').style.display = 'none';
  document.getElementById('chat-placeholder').style.display = 'flex';
  document.querySelectorAll('.conversation-item').forEach(el => el.classList.remove('active'));
}

async function loadConversations() {
  try {
    const conversations = await apiFetch('/conversations');
    renderConversations(conversations);
  } catch {
    // silently handle
  }
}

function renderConversations(conversations) {
  const list = document.getElementById('conversation-list');
  if (!conversations.length) {
    list.innerHTML = '<div style="padding:40px 20px;text-align:center;color:#999;font-size:14px">暂无对话<br>搜索用户开始聊天吧</div>';
    return;
  }

  list.innerHTML = conversations.map(c => {
    const isActive = activeChatUserId === c.other_user_id;
    return `
      <div class="conversation-item ${isActive ? 'active' : ''}" data-user-id="${c.other_user_id}">
        <div class="avatar">${getInitial(c.other_username)}</div>
        <div class="info">
          <div class="top-row">
            <span class="name">${escapeHtml(c.other_username)}</span>
            <span class="time">${c.last_message_time ? formatTime(c.last_message_time) : ''}</span>
          </div>
          <div class="preview">
            ${c.unread_count > 0 ? `<span class="unread-badge">${c.unread_count > 99 ? '99+' : c.unread_count}</span>` : ''}
            <span>${c.last_message ? escapeHtml(c.last_message) : '暂无消息'}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.conversation-item').forEach(el => {
    el.addEventListener('click', () => {
      const userId = parseInt(el.dataset.userId);
      openChat(userId);
    });
  });
}

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
      } else {
        results.innerHTML = users.map(u => `
          <div class="search-result-item" data-user-id="${u.id}">
            <div class="avatar">${getInitial(u.username)}</div>
            <div class="info">
              <div class="name">${escapeHtml(u.username)}</div>
              <div class="hint">点击开始聊天</div>
            </div>
          </div>
        `).join('');
        results.querySelectorAll('.search-result-item').forEach(el => {
          el.addEventListener('click', () => {
            document.getElementById('search-input').value = '';
            results.style.display = 'none';
            openChat(parseInt(el.dataset.userId));
          });
        });
      }
      results.style.display = 'block';
    } catch {
      results.style.display = 'none';
    }
  }, 300);
}

// Close search results on click outside
document.addEventListener('click', (e) => {
  const results = document.getElementById('search-results');
  if (results && !e.target.closest('.search-wrapper')) {
    results.style.display = 'none';
  }
});

async function openChat(userId) {
  activeChatUserId = userId;

  document.querySelectorAll('.conversation-item').forEach(el => {
    el.classList.toggle('active', parseInt(el.dataset.userId) === userId);
  });

  document.getElementById('chat-placeholder').style.display = 'none';
  document.getElementById('chat-area').style.display = 'flex';

  const partnerName = document.getElementById('partner-name');

  let user;
  try {
    user = await apiFetch(`/users/${userId}`);
  } catch {
    showToast('用户不存在');
    closeChat();
    return;
  }

  partnerName.textContent = user.username;
  document.getElementById('partner-avatar').textContent = getInitial(user.username);

  await loadMessages(userId);
}

async function loadMessages(otherUserId) {
  try {
    const messages = await apiFetch(`/conversations/${otherUserId}/messages`);
    renderMessages(messages);
    loadConversations();

    // Mark as read on server
    apiFetch(`/conversations/${otherUserId}/read`, { method: 'POST' }).catch(() => {});
  } catch {
    showToast('加载消息失败');
  }
}

function renderMessages(messages) {
  const list = document.getElementById('messages-list');
  if (!messages.length) {
    list.innerHTML = '<div style="text-align:center;color:#ccc;font-size:13px;padding:20px">开始你们的树洞对话吧</div>';
    return;
  }

  list.innerHTML = messages.map(m => {
    const isSent = m.senderId === currentUser.id;
    const name = isSent ? currentUser.username : (document.getElementById('partner-name')?.textContent || '用户');
    return `
      <div class="message ${isSent ? 'sent' : 'received'}">
        <div class="msg-avatar">${getInitial(name)}</div>
        <div>
          <div class="bubble">${escapeHtml(m.content)}</div>
          <div class="time-label">${formatTime(m.createdAt)}</div>
        </div>
      </div>
    `;
  }).join('');

  scrollToBottom();
}

function scrollToBottom() {
  const container = document.getElementById('messages-container');
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function sendMessage() {
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content || !activeChatUserId) return;

  if (!socket || !socket.connected) {
    showToast('连接已断开，请刷新页面');
    return;
  }

  socket.emit('send_message', { receiverId: activeChatUserId, content });
  input.value = '';
  document.getElementById('send-btn').disabled = true;

  setTimeout(() => {
    document.getElementById('send-btn').disabled = false;
  }, 5000);

  socket.emit('stop_typing', { receiverId: activeChatUserId });
}

function onMessageSent(msg) {
  document.getElementById('send-btn').disabled = false;
  appendMessage(msg);
  loadConversations();
}

function onNewMessage(msg) {
  if (msg.senderId === activeChatUserId) {
    appendMessage(msg);
    loadConversations();
    apiFetch(`/conversations/${msg.senderId}/read`, { method: 'POST' }).catch(() => {});
  } else {
    loadConversations();
    const el = document.querySelector(`.conversation-item[data-user-id="${msg.senderId}"] .name`);
    const name = el ? el.textContent : '有人';
    showToast(`${name} 发来一条消息`);
  }
}

function appendMessage(msg) {
  const list = document.getElementById('messages-list');
  const isSent = msg.senderId === currentUser.id;
  const name = isSent ? currentUser.username : (document.getElementById('partner-name')?.textContent || '用户');

  // Remove empty state if present
  const empty = list.querySelector('div[style*="text-align:center"]');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `message ${isSent ? 'sent' : 'received'}`;
  div.innerHTML = `
    <div class="msg-avatar">${getInitial(name)}</div>
    <div>
      <div class="bubble">${escapeHtml(msg.content)}</div>
      <div class="time-label">${formatTime(msg.createdAt)}</div>
    </div>
  `;
  list.appendChild(div);
  scrollToBottom();
}

let typingTimer = null;

function handleTyping() {
  if (!activeChatUserId) return;
  if (!socket || !socket.connected) return;

  socket.emit('typing', { receiverId: activeChatUserId });

  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit('stop_typing', { receiverId: activeChatUserId });
  }, 2000);
}

function onUserTyping(userId) {
  if (userId === activeChatUserId) {
    document.getElementById('typing-indicator').style.display = 'flex';
    scrollToBottom();
  }
}

function onUserStoppedTyping(userId) {
  if (userId === activeChatUserId) {
    document.getElementById('typing-indicator').style.display = 'none';
  }
}
