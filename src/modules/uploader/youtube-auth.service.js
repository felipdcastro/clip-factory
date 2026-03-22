'use strict';

const { google } = require('googleapis');
const { query } = require('../../db/connection');
const { encryptToken, decryptToken } = require('../../utils/crypto');

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );
}

/**
 * Gera URL de autorização OAuth com state para proteção CSRF.
 * @param {string} state - valor aleatório gerado pelo caller e armazenado na sessão
 */
function getAuthUrl(state) {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    prompt: 'consent', // força retorno do refresh_token
    state,
  });
}

/**
 * Troca o código de autorização por tokens e persiste no banco
 */
async function exchangeCodeForTokens(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);

  await saveTokens(tokens);
  return tokens;
}

/**
 * Salva / atualiza tokens no banco com encriptação AES-256-GCM
 */
async function saveTokens(tokens) {
  const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

  const encryptedAccess = encryptToken(tokens.access_token);
  const encryptedRefresh = tokens.refresh_token ? encryptToken(tokens.refresh_token) : null;

  await query(
    `INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at, auth_status)
     VALUES ('youtube', $1, $2, $3, 'active')
     ON CONFLICT (provider) DO UPDATE
       SET access_token=$1,
           refresh_token=COALESCE($2, oauth_tokens.refresh_token),
           expires_at=$3,
           auth_status='active',
           updated_at=NOW()`,
    [encryptedAccess, encryptedRefresh, expiresAt]
  );
}

/**
 * Retorna cliente OAuth autenticado com tokens válidos.
 * Faz refresh automático se access_token expirado.
 * Marca auth_status='expired' se refresh_token também falhar.
 */
async function getAuthenticatedClient() {
  const result = await query("SELECT * FROM oauth_tokens WHERE provider='youtube'");
  if (!result.rows.length) {
    throw new Error('YouTube não autorizado. Acesse /auth/youtube para autenticar.');
  }

  const tokenRow = result.rows[0];

  if (tokenRow.auth_status === 'expired') {
    throw new Error(
      'Sessão YouTube expirada. Acesse o dashboard e reautentique em /auth/youtube.'
    );
  }

  // Decripta tokens armazenados
  const accessToken = decryptToken(tokenRow.access_token);
  const refreshToken = tokenRow.refresh_token ? decryptToken(tokenRow.refresh_token) : null;

  const client = createOAuthClient();
  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : null,
  });

  // Auto-refresh se expirado ou expira em menos de 5 minutos
  const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : 0;
  const isExpiringSoon = expiresAt < Date.now() + 5 * 60 * 1000;

  if (isExpiringSoon && refreshToken) {
    try {
      const { credentials } = await client.refreshAccessToken();
      await saveTokens(credentials);
      client.setCredentials({
        access_token: decryptToken(encryptToken(credentials.access_token)),
        refresh_token: credentials.refresh_token
          ? decryptToken(encryptToken(credentials.refresh_token))
          : refreshToken,
        expiry_date: credentials.expiry_date,
      });
    } catch (refreshErr) {
      await query(
        "UPDATE oauth_tokens SET auth_status='expired', updated_at=NOW() WHERE provider='youtube'"
      );
      throw new Error(
        'Refresh token YouTube inválido ou expirado. Reautentique em /auth/youtube.',
        { cause: refreshErr }
      );
    }
  }

  return client;
}

/**
 * Verifica se o YouTube está autenticado e com auth_status=active
 */
async function isAuthenticated() {
  const result = await query(
    "SELECT id FROM oauth_tokens WHERE provider='youtube' AND auth_status='active'"
  );
  return result.rows.length > 0;
}

module.exports = { getAuthUrl, exchangeCodeForTokens, getAuthenticatedClient, isAuthenticated, saveTokens };
