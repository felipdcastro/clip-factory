'use strict';

const router = require('express').Router();
const { pool } = require('../db/connection');
const Redis = require('ioredis');
const { getQueuesStatus } = require('../queues');

const CHECK_TIMEOUT_MS = 2000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function checkDb() {
  const start = Date.now();
  try {
    await withTimeout(pool.query('SELECT 1'), CHECK_TIMEOUT_MS);
    return { status: 'ok', latency_ms: Date.now() - start };
  } catch {
    return { status: 'down', latency_ms: null };
  }
}

async function checkRedis() {
  if (!process.env.REDIS_URL) return { status: 'not_configured', latency_ms: null };
  const start = Date.now();
  const client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 0,
    connectTimeout: CHECK_TIMEOUT_MS,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  try {
    await withTimeout(client.connect(), CHECK_TIMEOUT_MS);
    await withTimeout(client.ping(), CHECK_TIMEOUT_MS);
    return { status: 'ok', latency_ms: Date.now() - start };
  } catch {
    return { status: 'down', latency_ms: null };
  } finally {
    client.disconnect();
  }
}

async function checkQueues() {
  try {
    const counts = await withTimeout(getQueuesStatus(), CHECK_TIMEOUT_MS * 2);
    const result = {};
    for (const [name, c] of Object.entries(counts)) {
      result[name] = { waiting: c.waiting, active: c.active, failed: c.failed };
    }
    return result;
  } catch {
    return null;
  }
}

router.get('/', async (req, res) => {
  const failedThreshold = parseInt(process.env.HEALTH_FAILED_THRESHOLD || '5');

  const [db, redis, queues] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkQueues(),
  ]);

  const isDown = db.status === 'down' || redis.status === 'down';
  const isDegraded = !isDown && queues
    ? Object.values(queues).some(q => q.failed >= failedThreshold)
    : false;

  const status = isDown ? 'down' : isDegraded ? 'degraded' : 'ok';
  const httpStatus = isDown ? 503 : 200;

  res.status(httpStatus).json({
    status,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    subsystems: {
      database: db,
      redis,
      queues: queues ?? {},
    },
  });
});

module.exports = router;
