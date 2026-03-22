const router = require('express').Router();
const { getAuthUrl, exchangeCodeForTokens, isAuthenticated } = require('../modules/uploader/youtube-auth.service');
const logger = require('../utils/logger').child({ module: 'auth' });

// GET /auth/youtube — redireciona para autorização Google
router.get('/youtube', (req, res) => {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    return res.status(500).send('YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET não configurados.');
  }
  res.redirect(getAuthUrl());
});

// GET /auth/youtube/callback — Google redireciona aqui após autorização
router.get('/youtube/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect('/?youtube_auth=error');
  }
  try {
    await exchangeCodeForTokens(code);
    res.redirect('/?youtube_auth=success');
  } catch (err) {
    logger.error({ err }, 'YouTube OAuth callback error');
    res.redirect('/?youtube_auth=error');
  }
});

// GET /auth/youtube/status — verifica se YouTube está autenticado
router.get('/youtube/status', async (req, res) => {
  const authenticated = await isAuthenticated();
  res.json({ authenticated });
});

// POST /auth/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  const expected = process.env.DASHBOARD_PASSWORD;

  if (!expected) {
    return res.status(500).json({ error: 'DASHBOARD_PASSWORD não configurado' });
  }

  if (password !== expected) {
    return res.redirect('/login.html?error=1');
  }

  req.session.authenticated = true;
  res.redirect('/');
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login.html');
});

module.exports = router;
