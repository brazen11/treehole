const express = require('express');
const { query, queryOne, queryAll } = require('../db');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length === 0) return res.json([]);

    const term = q.trim();
    const users = await queryAll(
      `SELECT id, username, email, created_at FROM users
       WHERE (username ILIKE $1 OR email ILIKE $1) AND id != $2
       LIMIT 20`,
      [`%${term}%`, req.userId]
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: '搜索失败' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const user = await queryOne('SELECT id, username, created_at FROM users WHERE id = $1', [req.params.id]);
    if (!user) return res.status(404).json({ error: '用户不存在' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const user = await queryOne(
      'SELECT id, email, username, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
