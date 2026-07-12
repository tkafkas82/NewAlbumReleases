// Scrape albumoftheyear.org new-releases for the base list + ratings.
// The /releases/ page returns ~60 recent albums as .albumBlock elements with
// artist, album, cover, date/type and a critic OR user rating (0-100). It is
// NOT behind Cloudflare's JS challenge, so plain fetch works. (Genre is NOT on
// this page — it lives on per-album pages that ARE challenged — so genre is
// resolved separately via the iTunes API in genre.js.)
import { getText, decode } from './http.js';

const BASE = 'https://www.albumoftheyear.org';

// Fetch `pages` pages of new releases (~60 each). Pagination is the `?p=N` query
// param — the path form (/releases/2/) is Cloudflare-blocked, but the query form
// works. Stops early if a page is empty/blocked, and de-dupes across pages.
export async function getReleases(pages = 4) {
  // Pages are independent → fetch them concurrently (was sequential w/ delays).
  const urls = Array.from({ length: pages }, (_, i) =>
    i === 0 ? `${BASE}/releases/` : `${BASE}/releases/?p=${i + 1}`);
  const lists = await Promise.all(urls.map(async (url, i) => {
    try { return parseReleases(await getText(url, { headers: { Referer: `${BASE}/releases/` } })); }
    catch (e) { console.error(`[aoty] page ${i + 1} failed: ${e.message}`); return []; }
  }));
  const seen = new Set();
  return lists.flat().filter((a) => {
    const k = `${a.artist}::${a.album}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function parseReleases(html) {
  const segments = html.split('albumBlock').slice(1);
  const out = [];
  for (const seg of segments) {
    const artM = seg.match(/class="artistTitle"[^>]*>([^<]+)</i);
    const albM = seg.match(/class="albumTitle"[^>]*>([^<]+)</i);
    if (!artM || !albM) continue;

    const urlM = seg.match(/href="(\/album\/[^"]+\.php)"/i);
    const coverM = seg.match(/<img\s+src="([^"]+)"/i);
    const ratM = seg.match(/class="rating"[^>]*>(\d{1,3})</i);
    const typeText = seg.match(/class="ratingText"[^>]*>([^<]+)</i);
    const countM = seg.match(/class="ratingText"[^>]*>\((\d[\d,]*)\)/i);
    const metaM = seg.match(/class="type"[^>]*>([^<]+)</i);

    const artist = decode(artM[1]);
    const album = decode(albM[1]);
    const meta = metaM ? decode(metaM[1]) : '';
    const typeM = meta.match(/[•·]\s*([A-Za-z]+)/);

    out.push({
      artist,
      album,
      rating: ratM ? Number(ratM[1]) : null,
      ratingKind: typeText ? decode(typeText[1]).trim().toLowerCase() : null, // "user score" | "critic score"
      ratingCount: countM ? Number(countM[1].replace(/,/g, '')) : null,
      cover: coverM ? coverM[1].replace('/200x0/', '/400x0/') : null,
      aotyUrl: urlM ? BASE + urlM[1] : null,
      releaseText: meta.replace(/\s*[•·].*$/, '').trim(),
      type: typeM ? typeM[1] : null,
      source: 'AOTY',
    });
  }
  return out;
}
