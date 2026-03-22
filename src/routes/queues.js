'use strict';

const router = require('express').Router();
const { getQueuesStatus } = require('../queues');

// GET /api/queues/status — contagem de jobs por fila
router.get('/status', async (req, res, next) => {
  try {
    const status = await getQueuesStatus();
    res.json({ queues: status, timestamp: new Date().toISOString() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
