'use strict';

const router = require('express').Router();
const { pool } = require('../db/connection');
const Redis = require('ioredis');

async function checkDb() {
  try {
    await pool.query('SELECT 1');
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkRedis() {
  if (!process.env.REDIS_URL) return 'not_configured';
  const client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 0,
    connectTimeout: 3000,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  try {
    await client.connect();
    await client.ping();
    return 'ok';
  } catch {
    return 'error';
  } finally {
    client.disconnect();
  }
}

router.get('/', async (req, res) => {
  const [dbStatus, redisStatus] = await Promise.all([checkDb(), checkRedis()]);

  const allOk = dbStatus === 'ok' && (redisStatus === 'ok' || redisStatus === 'not_configured');
  const status = allOk ? 'ok' : 'degraded';

  res.status(allOk ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    services: {
      db: dbStatus,
      redis: redisStatus,
    },
  });
});

module.exports = router;
