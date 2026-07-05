function renderLoginPage() {
  return `
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-header">
          <div class="auth-logo">🌳</div>
          <h1>树洞</h1>
          <p>说出你的秘密</p>
        </div>
        <form id="login-form">
          <div class="form-group">
            <input type="text" id="login-account" placeholder="邮箱 / 用户名" autocomplete="username">
          </div>
          <div class="form-group">
            <input type="password" id="login-password" placeholder="密码" autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary" id="login-btn">登录</button>
        </form>
        <div class="auth-footer">没有账号？<a href="#" id="go-to-register">立即注册</a></div>
      </div>
    </div>
  `;
}

function renderRegisterPage() {
  return `
    <div class="auth-container">
      <div class="auth-card">
        <div class="auth-header">
          <div class="auth-logo">🌳</div>
          <h1>注册树洞</h1>
          <p>创建一个新账号</p>
        </div>

        <div id="register-step-1">
          <div class="form-group">
            <input type="email" id="reg-email" placeholder="邮箱地址" autocomplete="email">
          </div>
          <div class="code-row">
            <div class="form-group" style="flex:1;margin:0">
              <input type="text" id="reg-code" placeholder="验证码" maxlength="6" inputmode="numeric">
            </div>
            <button class="btn btn-secondary" id="send-code-btn">发送验证码</button>
          </div>
          <div style="margin-top:16px">
            <button class="btn btn-primary" id="verify-code-btn">下一步</button>
          </div>
        </div>

        <div id="register-step-2" style="display:none">
          <div class="form-group">
            <input type="text" id="reg-username" placeholder="用户名（2-20个字符）" autocomplete="username">
          </div>
          <div class="form-group">
            <input type="password" id="reg-password" placeholder="密码（至少6位）" autocomplete="new-password">
          </div>
          <div class="form-group">
            <input type="password" id="reg-confirm" placeholder="确认密码" autocomplete="new-password">
          </div>
          <button class="btn btn-primary" id="register-btn">注册</button>
          <div style="margin-top:12px">
            <button class="btn btn-secondary" id="back-to-step1">上一步</button>
          </div>
        </div>

        <div class="auth-footer">已有账号？<a href="#" id="go-to-login">立即登录</a></div>
      </div>
    </div>
  `;
}

function bindLoginEvents() {
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const account = document.getElementById('login-account').value.trim();
    const password = document.getElementById('login-password').value;
    if (!account || !password) return showToast('请填写账号和密码');

    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.textContent = '登录中...';

    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ account, password }),
      });
      setToken(data.token);
      currentUser = data.user;
      showChatApp();
    } catch (err) {
      showToast(err.message);
      btn.disabled = false;
      btn.textContent = '登录';
    }
  });

  document.getElementById('go-to-register').addEventListener('click', (e) => {
    e.preventDefault();
    showRegister();
  });
}

function bindRegisterEvents() {
  const emailInput = document.getElementById('reg-email');
  const codeInput = document.getElementById('reg-code');
  const sendBtn = document.getElementById('send-code-btn');
  const verifyBtn = document.getElementById('verify-code-btn');

  sendBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email || !email.includes('@')) return showToast('请输入有效的邮箱地址');

    sendBtn.disabled = true;
    let countdown = 60;
    sendBtn.textContent = `${countdown}s`;

    const timer = setInterval(() => {
      countdown--;
      sendBtn.textContent = `${countdown}s`;
      if (countdown <= 0) {
        clearInterval(timer);
        sendBtn.disabled = false;
        sendBtn.textContent = '重新发送';
      }
    }, 1000);

    try {
      await apiFetch('/auth/send-code', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      showToast('验证码已发送到邮箱');
    } catch (err) {
      showToast(err.message);
      clearInterval(timer);
      sendBtn.disabled = false;
      sendBtn.textContent = '发送验证码';
    }
  });

  verifyBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const code = codeInput.value.trim();
    if (!email) return showToast('请输入邮箱');
    if (!code || code.length !== 6) return showToast('请输入6位验证码');

    document.getElementById('register-step-1').style.display = 'none';
    document.getElementById('register-step-2').style.display = 'block';
  });

  document.getElementById('register-btn').addEventListener('click', async () => {
    const email = emailInput.value.trim();
    const code = codeInput.value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;

    if (!username) return showToast('请输入用户名');
    if (username.length < 2 || username.length > 20) return showToast('用户名需2-20个字符');
    if (!password || password.length < 6) return showToast('密码至少6位');
    if (password !== confirm) return showToast('两次密码不一致');

    const btn = document.getElementById('register-btn');
    btn.disabled = true;
    btn.textContent = '注册中...';

    try {
      const data = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, code, username, password }),
      });
      setToken(data.token);
      currentUser = data.user;
      showChatApp();
    } catch (err) {
      showToast(err.message);
      btn.disabled = false;
      btn.textContent = '注册';
    }
  });

  document.getElementById('back-to-step1').addEventListener('click', () => {
    document.getElementById('register-step-1').style.display = 'block';
    document.getElementById('register-step-2').style.display = 'none';
  });

  document.getElementById('go-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    showLogin();
  });
}
