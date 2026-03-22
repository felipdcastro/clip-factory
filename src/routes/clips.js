const router = require('express').Router();
const { getClip } = require('../modules/editor/editor.service');
const { query } = require('../db/connection');

// GET /api/clips/by-suggestion/:suggestionId — busca clip pela sugestão
router.get('/by-suggestion/:suggestionId', async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM clips WHERE suggestion_id=$1 ORDER BY created_at DESC LIMIT 1', [req.params.suggestionId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Clip não encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/clips/:id — retorna status e caminho do clip
router.get('/:id', async (req, res, next) => {
  try {
    const clip = await getClip(req.params.id);
    if (!clip) return res.status(404).json({ error: 'Clip não encontrado' });
    res.json(clip);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
