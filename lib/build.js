// Orchestrate a full build: AOTY releases (+ ratings) + optional NAR feed,
// merged/de-duplicated, then genre + artwork resolved per album. `onProgress`
// receives the live album array so the UI can render as genres resolve.
import { getReleases } from './aoty.js';
import { getNarReleases } from './nar.js';
import { getBestNewMusic } from './pitchfork.js';
import { lookupGenre, persistGenreCache } from './genre.js';
import { lookupBandcamp, persistBandcampCache } from './bandcamp.js';
import { streamingLinks, albumKey, norm, cleanAlbum } from './links.js';
import { mapLimit, sleep } from './http.js';

const safe = async (fn, fb) => { try { return await fn(); } catch (e) { console.error('[build]', e.message); return fb; } };

export async function buildAlbums({ config = {}, onProgress } = {}) {
  const pages = Number(config.aotyPages) || Number(process.env.AOTY_PAGES) || 4;
  const base = await safe(() => getReleases(pages), []);
  const nar = await safe(() => getNarReleases(config), { items: [], ok: false, reason: 'skipped' });

  const map = new Map();
  for (const a of [...base, ...nar.items]) {
    const key = albumKey(a.artist, a.album);
    if (!key || key === '::') continue;
    const ex = map.get(key);
    if (ex) {
      if (!ex.sources.includes(a.source)) ex.sources.push(a.source);
      if (ex.rating == null && a.rating != null) { ex.rating = a.rating; ex.ratingKind = a.ratingKind; ex.ratingCount = a.ratingCount; }
      if (!ex.genre && a.genre) ex.genre = a.genre;
      if (!ex.cover && a.cover) ex.cover = a.cover;
      if (!ex.narUrl && a.narUrl) ex.narUrl = a.narUrl;
      continue;
    }
    map.set(key, {
      key, artist: a.artist, album: a.album,
      rating: a.rating ?? null, ratingKind: a.ratingKind ?? null, ratingCount: a.ratingCount ?? null,
      genre: a.genre ?? null, cover: a.cover ?? null, appleUrl: null,
      aotyUrl: a.aotyUrl ?? null, narUrl: a.narUrl ?? null,
      releaseText: a.releaseText ?? null, type: a.type ?? null,
      sources: [a.source],
      links: streamingLinks(a.artist, a.album),
    });
  }

  // Pitchfork Best New Music: flag matching albums + fold in picks we don't have.
  const bnm = await safe(getBestNewMusic, []);
  const byAlbumNorm = (a) => norm(cleanAlbum(a));
  const bnmMatch = (a) => bnm.find((b) => b.albumNorm === byAlbumNorm(a.album) || albumKey(b.artist, b.album) === a.key);
  for (const a of map.values()) {
    const hit = bnmMatch(a);
    if (hit) { a.bnm = true; a.pitchforkUrl = hit.url; if (!a.sources.includes('Pitchfork')) a.sources.push('Pitchfork'); }
  }
  for (const b of bnm) {
    const key = albumKey(b.artist, b.album);
    if (map.has(key) || [...map.values()].some((a) => byAlbumNorm(a.album) === b.albumNorm)) continue;
    map.set(key, {
      key, artist: b.artist, album: b.album,
      rating: null, ratingKind: null, ratingCount: null,
      genre: null, cover: null, appleUrl: null,
      aotyUrl: null, narUrl: null, pitchforkUrl: b.url,
      releaseText: null, type: null, bnm: true,
      sources: ['Pitchfork'],
      links: streamingLinks(b.artist, b.album),
    });
  }

  const albums = [...map.values()];
  onProgress?.({ albums, done: 0, total: albums.length });

  let done = 0;
  await mapLimit(albums, 4, async (a) => {
    // genre/artwork (iTunes+Deezer) and Bandcamp resolution run concurrently.
    // Always resolve via iTunes/Deezer — their artwork is hotlink-friendly,
    // whereas AOTY's own cover CDN 403s (hotlink-protected), so its covers can't
    // be displayed and are dropped in favour of the iTunes/Deezer image.
    const [g, bc] = await Promise.all([
      lookupGenre(a.key, a.artist, a.album),
      lookupBandcamp(a.key, a.artist, a.album).catch(() => ({ url: null, art: null })),
    ]);
    a.bandcampUrl = (bc && bc.url) || null;
    if (g) {
      if (!a.genre && g.genre) a.genre = g.genre;
      if (g.cover) a.cover = g.cover;              // prefer usable iTunes/Deezer artwork
      if (!a.appleUrl && g.appleUrl) a.appleUrl = g.appleUrl;
    }
    if (a.cover && a.cover.includes('albumoftheyear.org')) a.cover = null; // 403s in the browser
    if (!a.cover && bc && bc.art) a.cover = bc.art; // Bandcamp artwork fallback for indie releases
    onProgress?.({ albums, done: ++done, total: albums.length });
    await sleep(120); // stay under the APIs' rate limits
  });
  await persistGenreCache();
  await persistBandcampCache();

  for (const a of albums) if (!a.genre) a.genre = 'Other';

  return {
    updated: new Date().toISOString(),
    updatedMs: Date.now(),
    counts: { total: albums.length, aoty: base.length, nar: nar.items.length, bnm: albums.filter((a) => a.bnm).length },
    narStatus: nar.ok ? 'ok' : nar.reason,
    albums,
  };
}
