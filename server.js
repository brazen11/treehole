require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');

const { query, queryOne, queryAll, initDB } = require('./db');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const friendRoutes = require('./routes/friends');
const messageRoutes = require('./routes/messages');
const { sendEmail } = require('./routes/mailer');
const authMiddleware = require('./middleware/auth');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'treehole_jwt_secret_key_change_in_production') {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.log('已自动生成随机 JWT_SECRET（服务器重启后所有登录会失效）');
}

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/friends', friendRoutes);
app.use('/api/messages', messageRoutes);

// Background job: process scheduled messages every 30 seconds
async function processScheduledMessages() {
  try {
    const batches = await queryAll(`
      SELECT DISTINCT batch_id, sender_id, receiver_id, delay_hours,
        MIN(send_at) AS send_at
      FROM delayed_messages
      WHERE status = 'scheduled' AND send_at <= NOW()
      GROUP BY batch_id, sender_id, receiver_id, delay_hours
    `);

    for (const batch of batches) {
      const messages = await queryAll(
        `SELECT id, content FROM delayed_messages
         WHERE batch_id = $1 ORDER BY id ASC`,
        [batch.batch_id]
      );

      const sender = await queryOne(
        'SELECT username FROM users WHERE id = $1',
        [batch.sender_id]
      );

      const receiver = await queryOne(
        'SELECT email, username FROM users WHERE id = $1',
        [batch.receiver_id]
      );

      const messageList = messages.map(m => m.content).join('\n\n');

      const delayLabel = batch.delay_hours >= 24
        ? `${Math.floor(batch.delay_hours / 24)}天`
        : `${batch.delay_hours}小时`;

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;">
          <div style="text-align:center;margin-bottom:28px;">
            <div style="width:56px;height:56px;background:#07C160;border-radius:16px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;">
              <span style="font-size:28px;color:white;">🌳</span>
            </div>
            <h1 style="font-size:20px;color:#1a1a1a;margin:0;">树洞来信</h1>
          </div>
          <div style="background:#f7f7f7;border-radius:16px;padding:24px;">
            <p style="font-size:14px;color:#666;margin:0 0 16px;">
              <strong style="color:#1a1a1a;">${escapeHtml(sender.username)}</strong>
              在 ${delayLabel} 前向你发送了一条树洞消息：
            </p>
            <div style="background:white;border-radius:12px;padding:20px;white-space:pre-wrap;font-size:15px;line-height:1.6;color:#1a1a1a;">
              ${escapeHtml(messageList)}
            </div>
            <p style="font-size:13px;color:#999;margin:16px 0 0;">
              登录树洞查看完整对话：<a href="https://treehole-e8ga.onrender.com" style="color:#07C160;">https://treehole-e8ga.onrender.com</a>
            </p>
          </div>
        </div>
      `;

      try {
        await sendEmail(receiver.email, '树洞 - 你收到了一条定时消息', html);
        await query(
          `UPDATE delayed_messages
           SET status = 'delivered', delivered_at = NOW()
           WHERE batch_id = $1`,
          [batch.batch_id]
        );
        console.log(`定时消息已送达: batch=${batch.batch_id}, 收件人=${receiver.username}`);
      } catch (err) {
        console.error(`定时消息发送失败: batch=${batch.batch_id}`, err.message);
      }
    }
  } catch (err) {
    console.error('定时任务处理失败:', err);
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  try {
    await initDB();
    // Start background job
    setInterval(processScheduledMessages, 30000);
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`树洞运行在 http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('启动失败:', err);
    process.exit(1);
  }
}

start();
