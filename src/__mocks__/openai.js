'use strict';
/* global jest */

// Mock automático do OpenAI para testes — evita chamadas reais à API

const mockSuggestions = [
  { start_time: 10, end_time: 370, title: 'Vídeo destaque', reason: 'Conteúdo relevante', type: 'video' },
  { start_time: 50, end_time: 110, title: 'Reel viral', reason: 'Momento forte', type: 'reel' },
];

const OpenAI = jest.fn().mockImplementation(() => ({
  chat: {
    completions: {
      create: jest.fn().mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify(mockSuggestions),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      }),
    },
  },
}));

module.exports = OpenAI;
module.exports.default = OpenAI;
