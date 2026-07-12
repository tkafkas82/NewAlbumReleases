// Optional source: newalbumreleases.net WordPress feed. The site sits behind an
// aggressive Cloudflare challenge that blocks scripted browsers, so the only way
// in is to reuse a `cf_clearance` cookie captured from YOUR real browser (with
// the exact User-Agent that obtained it). Configure both via the app's settings
// panel. If the cookie is missing/expired, this returns [] and the app falls
// back to AOTY only.
import { getText, decode, UA } from './http.js';
import { tidyGenre } from './genre.js';

const FEED = 'https://newalbumreleases.net/feed/';

export async function getNarReleases({ narCookie, narUA } = {}) {
  if (!narCookie) return { items: [], ok: false, reason: 'no-cookie' };
  let xml;
  try {
    xml = await getText(FEED, {
      headers: {
        'User-Agent': narUA || UA,
        'Cookie': narCookie.includes('=') ? narCookie : `cf_clearance=${narCookie}`,
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Referer': 'https://newalbumreleases.net/',
      },
      retries: 1,
    });
  } catch (e) {
    return { items: [], ok: false, reason: e.message };
  }
  if (/Just a moment|Checking your browser|Attention Required/i.test(xml) || !/<item>/i.test(xml)) {
    return { items: [], ok: false, reason: 'challenge-or-empty' };
  }
  return { items: parseFeed(xml), ok: true };
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : '';
}

function parseFeed(xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  const out = [];
  for (const b of items) {
    const title = tag(b, 'title');
    const split = title.split(/\s+[–—-]\s+/); // "Artist – Album"
    const artist = split.length > 1 ? split[0].trim() : '';
    const album = (split.length > 1 ? split.slice(1).join(' - ') : title).trim();
    if (!album) continue;

    const cats = [...b.matchAll(/<category><!\[CDATA\[([\s\S]*?)\]\]><\/category>/gi)].map((m) => decode(m[1]));
    const genre = pickGenre(cats);
    const content = tag(b, 'content:encoded') || tag(b, 'description');
    const coverM = content.match(/<img[^>]+src="([^"]+)"/i);

    out.push({
      artist,
      album,
      genre,
      cover: coverM ? coverM[1] : null,
      narUrl: tag(b, 'link'),
      releaseText: (tag(b, 'pubDate') || '').replace(/\s+\d{2}:\d{2}:\d{2}.*$/, '').trim(),
      source: 'NAR',
    });
  }
  return out;
}

// Feed categories mix genres with noise ("Music", "Album", format tags). Prefer
// the first category that maps to a known genre bucket.
const NOISE = /^(music|album|albums|lossless|flac|mp3|deluxe|ep|single|va|various)$/i;
function pickGenre(cats) {
  for (const c of cats) {
    if (NOISE.test(c)) continue;
    const t = tidyGenre(c);
    if (t) return t;
  }
  return null;
}
