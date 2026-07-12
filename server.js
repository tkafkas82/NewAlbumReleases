// Local web app: newest album releases grouped by genre, sorted by rating,
// with Spotify / YouTube Music / YouTube links. Run: npm install && npm start,
// then open http://localhost:5178
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildAlbums } from './lib/build.js';
import { readAlbums, writeAlbums, readConfig, writeConfig } from './lib/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5178;
const STALE_MS = 6 * 3600 * 1000;

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Shared, mutable build state so /api/albums can stream progress to the UI.
const state = { building: false, done: 0, total: 0, data: null };

async function startBuild() {
  if (state.building) return false;
  state.building = true; state.done = 0; state.total = 0;
  const config = await readConfig();
  buildAlbums({
    config,
    onProgress: ({ albums, done, total }) => {
      state.data = { ...(state.data || {}), albums };
      state.done = done; state.total = total;
    },
  })
    .then(async (data) => { state.data = data; await writeAlbums(data); console.log(`[build] done: ${data.counts.total} albums (AOTY ${data.counts.aoty}, NAR ${data.counts.nar}, feed:${data.narStatus})`); })
    .catch((e) => console.error('[build] failed:', e.message))
    .finally(() => { state.building = false; });
  return true;
}

app.get('/api/albums', (_req, res) => {
  res.json({
    building: state.building,
    progress: { done: state.done, total: state.total },
    updated: state.data?.updated || null,
    counts: state.data?.counts || null,
    narStatus: state.data?.narStatus || null,
    albums: state.data?.albums || [],
  });
});

app.post('/api/refresh', async (_req, res) => {
  const started = await startBuild();
  res.json({ started });
});

// Config: never echo the cookie back, just whether one is set.
app.get('/api/config', async (_req, res) => {
  const c = await readConfig();
  res.json({ hasNarCookie: !!c.narCookie, narUA: c.narUA || '' });
});

app.post('/api/config', async (req, res) => {
  const c = await readConfig();
  const { narCookie, narUA } = req.body || {};
  if (typeof narCookie === 'string') c.narCookie = narCookie.trim();
  if (typeof narUA === 'string') c.narUA = narUA.trim();
  await writeConfig(c);
  res.json({ ok: true, hasNarCookie: !!c.narCookie });
  startBuild(); // re-scrape with the new cookie
});

// Boot: load cache, kick a build if empty/stale.
state.data = await readAlbums();
if (!state.data || Date.now() - (state.data.updatedMs || 0) > STALE_MS) startBuild();

app.listen(PORT, () => {
  console.log(`\n  🎵 New Album Releases  →  http://localhost:${PORT}\n`);
  if (state.building) console.log('  (building initial data in the background…)\n');
});
