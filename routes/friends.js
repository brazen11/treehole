const express = require('express');
const { query, queryOne, queryAll } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

// Send friend request
router.post('/request', authMiddleware, async (req, res) => {
  try {
    const { receiverId } = req.body;
    if (!receiverId) return res.status(400).json({ error: '请指定用户' });
    if (receiverId === req.userId) return res.status(400).json({ error: '不能添加自己为好友' });

    // Check if receiver has blocked sender
    const blocked = await queryOne(
      'SELECT * FROM blacklist WHERE user_id = $1 AND blocked_id = $2',
      [receiverId, req.userId]
    );
    if (blocked) return res.status(400).json({ error: '对方已将你拉黑，无法发送好友请求' });

    const existing = await queryOne(
      `SELECT * FROM friend_requests
       WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
       AND status = 'pending'`,
      [req.userId, receiverId]
    );
    if (existing) return res.status(400).json({ error: '已发送过好友请求' });

    const areFriends = await queryOne(
      `SELECT * FROM friends
       WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)`,
      [req.userId, receiverId]
    );
    if (areFriends) return res.status(400).json({ error: '已经是好友了' });

    await query(
      'INSERT INTO friend_requests (sender_id, receiver_id) VALUES ($1, $2)',
      [req.userId, receiverId]
    );

    res.json({ message: '好友请求已发送' });
  } catch (err) {
    console.error('发送好友请求失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

// Accept or reject friend request
router.post('/respond', authMiddleware, async (req, res) => {
  try {
    const { requestId, action } = req.body;
    if (!requestId || !['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: '参数错误' });
    }

    const reqRow = await queryOne(
      'SELECT * FROM friend_requests WHERE id = $1 AND receiver_id = $2 AND status = $3',
      [requestId, req.userId, 'pending']
    );
    if (!reqRow) return res.status(400).json({ error: '请求不存在' });

    await query('UPDATE friend_requests SET status = $1, updated_at = NOW() WHERE id = $2',
      [action === 'accept' ? 'accepted' : 'rejected', requestId]);

    if (action === 'accept') {
      const u1 = Math.min(reqRow.sender_id, reqRow.receiver_id);
      const u2 = Math.max(reqRow.sender_id, reqRow.receiver_id);
      await query(
        'INSERT INTO friends (user1_id, user2_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [u1, u2]
      );
    }

    res.json({ message: action === 'accept' ? '已同意好友请求' : '已拒绝好友请求' });
  } catch (err) {
    console.error('处理好友请求失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

// Get pending friend requests received
router.get('/requests/received', authMiddleware, async (req, res) => {
  try {
    const requests = await queryAll(`
      SELECT fr.id, fr.sender_id AS "senderId", fr.status, fr.created_at AS "createdAt",
             u.username, u.email
      FROM friend_requests fr
      JOIN users u ON u.id = fr.sender_id
      WHERE fr.receiver_id = $1 AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `, [req.userId]);
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: '获取失败' });
  }
});

// Get sent friend requests
router.get('/requests/sent', authMiddleware, async (req, res) => {
  try {
    const requests = await queryAll(`
      SELECT fr.id, fr.receiver_id AS "receiverId", fr.status, fr.created_at AS "createdAt",
             u.username, u.email
      FROM friend_requests fr
      JOIN users u ON u.id = fr.receiver_id
      WHERE fr.sender_id = $1 AND fr.status = 'pending'
      ORDER BY fr.created_at DESC
    `, [req.userId]);
    res.json(requests);
  } catch (err) {
    res.status(500).json({ error: '获取失败' });
  }
});

// Get friend list (with mute status and blacklist status)
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const friends = await queryAll(`
      SELECT u.id, u.username, u.email, f.created_at AS "becameFriendsAt",
        CASE
          WHEN f.user1_id = $1 THEN f.muted_by_user1
          ELSE f.muted_by_user2
        END AS "muted",
        CASE
          WHEN f.user1_id = $1 THEN f.muted_by_user2
          ELSE f.muted_by_user1
        END AS "theirMuted"
      FROM friends f
      JOIN users u ON u.id = CASE WHEN f.user1_id = $1 THEN f.user2_id ELSE f.user1_id END
      WHERE f.user1_id = $1 OR f.user2_id = $1
      ORDER BY u.username ASC
    `, [req.userId]);
    res.json(friends);
  } catch (err) {
    res.status(500).json({ error: '获取失败' });
  }
});

// Toggle mute for a friend
router.post('/mute', authMiddleware, async (req, res) => {
  try {
    const { friendId } = req.body;
    if (!friendId) return res.status(400).json({ error: '参数错误' });

    const friend = await queryOne(
      'SELECT * FROM friends WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
      [req.userId, friendId]
    );
    if (!friend) return res.status(400).json({ error: '不是好友' });

    if (friend.user1_id === req.userId) {
      await query('UPDATE friends SET muted_by_user1 = NOT muted_by_user1 WHERE id = $1', [friend.id]);
    } else {
      await query('UPDATE friends SET muted_by_user2 = NOT muted_by_user2 WHERE id = $1', [friend.id]);
    }

    res.json({ message: '操作成功' });
  } catch (err) {
    console.error('切换屏蔽失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

// Delete friend (remove from friends list)
router.post('/unfriend', authMiddleware, async (req, res) => {
  try {
    const { friendId } = req.body;
    if (!friendId) return res.status(400).json({ error: '参数错误' });

    await query(
      'DELETE FROM friends WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
      [req.userId, friendId]
    );

    res.json({ message: '已删除好友' });
  } catch (err) {
    console.error('删除好友失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

// Blacklist a user (block + unfriend + block future requests)
router.post('/blacklist', authMiddleware, async (req, res) => {
  try {
    const { blockedId } = req.body;
    if (!blockedId) return res.status(400).json({ error: '参数错误' });
    if (blockedId === req.userId) return res.status(400).json({ error: '不能拉黑自己' });

    // Remove from friends if they are
    await query(
      'DELETE FROM friends WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
      [req.userId, blockedId]
    );

    // Reject any pending requests
    await query(
      "UPDATE friend_requests SET status = 'rejected', updated_at = NOW() WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1)) AND status = 'pending'",
      [req.userId, blockedId]
    );

    // Add to blacklist
    await query(
      'INSERT INTO blacklist (user_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.userId, blockedId]
    );

    res.json({ message: '已拉黑' });
  } catch (err) {
    console.error('拉黑失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

// Remove from blacklist
router.post('/unblacklist', authMiddleware, async (req, res) => {
  try {
    const { blockedId } = req.body;
    if (!blockedId) return res.status(400).json({ error: '参数错误' });

    await query(
      'DELETE FROM blacklist WHERE user_id = $1 AND blocked_id = $2',
      [req.userId, blockedId]
    );

    res.json({ message: '已移出黑名单' });
  } catch (err) {
    console.error('移出黑名单失败:', err);
    res.status(500).json({ error: '操作失败' });
  }
});

// Get blacklist
router.get('/blacklist', authMiddleware, async (req, res) => {
  try {
    const list = await queryAll(`
      SELECT u.id, u.username, u.email, b.created_at AS "blockedAt"
      FROM blacklist b
      JOIN users u ON u.id = b.blocked_id
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC
    `, [req.userId]);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: '获取失败' });
  }
});

// Get relationship with a user
router.get('/status/:userId', authMiddleware, async (req, res) => {
  try {
    const otherId = parseInt(req.params.userId);
    if (otherId === req.userId) return res.json({ status: 'self' });

    // Check if blacklisted
    const blockedByMe = await queryOne(
      'SELECT * FROM blacklist WHERE user_id = $1 AND blocked_id = $2',
      [req.userId, otherId]
    );
    if (blockedByMe) return res.json({ status: 'blocked_by_me' });

    const blockedByThem = await queryOne(
      'SELECT * FROM blacklist WHERE user_id = $1 AND blocked_id = $2',
      [otherId, req.userId]
    );
    if (blockedByThem) return res.json({ status: 'blocked_by_them' });

    const areFriends = await queryOne(
      'SELECT * FROM friends WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
      [req.userId, otherId]
    );
    if (areFriends) return res.json({ status: 'friends' });

    const pendingReq = await queryOne(
      `SELECT * FROM friend_requests
       WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
       AND status = 'pending'`,
      [req.userId, otherId]
    );
    if (pendingReq) {
      return res.json({
        status: pendingReq.sender_id === req.userId ? 'pending_sent' : 'pending_received',
        requestId: pendingReq.id,
      });
    }

    res.json({ status: 'none' });
  } catch (err) {
    res.status(500).json({ error: '获取失败' });
  }
});

module.exports = router;
