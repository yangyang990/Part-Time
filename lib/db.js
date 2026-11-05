import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password   TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin', 'worker')),
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
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

CREATE INDEX IF NOT EXISTS idx_apps_worker ON applications(worker_id);
CREATE INDEX IF NOT EXISTS idx_ratings_worker ON ratings(worker_id);
`);

// can_organise = this account may use organiser mode. users.role is the mode it is in right now,
// so one account can switch between organiser and part-timer (handy for testing).
/** Add a column to an existing table if it is missing (simple migrations). */
function addColumn(table, name, def) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}
addColumn('users', 'can_organise', 'INTEGER NOT NULL DEFAULT 0');
// Who the organiser is looking for, and the event's terms.
addColumn('events', 'skills', 'TEXT');          // comma-separated, e.g. "Sales, Promotion"
addColumn('events', 'languages', 'TEXT');       // comma-separated, e.g. "Malay, Chinese"
addColumn('events', 'payment_days', 'INTEGER NOT NULL DEFAULT 14');
addColumn('events', 'terms', 'TEXT');           // rules & penalties shown before applying
// Part-timer agreed to the terms; organiser deductions (late, wrong attire, ...).
addColumn('applications', 'terms_accepted_at', 'TEXT');
addColumn('applications', 'deduction', 'REAL NOT NULL DEFAULT 0');
addColumn('applications', 'deduction_reason', 'TEXT');
db.exec("UPDATE users SET can_organise = 1 WHERE role = 'admin' AND can_organise = 0");

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

/** Run fn inside a transaction. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
