const { google } = require('googleapis');
const { query } = require('../../db/connection');

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    process.env.YOUTUBE_REDIRECT_URI
  );
}

/**
 * Gera URL de autorização OAuth — redirecionar o usuário para esta URL
 */
function getAuthUrl() {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    prompt: 'consent', // força retorno do refresh_token
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
 * Salva / atualiza tokens no banco (tabela oauth_tokens)
 */
async function saveTokens(tokens) {
  const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : null;

  await query(
    `INSERT INTO oauth_tokens (provider, access_token, refresh_token, expires_at)
     VALUES ('youtube', $1, $2, $3)
     ON CONFLICT (provider) DO UPDATE
       SET access_token=$1,
           refresh_token=COALESCE($2, oauth_tokens.refresh_token),
           expires_at=$3,
           updated_at=NOW()`,
    [tokens.access_token, tokens.refresh_token || null, expiresAt]
  );
}

/**
 * Retorna cliente OAuth autenticado com tokens válidos (faz refresh automático se necessário)
 */
async function getAuthenticatedClient() {
  const result = await query("SELECT * FROM oauth_tokens WHERE provider='youtube'");
  if (!result.rows.length) {
    throw new Error('YouTube não autorizado. Acesse /auth/youtube para autenticar.');
  }

  const tokenRow = result.rows[0];
  const client = createOAuthClient();

  client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
    expiry_date: tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : null,
  });

  // Auto-refresh se expirado ou expira em menos de 5 minutos
  const expiresAt = tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : 0;
  const isExpiringSoon = expiresAt < Date.now() + 5 * 60 * 1000;

  if (isExpiringSoon && tokenRow.refresh_token) {
    const { credentials } = await client.refreshAccessToken();
    await saveTokens(credentials);
    client.setCredentials(credentials);
  }

  return client;
}

/**
 * Verifica se o YouTube está autenticado
 */
async function isAuthenticated() {
  const result = await query("SELECT id FROM oauth_tokens WHERE provider='youtube'");
  return result.rows.length > 0;
}

module.exports = { getAuthUrl, exchangeCodeForTokens, getAuthenticatedClient, isAuthenticated };
