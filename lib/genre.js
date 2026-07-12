// Resolve an album's genre (AOTY genre pages are Cloudflare-blocked). Primary
// source: the free iTunes Search API (primaryGenreName + artwork + Apple Music
// link). Fallback: Deezer's open API. Results are cached to disk permanently
// for hits; misses are cached briefly so new albums get retried.
import { getJson, sleep } from './http.js';
import { norm, cleanAlbum } from './links.js';
import { readGenres, writeGenres } from './store.js';

const MISS_TTL = 24 * 3600 * 1000;
let cache = null;

async function ensureCache() { if (!cache) cache = await readGenres(); return cache; }

// Map iTunes/Deezer's granular labels onto a tidy display genre.
export function tidyGenre(g) {
  if (!g) return null;
  const s = g.toLowerCase();
  if (/hip.?hop|rap/.test(s)) return 'Hip-Hop / Rap';
  if (/r&b|r and b|soul|funk/.test(s)) return 'R&B / Soul';
  if (/metal|hardcore|deathcore/.test(s)) return 'Metal';
  if (/punk/.test(s)) return 'Punk';
  if (/alternative|indie/.test(s)) return 'Alternative / Indie';
  if (/electronic|dance|house|techno|edm|electro/.test(s)) return 'Electronic';
  if (/rock/.test(s)) return 'Rock';
  if (/\bpop\b|k-pop|j-pop/.test(s)) return 'Pop';
  if (/jazz/.test(s)) return 'Jazz';
  if (/classic|orchestr/.test(s)) return 'Classical';
  if (/country|americana|folk/.test(s)) return 'Country / Folk';
  if (/reggae|dancehall|dub/.test(s)) return 'Reggae';
  if (/latin|reggaeton/.test(s)) return 'Latin';
  if (/world|afro/.test(s)) return 'World';
  if (/blues/.test(s)) return 'Blues';
  return g.replace(/\/.*$/, '').trim();
}

const bestMatch = (results, artist, album) => {
  const aN = norm(artist), alN = norm(cleanAlbum(album));
  return results.find((r) => {
    const ra = norm(r.artistName || ''), rl = norm(cleanAlbum(r.collectionName || r.title || ''));
    const artistOk = ra.includes(aN) || aN.includes(ra) || ra.split(' ')[0] === aN.split(' ')[0];
    const albumOk = rl === alN || rl.includes(alN) || alN.includes(rl);
    return artistOk && albumOk;
  });
};

async function itunes(artist, album) {
  const term = encodeURIComponent(`${artist} ${cleanAlbum(album)}`);
  const j = await getJson(`https://itunes.apple.com/search?entity=album&limit=8&term=${term}`, { retries: 1 });
  const m = bestMatch(j.results || [], artist, album);
  if (!m) return null;
  return {
    genre: tidyGenre(m.primaryGenreName),
    appleUrl: m.collectionViewUrl || null,
    cover: m.artworkUrl100 ? m.artworkUrl100.replace('100x100', '600x600') : null,
  };
}

async function deezer(artist, album) {
  const q = encodeURIComponent(`artist:"${artist}" album:"${cleanAlbum(album)}"`);
  const s = await getJson(`https://api.deezer.com/search/album?limit=1&q=${q}`, { retries: 1 });
  const hit = s.data && s.data[0];
  if (!hit) return null;
  const full = await getJson(`https://api.deezer.com/album/${hit.id}`, { retries: 1 });
  const g = full.genres && full.genres.data && full.genres.data[0];
  return {
    genre: g ? tidyGenre(g.name) : null,
    cover: hit.cover_xl || hit.cover_big || null,
    appleUrl: null,
  };
}

// Returns { genre, appleUrl, cover } — genre may be null if unresolved.
export async function lookupGenre(key, artist, album) {
  await ensureCache();
  const hit = cache[key];
  if (hit && (hit.genre || Date.now() - hit.ts < MISS_TTL)) return hit;

  let res = null;
  try { res = await itunes(artist, album); } catch { /* rate-limited or offline */ }
  if (!res || !res.genre) {
    await sleep(150);
    try { const d = await deezer(artist, album); if (d && d.genre) res = { ...(res || {}), ...d }; } catch { /* ignore */ }
  }
  const entry = { genre: (res && res.genre) || null, appleUrl: (res && res.appleUrl) || null, cover: (res && res.cover) || null, ts: Date.now() };
  cache[key] = entry;
  return entry;
}

export async function persistGenreCache() { if (cache) await writeGenres(cache); }
