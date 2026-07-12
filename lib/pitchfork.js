// Pitchfork "Best New Music" — Pitchfork's curated best-of-the-moment albums.
// The listing embeds schema.org ItemList entries ({name, url}); the artist isn't
// in the name, but it's recoverable from the review-URL slug (slug = artist-slug
// + '-' + album-slug). Pitchfork's numeric scores are NOT here — they render
// client-side on ~1MB review pages — so this contributes a curated pick + a
// "Best New Music" flag rather than a score. AOTY's critic score already folds
// Pitchfork in, so we use BNM as a quality signal, not a competing number.
import { getText } from './http.js';
import { norm, cleanAlbum } from './links.js';

const slugify = (s) => norm(s).replace(/\s+/g, '-');
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export async function getBestNewMusic() {
  let html;
  try {
    html = await getText('https://pitchfork.com/reviews/best/albums/', {
      headers: { Referer: 'https://pitchfork.com/' },
    });
  } catch {
    return [];
  }
  const items = [...html.matchAll(
    /"@type":"ListItem","name":"([^"]+)","url":"https:\/\/pitchfork\.com\/reviews\/albums\/([a-z0-9-]+)\/"/g
  )];
  const out = [];
  const seen = new Set();
  for (const [, rawName, slug] of items) {
    const album = rawName.replace(/\*/g, '').trim();
    const albumSlug = slugify(album);
    let artist = '';
    if (albumSlug && slug.endsWith('-' + albumSlug)) {
      artist = titleCase(slug.slice(0, -(albumSlug.length + 1)).replace(/-/g, ' '));
    } else {
      // fall back: assume the first slug segment(s) before the album text are the artist
      const idx = slug.indexOf(albumSlug);
      if (idx > 0) artist = titleCase(slug.slice(0, idx).replace(/-+$/, '').replace(/-/g, ' '));
    }
    const key = norm(artist) + '::' + norm(cleanAlbum(album));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      artist,
      album,
      albumNorm: norm(cleanAlbum(album)),
      url: `https://pitchfork.com/reviews/albums/${slug}/`,
    });
  }
  return out;
}
