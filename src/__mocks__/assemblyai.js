'use strict';
/* global jest */

// Mock automático do AssemblyAI para testes — evita chamadas reais à API

const mockTranscript = {
  text: 'Transcrição de teste automática.',
  words: [
    { text: 'Transcrição', start: 0, end: 700, confidence: 0.99 },
    { text: 'de', start: 750, end: 850, confidence: 0.98 },
    { text: 'teste', start: 900, end: 1200, confidence: 0.97 },
  ],
  audio_duration: 120,
  status: 'completed',
};

const AssemblyAI = jest.fn().mockImplementation(() => ({
  transcripts: {
    transcribe: jest.fn().mockResolvedValue(mockTranscript),
    get: jest.fn().mockResolvedValue(mockTranscript),
  },
}));

module.exports = { AssemblyAI };
