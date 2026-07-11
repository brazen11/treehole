const API = '/api';

let currentUser = null;

function getToken() {
  return localStorage.getItem('token');
}

function setToken(token) {
  localStorage.setItem('token', token);
}

function clearToken() {
  localStorage.removeItem('token');
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._hide);
  el._hide = setTimeout(() => el.classList.remove('show'), 2500);
}

async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API}${path}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

function initApp() {
  const token = getToken();
  if (token) {
    loadUserAndShowChat();
  } else {
    showLogin();
  }
}

async function loadUserAndShowChat() {
  try {
    currentUser = await apiFetch('/auth/me');
    showChatApp();
  } catch {
    clearToken();
    showLogin();
  }
}

function showLogin() {
  document.getElementById('app').innerHTML = renderLoginPage();
  bindLoginEvents();
}

function showRegister() {
  document.getElementById('app').innerHTML = renderRegisterPage();
  bindRegisterEvents();
}

function showChatApp() {
  document.getElementById('app').innerHTML = renderChatApp();
  initChatApp();
}

document.addEventListener('DOMContentLoaded', initApp);
