// Resolve a real Bandcamp album URL via Bandcamp's public autocomplete API, so
// the Bandcamp button only appears when the album actually exists there (unlike
// the Spotify/YouTube search deep-links). Strict artist+album matching filters
// out fan edits / unrelated uploads. Results cached to disk (misses briefly).
import { UA } from './http.js';
import { norm, cleanAlbum } from './links.js';
import { readBandcamp, writeBandcamp } from './store.js';

const MISS_TTL = 7 * 24 * 3600 * 1000; // availability changes rarely
const ENDPOINT = 'https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic';
let cache = null;

async function ensure() { if (!cache) cache = await readBandcamp(); return cache; }

// Reject obvious fan edits / re-uploads.
const JUNK = /(reloaded|re-?upload|\bfan\b|concept|tribute|karaoke|remix|instrumental|sped\s?up|slowed|nightcore|mashup|\bcovers?\b|8d)/i;

function pick(results, artist, album) {
  const aN = norm(artist), alN = norm(cleanAlbum(album));
  if (!aN || !alN) return null; // need both to avoid false positives
  let loose = null;
  for (const x of results) {
    const url = x.item_url_path || x.item_url_root || x.url;
    if (x.type !== 'a' || !url || JUNK.test(x.name || '')) continue;
    const band = norm(x.band_name || '');
    const name = norm(cleanAlbum(x.name || ''));
    const bandExact = band === aN, bandLoose = band.includes(aN) || aN.includes(band);
    const albumExact = name === alN, albumLoose = name.includes(alN) || alN.includes(name);
    if (bandExact && albumExact) return url; // strongest match wins immediately
    if (!loose && ((bandExact && albumLoose) || (bandLoose && albumExact))) loose = url;
  }
  return loose;
}

export async function lookupBandcamp(key, artist, album) {
  await ensure();
  const hit = cache[key];
  if (hit && (hit.url || Date.now() - hit.ts < MISS_TTL)) return hit.url;

  let url = null;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Accept': '*/*' },
      body: JSON.stringify({ search_text: `${artist} ${cleanAlbum(album)}`, search_filter: 'a', full_page: false, fan_id: null }),
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const j = await res.json();
      url = pick((j.auto && j.auto.results) || [], artist, album);
    }
  } catch { /* offline / rate-limited — treat as a miss */ }

  cache[key] = { url, ts: Date.now() };
  return url;
}

export async function persistBandcampCache() { if (cache) await writeBandcamp(cache); }
