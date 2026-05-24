'use strict';

const fs     = require('fs');
const path   = require('path');
const router = require('express').Router();
const { query } = require('../db/connection');
const logger = require('../utils/logger').child({ module: 'health-dashboard' });

const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './tmp');

function dirSizeMb(dir) {
  try {
    const files = fs.readdirSync(dir);
    let total = 0;
    for (const f of files) {
      try { total += fs.statSync(path.join(dir, f)).size; } catch { /* arquivo inacessível */ }
    }
    return parseFloat((total / 1024 / 1024).toFixed(1));
  } catch { return 0; }
}

// GET /api/health-dashboard — resumo de saúde do sistema
router.get('/', async (req, res, next) => {
  try {
    const [jobs, clips, uploads, queues, token] = await Promise.all([
      query(`SELECT status, COUNT(*) as n FROM jobs GROUP BY status`),
      query(`SELECT status, COUNT(*) as n FROM clips GROUP BY status`),
      query(`SELECT status, COUNT(*) as n FROM uploads GROUP BY status`),
      query(`SELECT
               (SELECT COUNT(*) FROM clips WHERE status='ready'
                AND id NOT IN (SELECT clip_id FROM uploads WHERE status IN ('queued','scheduled','uploading','uploaded'))) AS clips_sem_upload,
               (SELECT COUNT(*) FROM uploads WHERE status='queued') AS uploads_na_fila,
               (SELECT COUNT(*) FROM uploads WHERE status='failed') AS uploads_falhos,
               (SELECT COUNT(*) FROM uploads WHERE status='scheduled' AND scheduled_at < NOW() + INTERVAL '24 hours') AS uploads_proximas_24h`),
      query(`SELECT auth_status, expires_at FROM oauth_tokens WHERE provider='youtube' ORDER BY updated_at DESC LIMIT 1`),
    ]);

    const byStatus = (rows) => rows.reduce((acc, r) => { acc[r.status] = parseInt(r.n); return acc; }, {});

    const tokenRow = token.rows[0];
    const q        = queues.rows[0];

    res.json({
      youtube: {
        status:     tokenRow?.auth_status || 'disconnected',
        expires_at: tokenRow?.expires_at || null,
      },
      tmp_size_mb: dirSizeMb(TEMP_DIR),
      jobs:    byStatus(jobs.rows),
      clips:   byStatus(clips.rows),
      uploads: byStatus(uploads.rows),
      summary: {
        clips_sem_upload:      parseInt(q?.clips_sem_upload   || 0),
        uploads_na_fila:       parseInt(q?.uploads_na_fila    || 0),
        uploads_falhos:        parseInt(q?.uploads_falhos     || 0),
        uploads_proximas_24h:  parseInt(q?.uploads_proximas_24h || 0),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Erro ao gerar health dashboard');
    next(err);
  }
});

module.exports = router;
