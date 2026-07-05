require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const { query, queryOne, queryAll, initDB } = require('./db');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const authMiddleware = require('./middleware/auth');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'treehole_jwt_secret_key_change_in_production') {
  process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
  console.log('已自动生成随机 JWT_SECRET（服务器重启后所有登录会失效）');
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

async function getOrCreateConversation(userId1, userId2) {
  const u1 = Math.min(userId1, userId2);
  const u2 = Math.max(userId1, userId2);

  let conv = await queryOne(
    'SELECT * FROM conversations WHERE user1_id = $1 AND user2_id = $2',
    [u1, u2]
  );

  if (!conv) {
    const result = await query(
      'INSERT INTO conversations (user1_id, user2_id) VALUES ($1, $2) RETURNING *',
      [u1, u2]
    );
    conv = result.rows[0];
  }
  return conv;
}

app.get('/api/conversations', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const conversations = await queryAll(`
      SELECT
        c.*,
        CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END AS other_user_id,
        u.username AS other_username,
        (SELECT COUNT(*) FROM messages
         WHERE ((sender_id = $1 AND receiver_id = u.id) OR (sender_id = u.id AND receiver_id = $1))
         AND sender_id != $1 AND read = FALSE) AS unread_count
      FROM conversations c
      JOIN users u ON u.id = CASE WHEN c.user1_id = $1 THEN c.user2_id ELSE c.user1_id END
      WHERE c.user1_id = $1 OR c.user2_id = $1
      ORDER BY c.last_message_time DESC NULLS LAST
    `, [userId]);

    res.json(conversations);
  } catch (err) {
    console.error('获取对话列表失败:', err);
    res.status(500).json({ error: '获取对话列表失败' });
  }
});

app.get('/api/conversations/:userId/messages', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const otherUserId = parseInt(req.params.userId);

    await query(
      'UPDATE messages SET read = TRUE WHERE sender_id = $1 AND receiver_id = $2 AND read = FALSE',
      [otherUserId, userId]
    );

    const messages = await queryAll(`
      SELECT id, sender_id AS "senderId", receiver_id AS "receiverId", content, created_at AS "createdAt", read
      FROM messages
      WHERE (sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)
      ORDER BY created_at ASC
    `, [userId, otherUserId]);

    await getOrCreateConversation(userId, otherUserId);

    res.json(messages);
  } catch (err) {
    console.error('获取消息失败:', err);
    res.status(500).json({ error: '获取消息失败' });
  }
});

app.post('/api/conversations/:userId/read', authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const otherUserId = parseInt(req.params.userId);

    await query(
      'UPDATE messages SET read = TRUE WHERE sender_id = $1 AND receiver_id = $2 AND read = FALSE',
      [otherUserId, userId]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '操作失败' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('未登录'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch {
    next(new Error('登录已过期'));
  }
});

io.on('connection', (socket) => {
  const userId = socket.userId;
  socket.join(`user_${userId}`);

  socket.on('send_message', async (data) => {
    try {
      const { receiverId, content } = data;
      if (!receiverId || !content?.trim()) return;

      const result = await query(
        'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING id, created_at',
        [userId, receiverId, content.trim()]
      );
      const row = result.rows[0];

      await getOrCreateConversation(userId, receiverId);

      const u1 = Math.min(userId, receiverId);
      const u2 = Math.max(userId, receiverId);
      await query(
        `UPDATE conversations
         SET last_message = $1, last_message_time = NOW(), last_sender_id = $2
         WHERE user1_id = $3 AND user2_id = $4`,
        [content.trim(), userId, u1, u2]
      );

      const message = {
        id: row.id,
        senderId: userId,
        receiverId,
        content: content.trim(),
        createdAt: row.created_at,
        read: false,
      };

      io.to(`user_${receiverId}`).emit('new_message', message);
      socket.emit('message_sent', message);
    } catch (err) {
      console.error('发送消息失败:', err);
      socket.emit('error_message', { error: '发送失败' });
    }
  });

  socket.on('typing', (data) => {
    const { receiverId } = data;
    if (receiverId) {
      io.to(`user_${receiverId}`).emit('user_typing', { userId });
    }
  });

  socket.on('stop_typing', (data) => {
    const { receiverId } = data;
    if (receiverId) {
      io.to(`user_${receiverId}`).emit('user_stopped_typing', { userId });
    }
  });
});

async function start() {
  try {
    await initDB();
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
