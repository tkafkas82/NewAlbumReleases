// Local web app: newest album releases grouped by genre, sorted by rating,
// with Spotify / YouTube Music / YouTube links. Run: npm install && npm start,
// then open http://localhost:5178
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildAlbums } from './lib/build.js';
import { readAlbums, writeAlbums, readConfig } from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5178;
const STALE_MS = 6 * 3600 * 1000;

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Shared, mutable build state so /api/albums can stream progress to the UI.
const state = { building: false, done: 0, total: 0, data: null, lastGood: null, rerun: false };

async function startBuild() {
  // Already building? Queue one more run for when this finishes so a manual
  // refresh requested mid-build isn't silently dropped.
  if (state.building) { state.rerun = true; return false; }
  state.building = true; state.rerun = false; state.done = 0; state.total = 0;
  const config = await readConfig();
  // Snapshot the last good build so we can keep showing known genres/covers
  // while the new build re-resolves them (avoids a "null" flood on refresh).
  const prevByKey = new Map((state.lastGood?.albums || []).map((a) => [a.key, a]));
  buildAlbums({
    config,
    onProgress: ({ albums, done, total }) => {
      // Don't mutate the build's own objects: copy only the ones still missing a
      // genre and borrow the previous value so the streaming view stays populated.
      const display = prevByKey.size
        ? albums.map((a) => {
            if (a.genre) return a;
            const p = prevByKey.get(a.key);
            return (p && p.genre) ? { ...a, genre: p.genre, cover: a.cover || p.cover, appleUrl: a.appleUrl || p.appleUrl } : a;
          })
        : albums;
      state.data = { ...(state.data || {}), albums: display };
      state.done = done; state.total = total;
    },
  })
    .then(async (data) => {
      if (data.albums && data.albums.length) {
        state.data = data; state.lastGood = data; await writeAlbums(data);
        console.log(`[build] done: ${data.counts.total} albums (AOTY ${data.counts.aoty}, BNM ${data.counts.bnm})`);
      } else {
        // A transient source failure yielded nothing — don't cache/serve empty;
        // keep whatever we had and let the next request retry.
        console.warn('[build] produced 0 albums (source hiccup) — not caching; will retry');
        if (state.data && state.data.albums && !state.data.albums.length) state.data = null;
      }
    })
    .catch((e) => console.error('[build] failed:', e.message))
    .finally(() => {
      state.building = false;
      // A build was requested while this one ran (e.g. cookie saved) → run it
      // now with the current config. building flips true again synchronously,
      // so pollers never see a false gap.
      if (state.rerun) { state.rerun = false; startBuild(); }
    });
  return true;
}

app.get('/api/albums', (_req, res) => {
  // if we have no albums and nothing is building, kick a (re)build
  if (!state.building && !(state.data && state.data.albums && state.data.albums.length)) startBuild();
  res.json({
    building: state.building,
    progress: { done: state.done, total: state.total },
    updated: state.data?.updated || null,
    counts: state.data?.counts || null,
    albums: state.data?.albums || [],
  });
});

app.post('/api/refresh', async (_req, res) => {
  const started = await startBuild();
  res.json({ started });
});

// Boot: load cache, kick a build if empty, album-less, or stale.
state.data = await readAlbums();
if (state.data && state.data.albums && state.data.albums.length) state.lastGood = state.data;
if (!state.data || !(state.data.albums && state.data.albums.length) || Date.now() - (state.data.updatedMs || 0) > STALE_MS) startBuild();

app.listen(PORT, () => {
  console.log(`\n  🎵 New Album Releases  →  http://localhost:${PORT}\n`);
  if (state.building) console.log('  (building initial data in the background…)\n');
});
