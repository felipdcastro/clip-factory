'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Retorna a chave de encriptação de 32 bytes a partir de TOKEN_ENCRYPTION_KEY.
 * Lança erro se a variável não estiver configurada (chamado no startup para fail-fast).
 */
function getKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY não configurado ou muito curto (mínimo 32 caracteres). ' +
      'Configure a variável de ambiente antes de iniciar o servidor.'
    );
  }
  // Deriva chave de exatamente 32 bytes via SHA-256
  return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Encripta um token usando AES-256-GCM.
 * Retorna string no formato: base64(iv):base64(authTag):base64(ciphertext)
 * @param {string} plaintext
 * @returns {string}
 */
function encryptToken(plaintext) {
  if (!plaintext) return null;

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Decripta um token previamente encriptado com encryptToken.
 * @param {string} encryptedText - formato: base64(iv):base64(authTag):base64(ciphertext)
 * @returns {string}
 */
function decryptToken(encryptedText) {
  if (!encryptedText) return null;

  // Suporte a tokens legados (plain text sem ':') — retorna como está
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    return encryptedText;
  }

  const key = getKey();
  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const ciphertext = Buffer.from(parts[2], 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
}

/**
 * Verifica se um valor está no formato encriptado (iv:authTag:ciphertext).
 * Útil para identificar tokens legados durante a migration.
 * @param {string} value
 * @returns {boolean}
 */
function isEncrypted(value) {
  if (!value) return false;
  return value.split(':').length === 3;
}

module.exports = { encryptToken, decryptToken, isEncrypted, getKey };
