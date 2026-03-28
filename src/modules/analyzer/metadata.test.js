'use strict';

const { generateYouTubeMetadata } = require('./metadata.service');

describe('generateYouTubeMetadata', () => {
  it('highlight + video → título sem prefixo, descrição com 🏆 e #Gaming', () => {
    const result = generateYouTubeMetadata({
      title: 'Faker PENTA kill',
      reason: 'Jogada incrível no mid',
      clip_category: 'highlight',
      type: 'video',
    });
    expect(result.title).toBe('Faker PENTA kill');
    expect(result.description).toContain('🏆');
    expect(result.description).toContain('#Highlights');
    expect(result.description).toContain('#Gaming');
    expect(result.description).not.toContain('#Shorts');
  });

  it('educational + video → título com [Educacional], descrição com 🎓', () => {
    const result = generateYouTubeMetadata({
      title: 'Como farmar corretamente',
      reason: 'Técnica de last hit',
      clip_category: 'educational',
      type: 'video',
    });
    expect(result.title).toBe('[Educacional] Como farmar corretamente');
    expect(result.description).toContain('🎓');
    expect(result.description).toContain('#Educational');
    expect(result.description).toContain('#Tips');
    expect(result.description).toContain('#Gaming');
  });

  it('funny + reel → descrição com 😂 e #Shorts', () => {
    const result = generateYouTubeMetadata({
      title: 'Campeão dançando na base',
      reason: 'Momento hilário',
      clip_category: 'funny',
      type: 'reel',
    });
    expect(result.title).toBe('Campeão dançando na base');
    expect(result.description).toContain('😂');
    expect(result.description).toContain('#Funny');
    expect(result.description).toContain('#Moments');
    expect(result.description).toContain('#Shorts');
    expect(result.description).not.toContain('#Gaming');
  });

  it('sem clip_category → título original, descrição com reason e hashtags genéricas', () => {
    const result = generateYouTubeMetadata({
      title: 'Clip genérico',
      reason: 'Momento interessante',
      clip_category: null,
      type: 'video',
    });
    expect(result.title).toBe('Clip genérico');
    expect(result.description).toContain('Momento interessante');
    expect(result.description).toContain('#LoL');
    expect(result.description).toContain('#LeagueOfLegends');
    expect(result.description).toContain('#Gaming');
    expect(result.description).not.toContain('🏆');
    expect(result.description).not.toContain('🎓');
    expect(result.description).not.toContain('😂');
  });

  it('título muito longo (>100 chars) é truncado em educational', () => {
    const longTitle = 'A'.repeat(110);
    const result = generateYouTubeMetadata({
      title: longTitle,
      reason: 'Razão qualquer',
      clip_category: 'educational',
      type: 'video',
    });
    expect(result.title.length).toBeLessThanOrEqual(100);
    expect(result.title.startsWith('[Educacional] ')).toBe(true);
  });

  it('sem reason e sem clip_category → descrição apenas com hashtags', () => {
    const result = generateYouTubeMetadata({
      title: 'Clip sem reason',
      reason: null,
      clip_category: null,
      type: 'reel',
    });
    expect(result.title).toBe('Clip sem reason');
    expect(result.description).toContain('#LoL');
    expect(result.description).toContain('#Shorts');
  });

  it('com riotData → descrição inclui bloco ⚔️ com campeão e rank', () => {
    const riotData = { champion: 'Azir', tier: 'PLATINUM', rank: 'II', leaguePoints: 75 };
    const result = generateYouTubeMetadata({
      title: 'Faker outplay',
      reason: 'Jogada incrível',
      clip_category: 'highlight',
      type: 'video',
    }, riotData);
    expect(result.description).toContain('⚔️ Azir');
    expect(result.description).toContain('PLATINUM II 75LP');
  });

  it('sem riotData → comportamento existente inalterado', () => {
    const result = generateYouTubeMetadata({
      title: 'Faker outplay',
      reason: 'Jogada incrível',
      clip_category: 'highlight',
      type: 'video',
    });
    expect(result.description).not.toContain('⚔️');
    expect(result.description).toContain('🏆');
    expect(result.description).toContain('#Highlights');
  });
});
