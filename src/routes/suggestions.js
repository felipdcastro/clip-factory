const router = require('express').Router();
const { updateSuggestionStatus } = require('../modules/analyzer/analyzer.service');

// PATCH /api/suggestions/:id — aprova ou rejeita uma sugestão
router.patch('/:id', async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'Campo "status" é obrigatório' });

    const suggestion = await updateSuggestionStatus(req.params.id, status);
    res.json(suggestion);
  } catch (err) {
    if (err.status === 400 || err.status === 404) {
      return res.status(err.status).json({ error: err.message });
    }
    next(err);
  }
});

module.exports = router;
