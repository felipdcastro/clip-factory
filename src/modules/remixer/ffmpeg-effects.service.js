'use strict';

const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const FFMPEG_TIMEOUT_MS = parseInt(process.env.FFMPEG_TIMEOUT_MS || '1800000');

function toFfmpegPath(p) {
  return p ? p.replace(/\\/g, '/') : p;
}

// Filtros de cor pré-definidos
const COLOR_FILTERS = {
  warm:     'eq=saturation=1.2:gamma_r=1.1:gamma_b=0.9',
  cold:     'eq=saturation=1.1:gamma_r=0.9:gamma_b=1.15',
  vintage:  'colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131',
  dramatic: 'eq=contrast=1.4:saturation=1.3:brightness=-0.05',
};

/**
 * Monta a cadeia de filtros de vídeo para os efeitos selecionados.
 * Ordem: zoom → mirror → color (cada etapa recebe o frame da anterior)
 *
 * @param {object} effects - { mirror, filter, zoom, speed }
 * @param {'reel'|'video'} type
 * @returns {string|null} filtro FFmpeg ou null se nenhum efeito de vídeo
 */
function buildVideoFilterChain(effects, type) {
  const parts = [];

  // Zoom in 8% com slow pan horizontal (câmera se move da esquerda para direita)
  // Usa scale+crop relativo para funcionar com qualquer resolução de entrada
  if (effects.zoom) {
    if (type === 'reel') {
      // Entrada: 1080x1920 → escala para 1166x2072 → crop 1080x1920
      // Pan: x de 0 a 86px ao longo do tempo (1.2px/seg em 30fps)
      parts.push('scale=1166:2072');
      parts.push("crop=1080:1920:x='min(t*1.2,86)':y=76");
    } else {
      // Entrada: até 1920x1080 → scale 108%, crop original, pan horizontal
      parts.push("scale=trunc(iw*1.08/2)*2:trunc(ih*1.08/2)*2");
      parts.push("crop='trunc(iw/1.08/2)*2':'trunc(ih/1.08/2)*2':x='min(t*1.5,(iw-trunc(iw/1.08/2)*2))':y='(ih-trunc(ih/1.08/2)*2)/2'");
    }
  }

  // Espelhar horizontalmente — técnica mais eficaz anti-repost
  if (effects.mirror) {
    parts.push('hflip');
  }

  // Filtro de cor
  if (effects.filter && COLOR_FILTERS[effects.filter]) {
    parts.push(COLOR_FILTERS[effects.filter]);
  }

  // Speed afeta apenas PTS de vídeo (áudio tratado separadamente via audioFilter)
  if (effects.speed) {
    parts.push('setpts=0.952*PTS');
  }

  return parts.length ? parts.join(',') : null;
}

/**
 * Converte caminho Windows para formato aceito pelo filtro subtitles do FFmpeg.
 * C:\path\to\file.srt → C\:/path/to/file.srt
 */
function toSubtitlePath(p) {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
}

/**
 * Aplica efeitos a um clip já cortado.
 *
 * @param {string} inputPath    - Caminho do clip original (já em formato final)
 * @param {string} outputPath   - Caminho do arquivo de saída
 * @param {object} effects      - { mirror, filter, zoom, speed, subtitles }
 * @param {'reel'|'video'} type
 * @param {string|null} srtPath - Caminho do arquivo .srt (obrigatório se effects.subtitles)
 * @returns {Promise<string>} outputPath
 */
function applyEffects(inputPath, outputPath, effects = {}, type = 'reel', srtPath = null) {
  const stderrLines = [];

  return new Promise((resolve, reject) => {
    let vfChain = buildVideoFilterChain(effects, type);

    if (effects.subtitles && srtPath) {
      const subtitleFilter = `subtitles='${toSubtitlePath(srtPath)}':force_style='FontName=Arial,FontSize=16,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2'`;
      vfChain = vfChain ? `${vfChain},${subtitleFilter}` : subtitleFilter;
    }

    const outputOpts = ['-crf 22', '-preset fast', '-movflags +faststart'];
    if (vfChain) outputOpts.push(`-vf ${vfChain}`);

    const cmd = ffmpeg(toFfmpegPath(inputPath))
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions(outputOpts);

    if (effects.speed) {
      cmd.audioFilters('atempo=1.05');
    }

    cmd
      .output(toFfmpegPath(outputPath))
      .on('stderr', (line) => stderrLines.push(line))
      .on('end', () => { clearTimeout(timer); resolve(outputPath); })
      .on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`FFmpeg (efeitos) falhou: ${err.message}\n${stderrLines.slice(-15).join('\n')}`));
      });

    const timer = setTimeout(() => {
      cmd.kill('SIGKILL');
      reject(new Error(`FFmpeg timeout após ${FFMPEG_TIMEOUT_MS / 60000} minutos`));
    }, FFMPEG_TIMEOUT_MS);

    cmd.run();
  });
}

module.exports = { applyEffects, COLOR_FILTERS };
