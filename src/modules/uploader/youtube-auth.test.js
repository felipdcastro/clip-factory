'use strict';

jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

// Mock googleapis com implementação inline
const mockGenerateAuthUrl = jest.fn().mockReturnValue('https://accounts.google.com/mock-auth-url');
const mockGetToken = jest.fn().mockResolvedValue({
  tokens: { access_token: 'mock-access-token', refresh_token: 'mock-refresh-token', expiry_date: Date.now() + 3600000 },
});
const mockSetCredentials = jest.fn();
const mockRefreshAccessToken = jest.fn().mockResolvedValue({
  credentials: { access_token: 'refreshed-token', refresh_token: null, expiry_date: Date.now() + 3600000 },
});
const mockOAuth2 = jest.fn().mockImplementation(() => ({
  generateAuthUrl: mockGenerateAuthUrl,
  getToken: mockGetToken,
  setCredentials: mockSetCredentials,
  refreshAccessToken: mockRefreshAccessToken,
}));

jest.mock('googleapis', () => ({
  google: { auth: { OAuth2: mockOAuth2 } },
}));

// TOKEN_ENCRYPTION_KEY obrigatória para crypto
process.env.TOKEN_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef'; // 32 chars

const { query } = require('../../db/connection');
const {
  getAuthUrl,
  exchangeCodeForTokens,
  getAuthenticatedClient,
  isAuthenticated,
  saveTokens,
} = require('./youtube-auth.service');

describe('getAuthUrl', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna URL de autorização do Google', () => {
    mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/mock-auth-url');
    process.env.YOUTUBE_CLIENT_ID = 'test-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-secret';
    const url = getAuthUrl();
    expect(typeof url).toBe('string');
    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ access_type: 'offline' })
    );
  });
});

describe('exchangeCodeForTokens', () => {
  beforeEach(() => jest.clearAllMocks());

  it('troca código por tokens e persiste no banco', async () => {
    mockGetToken.mockResolvedValue({
      tokens: { access_token: 'ya29.test', refresh_token: 'refresh-test', expiry_date: Date.now() + 3600000 },
    });
    query.mockResolvedValue({ rows: [] });

    const tokens = await exchangeCodeForTokens('mock-auth-code');
    expect(mockGetToken).toHaveBeenCalledWith('mock-auth-code');
    expect(tokens.access_token).toBe('ya29.test');
    expect(query).toHaveBeenCalled();
  });
});

describe('saveTokens', () => {
  beforeEach(() => jest.clearAllMocks());

  it('encripta access_token antes de salvar', async () => {
    query.mockResolvedValue({ rows: [] });
    await saveTokens({
      access_token: 'ya29.plain-access',
      refresh_token: 'plain-refresh',
      expiry_date: Date.now() + 3600000,
    });
    const savedAccess = query.mock.calls[0][1][0];
    expect(savedAccess).not.toBe('ya29.plain-access'); // deve estar encriptado
    expect(savedAccess).toContain(':'); // formato IV:authTag:ciphertext
  });

  it('aceita tokens sem refresh_token', async () => {
    query.mockResolvedValue({ rows: [] });
    await saveTokens({ access_token: 'ya29.only' });
    expect(query.mock.calls[0][1][1]).toBeNull(); // refresh null
  });
});

describe('isAuthenticated', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retorna false quando não há token ativo no banco', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await isAuthenticated()).toBe(false);
  });

  it('retorna true quando há token ativo', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }] });
    expect(await isAuthenticated()).toBe(true);
  });
});

describe('getAuthenticatedClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lança quando não há tokens no banco', async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getAuthenticatedClient()).rejects.toThrow('YouTube não autorizado');
  });

  it('lança quando auth_status é expired', async () => {
    query.mockResolvedValue({
      rows: [{ auth_status: 'expired', access_token: 'enc', refresh_token: null, expires_at: null }],
    });
    await expect(getAuthenticatedClient()).rejects.toThrow('Sessão YouTube expirada');
  });

  it('retorna cliente com token válido (não expira em breve)', async () => {
    const { encryptToken } = require('../../utils/crypto');
    const encAccess = encryptToken('ya29.valid');
    const encRefresh = encryptToken('refresh-valid');
    const farFuture = new Date(Date.now() + 60 * 60 * 1000); // 1h

    query.mockResolvedValue({
      rows: [{ auth_status: 'active', access_token: encAccess, refresh_token: encRefresh, expires_at: farFuture }],
    });

    const client = await getAuthenticatedClient();
    expect(client).toBeDefined();
    expect(mockSetCredentials).toHaveBeenCalled();
  });

  it('faz refresh quando token expira em breve', async () => {
    const { encryptToken } = require('../../utils/crypto');
    const encAccess = encryptToken('ya29.expiring');
    const encRefresh = encryptToken('refresh-still-valid');
    const soonExpiry = new Date(Date.now() + 60 * 1000); // expira em 1 min (< 5 min)

    const tokenRow = { auth_status: 'active', access_token: encAccess, refresh_token: encRefresh, expires_at: soonExpiry };
    // Primeira chamada: SELECT token; Segunda: INSERT (saveTokens)
    query
      .mockResolvedValueOnce({ rows: [tokenRow] })
      .mockResolvedValueOnce({ rows: [] }); // saveTokens INSERT

    mockRefreshAccessToken.mockResolvedValueOnce({
      credentials: { access_token: 'ya29.refreshed', refresh_token: null, expiry_date: Date.now() + 3600000 },
    });

    const client = await getAuthenticatedClient();
    expect(mockRefreshAccessToken).toHaveBeenCalled();
    expect(client).toBeDefined();
  });
});
