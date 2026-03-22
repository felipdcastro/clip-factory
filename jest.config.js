'use strict';

module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js',                                    // entrypoint — não testável em unit
    '!src/db/migrate.js',                                // DDL — não testável em unit
    '!src/db/connection.js',                             // infraestrutura de pool
    '!src/public/**',                                    // JS frontend sem bundler
    '!src/**/*.test.js',
    '!src/modules/downloader/yt-dlp.js',                // wrapper de shell command externo
    '!src/modules/transcriber/audio-extractor.js',      // wrapper de ffmpeg externo
    '!src/modules/editor/ffmpeg.service.js',             // wrapper de ffmpeg externo
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  testMatch: [
    '**/__tests__/**/*.test.js',
    '**/*.test.js',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
  ],
};
