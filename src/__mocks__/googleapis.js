'use strict';
/* global jest */

// Mock automático do googleapis para testes — evita chamadas reais à API YouTube

const mockOAuth2 = jest.fn().mockImplementation(() => ({
  generateAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/mock-auth-url'),
  getToken: jest.fn().mockResolvedValue({
    tokens: {
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expiry_date: Date.now() + 3600000,
    },
  }),
  setCredentials: jest.fn(),
  refreshAccessToken: jest.fn().mockResolvedValue({
    credentials: { access_token: 'mock-refreshed-token', expiry_date: Date.now() + 3600000 },
  }),
}));

const mockYouTube = {
  videos: {
    insert: jest.fn().mockResolvedValue({
      data: { id: 'mock-video-id', status: { uploadStatus: 'uploaded' } },
    }),
  },
};

const google = {
  auth: {
    OAuth2: mockOAuth2,
  },
  youtube: jest.fn().mockReturnValue(mockYouTube),
};

module.exports = { google };
