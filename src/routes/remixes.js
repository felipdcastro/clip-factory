'use strict';

const fs     = require('fs');
const router = require('express').Router();
const { query }       = require('../db/connection');
const { createRemix, listRemixes, getRemix } = require('../modules/remixer/remixer.service');
const { enqueueRemix } = require('../queues');
const logger = require('../utils/logger').child({ module: 'remixes-route' });

// GET /api/remixes/clips — clips prontos disponíveis para remix
router.get('/clips', async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.id, c.type, c.file_path, c.duration_ms, c.created_at,
              cs.title, cs.seo_title
       FROM clips c
       LEFT JOIN clip_suggestions cs ON cs.id = c.suggestion_id
       WHERE c.status = 'ready' AND c.file_path IS NOT NULL
       ORDER BY c.created_at DESC
       LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// POST /api/remixes — cria e enfileira um remix
router.post('/', async (req, res, next) => {
  try {
    const { clip_id, effects } = req.body;

    if (!clip_id) {
      return res.status(400).json({ error: 'clip_id é obrigatório' });
    }

    const validEffects = {};
    if (effects?.mirror) validEffects.mirror = true;
    if (effects?.zoom)   validEffects.zoom   = true;
    if (effects?.speed)  validEffects.speed  = true;
    if (effects?.filter && ['warm', 'cold', 'vintage', 'dramatic'].includes(effects.filter)) {
      validEffects.filter = effects.filter;
    }

    if (!Object.keys(validEffects).length) {
      return res.status(400).json({ error: 'Selecione pelo menos um efeito' });
    }

    const remix = await createRemix(Number(clip_id), validEffects);
    await enqueueRemix(remix.id);

    logger.info({ remix_id: remix.id, clip_id, effects: validEffects }, 'Remix criado e enfileirado');
    res.status(201).json(remix);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// GET /api/remixes — lista remixes (opcional: ?source=studio para apenas uploads diretos prontos)
router.get('/', async (req, res, next) => {
  try {
    if (req.query.source === 'studio') {
      // Remixes prontos vindos do Studio (job_id IS NULL) sem upload agendado
      const result = await query(
        `SELECT r.*, c.type
         FROM clip_remixes r
         JOIN clips c ON c.id = r.source_clip_id
         WHERE r.status = 'ready'
           AND c.job_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM uploads u WHERE u.clip_id = r.result_clip_id
           )
         ORDER BY r.created_at DESC
         LIMIT 20`
      );
      return res.json(result.rows);
    }
    const remixes = await listRemixes(100);
    res.json(remixes);
  } catch (err) {
    next(err);
  }
});

// GET /api/remixes/:id — status de um remix
router.get('/:id', async (req, res, next) => {
  try {
    const remix = await getRemix(req.params.id);
    if (!remix) return res.status(404).json({ error: 'Remix não encontrado' });
    res.json(remix);
  } catch (err) {
    next(err);
  }
});

// GET /api/remixes/:id/stream — streaming do vídeo remixado
router.get('/:id/stream', async (req, res, next) => {
  try {
    const remix = await getRemix(req.params.id);
    if (!remix) return res.status(404).json({ error: 'Remix não encontrado' });
    if (remix.status !== 'ready') return res.status(409).json({ error: 'Remix ainda não está pronto' });

    // Busca o clip resultado para pegar o file_path
    const clipResult = await query('SELECT file_path FROM clips WHERE id=$1', [remix.result_clip_id]);
    const filePath = clipResult.rows[0]?.file_path;
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Arquivo do remix não encontrado' });
    }

    const { size: fileSize } = fs.statSync(filePath);
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end   = endStr ? Math.min(parseInt(endStr, 10), fileSize - 1) : fileSize - 1;
      res.writeHead(206, {
        'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges':  'bytes',
        'Content-Length': end - start + 1,
        'Content-Type':   'video/mp4',
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type':   'video/mp4',
        'Accept-Ranges':  'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
