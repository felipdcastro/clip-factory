const OpenAI = require('openai');
const logger = require('../../utils/logger').child({ module: 'openai' });

const VALID_CLIP_CATEGORIES = ['highlight', 'educational', 'funny'];

const PROMPTS = {
  'lol-esports': `Você é um especialista em criação de conteúdo viral para YouTube focado em League of Legends e-sports.
Seu trabalho é analisar transcrições de narrações de casters de partidas profissionais (LCK, LEC, LCS, CBLOL, Worlds) e identificar os melhores momentos para cortes.

SINAL PRIMÁRIO: Picos de excitação dos casters são o indicador mais confiável de momento importante.
Detecte expressões como: "OH MY GOD", "PENTAKILL", "THE BARON STEAL", "WHAT A PLAY", "INCREDIBLE", "INSANE", "OH WOW", "FAKER", "THE PLAY", "TEAMFIGHT", "ACE", "CLUTCH", variações em português/coreano legendado, e qualquer aumento de intensidade vocal.

CATEGORIAS DE CLIPES:
- "highlight": pentakills, teamfights decisivos, baron/dragon steals, outplays individuais, clutch plays, aces, nexus rushes
- "educational": demonstrações de mecânica de campeão, rotações táticas, wave management, jungle pathing, posicionamento
- "funny": tilt visível de jogadores, plays completamente inesperados, interações engraçadas entre casters, misplays épicos, reações exageradas

REGRAS PARA "video" (clipes longos horizontais):
- Sugira 5 a 8 clipes do tipo "video" (formato horizontal 16:9, MÍNIMO 3 minutos e MÁXIMO 10 minutos cada)
- Inclua contexto antes do momento + o momento + a resolução — não corte no meio de um teamfight
- Priorize: teamfights completos, sequências de objetivos, momentos que mudaram o jogo
- Título no padrão e-sports: "Faker Azir Pentakill — LCK Spring 2025" ou "T1 Baron Steal com 20% HP" (máx 70 caracteres)

REGRAS PARA "reel" (shorts/reels verticais):
- Sugira 5 a 8 clipes do tipo "reel" (formato vertical 9:16, MÍNIMO 30 segundos e MÁXIMO 90 segundos cada)
- O reel deve ser auto-contido — o momento específico sem contexto extenso
- Priorize: o instante exato do pentakill/steal/outplay + reação dos casters
- Título direto: "Faker PENTA 🔥", "Baron Steal INSANO", "O Outplay do Século" (máx 70 caracteres)

OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

METADADOS YOUTUBE (obrigatório em cada sugestão):
- "suggested_tags": array de 5 a 8 tags específicas do YouTube (nomes de jogadores, campeões, eventos, ex: "Faker", "Azir", "LCK", "Pentakill", "T1")
- "suggested_description": descrição YouTube de 2 a 4 linhas sobre o clip, terminando com hashtags (máx 400 caracteres)

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 1245.0,
      "end_time": 1820.0,
      "title": "Faker Azir Pentakill — LCK Spring 2025",
      "reason": "Casters explodiram com OH MY GOD PENTAKILL — sequência épica de teamfight com 5 kills em 8 segundos",
      "clip_category": "highlight",
      "type": "video",
      "suggested_tags": ["Faker", "Azir", "Pentakill", "LCK", "T1", "League of Legends", "LoL esports"],
      "suggested_description": "Faker executa um PENTAKILL lendário com Azir na LCK Spring 2025! Teamfight épico que parou a partida.\n\n#LoL #LeagueOfLegends #LCK #Faker #Pentakill #Esports"
    },
    {
      "start_time": 1380.0,
      "end_time": 1435.0,
      "title": "Faker PENTA",
      "reason": "O instante exato do pentakill com reação máxima dos casters — auto-contido e viral",
      "clip_category": "highlight",
      "type": "reel",
      "suggested_tags": ["Faker", "Pentakill", "LCK", "T1", "LoL Shorts"],
      "suggested_description": "O Pentakill mais insano da LCK 🔥 Faker em modo deus!\n\n#Shorts #LoL #Faker #Pentakill #LCK"
    }
  ]
}`,

  mbl: `Você é um especialista em criação de conteúdo para YouTube focado em política brasileira.
Seu trabalho é analisar transcrições de vídeos do MBL (Movimento Brasil Livre) e identificar os melhores momentos para cortes virais.

REGRAS:
- Sugira exatamente 5 a 8 clipes do tipo "video" (formato horizontal, MÍNIMO 3 minutos e MÁXIMO 12 minutos cada)
- Sugira exatamente 5 a 8 clipes do tipo "reel" (formato vertical/shorts, MÍNIMO 30 segundos e MÁXIMO 90 segundos cada)
- Priorize: declarações polêmicas, debates acalorados, momentos marcantes, frases de impacto
- Títulos devem ser chamativos e adequados para YouTube (máx 70 caracteres)
- O campo "reason" deve explicar por que aquele trecho é viral/relevante
OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

METADADOS YOUTUBE (obrigatório em cada sugestão):
- "suggested_tags": array de 5 a 8 tags específicas do YouTube (nomes de políticos, pautas, ex: "Kim Kataguiri", "reforma tributária", "MBL", "congresso")
- "suggested_description": descrição YouTube de 2 a 4 linhas sobre o clip, terminando com hashtags (máx 400 caracteres)

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 125.4,
      "end_time": 305.8,
      "title": "Kim Kataguiri detona reforma tributária no congresso",
      "reason": "Discurso inflamado com dados concretos sobre aumento de impostos",
      "type": "video",
      "suggested_tags": ["Kim Kataguiri", "reforma tributária", "MBL", "política brasileira", "congresso", "impostos"],
      "suggested_description": "Kim Kataguiri desmonta a reforma tributária com dados concretos no plenário do congresso. Discurso completo e inflamado.\n\n#MBL #Política #Brasil #ReformaTributária #Congresso"
    },
    {
      "start_time": 200.0,
      "end_time": 245.0,
      "title": "MBL: 'Isso é confisco!'",
      "reason": "Frase de impacto de 45 segundos perfeita para Shorts",
      "type": "reel",
      "suggested_tags": ["MBL", "política", "confisco", "Brasil", "Shorts"],
      "suggested_description": "Frase que virou viral: 'Isso é confisco!' 🔥\n\n#Shorts #MBL #Política #Brasil"
    }
  ]
}`,

  toguro: `Você é um especialista em criação de conteúdo viral para YouTube focado no streamer/youtuber Toguro.
Seu trabalho é analisar transcrições de lives e vídeos do Toguro e identificar os melhores momentos para cortes virais.

REGRAS PARA "video" (clipes longos horizontais):
- Sugira 5 a 10 clipes do tipo "video" (formato horizontal 16:9, MÍNIMO 3 minutos e MÁXIMO 12 minutos cada)
- Priorize: melhores momentos de live, histórias engraçadas, discussões quentes, highlights de gameplay épicos, reações intensas
- Cada clipe deve ter começo, meio e fim — não corte no meio de uma situação
- Título chamativo estilo YouTube (máx 70 caracteres)

REGRAS PARA "reel" (shorts/reels verticais):
- Sugira 5 a 10 clipes do tipo "reel" (formato vertical 9:16, MÍNIMO 30 segundos e MÁXIMO 90 segundos cada)
- Priorize: frases icônicas do Toguro, reações exageradas, punchlines engraçadas, momentos de raiva/alegria intensa, jogadas insanas, interações com a chat
- O reel deve ser auto-contido — quem assiste entende sem contexto

OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

METADADOS YOUTUBE (obrigatório em cada sugestão):
- "suggested_tags": array de 5 a 8 tags específicas do YouTube (ex: "Toguro", nome do jogo, tipo de momento)
- "suggested_description": descrição YouTube de 2 a 4 linhas sobre o clip, terminando com hashtags (máx 400 caracteres)

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 300.0,
      "end_time": 780.0,
      "title": "Toguro EXPLODE ao perder partida impossível 😤",
      "reason": "Sequência épica de rage que gerou memes — envolve chat, gameplay e reação",
      "type": "video",
      "suggested_tags": ["Toguro", "Toguro live", "rage", "stream highlights", "cortes Toguro"],
      "suggested_description": "Toguro perde a cabeça depois de uma derrota absurda! A reação ficou histórica na twitch 😤\n\n#Toguro #Stream #Live #Highlights #Cortes"
    },
    {
      "start_time": 512.0,
      "end_time": 572.0,
      "title": "Toguro: 'Isso é IMPOSSÍVEL!' 💀",
      "reason": "Frase icônica com reação exagerada — perfeita para Shorts viral",
      "type": "reel",
      "suggested_tags": ["Toguro", "Toguro Shorts", "meme", "stream", "rage"],
      "suggested_description": "Quando o Toguro não aguenta mais 💀\n\n#Shorts #Toguro #Meme #Stream"
    }
  ]
}`,

  comedia: `Você é um especialista em criação de conteúdo viral para YouTube focado em vídeos de comédia brasileira.
Seu trabalho é analisar transcrições de stand-up, esquetes, podcasts de humor, vídeos engraçados e identificar os melhores momentos para cortes virais.

REGRAS PARA "video" (clipes longos horizontais):
- Sugira 5 a 10 clipes do tipo "video" (formato horizontal 16:9, MÍNIMO 3 minutos e MÁXIMO 12 minutos cada)
- Priorize: bits de stand-up completos, histórias engraçadas do início ao fim, debates hilários, esquetes completas, roasts intensos
- Cada clipe deve ter começo, meio e fim — não corte no meio de uma piada ou história
- Título chamativo estilo YouTube (máx 70 caracteres)

REGRAS PARA "reel" (shorts/reels verticais):
- Sugira 5 a 10 clipes do tipo "reel" (formato vertical 9:16, MÍNIMO 30 segundos e MÁXIMO 90 segundos cada)
- Priorize: punchlines memoráveis, reações exageradas, momentos de gargalhada da plateia, frases icônicas, confusões engraçadas, auto-depreciação cômica
- O reel deve ser auto-contido — quem assiste entende sem contexto

OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

METADADOS YOUTUBE (obrigatório em cada sugestão):
- "suggested_tags": array de 5 a 8 tags específicas do YouTube (nome do comediante, tema do bit, ex: "stand-up", "comédia brasileira", "humor")
- "suggested_description": descrição YouTube de 2 a 4 linhas sobre o clip, terminando com hashtags (máx 400 caracteres)

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 120.0,
      "end_time": 480.0,
      "title": "A história mais engraçada que você vai ouvir hoje 😂",
      "reason": "Bit completo com setup, desenvolvimento e punchline devastadora — plateia no chão",
      "type": "video",
      "suggested_tags": ["stand-up", "comédia brasileira", "humor", "cortes", "engraçado"],
      "suggested_description": "Um dos bits mais engraçados do show! Plateia no chão do começo ao fim 😂\n\n#StandUp #Comédia #Humor #Brasil #Engraçado"
    },
    {
      "start_time": 305.0,
      "end_time": 365.0,
      "title": "Isso aconteceu de VERDADE?! 💀",
      "reason": "Punchline inesperada com reação da plateia — momento perfeito para Shorts viral",
      "type": "reel",
      "suggested_tags": ["comédia", "stand-up", "humor", "Shorts", "viral"],
      "suggested_description": "Punchline que ninguém esperava 💀😂\n\n#Shorts #Comédia #Humor #StandUp #Brasil"
    }
  ]
}`,

  sinuca: `Você é um especialista em criação de conteúdo viral para YouTube focado em sinuca brasileira.
Seu trabalho é analisar transcrições de vídeos do canal Baianhinho de Mauá e outros criadores de sinuca, identificando os melhores momentos para cortes virais.

SINAL PRIMÁRIO: Reações da plateia, exclamações do narrador/comentarista e descrições de tacadas difíceis são os indicadores mais confiáveis de momento importante.
Detecte expressões como: "que tacada", "impossível", "inacreditável", "caramba", "olha isso", "que bola", "série", "encaixou", "bola de pé", "bola de banda", "série grande", "carambolou", "deixou bom", "nossa senhora", nomes de tacadas especiais e qualquer pico de empolgação vocal.

CATEGORIAS DE CLIPES:
- "highlight": tacadas difíceis executadas com sucesso, séries longas, jogadas de efeito, bolas de banda, caramboladas, deixadas perfeitas
- "educational": explicações de posicionamento, análise de efeito, dicas de tacada, estratégia de mesa
- "funny": erros inesperados, reações exageradas da plateia, situações inusitadas, bola caindo no bolso errado

REGRAS PARA "video" (clipes longos horizontais):
- Sugira 4 a 8 clipes do tipo "video" (formato horizontal 16:9, MÍNIMO 2 minutos e MÁXIMO 8 minutos cada)
- Inclua o contexto antes da tacada + a execução + a reação — não corte no meio de uma série
- Priorize: sequências de tacadas difíceis, partidas decididas em jogadas especiais, séries grandes
- Título chamativo: "Baianhinho FAZ TACADA IMPOSSÍVEL de Banda" ou "Série de 10 bolas que PAROU a sinuca" (máx 70 caracteres)

REGRAS PARA "reel" (shorts/reels verticais):
- Sugira 4 a 8 clipes do tipo "reel" (formato vertical 9:16, MÍNIMO 20 segundos e MÁXIMO 90 segundos cada)
- Priorize: o instante exato da tacada especial + reação da plateia — auto-contido
- Ideal: uma única jogada impressionante com reação, que qualquer pessoa entende sem contexto
- Título direto: "Que TACADA! 😱", "Bola de banda PERFEITA 🎱", "Impossível de fazer isso!" (máx 70 caracteres)

OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

METADADOS YOUTUBE (obrigatório em cada sugestão):
- "suggested_tags": array de 5 a 8 tags específicas do YouTube (ex: "Baianhinho de Mauá", "sinuca", "tacada difícil", "sinuca brasileira", "bilhar", "pool", nome da jogada)
- "suggested_description": descrição YouTube de 2 a 4 linhas sobre o clip, terminando com hashtags (máx 400 caracteres)

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 320.0,
      "end_time": 620.0,
      "title": "Baianhinho FAZ SÉRIE de 8 bolas seguidas",
      "reason": "Série impressionante com plateia reagindo a cada bola — narrador empolgado do início ao fim",
      "clip_category": "highlight",
      "type": "video",
      "suggested_tags": ["Baianhinho de Mauá", "sinuca", "série", "tacada difícil", "sinuca brasileira", "bilhar"],
      "suggested_description": "Baianhinho de Mauá em uma série absurda de 8 bolas! A plateia foi à loucura 🎱\n\n#Sinuca #BaianhinhodeMauá #Bilhar #TacadaDifícil #Shorts"
    },
    {
      "start_time": 445.0,
      "end_time": 500.0,
      "title": "Bola de banda PERFEITA! 😱",
      "reason": "Tacada de efeito impossível que fez a plateia explodir — momento único e auto-contido",
      "clip_category": "highlight",
      "type": "reel",
      "suggested_tags": ["Baianhinho de Mauá", "sinuca", "bola de banda", "tacada difícil", "Shorts"],
      "suggested_description": "Isso é humanamente possível?! Bola de banda perfeita do Baianhinho 🎱😱\n\n#Shorts #Sinuca #BaianhinhodeMauá #Bilhar"
    }
  ]
}`,

  'slap-battles': `Você é um especialista em criação de conteúdo viral para YouTube focado em batalhas de tapa (slap battles).
Seu trabalho é analisar transcrições de narração e comentários de competições de slap battle e identificar os melhores momentos para cortes virais.

SINAL PRIMÁRIO: Reações do narrador e da plateia são os indicadores mais confiáveis de momento importante.
Detecte expressões como: "KO", "nocaute", "caiu", "não aguenta", "que tapa", "que pancada", "insano", "absurdo", "ROUND", "knockout", "bateu forte", "derrubou", "eliminou", "venceu a disputa", e qualquer pico de empolgação vocal do narrador ou plateia.

CATEGORIAS DE CLIPES:
- "highlight": KOs, tapaços que derrubaram o adversário, disputas acirradas, momentos decisivos de eliminação
- "educational": análise de técnica, posicionamento, regras da competição, estratégia de defesa/ataque
- "funny": reações exageradas ao receber o tapa, expressões faciais cômicas, reações da plateia, competidores intimidando o adversário

REGRAS PARA "video" (clipes longos horizontais):
- Sugira 4 a 8 clipes do tipo "video" (formato horizontal 16:9, MÍNIMO 2 minutos e MÁXIMO 10 minutos cada)
- Inclua apresentação dos competidores + todos os rounds + reação final — não corte no meio de um duelo
- Priorize: duelos completos com KO, confrontos com muita reação da plateia, disputas emocionantes
- Título chamativo: "NOCAUTE com 1 TAPA na final do Slap Battle 😱" ou "Duelo INSANO termina em KO imediato" (máx 70 caracteres)

REGRAS PARA "reel" (shorts/reels verticais):
- Sugira 4 a 8 clipes do tipo "reel" (formato vertical 9:16, MÍNIMO 15 segundos e MÁXIMO 90 segundos cada)
- Priorize: o instante exato do tapa + reação imediata — auto-contido, impacto visual imediato
- Ideal: build-up curto antes do golpe + impacto + reação da plateia
- Título direto: "KO com 1 TAPA 😱", "Reação HILÁRIA depois do tapa 💀", "Esse cara NÃO sentiu nada 🤯" (máx 70 caracteres)

OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

METADADOS YOUTUBE (obrigatório em cada sugestão):
- "suggested_tags": array de 5 a 8 tags específicas do YouTube (nomes dos competidores, evento, tipo de momento, ex: "slap battle", "KO", "tapa", "knockout", "batalha de tapa")
- "suggested_description": descrição YouTube de 2 a 4 linhas sobre o clip, terminando com hashtags (máx 400 caracteres)

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 120.0,
      "end_time": 480.0,
      "title": "NOCAUTE com 1 TAPA na final do Slap Battle 😱",
      "reason": "Competidor derrubou o adversário com um único tapa — plateia explodiu e narrador perdeu a voz",
      "clip_category": "highlight",
      "type": "video",
      "suggested_tags": ["slap battle", "KO", "knockout", "tapa", "nocaute", "batalha de tapa", "viral"],
      "suggested_description": "Um único tapa encerrou tudo! Nocaute brutal na final do Slap Battle 😱\n\n#SlapBattle #KO #Knockout #BatalhadeTapa #Nocaute #Viral"
    },
    {
      "start_time": 310.0,
      "end_time": 360.0,
      "title": "KO com 1 TAPA 😱",
      "reason": "O impacto do tapa + reação imediata da plateia — momento auto-contido e altamente viral",
      "clip_category": "highlight",
      "type": "reel",
      "suggested_tags": ["slap battle", "KO", "tapa", "nocaute", "Shorts", "viral"],
      "suggested_description": "Um tapa. Um KO. 😱\n\n#Shorts #SlapBattle #KO #Nocaute #Viral #BatalhadeTapa"
    }
  ]
}`,

  'skills-desafios': `Você é um especialista em criação de conteúdo viral para YouTube focado em vídeos de habilidades esportivas e desafios.
Seu trabalho é analisar transcrições de vídeos de trick shots, desafios atléticos, demonstrações de habilidade (futebol, basquete, skate, parkour, freestyle, dança, artes marciais, etc.) e identificar os melhores momentos para cortes virais.

SINAL PRIMÁRIO: Reações de incredulidade, exclamações de admiração e aplausos são os indicadores mais confiáveis de momento especial.
Detecte expressões como: "impossível", "que habilidade", "inacreditável", "não acredito", "olha isso", "que chute", "que cesta", "que manobra", "passou na trave", "entrou limpo", "que esquiva", "que equilíbrio", "tentativa incrível", e qualquer reação de espanto/admiração.

CATEGORIAS DE CLIPES:
- "highlight": execuções perfeitas de movimentos difíceis, trick shots confirmados, desafios vencidos, feitos atléticos impressionantes
- "educational": explicação de técnica, demonstração passo a passo, análise de movimento, dicas de treino
- "funny": tentativas que deram errado de forma cômica, reações exageradas, fails engraçados durante o desafio, celebrações exageradas

REGRAS PARA "video" (clipes longos horizontais):
- Sugira 4 a 8 clipes do tipo "video" (formato horizontal 16:9, MÍNIMO 2 minutos e MÁXIMO 10 minutos cada)
- Inclua o contexto da tentativa + a execução + a reação — não corte no meio de um desafio em andamento
- Priorize: sequências de desafios, progressão de dificuldade, compilações de trick shots, duelos de habilidade
- Título chamativo: "O Trick Shot IMPOSSÍVEL que todo mundo duvidou 🏆" ou "3 desafios que levaram MESES para conseguir" (máx 70 caracteres)

REGRAS PARA "reel" (shorts/reels verticais):
- Sugira 4 a 8 clipes do tipo "reel" (formato vertical 9:16, MÍNIMO 15 segundos e MÁXIMO 90 segundos cada)
- Priorize: o momento exato da execução perfeita + reação imediata — auto-contido e impacto visual imediato
- Ideal: build-up rápido da tentativa + execução + reação de espanto — qualquer pessoa entende sem contexto
- Título direto: "Impossível fazer isso 🔥", "Conseguiu NA PRIMEIRA TENTATIVA 😱", "Isso é de OUTRO NÍVEL 🏆" (máx 70 caracteres)

OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

METADADOS YOUTUBE (obrigatório em cada sugestão):
- "suggested_tags": array de 5 a 8 tags específicas do YouTube (esporte/modalidade, tipo de habilidade, ex: "trick shot", "desafio", "habilidade", "futebol freestyle", "skate", "viral")
- "suggested_description": descrição YouTube de 2 a 4 linhas sobre o clip, terminando com hashtags (máx 400 caracteres)

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 90.0,
      "end_time": 420.0,
      "title": "3 desafios IMPOSSÍVEIS que levaram meses pra conseguir",
      "reason": "Sequência de progressão com 3 trick shots de dificuldade crescente — reação incrível na execução final",
      "clip_category": "highlight",
      "type": "video",
      "suggested_tags": ["trick shot", "desafio impossível", "habilidade esportiva", "viral", "futebol freestyle", "challenge"],
      "suggested_description": "Meses de treino pra esse momento! 3 desafios que pareciam impossíveis 🏆\n\n#TrickShot #Desafio #HabilidadeEsportiva #Viral #Challenge #Freestyle"
    },
    {
      "start_time": 310.0,
      "end_time": 365.0,
      "title": "Conseguiu NA PRIMEIRA TENTATIVA 😱",
      "reason": "Trick shot absurdo executado na primeira vez — reação de incredulidade imediata e altamente viral",
      "clip_category": "highlight",
      "type": "reel",
      "suggested_tags": ["trick shot", "habilidade", "viral", "desafio", "Shorts", "esporte"],
      "suggested_description": "Isso é humanamente possível?! Na primeira tentativa! 😱🔥\n\n#Shorts #TrickShot #Desafio #Viral #Habilidade #Esporte"
    }
  ]
}`,

  'batalha-de-rima': `Você é um especialista em criação de conteúdo para YouTube focado em batalhas de rima brasileiras.
Seu trabalho é analisar transcrições de batalhas de rima e identificar: (1) a batalha completa de cada dupla e (2) os melhores momentos para reels.

REGRAS PARA "video" (batalha completa por dupla):
- Identifique CADA dupla que batalhou e corte a batalha completa dela (do início ao fim, incluindo todas as rondas)
- Duração: MÍNIMO 3 minutos e MÁXIMO 20 minutos por dupla
- Formato horizontal (16:9)
- Título: "Nome do MC1 vs Nome do MC2 | Nome do Evento" (máx 70 caracteres)
- IMPORTANTE: cubra TODAS as duplas do vídeo, não apenas as melhores

REGRAS PARA "reel" (melhores momentos):
- Extraia os melhores punchlines, trocas quentes e reações da plateia
- Duração: MÍNIMO 30 segundos e MÁXIMO 90 segundos cada (NUNCA ultrapasse 90s)
- Formato vertical (9:16) — ideal para Instagram Reels e YouTube Shorts
- Priorize: punchlines que geraram reação, trocas diretas entre os MCs, momentos de virada
- Sugira 2 a 4 reels por dupla

OBRIGATÓRIO: você DEVE retornar sugestões dos DOIS tipos — "video" E "reel". Retornar apenas um tipo é inválido.

METADADOS YOUTUBE (obrigatório em cada sugestão):
- "suggested_tags": array de 5 a 8 tags específicas do YouTube (nomes dos MCs, evento, ex: "MC Alpha", "batalha de rima", "freestyle")
- "suggested_description": descrição YouTube de 2 a 4 linhas sobre o clip, terminando com hashtags (máx 400 caracteres)

FORMATO DE RESPOSTA (JSON obrigatório):
{
  "suggestions": [
    {
      "start_time": 60.0,
      "end_time": 780.0,
      "title": "MC Alpha vs MC Beta | Batalha do Conhecimento",
      "reason": "Batalha completa da dupla — 3 rondas intensas com reação forte da plateia",
      "type": "video",
      "suggested_tags": ["MC Alpha", "MC Beta", "batalha de rima", "freestyle", "rap", "Batalha do Conhecimento"],
      "suggested_description": "MC Alpha vs MC Beta na Batalha do Conhecimento! 3 rondas de puro flow e punchlines pesados 🔥\n\n#BatalhaDeRima #Freestyle #Rap #BatalhaDoConhecimento #MCAlpha"
    },
    {
      "start_time": 320.0,
      "end_time": 395.0,
      "title": "MC Alpha DESTRUIU com esse punchline 🔥",
      "reason": "Punchline que parou a batalha — plateia explodiu, adversário sem resposta",
      "type": "reel",
      "suggested_tags": ["MC Alpha", "punchline", "batalha de rima", "freestyle", "Shorts"],
      "suggested_description": "Esse punchline parou a batalha 🔥 Plateia foi ao delírio!\n\n#Shorts #BatalhaDeRima #Freestyle #Rap #MCAlpha"
    }
  ]
}`,
};

function getSystemPrompt(contentType) {
  if (process.env.ANALYSIS_PROMPT_TEMPLATE) {
    return process.env.ANALYSIS_PROMPT_TEMPLATE;
  }
  const ct = contentType || process.env.CONTENT_TYPE || 'mbl';
  const prompt = PROMPTS[ct];
  if (!prompt) {
    logger.warn({ content_type: ct }, `content_type desconhecido — usando prompt padrão (mbl)`);
    return PROMPTS.mbl;
  }
  return prompt;
}

/**
 * Formata a transcrição para envio ao GPT
 * Inclui timestamps para que o GPT possa referenciar os momentos
 */
function formatTranscriptionForPrompt(text, words, durationSeconds, clipsPerType) {
  const minutes = Math.floor(durationSeconds / 60);

  let timedText = '';
  if (Array.isArray(words) && words.length > 0) {
    let nextMarkerSec = Math.floor(words[0].start / 1000);
    // Marcadores a cada 60s a partir do início do chunk
    nextMarkerSec = Math.floor(nextMarkerSec / 60) * 60;
    words.forEach(word => {
      const wordStartSec = word.start / 1000;
      if (wordStartSec >= nextMarkerSec) {
        timedText += `\n[${Math.floor(nextMarkerSec)}s] `;
        nextMarkerSec += 60;
      }
      timedText += word.text + ' ';
    });
  } else {
    timedText = text;
  }

  const targetLine = clipsPerType
    ? `\nTARGET OBRIGATÓRIO: Gere PELO MENOS ${clipsPerType} sugestões do tipo "video" E PELO MENOS ${clipsPerType} do tipo "reel" para este trecho. Vídeos longos têm mais momentos — aproveite TODOS os melhores momentos, não apenas os top 5.`
    : '';

  return `DURAÇÃO TOTAL DO VÍDEO: ${durationSeconds} segundos (${minutes} minutos)${targetLine}

IMPORTANTE: Os marcadores [Xs] indicam o segundo exato no vídeo. Use esses valores DIRETAMENTE para start_time e end_time. Exemplo: marcador [300s] = start_time: 300.0. Um clip de 5 minutos a partir de [600s] = start_time: 600.0, end_time: 900.0.

TRANSCRIÇÃO COM TIMESTAMPS:
${timedText.trim()}`;
}

/**
 * Calcula target de clips por tipo baseado na duração do vídeo
 * Vídeos mais longos precisam de mais sugestões para aproveitar o conteúdo
 */
function calcClipsPerType(durationSeconds) {
  const minutes = durationSeconds / 60;
  // 1 clip por tipo a cada ~8 minutos, mínimo 5, máximo 25
  return Math.min(25, Math.max(5, Math.ceil(minutes / 8)));
}

/**
 * Divide words em janelas de tempo de ~20 minutos com overlap de 2 minutos
 * Garante que vídeos longos gerem múltiplas chamadas GPT e mais sugestões
 */
function chunkByTime(words, chunkMs = 20 * 60 * 1000, overlapMs = 2 * 60 * 1000) {
  if (!words || !words.length) return [];

  const chunks = [];
  let windowStart = words[0].start;
  const videoEnd = words[words.length - 1].end;

  while (windowStart < videoEnd) {
    const windowEnd = windowStart + chunkMs + overlapMs;
    const chunkWords = words.filter(w => w.start >= windowStart && w.start < windowEnd);

    if (chunkWords.length > 0) {
      chunks.push({
        words: chunkWords,
        text: chunkWords.map(w => w.text).join(' '),
        startSec: windowStart / 1000,
        endSec: Math.min(windowEnd, videoEnd) / 1000,
      });
    }

    windowStart += chunkMs;

    // Se o próximo window cobre menos de 5 minutos, inclui no chunk atual
    if (videoEnd - windowStart < 5 * 60 * 1000) break;
  }

  // Garante que o final do vídeo sempre está num chunk
  if (chunks.length > 0) {
    const lastChunkEnd = chunks[chunks.length - 1].words.at(-1)?.end || 0;
    const remainingWords = words.filter(w => w.start > lastChunkEnd);
    if (remainingWords.length > 20) {
      chunks.push({
        words: remainingWords,
        text: remainingWords.map(w => w.text).join(' '),
        startSec: remainingWords[0].start / 1000,
        endSec: videoEnd / 1000,
      });
    }
  }

  logger.info({ chunks: chunks.length, duration_min: Math.round(videoEnd / 60000) }, 'Transcrição dividida em chunks de 20min');
  return chunks;
}

/**
 * Valida que um item do GPT possui os campos obrigatórios com tipos corretos.
 * Rejeita silenciosamente itens malformados em vez de deixar o pipeline quebrar.
 */
function validateSuggestionSchema(s) {
  if (!s || typeof s !== 'object') return false;
  if (typeof s.start_time !== 'number' || !Number.isFinite(s.start_time)) return false;
  if (typeof s.end_time !== 'number' || !Number.isFinite(s.end_time)) return false;
  if (typeof s.title !== 'string' || !s.title.trim()) return false;
  if (typeof s.reason !== 'string') return false;
  if (!['video', 'reel'].includes(s.type)) return false;
  return true;
}

/**
 * Remove sugestões duplicadas (mesmo start_time ±5s)
 */
function deduplicateSuggestions(suggestions) {
  const seen = [];
  return suggestions.filter(s => {
    const isDuplicate = seen.some(
      existing => Math.abs(existing.start_time - s.start_time) < 5 && existing.type === s.type
    );
    if (!isDuplicate) seen.push(s);
    return !isDuplicate;
  });
}

/**
 * Analisa transcrição e retorna sugestões de cortes.
 * @param {string} retryHint - Mensagem de correção para retry (ex: durações inválidas)
 */
async function analyzeTranscription(transcriptionText, words, durationSeconds, contentType, retryHint = null) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY não configurada');
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const wordList = Array.isArray(words) && words.length ? words : [];
  const durationMin = (durationSeconds || 0) / 60;
  // Chunking por tempo: janelas de 20min apenas para vídeos > 60 min
  const chunks = (wordList.length && durationMin > 60)
    ? chunkByTime(wordList)
    : [{ text: transcriptionText, words: wordList, startSec: 0, endSec: durationSeconds }];

  // Target dinâmico por chunk (proporcional à duração do chunk)
  const totalClipsPerType = calcClipsPerType(durationSeconds || 0);
  const clipsPerChunk = Math.max(4, Math.ceil(totalClipsPerType / chunks.length));

  logger.info({
    total_chunks: chunks.length,
    clips_per_chunk: clipsPerChunk,
    total_target: totalClipsPerType * 2,
    duration_min: Math.round((durationSeconds || 0) / 60),
  }, 'Iniciando análise GPT');

  const allSuggestions = [];
  // GPT-4o-mini pricing (USD por 1M tokens)
  const COST_PER_1M_INPUT  = 0.15;
  const COST_PER_1M_OUTPUT = 0.60;
  let totalCostUsd = 0;

  for (const [chunkIdx, chunk] of chunks.entries()) {
    let userPrompt = formatTranscriptionForPrompt(chunk.text, chunk.words, durationSeconds, clipsPerChunk);
    if (retryHint && chunkIdx === 0) {
      userPrompt = `${retryHint}\n\n${userPrompt}`;
    }
    const systemPrompt = getSystemPrompt(contentType);

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.5,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const usage = response.usage || {};
    const chunkCost =
      ((usage.prompt_tokens     || 0) / 1_000_000) * COST_PER_1M_INPUT +
      ((usage.completion_tokens || 0) / 1_000_000) * COST_PER_1M_OUTPUT;
    totalCostUsd += chunkCost;

    const raw = response.choices[0].message.content;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('GPT retornou JSON inválido');
    }

    if (!Array.isArray(parsed.suggestions)) {
      throw new Error('Resposta do GPT não contém array "suggestions"');
    }

    const validItems = parsed.suggestions.filter(validateSuggestionSchema);
    const dropped = parsed.suggestions.length - validItems.length;
    if (dropped > 0) {
      logger.warn({ dropped, chunk_index: chunks.indexOf(chunk) }, 'GPT retornou itens com schema inválido — descartados');
    }

    allSuggestions.push(...validItems);
  }

  logger.info({ total_cost_usd: parseFloat(totalCostUsd.toFixed(6)) }, 'Custo OpenAI desta análise');

  return { suggestions: deduplicateSuggestions(allSuggestions), costUsd: totalCostUsd };
}

/**
 * Traduz linhas de legenda do inglês para português brasileiro.
 * Recebe e retorna array de { text, start, end } — apenas .text é alterado.
 */
async function translateLinesToPt(lines) {
  if (!lines.length) return lines;
  if (!process.env.OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY não configurada — tradução de legenda ignorada');
    return lines;
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const numbered = lines.map((l, i) => `${i}|${l.text}`).join('\n');

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: 'Traduza cada linha do inglês para o português brasileiro informal e natural. Retorne SOMENTE as linhas no formato "N|tradução", uma por linha, sem explicações.',
      },
      { role: 'user', content: numbered },
    ],
  });

  const raw = response.choices[0].message.content || '';
  const result = lines.map(l => ({ ...l }));

  for (const rawLine of raw.split('\n')) {
    const match = rawLine.match(/^(\d+)\|(.+)/);
    if (match) {
      const idx = parseInt(match[1], 10);
      if (result[idx]) result[idx].text = match[2].trim();
    }
  }

  return result;
}

module.exports = { analyzeTranscription, calcClipsPerType, chunkByTime, VALID_CLIP_CATEGORIES, translateLinesToPt };
