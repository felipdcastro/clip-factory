'use strict';

const https = require('https');

const REGION_HOSTS = {
  BR1:  'br1.api.riotgames.com',
  NA1:  'na1.api.riotgames.com',
  EUW1: 'euw1.api.riotgames.com',
  EUNE1:'eune1.api.riotgames.com',
  KR:   'kr.api.riotgames.com',
  LA1:  'la1.api.riotgames.com',
  LA2:  'la2.api.riotgames.com',
};

const ROUTING_HOSTS = {
  BR1:  'americas.api.riotgames.com',
  NA1:  'americas.api.riotgames.com',
  EUW1: 'europe.api.riotgames.com',
  EUNE1:'europe.api.riotgames.com',
  KR:   'asia.api.riotgames.com',
  LA1:  'americas.api.riotgames.com',
  LA2:  'americas.api.riotgames.com',
};

function riotFetch(hostname, path) {
  return new Promise((resolve) => {
    const apiKey = process.env.RIOT_API_KEY || '';
    if (!apiKey) { resolve(null); return; }
    const options = {
      hostname,
      path,
      headers: { 'X-Riot-Token': apiKey },
      timeout: 5000,
    };
    const req = https.get(options, (res) => {
      if (res.statusCode !== 200) { resolve(null); return; }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

/**
 * Busca dados do summoner pelo nome.
 * @returns {{ puuid: string, encryptedId: string, name: string } | null}
 */
async function getSummonerByName(summonerName, region = 'BR1') {
  if (!summonerName) return null;
  const host = REGION_HOSTS[region] || REGION_HOSTS.BR1;
  const encoded = encodeURIComponent(summonerName);
  const data = await riotFetch(host, `/lol/summoner/v4/summoners/by-name/${encoded}`);
  if (!data || !data.id) return null;
  return { puuid: data.puuid, encryptedId: data.id, name: data.name };
}

/**
 * Busca o rank Solo/Duo do summoner.
 * @returns {{ tier: string, rank: string, leaguePoints: number, queueType: string } | null}
 */
async function getSummonerRank(encryptedId, region = 'BR1') {
  if (!encryptedId) return null;
  const host = REGION_HOSTS[region] || REGION_HOSTS.BR1;
  const data = await riotFetch(host, `/lol/league/v4/entries/by-summoner/${encryptedId}`);
  if (!Array.isArray(data)) return null;
  const solo = data.find((e) => e.queueType === 'RANKED_SOLO_5x5');
  if (!solo) return null;
  return {
    tier: solo.tier,
    rank: solo.rank,
    leaguePoints: solo.leaguePoints,
    queueType: solo.queueType,
  };
}

/**
 * Busca o campeão jogado na partida mais recente.
 * @returns {string | null} Nome do campeão ou null
 */
async function getRecentMatchChampion(puuid, region = 'BR1') {
  if (!puuid) return null;
  const routing = ROUTING_HOSTS[region] || ROUTING_HOSTS.BR1;
  const matchIds = await riotFetch(routing, `/lol/match/v5/matches/by-puuid/${puuid}/ids?count=1`);
  if (!Array.isArray(matchIds) || !matchIds.length) return null;
  const match = await riotFetch(routing, `/lol/match/v5/matches/${matchIds[0]}`);
  if (!match || !match.info) return null;
  const participant = match.info.participants.find((p) => p.puuid === puuid);
  return participant ? participant.championName : null;
}

module.exports = { getSummonerByName, getSummonerRank, getRecentMatchChampion };
