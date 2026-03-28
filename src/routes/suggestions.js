const router = require('express').Router();
const { updateSuggestionStatus } = require('../modules/analyzer/analyzer.service');
const { generateYouTubeMetadata } = require('../modules/analyzer/metadata.service');
const { query } = require('../db/connection');

// GET /api/suggestions/:id/clip — retorna o clip associado à sugestão
router.get('/:id/clip', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT * FROM clips WHERE suggestion_id=$1 ORDER BY created_at DESC LIMIT 1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Clip não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/suggestions/:id/metadata — retorna metadados YouTube gerados
router.get('/:id/metadata', async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, title, reason, clip_category, type FROM clip_suggestions WHERE id=$1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Sugestão não encontrada' });
    const metadata = generateYouTubeMetadata(result.rows[0]);
    res.json(metadata);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/suggestions/:id — aprova ou rejeita uma sugestão
router.patch('/:id', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Campo "status" é obrigatório' });

    const suggestion = await updateSuggestionStatus(req.params.id, status);

    // Se aprovada, enfileira para corte imediatamente
    if (status === 'approved') {
      const { enqueueClip } = require('../queues');
      enqueueClip(suggestion.id).catch(err => {
        const logger = require('../utils/logger').child({ module: 'suggestions-route' });
        logger.error({ err, suggestion_id: suggestion.id }, 'Falha ao enfileirar clip');
      });
    }

    res.json(suggestion);
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
