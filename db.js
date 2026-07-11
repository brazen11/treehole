const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/treehole',
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

async function query(text, params) {
  const client = await getPool().connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

async function queryOne(text, params) {
  const result = await query(text, params);
  return result.rows[0] || null;
}

async function queryAll(text, params) {
  const result = await query(text, params);
  return result.rows;
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      username VARCHAR(50) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      code VARCHAR(6) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT FALSE
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      receiver_id INTEGER NOT NULL REFERENCES users(id),
      status VARCHAR(20) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS friends (
      id SERIAL PRIMARY KEY,
      user1_id INTEGER NOT NULL REFERENCES users(id),
      user2_id INTEGER NOT NULL REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user1_id, user2_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS delayed_messages (
      id SERIAL PRIMARY KEY,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      receiver_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'draft',
      batch_id VARCHAR(36),
      delay_hours NUMERIC,
      send_at TIMESTAMP,
      delivered_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_delayed_messages_send_at
    ON delayed_messages(send_at) WHERE status = 'scheduled'
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_delayed_messages_sender_receiver
    ON delayed_messages(sender_id, receiver_id)
  `);

  console.log('数据库初始化完成');
}

module.exports = { query, queryOne, queryAll, initDB, getPool };
