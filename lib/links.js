// Build streaming/search deep-links for an album. These are plain search URLs —
// no API keys, no auth — that open the right query in each service.
export function streamingLinks(artist, album) {
  const q = `${artist} ${album}`.trim();
  const e = encodeURIComponent(q);
  return {
    spotify: `https://open.spotify.com/search/${e}`,
    ytMusic: `https://music.youtube.com/search?q=${e}`,
    youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' full album')}`,
  };
}

// Stable key for de-duplicating the same album coming from two sources.
export const albumKey = (artist, album) =>
  norm(artist) + '::' + norm(cleanAlbum(album));

export const norm = (s) =>
  (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// Strip edition/version noise so matching + keys are stable across sources.
export const cleanAlbum = (a) =>
  (a || '').split('|')[0]
    .replace(/\((deluxe|expanded|remaster(ed)?|edition|version|explicit|bonus)[^)]*\)/ig, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+/g, ' ').trim();
