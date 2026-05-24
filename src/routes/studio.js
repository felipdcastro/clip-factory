'use strict';

const fs     = require('fs');
const path   = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const router = require('express').Router();
const { query } = require('../db/connection');
const { createRemix } = require('../modules/remixer/remixer.service');
const { enqueueRemix } = require('../queues');
const logger = require('../utils/logger').child({ module: 'studio-route' });

const TEMP_DIR = path.resolve(process.env.TEMP_DIR || './tmp');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    cb(null, `studio_${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp4', '.mkv', '.avi', '.mov', '.webm'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error(`Formato não suportado: ${ext}`));
  },
});

// POST /api/studio/upload — recebe vídeo, cria clip no banco, enfileira remix
router.post('/upload', upload.single('video'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  let effectsRaw;
  try {
    effectsRaw = req.body.effects ? JSON.parse(req.body.effects) : {};
  } catch {
    return res.status(400).json({ error: 'Campo "effects" inválido (JSON esperado)' });
  }

  // Valida efeitos
  const validEffects = {};
  if (effectsRaw.mirror)    validEffects.mirror    = true;
  if (effectsRaw.zoom)      validEffects.zoom      = true;
  if (effectsRaw.speed)     validEffects.speed     = true;
  if (effectsRaw.subtitles) validEffects.subtitles = true;
  if (effectsRaw.filter && ['warm', 'cold', 'vintage', 'dramatic'].includes(effectsRaw.filter)) {
    validEffects.filter = effectsRaw.filter;
  }

  if (!Object.keys(validEffects).length) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Selecione pelo menos um efeito' });
  }

  try {
    // Detecta tipo pelo nome original
    const type = req.body.type === 'reel' ? 'reel' : 'video';

    // Cria clip no banco (job_id=null — sem pipeline, só Studio)
    const clipRow = await query(
      `INSERT INTO clips (job_id, suggestion_id, type, status, file_path)
       VALUES (NULL, NULL, $1, 'ready', $2) RETURNING id`,
      [type, req.file.path]
    );
    const clipId = clipRow.rows[0].id;

    const remix = await createRemix(clipId, validEffects);
    await enqueueRemix(remix.id);

    logger.info({ clip_id: clipId, remix_id: remix.id, effects: validEffects }, 'Studio: clip enviado e remix enfileirado');
    res.status(201).json({ clip_id: clipId, remix_id: remix.id, status: remix.status });
  } catch (err) {
    // Limpa arquivo se falhar no banco
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
