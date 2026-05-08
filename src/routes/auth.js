const crypto = require('crypto');
const router = require('express').Router();
const { getAuthUrl, exchangeCodeForTokens, isAuthenticated } = require('../modules/uploader/youtube-auth.service');
const logger = require('../utils/logger').child({ module: 'auth' });

/**
 * Comparação de senha resistente a timing attacks.
 * Usa SHA-256 para garantir buffers de tamanho idêntico antes de timingSafeEqual.
 */
function safeCompare(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// GET /auth/youtube — redireciona para autorização Google
router.get('/youtube', (req, res) => {
  if (!process.env.YOUTUBE_CLIENT_ID || !process.env.YOUTUBE_CLIENT_SECRET) {
    return res.status(500).send('YOUTUBE_CLIENT_ID e YOUTUBE_CLIENT_SECRET não configurados.');
  }
  // Gera state aleatório e armazena na sessão para validação CSRF no callback
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;
  res.redirect(getAuthUrl(state));
});

// GET /auth/youtube/callback — Google redireciona aqui após autorização
router.get('/youtube/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (error || !code) {
    return res.redirect('/?youtube_auth=error');
  }

  // Valida CSRF state
  const expectedState = req.session.oauthState;
  req.session.oauthState = null;
  if (!state || !expectedState || state !== expectedState) {
    logger.warn({ state, expectedState }, 'OAuth state mismatch — possível CSRF attack');
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

// GET /auth/youtube/status — retorna se a integração YouTube está autenticada
router.get('/youtube/status', async (req, res) => {
  try {
    const authenticated = await isAuthenticated();
    res.json({ authenticated });
  } catch {
    res.json({ authenticated: false });
  }
});

// POST /auth/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  const expected = process.env.DASHBOARD_PASSWORD;

  if (!expected) {
    return res.status(500).json({ error: 'DASHBOARD_PASSWORD não configurado' });
  }

  if (!safeCompare(password || '', expected)) {
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
