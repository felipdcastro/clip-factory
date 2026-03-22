const router = require('express').Router();
const { query } = require('../db/connection');
const { processUpload, retryUpload, listUploads, getUpload } = require('../modules/uploader/uploader.service');
const logger = require('../utils/logger').child({ module: 'uploads-route' });

// POST /api/uploads — agenda upload de um clip
router.post('/', async (req, res, next) => {
  try {
    const { clip_id, title, description, scheduled_at } = req.body;

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

    // Cria o registro de upload
    const result = await query(
      `INSERT INTO uploads (clip_id, title, description, status, scheduled_at)
       VALUES ($1, $2, $3, 'queued', $4) RETURNING *`,
      [clip_id, title.substring(0, 100), description || null, scheduled_at || null]
    );

    const upload = result.rows[0];

    // Enfileira para processamento via BullMQ (com delay para agendamentos)
    const { enqueueUpload } = require('../queues');
    enqueueUpload(upload.id, scheduled_at || null).catch(err => {
      logger.error({ err, upload_id: upload.id }, `Falha ao enfileirar upload ${upload.id}`);
      // Fallback: processa diretamente se fila indisponível
      processUpload(upload.id).catch(e => logger.error({ err: e, upload_id: upload.id }, 'Fallback upload failed'));
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

// POST /api/uploads/:id/retry — reprocessa upload em status 'failed'
router.post('/:id/retry', async (req, res, next) => {
  try {
    retryUpload(req.params.id).catch(err => {
      logger.error({ err, upload_id: req.params.id }, `Retry upload ${req.params.id} failed`);
    });
    res.json({ message: 'Retry iniciado', upload_id: Number(req.params.id) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
