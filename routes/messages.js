const express = require('express');
const crypto = require('crypto');
const { query, queryOne, queryAll } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Save a draft message
router.post('/draft', authMiddleware, async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    if (!receiverId || !content?.trim()) return res.status(400).json({ error: '参数错误' });

    const areFriends = await queryOne(
      'SELECT * FROM friends WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
      [req.userId, receiverId]
    );
    if (!areFriends) return res.status(400).json({ error: '仅好友可发送消息' });

    const result = await query(
      `INSERT INTO delayed_messages (sender_id, receiver_id, content, status)
       VALUES ($1, $2, $3, 'draft') RETURNING id, created_at`,
      [req.userId, receiverId, content.trim()]
    );

    res.json({
      id: result.rows[0].id,
      senderId: req.userId,
      receiverId,
      content: content.trim(),
      status: 'draft',
      createdAt: result.rows[0].created_at,
    });
  } catch (err) {
    console.error('保存草稿失败:', err);
    res.status(500).json({ error: '保存失败' });
  }
});

// Get drafts/unsent messages with a specific user
router.get('/drafts/:userId', authMiddleware, async (req, res) => {
  try {
    const otherId = parseInt(req.params.userId);
    const messages = await queryAll(`
      SELECT id, sender_id AS "senderId", receiver_id AS "receiverId",
             content, status, batch_id AS "batchId", delay_hours AS "delayHours",
             send_at AS "sendAt", delivered_at AS "deliveredAt", created_at AS "createdAt"
      FROM delayed_messages
      WHERE sender_id = $1 AND receiver_id = $2 AND status IN ('draft', 'scheduled')
      ORDER BY created_at ASC
    `, [req.userId, otherId]);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: '获取失败' });
  }
});

// Get delivered messages with a specific user (for receiver)
router.get('/delivered/:userId', authMiddleware, async (req, res) => {
  try {
    const otherId = parseInt(req.params.userId);

    // Mark delivered messages as read when receiver opens the chat
    await query(
      `UPDATE delayed_messages SET status = 'read'
       WHERE sender_id = $1 AND receiver_id = $2 AND status = 'delivered'`,
      [otherId, req.userId]
    );

    const messages = await queryAll(`
      SELECT id, sender_id AS "senderId", receiver_id AS "receiverId",
             content, status, batch_id AS "batchId", delay_hours AS "delayHours",
             send_at AS "sendAt", delivered_at AS "deliveredAt", created_at AS "createdAt"
      FROM delayed_messages
      WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
        AND status IN ('delivered', 'read')
      ORDER BY delivered_at ASC
    `, [req.userId, otherId]);

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: '获取失败' });
  }
});

// Get new (unread) received messages count per friend
router.get('/new', authMiddleware, async (req, res) => {
  try {
    const counts = await queryAll(`
      SELECT sender_id AS "senderId", COUNT(*) AS count
      FROM delayed_messages
      WHERE receiver_id = $1 AND status = 'delivered'
      GROUP BY sender_id
    `, [req.userId]);
    res.json(counts);
  } catch (err) {
    res.status(500).json({ error: '获取失败' });
  }
});

// Schedule messages for delayed sending
router.post('/schedule', authMiddleware, async (req, res) => {
  try {
    const { messageIds, delayHours, receiverId } = req.body;
    if (!messageIds?.length || delayHours === undefined || delayHours === null || !receiverId) {
      return res.status(400).json({ error: '参数错误' });
    }

    const validDelays = [0, 0.5, 1, 2, 3, 6, 12, 24, 48, 72, 120, 168];
    if (!validDelays.includes(delayHours)) {
      return res.status(400).json({ error: '无效的延迟时间' });
    }

    const areFriends = await queryOne(
      'SELECT * FROM friends WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
      [req.userId, receiverId]
    );
    if (!areFriends) return res.status(400).json({ error: '仅好友可发送消息' });

    // Verify all messages belong to this user and are drafts
    const drafts = await queryAll(
      `SELECT id FROM delayed_messages
       WHERE id = ANY($1::int[]) AND sender_id = $2 AND receiver_id = $3 AND status = 'draft'`,
      [messageIds, req.userId, receiverId]
    );
    if (drafts.length !== messageIds.length) {
      return res.status(400).json({ error: '部分消息不存在或已处理' });
    }

    const batchId = crypto.randomUUID();
    const sendAt = new Date(Date.now() + delayHours * 3600 * 1000).toISOString();

    await query(
      `UPDATE delayed_messages
       SET status = 'scheduled', batch_id = $1, delay_hours = $2, send_at = $3
       WHERE id = ANY($4::int[]) AND sender_id = $5`,
      [batchId, delayHours, sendAt, messageIds, req.userId]
    );

    res.json({ message: `已定时，将在 ${delayHours} 小时后发送`, batchId, sendAt });
  } catch (err) {
    console.error('定时发送失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

module.exports = router;
