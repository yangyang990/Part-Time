// Database: Turso (hosted, SQLite-compatible) in production, a local SQLite file in development.
//   Production: set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.
//   Local:      nothing to set — uses data/app.db.
import { createClient } from '@libsql/client';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

const REMOTE = !!process.env.TURSO_DATABASE_URL;
if (process.env.VERCEL && !REMOTE) {
  throw new Error('TURSO_DATABASE_URL is not set. Add it in Vercel → Project → Settings → Environment Variables.');
}
if (!REMOTE) fs.mkdirSync(DATA_DIR, { recursive: true });

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || `file:${path.join(DATA_DIR, 'app.db')}`,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

/** Rules pre-filled on every new event. Organisers can edit them per event. */
export const DEFAULT_TERMS = [
  'Arrive and check in at least 15 minutes before the start time.',
  'Late check-in: RM10 is deducted for every 15 minutes late, and your punctuality rating drops.',
  'No-show without 24 hours’ notice: no pay for the shift, and you may not be accepted for future events.',
  'Follow the dress code. Wrong attire may be sent home without pay.',
  'Not doing the job properly (on your phone, leaving your post without permission, rude to customers): pay may be deducted and your rating will drop.',
  'Leaving early is only paid up to your check-out time.',
].join('\n');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password     TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('admin', 'worker')),
  name         TEXT NOT NULL,
  can_organise INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- Part-timer "resume" — filled in once, editable any time.
CREATE TABLE IF NOT EXISTS profiles (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone       TEXT,
  birth_date  TEXT,
  gender      TEXT,
  height_cm   INTEGER,
  city        TEXT,
  languages   TEXT,
  experience  TEXT,
  skills      TEXT,
  about       TEXT,
  avatar      TEXT,
  resume      TEXT,
  resume_name TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  location_name TEXT NOT NULL,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  radius_m      INTEGER NOT NULL DEFAULT 200,
  start_at      TEXT NOT NULL,
  end_at        TEXT NOT NULL,
  pay           REAL NOT NULL,
  pay_unit      TEXT NOT NULL DEFAULT 'hour' CHECK (pay_unit IN ('hour', 'day', 'shift')),
  dress_code    TEXT,
  slots         INTEGER NOT NULL DEFAULT 1,
  min_rank      TEXT NOT NULL DEFAULT 'rookie',
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  skills        TEXT,
  languages     TEXT,
  payment_days  INTEGER NOT NULL DEFAULT 14,
  terms         TEXT,
  created_at    TEXT NOT NULL
);

-- One row per worker per event; also holds that worker's check-in / check-out.
CREATE TABLE IF NOT EXISTS applications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id          INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  worker_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  note              TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  checkin_at        TEXT,
  checkin_lat       REAL,
  checkin_lng       REAL,
  checkin_accuracy  REAL,
  checkin_distance  REAL,
  checkin_photo     TEXT,
  checkout_at       TEXT,
  checkout_lat      REAL,
  checkout_lng      REAL,
  checkout_accuracy REAL,
  checkout_distance REAL,
  checkout_photo    TEXT,
  checkout_outside  INTEGER NOT NULL DEFAULT 0,
  terms_accepted_at TEXT,
  deduction         REAL NOT NULL DEFAULT 0,
  deduction_reason  TEXT,
  chosen_roles      TEXT,
  chosen_languages  TEXT,
  UNIQUE (event_id, worker_id)
);

CREATE TABLE IF NOT EXISTS ratings (
  application_id INTEGER PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  admin_id       INTEGER NOT NULL REFERENCES users(id),
  worker_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  punctuality    INTEGER NOT NULL CHECK (punctuality BETWEEN 1 AND 5),
  attitude       INTEGER NOT NULL CHECK (attitude BETWEEN 1 AND 5),
  performance    INTEGER NOT NULL CHECK (performance BETWEEN 1 AND 5),
  stars          REAL NOT NULL,
  comment        TEXT,
  created_at     TEXT NOT NULL
);

-- Where each uploaded photo/resume lives (Vercel Blob URL in production).
CREATE TABLE IF NOT EXISTS files (
  name       TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  url        TEXT NOT NULL,
  mime       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Photo tasks the organiser sets for an event ("selfie at your post within 30 min").
CREATE TABLE IF NOT EXISTS event_tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  instructions TEXT,
  due_min      INTEGER,            -- minutes after the event starts; NULL = any time during the shift
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

-- One photo per task per crew member (re-taking replaces it).
CREATE TABLE IF NOT EXISTS task_submissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id        INTEGER NOT NULL REFERENCES event_tasks(id) ON DELETE CASCADE,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  worker_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  photo          TEXT NOT NULL,
  note           TEXT,
  lat            REAL,
  lng            REAL,
  distance       REAL,
  created_at     TEXT NOT NULL,
  UNIQUE (task_id, application_id)
);

-- Event group chat: the organiser plus approved crew.
CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,           -- may be '' when the message is just a photo
  photo      TEXT,                    -- /files/<uid>/<name> of an attached picture
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_event ON event_tasks(event_id);
CREATE INDEX IF NOT EXISTS idx_subs_app ON task_submissions(application_id);
CREATE INDEX IF NOT EXISTS idx_messages_event ON messages(event_id, id);
CREATE INDEX IF NOT EXISTS idx_apps_worker ON applications(worker_id);
CREATE INDEX IF NOT EXISTS idx_ratings_worker ON ratings(worker_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

/** Add a column to a table created by an older version, if it is missing. */
async function addColumn(table, name, def) {
  const cols = await client.execute(`PRAGMA table_info(${table})`);
  if (cols.rows.some((c) => c.name === name)) return;
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err; // another instance added it first
  }
}

async function init() {
  if (!REMOTE) await client.executeMultiple('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await client.executeMultiple(SCHEMA);
  await addColumn('users', 'can_organise', 'INTEGER NOT NULL DEFAULT 0');
  await addColumn('events', 'skills', 'TEXT');
  await addColumn('events', 'languages', 'TEXT');
  await addColumn('events', 'payment_days', 'INTEGER NOT NULL DEFAULT 14');
  await addColumn('events', 'terms', 'TEXT');
  await addColumn('applications', 'terms_accepted_at', 'TEXT');
  await addColumn('applications', 'deduction', 'REAL NOT NULL DEFAULT 0');
  await addColumn('applications', 'deduction_reason', 'TEXT');
  await addColumn('applications', 'chosen_roles', 'TEXT');
  await addColumn('applications', 'chosen_languages', 'TEXT');
  await addColumn('messages', 'photo', 'TEXT');
  await client.execute("UPDATE users SET can_organise = 1 WHERE role = 'admin' AND can_organise = 0");
  // Events created before terms existed get the default rules.
  await client.execute({ sql: 'UPDATE events SET terms = ? WHERE terms IS NULL', args: [DEFAULT_TERMS] });
}

/** Resolves once the schema is in place. Every query waits for it; retried if it failed. */
let readyPromise = null;
export function ready() {
  readyPromise ??= init().catch((err) => { readyPromise = null; throw err; });
  return readyPromise;
}

const clean = (args) => args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? Number(a) : a));
const toObjects = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));

/** Small async query API used everywhere. */
export const db = {
  async all(sql, ...args) {
    await ready();
    return toObjects(await client.execute({ sql, args: clean(args) }));
  },
  async get(sql, ...args) {
    return (await db.all(sql, ...args))[0];
  },
  async run(sql, ...args) {
    await ready();
    const rs = await client.execute({ sql, args: clean(args) });
    return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid) };
  },
  /** Several writes that succeed or fail together: [[sql, ...args], ...] */
  async batch(statements) {
    await ready();
    await client.batch(statements.map(([sql, ...args]) => ({ sql, args: clean(args) })), 'write');
  },
};

/** SQL condition (users aliased as u): counts as crew if in part-timer mode or has a part-timer profile. */
export const IS_CREW = "(u.role = 'worker' OR EXISTS (SELECT 1 FROM profiles crew_p WHERE crew_p.user_id = u.id))";

export const nowIso = () => new Date().toISOString();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === test.length && crypto.timingSafeEqual(test, expected);
}
