// Tiny JSON file store for the album cache, the genre lookup cache, and config.
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(ROOT, '..', 'cache');
const ALBUMS = path.join(CACHE_DIR, 'albums.json');
const GENRES = path.join(CACHE_DIR, 'genres.json');
const CONFIG = path.join(ROOT, '..', 'config.json');

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

export const readAlbums = () => readJson(ALBUMS, null);
export const writeAlbums = (d) => writeJson(ALBUMS, d);
export const readGenres = () => readJson(GENRES, {});
export const writeGenres = (d) => writeJson(GENRES, d);
export const readConfig = () => readJson(CONFIG, {});
export const writeConfig = (d) => writeJson(CONFIG, d);
