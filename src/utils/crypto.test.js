'use strict';

describe('crypto utils', () => {
  const VALID_KEY = 'chave-de-teste-com-32-caracteres-ok!!';

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  // Re-importa módulo a cada describe para respeitar env vars
  const getCrypto = () => {
    jest.resetModules();
    return require('./crypto');
  };

  describe('encryptToken / decryptToken', () => {
    it('roundtrip: encrypt → decrypt retorna valor original', () => {
      const { encryptToken, decryptToken } = getCrypto();
      const original = 'ya29.access_token_example_12345';
      const encrypted = encryptToken(original);
      expect(encrypted).not.toBe(original);
      expect(decryptToken(encrypted)).toBe(original);
    });

    it('tokens diferentes produzem ciphertexts diferentes (IV aleatório)', () => {
      const { encryptToken } = getCrypto();
      const token = 'mesmo-token';
      const enc1 = encryptToken(token);
      const enc2 = encryptToken(token);
      expect(enc1).not.toBe(enc2);
    });

    it('encriptado tem formato iv:authTag:ciphertext (3 partes base64)', () => {
      const { encryptToken } = getCrypto();
      const encrypted = encryptToken('token-qualquer');
      const parts = encrypted.split(':');
      expect(parts).toHaveLength(3);
      parts.forEach(part => {
        expect(() => Buffer.from(part, 'base64')).not.toThrow();
      });
    });

    it('retorna null para input null', () => {
      const { encryptToken, decryptToken } = getCrypto();
      expect(encryptToken(null)).toBeNull();
      expect(decryptToken(null)).toBeNull();
    });

    it('lança erro para tokens com formato inválido (sem encriptação / plain text)', () => {
      const { decryptToken } = getCrypto();
      expect(() => decryptToken('ya29.plain_text_legacy_token')).toThrow('formato inválido');
    });

    it('lança erro ao decriptar com chave diferente', () => {
      const { encryptToken } = getCrypto();
      const encrypted = encryptToken('token-secreto');

      process.env.TOKEN_ENCRYPTION_KEY = 'outra-chave-completamente-diferente!!xx';
      const { decryptToken } = getCrypto();
      expect(() => decryptToken(encrypted)).toThrow();
    });
  });

  describe('isEncrypted', () => {
    it('retorna true para valor no formato encriptado', () => {
      const { encryptToken, isEncrypted } = getCrypto();
      const encrypted = encryptToken('algum-token');
      expect(isEncrypted(encrypted)).toBe(true);
    });

    it('retorna false para plain text', () => {
      const { isEncrypted } = getCrypto();
      expect(isEncrypted('ya29.plain')).toBe(false);
    });

    it('retorna false para null/undefined', () => {
      const { isEncrypted } = getCrypto();
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
    });
  });

  describe('getKey — validação de TOKEN_ENCRYPTION_KEY', () => {
    it('lança erro se TOKEN_ENCRYPTION_KEY ausente', () => {
      delete process.env.TOKEN_ENCRYPTION_KEY;
      const { getKey } = getCrypto();
      expect(() => getKey()).toThrow('TOKEN_ENCRYPTION_KEY');
    });

    it('lança erro se TOKEN_ENCRYPTION_KEY menor que 32 caracteres', () => {
      process.env.TOKEN_ENCRYPTION_KEY = 'curta';
      const { getKey } = getCrypto();
      expect(() => getKey()).toThrow('TOKEN_ENCRYPTION_KEY');
    });

    it('não lança erro com chave de exatamente 32 caracteres', () => {
      process.env.TOKEN_ENCRYPTION_KEY = '12345678901234567890123456789012';
      const { getKey } = getCrypto();
      expect(() => getKey()).not.toThrow();
    });
  });
});
