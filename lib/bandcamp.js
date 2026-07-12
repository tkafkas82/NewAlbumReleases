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

// Returns the matched result object (has item_url_path + art_id) or null.
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
    if (bandExact && albumExact) return x; // strongest match wins immediately
    if (!loose && ((bandExact && albumLoose) || (bandLoose && albumExact))) loose = x;
  }
  return loose;
}

// Returns { url, art } — url is the album page, art is the Bandcamp cover image
// (usable as an artwork fallback). Either may be null.
export async function lookupBandcamp(key, artist, album) {
  await ensure();
  const hit = cache[key];
  if (hit && 'art' in hit && (hit.url || Date.now() - hit.ts < MISS_TTL)) return { url: hit.url, art: hit.art };

  let url = null, art = null;
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Accept': '*/*' },
      body: JSON.stringify({ search_text: `${artist} ${cleanAlbum(album)}`, search_filter: 'a', full_page: false, fan_id: null }),
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const chosen = pick(((await res.json()).auto || {}).results || [], artist, album);
      if (chosen) {
        url = chosen.item_url_path || chosen.item_url_root || chosen.url || null;
        art = chosen.art_id ? `https://f4.bcbits.com/img/a${chosen.art_id}_16.jpg` : null;
      }
    }
  } catch { /* offline / rate-limited — treat as a miss */ }

  cache[key] = { url, art, ts: Date.now() };
  return { url, art };
}

export async function persistBandcampCache() { if (cache) await writeBandcamp(cache); }
