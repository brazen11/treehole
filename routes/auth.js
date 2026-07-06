const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { query, queryOne } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function buildMailHtml(code) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="width: 56px; height: 56px; background: #07C160; border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 12px;">
          <span style="font-size: 28px; color: white;">🌳</span>
        </div>
        <h1 style="font-size: 22px; color: #1a1a1a; margin: 0;">树洞验证码</h1>
      </div>
      <div style="background: #f7f7f7; border-radius: 16px; padding: 32px; text-align: center;">
        <p style="font-size: 15px; color: #666; margin: 0 0 20px;">您的验证码为</p>
        <div style="font-size: 40px; font-weight: 700; color: #07C160; letter-spacing: 8px; font-family: monospace;">${code}</div>
        <p style="font-size: 13px; color: #999; margin: 20px 0 0;">验证码有效期为10分钟，请勿泄露给他人。</p>
        <p style="font-size: 13px; color: #999; margin: 8px 0 0;">如果您没有注册树洞，请忽略此邮件。</p>
      </div>
    </div>
  `;
}

async function sendEmailViaSendGrid(to, code) {
  const html = buildMailHtml(code);
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: process.env.SENDGRID_FROM || 'ljyjohn990@gmail.com', name: '树洞' },
      subject: '树洞 - 验证码',
      content: [{ type: 'text/html', value: html }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SendGrid API error: ${res.status} ${body}`);
  }
}

async function sendEmailViaSMTP(to, code) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    connectionTimeout: 15000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  await transporter.sendMail({
    from: `"树洞" <${process.env.SMTP_USER}>`,
    to,
    subject: '树洞 - 验证码',
    html: buildMailHtml(code),
  });
}

async function sendEmailViaBrevo(to, code) {
  const html = buildMailHtml(code);
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: process.env.BREVO_FROM || 'ljyjohn990@gmail.com', name: '树洞' },
      to: [{ email: to }],
      subject: '树洞 - 验证码',
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brevo API error: ${res.status} ${body}`);
  }
}

async function sendEmail(to, code) {
  if (process.env.BREVO_API_KEY) {
    await sendEmailViaBrevo(to, code);
  } else if (process.env.SENDGRID_API_KEY) {
    await sendEmailViaSendGrid(to, code);
  } else {
    await sendEmailViaSMTP(to, code);
  }
}

router.post('/send-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: '请输入邮箱' });

    const existing = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existing) return res.status(400).json({ error: '该邮箱已注册' });

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await query('DELETE FROM verification_codes WHERE email = $1', [email]);
    await query(
      'INSERT INTO verification_codes (email, code, expires_at) VALUES ($1, $2, $3)',
      [email, code, expiresAt]
    );

    await sendEmail(email, code);

    res.json({ message: '验证码已发送' });
  } catch (err) {
    console.error('发送验证码失败:', err);
    res.status(500).json({ error: '验证码发送失败: ' + err.message });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { email, code, username, password } = req.body;
    if (!email || !code || !username || !password) {
      return res.status(400).json({ error: '请填写所有字段' });
    }
    if (password.length < 6) return res.status(400).json({ error: '密码至少6位' });
    if (username.length < 2 || username.length > 20) {
      return res.status(400).json({ error: '用户名2-20个字符' });
    }

    const codeRow = await queryOne(
      `SELECT * FROM verification_codes
       WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()`,
      [email, code]
    );
    if (!codeRow) return res.status(400).json({ error: '验证码无效或已过期' });

    const existingUser = await queryOne('SELECT id FROM users WHERE username = $1', [username]);
    if (existingUser) return res.status(400).json({ error: '用户名已被使用' });

    const existingEmail = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail) return res.status(400).json({ error: '该邮箱已注册' });

    const hashed = bcrypt.hashSync(password, 10);
    const result = await query(
      'INSERT INTO users (email, username, password) VALUES ($1, $2, $3) RETURNING id',
      [email, username, hashed]
    );
    const userId = result.rows[0].id;

    await query('UPDATE verification_codes SET used = TRUE WHERE id = $1', [codeRow.id]);

    const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ token, user: { id: userId, email, username } });
  } catch (err) {
    console.error('注册失败:', err);
    res.status(500).json({ error: '注册失败，请稍后重试' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { account, password } = req.body;
    if (!account || !password) return res.status(400).json({ error: '请输入账号和密码' });

    const user = await queryOne(
      'SELECT * FROM users WHERE email = $1 OR username = $1',
      [account]
    );
    if (!user) return res.status(400).json({ error: '账号不存在' });

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ error: '密码错误' });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({ token, user: { id: user.id, email: user.email, username: user.username } });
  } catch (err) {
    console.error('登录失败:', err);
    res.status(500).json({ error: '登录失败' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await queryOne(
      'SELECT id, email, username, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
