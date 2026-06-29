const { Pool } = require('pg');
const logger = require('../utils/logger').child({ module: 'db' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  // força IPv4 no Render (free tier não suporta IPv6 outbound)
  family: 4,
});

pool.on('error', (err) => {
  logger.error({ err }, 'PostgreSQL pool error');
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    logger.debug({ query: text, duration_ms: duration, rows: res.rowCount }, 'DB query');
  }
  return res;
}

async function testConnection() {
  const client = await pool.connect();
  client.release();
  logger.info('PostgreSQL connected');
}

module.exports = { query, pool, testConnection };
