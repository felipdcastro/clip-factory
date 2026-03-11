const router = require('express').Router();
const { getClip } = require('../modules/editor/editor.service');

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
