// Uploaded photos and resumes.
//   Production (Vercel): stored in Vercel Blob — set BLOB_READ_WRITE_TOKEN (added automatically
//   when you connect a Blob store to the project).
//   Local: stored on disk in data/uploads/.
// Either way the app hands out /files/<userId>/<name> links, which check who is logged in.
import { put, get } from '@vercel/blob';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, UPLOAD_DIR, nowIso } from './db.js';

const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;
if (process.env.VERCEL && !USE_BLOB) {
  console.warn('BLOB_READ_WRITE_TOKEN is not set: uploads will fail. Connect a Blob store to the Vercel project.');
}

export async function saveFile(userId, buffer, ext, mime) {
  const name = `${crypto.randomUUID()}.${ext}`;
  if (USE_BLOB) {
    // Private store: blobs can only be read with the server's token, so every view goes through /files/ (login checked).
    const blob = await put(`uploads/${userId}/${name}`, buffer, { access: 'private', contentType: mime, addRandomSuffix: true });
    await db.run('INSERT INTO files (name, user_id, url, mime, created_at) VALUES (?, ?, ?, ?, ?)', name, userId, blob.url, mime, nowIso());
  } else {
    const dir = path.join(UPLOAD_DIR, String(userId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buffer);
  }
  return `/files/${userId}/${name}`;
}

/** Send a stored file to the browser. Returns false if it does not exist. */
export async function sendStoredFile(res, userId, name) {
  const row = await db.get('SELECT url, mime FROM files WHERE name = ? AND user_id = ?', name, Number(userId));
  if (row) {
    const found = await get(row.url, { access: 'private' });
    if (!found?.stream) return false;
    res.set('Content-Type', row.mime);
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(await new Response(found.stream).arrayBuffer()));
    return true;
  }
  const file = path.join(UPLOAD_DIR, String(userId), name);
  if (!fs.existsSync(file)) return false;
  res.sendFile(file);
  return true;
}
