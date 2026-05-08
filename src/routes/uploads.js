const router = require('express').Router();
const { query } = require('../db/connection');
const { retryUpload, listUploads, getUpload } = require('../modules/uploader/uploader.service');
const logger = require('../utils/logger').child({ module: 'uploads-route' });

// POST /api/uploads — agenda upload de um clip
router.post('/', async (req, res, next) => {
  try {
    const { clip_id, title, description, scheduled_at, tags } = req.body;

    if (!clip_id || !title) {
      return res.status(400).json({ error: 'clip_id e title são obrigatórios' });
    }

    // Busca o clip
    const clipResult = await query('SELECT * FROM clips WHERE id=$1', [clip_id]);
    if (!clipResult.rows.length) {
      return res.status(404).json({ error: 'Clip não encontrado' });
    }
    if (clipResult.rows[0].status !== 'ready') {
      return res.status(400).json({ error: 'Clip ainda não está pronto para upload' });
    }

    // tags: valida e normaliza (array de strings, máx 500 chars total)
    const finalTags = Array.isArray(tags) && tags.length
      ? JSON.stringify(tags.map(t => String(t).trim()).filter(Boolean).slice(0, 15))
      : null;

    // Cria o registro de upload
    const result = await query(
      `INSERT INTO uploads (clip_id, title, description, tags, status, scheduled_at)
       VALUES ($1, $2, $3, $4, 'queued', $5) RETURNING *`,
      [clip_id, title.substring(0, 100), description || null, finalTags, scheduled_at || null]
    );

    const upload = result.rows[0];

    // Enfileira para processamento via BullMQ (com delay para agendamentos)
    const { enqueueUpload } = require('../queues');
    enqueueUpload(upload.id, scheduled_at || null).catch(async err => {
      logger.error({ err, upload_id: upload.id }, `Falha ao enfileirar upload ${upload.id} — marcando como failed`);
      // Não processa diretamente: evita duplicação se a fila se recuperar.
      // Marca como failed para que o usuário possa usar o endpoint /retry.
      await query(
        "UPDATE uploads SET status='failed', error_message=$1, updated_at=NOW() WHERE id=$2",
        ['Fila indisponível ao enfileirar. Use /retry para reprocessar.', upload.id]
      ).catch(dbErr => logger.error({ err: dbErr, upload_id: upload.id }, 'Falha ao marcar upload como failed'));
    });

    res.status(201).json(upload);
  } catch (err) {
    next(err);
  }
});

// GET /api/uploads — lista todos os uploads
router.get('/', async (req, res, next) => {
  try {
    const uploads = await listUploads();
    res.json(uploads);
  } catch (err) {
    next(err);
  }
});

// GET /api/uploads/:id — status de um upload específico
router.get('/:id', async (req, res, next) => {
  try {
    const upload = await getUpload(req.params.id);
    if (!upload) return res.status(404).json({ error: 'Upload não encontrado' });
    res.json(upload);
  } catch (err) {
    next(err);
  }
});

// POST /api/uploads/:id/retry — reprocessa upload em status 'failed' (enfileira via BullMQ)
router.post('/:id/retry', async (req, res, next) => {
  try {
    const result = await retryUpload(req.params.id);
    res.json({ status: result.status, upload_id: result.uploadId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
