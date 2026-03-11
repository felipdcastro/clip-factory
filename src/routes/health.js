const router = require('express').Router();
const { pool } = require('../db/connection');

router.get('/', async (req, res) => {
  let dbStatus = 'ok';
  try {
    await pool.query('SELECT 1');
  } catch {
    dbStatus = 'error';
  }

  const status = dbStatus === 'ok' ? 'ok' : 'degraded';
  res.status(status === 'ok' ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    db: dbStatus,
    version: process.env.npm_package_version || '1.0.0',
  });
});

module.exports = router;
