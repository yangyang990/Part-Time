// The whole web app (API + static files). Used by server.js locally and api/index.js on Vercel.
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, IS_CREW, DEFAULT_TERMS, nowIso, hashPassword, verifyPassword } from './lib/db.js';
import { RANKS, rankLevel, workerStats, allWorkerStats } from './lib/rank.js';
import { saveFile, sendStoredFile } from './lib/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Anyone registering as an organiser must enter this code. Change it via the ORGANISER_CODE env var. */
export const ORGANISER_CODE = process.env.ORGANISER_CODE || 'ORGANISER2026';
const CURRENCY = process.env.CURRENCY || 'RM';
const CHECKIN_OPENS_MIN = 60; // check-in opens this many minutes before the shift starts
const SESSION_DAYS = 30;

const app = express();
app.set('trust proxy', 1);

// On Vercel every /api and /files request is rewritten to one function with ?__path=<original path>.
app.use((req, _res, next) => {
  const u = new URL(req.url, 'http://x');
  const original = u.searchParams.get('__path');
  if (original) {
    u.searchParams.delete('__path');
    const qs = u.searchParams.toString();
    req.url = original + (qs ? `?${qs}` : '');
  }
  next();
});

// Vercel caps request bodies at 4.5 MB, so uploads are kept under that.
app.use(express.json({ limit: '4.4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => {
  throw new HttpError(status, message);
};

/** Wrap an async handler: whatever it returns is sent as JSON; thrown errors go to the error handler. */
const route = (fn) => async (req, res, next) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined) res.json(out);
  } catch (err) {
    next(err);
  }
};

const text = (v, max = 500) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const fmtDistance = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const RESUME_TYPES = [...IMAGE_TYPES, 'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

/** Save a base64 data URL and return its /files/ path. */
async function saveDataUrl(userId, dataUrl, allowed, maxBytes) {
  const m = /^data:([\w/.+-]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) fail(400, 'File could not be read. Please try again.');
  const [, mime, b64] = m;
  if (!allowed.includes(mime)) fail(400, 'That file type is not supported.');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length > maxBytes) fail(400, `File is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`);
  return saveFile(userId, buf, MIME_EXT[mime], mime);
}

async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, expires.toISOString());
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_DAYS * 864e5 });
}

const PROFILE_REQUIRED = ['phone', 'city', 'avatar'];
const profileComplete = (p) => !!p && PROFILE_REQUIRED.every((k) => p[k]);

const getProfile = async (userId) => (await db.get('SELECT * FROM profiles WHERE user_id = ?', userId)) || null;

const approvedCount = async (eventId) =>
  Number((await db.get("SELECT COUNT(*) AS n FROM applications WHERE event_id = ? AND status = 'approved'", eventId)).n);

function shiftEarnings(event, app) {
  if (!app.checkin_at || !app.checkout_at) return null;
  // Paid time is clamped to the scheduled shift: arriving early or leaving late is not extra pay.
  const from = Math.max(new Date(app.checkin_at), new Date(event.start_at));
  const to = Math.min(new Date(app.checkout_at), new Date(event.end_at));
  const hours = Math.max(0, (to - from) / 36e5);
  const gross = event.pay_unit === 'hour' ? Math.round(hours * event.pay * 100) / 100 : event.pay;
  const deduction = Math.min(app.deduction || 0, gross);
  return { hours: Math.round(hours * 100) / 100, gross, deduction, amount: Math.round((gross - deduction) * 100) / 100 };
}

// ---------- auth ----------

app.use(async (req, _res, next) => {
  try {
    const sid = parseCookies(req.headers.cookie).sid;
    if (sid) {
      req.user = (await db.get(`
        SELECT u.id, u.email, u.role, u.name, u.can_organise FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ?`, sid, nowIso())) || null;
      req.sid = sid;
    }
    next();
  } catch (err) {
    next(err);
  }
});

const need = (role) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Please log in.'));
  if (role && req.user.role !== role) return next(new HttpError(403, 'You do not have access to this.'));
  next();
};

app.post('/api/auth/register', route(async (req, res) => {
  const name = text(req.body.name, 100);
  const email = text(req.body.email, 200).toLowerCase();
  const password = String(req.body.password || '');
  const role = req.body.role;
  if (!name) fail(400, 'Please enter your name.');
  if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Please enter a valid email.');
  if (password.length < 6) fail(400, 'Password must be at least 6 characters.');
  if (!['admin', 'worker'].includes(role)) fail(400, 'Choose whether you are an organiser or a part-timer.');
  if (role === 'admin' && text(req.body.organiserCode) !== ORGANISER_CODE) fail(403, 'That organiser code is not correct.');
  if (await db.get('SELECT 1 FROM users WHERE email = ?', email)) fail(409, 'An account with this email already exists.');

  const { lastInsertRowid } = await db.run(
    'INSERT INTO users (email, password, role, name, can_organise, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    email, hashPassword(password), role, name, role === 'admin' ? 1 : 0, nowIso());
  await startSession(req, res, lastInsertRowid);
  return { ok: true };
}));

app.post('/api/auth/login', route(async (req, res) => {
  const email = text(req.body.email, 200).toLowerCase();
  const user = await db.get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(String(req.body.password || ''), user.password)) fail(401, 'Wrong email or password.');
  await startSession(req, res, user.id);
  return { ok: true };
}));

app.post('/api/auth/logout', route(async (req, res) => {
  if (req.sid) await db.run('DELETE FROM sessions WHERE token = ?', req.sid);
  res.clearCookie('sid');
  return { ok: true };
}));

// Organiser accounts can switch into part-timer view and back.
// Part-timer accounts can never reach organiser view.
app.post('/api/auth/role', need(), route(async (req) => {
  const role = req.body.role;
  if (!['admin', 'worker'].includes(role)) fail(400, 'Unknown role.');
  if (!req.user.can_organise) fail(403, 'Only organiser accounts can switch views.');
  await db.run('UPDATE users SET role = ? WHERE id = ?', role, req.user.id);
  return { ok: true };
}));

app.get('/api/me', route(async (req) => {
  const meta = { currency: CURRENCY, ranks: RANKS, checkinOpensMin: CHECKIN_OPENS_MIN, defaultTerms: DEFAULT_TERMS };
  if (!req.user) return { user: null, meta };
  const out = { user: req.user, meta };
  if (req.user.role === 'worker') {
    out.profile = await getProfile(req.user.id);
    out.profileComplete = profileComplete(out.profile);
    out.stats = await workerStats(req.user.id);
  }
  return out;
}));

// ---------- private files (photos, resumes) ----------

app.get('/files/:uid/:name', need(), route(async (req, res) => {
  const { uid, name } = req.params;
  if (!/^\d+$/.test(uid) || !/^[\w-]+\.\w+$/.test(name)) fail(404, 'Not found.');
  if (req.user.role !== 'admin' && Number(uid) !== req.user.id) fail(403, 'Not allowed.');
  if (!(await sendStoredFile(res, uid, name))) fail(404, 'Not found.');
}));

// ---------- part-timer: profile ----------

app.put('/api/profile', need('worker'), route(async (req) => {
  const b = req.body;
  const current = (await getProfile(req.user.id)) || {};
  const name = text(b.name, 100);
  if (!name) fail(400, 'Please enter your name.');

  const p = {
    phone: text(b.phone, 40),
    birth_date: text(b.birth_date, 10) || null,
    gender: text(b.gender, 20) || null,
    height_cm: b.height_cm ? int(b.height_cm) || null : null,
    city: text(b.city, 100),
    languages: text(b.languages, 200),
    experience: text(b.experience, 3000),
    skills: text(b.skills, 500),
    about: text(b.about, 1500),
    avatar: current.avatar || null,
    resume: current.resume || null,
    resume_name: current.resume_name || null,
  };
  if (!p.phone) fail(400, 'Please enter your phone number.');
  if (!p.city) fail(400, 'Please enter the city/area you live in.');
  if (b.avatar) p.avatar = await saveDataUrl(req.user.id, b.avatar, IMAGE_TYPES, 2 * 1024 * 1024);
  if (!p.avatar) fail(400, 'Please add a clear photo of your face.');
  if (b.resume?.dataUrl) {
    p.resume = await saveDataUrl(req.user.id, b.resume.dataUrl, RESUME_TYPES, 3 * 1024 * 1024);
    p.resume_name = text(b.resume.name, 200) || 'resume';
  }
  if (b.removeResume) p.resume = p.resume_name = null;

  await db.batch([
    ['UPDATE users SET name = ? WHERE id = ?', name, req.user.id],
    [`INSERT INTO profiles (user_id, phone, birth_date, gender, height_cm, city, languages, experience, skills, about,
                            avatar, resume, resume_name, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET
        phone = excluded.phone, birth_date = excluded.birth_date, gender = excluded.gender,
        height_cm = excluded.height_cm, city = excluded.city, languages = excluded.languages,
        experience = excluded.experience, skills = excluded.skills, about = excluded.about,
        avatar = excluded.avatar, resume = excluded.resume, resume_name = excluded.resume_name,
        updated_at = excluded.updated_at`,
    req.user.id, p.phone, p.birth_date, p.gender, p.height_cm, p.city, p.languages, p.experience, p.skills,
    p.about, p.avatar, p.resume, p.resume_name, nowIso()],
  ]);
  return { ok: true, profile: await getProfile(req.user.id) };
}));

// ---------- part-timer: jobs ----------

app.get('/api/events', need('worker'), route(async (req) => ({
  events: await db.all(`
    SELECT e.*, u.name AS organiser,
      (SELECT COUNT(*) FROM applications a WHERE a.event_id = e.id AND a.status = 'approved') AS approved_count,
      my.id AS my_app_id, my.status AS my_status, my.chosen_roles AS my_roles
    FROM events e
    JOIN users u ON u.id = e.admin_id
    LEFT JOIN applications my ON my.event_id = e.id AND my.worker_id = ?
    WHERE e.end_at > ? AND (e.status = 'open' OR my.id IS NOT NULL)
    ORDER BY e.start_at`, req.user.id, nowIso()),
})));

app.post('/api/events/:id/apply', need('worker'), route(async (req) => {
  const event = await db.get('SELECT * FROM events WHERE id = ?', req.params.id);
  if (!event) fail(404, 'Event not found.');
  if (!profileComplete(await getProfile(req.user.id))) fail(400, 'Complete your profile before applying.');
  if (event.status !== 'open') fail(400, 'This event is no longer taking applications.');
  if (new Date(event.start_at) <= new Date()) fail(400, 'This event has already started.');
  if ((await approvedCount(event.id)) >= event.slots) fail(400, 'All slots for this event are filled.');
  const stats = await workerStats(req.user.id);
  if (stats.rank.level < rankLevel(event.min_rank)) {
    const required = RANKS.find((r) => r.key === event.min_rank);
    fail(403, `This event needs rank ${required.name} or above. You are ${stats.rank.name}.`);
  }
  const existing = await db.get('SELECT * FROM applications WHERE event_id = ? AND worker_id = ?', event.id, req.user.id);
  const note = text(req.body.note, 500);
  if (existing && existing.status !== 'cancelled') fail(409, 'You have already applied to this event.');
  // The part-timer picks which of the event's roles they want and which of its languages they speak.
  const roles = pickFrom(event.skills, req.body.roles);
  const languages = pickFrom(event.languages, req.body.languages);
  if (event.skills && !roles) fail(400, 'Pick at least one role you want to do.');
  if (event.languages && !languages) fail(400, 'Tick the languages you can speak.');
  if (req.body.acceptTerms !== true) fail(400, 'Please read and accept the terms & conditions.');
  if (existing) {
    await db.run(`UPDATE applications SET status = 'pending', note = ?, chosen_roles = ?, chosen_languages = ?,
                  terms_accepted_at = ?, updated_at = ? WHERE id = ?`,
    note, roles || null, languages || null, nowIso(), nowIso(), existing.id);
  } else {
    await db.run(`INSERT INTO applications (event_id, worker_id, status, note, chosen_roles, chosen_languages,
                  terms_accepted_at, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    event.id, req.user.id, note, roles || null, languages || null, nowIso(), nowIso(), nowIso());
  }
  return { ok: true };
}));

async function ownApplication(req) {
  const app = await db.get(`
    SELECT a.*, e.title, e.lat, e.lng, e.radius_m, e.start_at, e.end_at, e.location_name, e.pay, e.pay_unit
    FROM applications a JOIN events e ON e.id = a.event_id WHERE a.id = ? AND a.worker_id = ?`, req.params.id, req.user.id);
  if (!app) fail(404, 'Shift not found.');
  return app;
}

app.post('/api/applications/:id/cancel', need('worker'), route(async (req) => {
  const app = await ownApplication(req);
  if (app.checkin_at) fail(400, 'You have already checked in to this shift.');
  if (!['pending', 'approved'].includes(app.status)) fail(400, 'This application cannot be cancelled.');
  await db.run("UPDATE applications SET status = 'cancelled', updated_at = ? WHERE id = ?", nowIso(), app.id);
  return { ok: true };
}));

app.get('/api/my/shifts', need('worker'), route(async (req) => {
  const rows = await db.all(`
    SELECT a.*, e.title, e.description, e.location_name, e.lat, e.lng, e.radius_m, e.start_at, e.end_at,
           e.pay, e.pay_unit, e.dress_code, e.payment_days, e.terms, e.skills, e.languages, u.name AS organiser,
           r.stars, r.punctuality, r.attitude, r.performance, r.comment AS rating_comment
    FROM applications a
    JOIN events e ON e.id = a.event_id
    JOIN users u ON u.id = e.admin_id
    LEFT JOIN ratings r ON r.application_id = a.id
    WHERE a.worker_id = ?
    ORDER BY e.start_at DESC`, req.user.id);
  return {
    shifts: rows.map((r) => ({ ...r, earnings: shiftEarnings(r, r) })),
    feedback: await db.all(`
      SELECT r.*, e.title FROM ratings r JOIN applications a ON a.id = r.application_id
      JOIN events e ON e.id = a.event_id WHERE r.worker_id = ? ORDER BY r.created_at DESC LIMIT 20`, req.user.id),
  };
}));

function readFix(body) {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const accuracy = Number(body.accuracy) || 0;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    fail(400, 'We could not read your location. Turn on location and try again.');
  }
  if (!body.photo) fail(400, 'Please take a photo as proof.');
  return { lat, lng, accuracy };
}

app.post('/api/applications/:id/checkin', need('worker'), route(async (req) => {
  const app = await ownApplication(req);
  if (app.status !== 'approved') fail(400, 'You are not approved for this shift.');
  if (app.checkin_at) fail(400, 'You have already checked in.');
  const now = Date.now();
  const opens = new Date(app.start_at).getTime() - CHECKIN_OPENS_MIN * 6e4;
  if (now < opens) fail(400, `Check-in opens ${CHECKIN_OPENS_MIN} minutes before the shift starts.`);
  if (now > new Date(app.end_at).getTime()) fail(400, 'This shift has already ended.');

  const fix = readFix(req.body);
  const dist = distanceMeters(fix.lat, fix.lng, app.lat, app.lng);
  const allowed = app.radius_m + Math.min(fix.accuracy, 100); // forgive some GPS drift
  if (dist > allowed) {
    fail(400, `You are ${fmtDistance(dist)} from ${app.location_name}. Get within ${app.radius_m} m to check in.`);
  }
  const photo = await saveDataUrl(req.user.id, req.body.photo, IMAGE_TYPES, 3 * 1024 * 1024);
  await db.run(`UPDATE applications SET checkin_at = ?, checkin_lat = ?, checkin_lng = ?, checkin_accuracy = ?,
                checkin_distance = ?, checkin_photo = ?, updated_at = ? WHERE id = ?`,
  nowIso(), fix.lat, fix.lng, fix.accuracy, dist, photo, nowIso(), app.id);
  return { ok: true, distance: dist };
}));

app.post('/api/applications/:id/checkout', need('worker'), route(async (req) => {
  const app = await ownApplication(req);
  if (!app.checkin_at) fail(400, 'You need to check in first.');
  if (app.checkout_at) fail(400, 'You have already checked out.');
  const fix = readFix(req.body);
  const dist = distanceMeters(fix.lat, fix.lng, app.lat, app.lng);
  // Check-out is never blocked (people leave in a hurry), but the organiser sees a flag if it was off-site.
  const outside = dist > app.radius_m + Math.min(fix.accuracy, 100) ? 1 : 0;
  const photo = await saveDataUrl(req.user.id, req.body.photo, IMAGE_TYPES, 3 * 1024 * 1024);
  await db.run(`UPDATE applications SET checkout_at = ?, checkout_lat = ?, checkout_lng = ?, checkout_accuracy = ?,
                checkout_distance = ?, checkout_photo = ?, checkout_outside = ?, updated_at = ? WHERE id = ?`,
  nowIso(), fix.lat, fix.lng, fix.accuracy, dist, photo, outside, nowIso(), app.id);
  return { ok: true, distance: dist, outside: !!outside };
}));

// ---------- organiser: events ----------

/** Accept an array or comma-separated string; return a tidy "A, B, C" string. */
/** Keep only the picks that are in the event's own list (matched case-insensitively), in the event's wording. */
function pickFrom(allowed, picks) {
  const options = String(allowed || '').split(',').map((s) => s.trim()).filter(Boolean);
  const wanted = new Set((Array.isArray(picks) ? picks : []).map((s) => String(s).trim().toLowerCase()));
  return options.filter((o) => wanted.has(o.toLowerCase())).join(', ');
}

function tags(v) {
  const list = (Array.isArray(v) ? v : String(v || '').split(','))
    .map((s) => String(s).trim().slice(0, 40)).filter(Boolean);
  return [...new Set(list)].slice(0, 20).join(', ');
}

function readEvent(b) {
  const e = {
    title: text(b.title, 150),
    description: text(b.description, 4000),
    location_name: text(b.location_name, 300),
    lat: Number(b.lat),
    lng: Number(b.lng),
    radius_m: int(b.radius_m),
    start_at: new Date(b.start_at),
    end_at: new Date(b.end_at),
    pay: Number(b.pay),
    pay_unit: b.pay_unit,
    dress_code: text(b.dress_code, 1000),
    slots: int(b.slots),
    min_rank: b.min_rank || 'rookie',
    status: b.status === 'closed' ? 'closed' : 'open',
    skills: tags(b.skills),
    languages: tags(b.languages),
    payment_days: b.payment_days === '' || b.payment_days == null ? 14 : int(b.payment_days),
    terms: text(b.terms, 4000),
  };
  if (!e.title) fail(400, 'Give the event a title.');
  if (!e.location_name) fail(400, 'Enter the location name or address.');
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lng)) fail(400, 'Pin the location on the map.');
  if (!(e.radius_m >= 20 && e.radius_m <= 5000)) fail(400, 'Check-in radius must be between 20 m and 5 km.');
  if (isNaN(e.start_at) || isNaN(e.end_at)) fail(400, 'Set a start and end time.');
  if (e.end_at <= e.start_at) fail(400, 'End time must be after start time.');
  if (!(e.pay >= 0)) fail(400, 'Enter the pay.');
  if (!['hour', 'day', 'shift'].includes(e.pay_unit)) fail(400, 'Choose how pay is counted.');
  if (!(e.slots >= 1 && e.slots <= 1000)) fail(400, 'Slots must be between 1 and 1000.');
  if (!RANKS.some((r) => r.key === e.min_rank)) fail(400, 'Unknown rank.');
  if (!(e.payment_days >= 0 && e.payment_days <= 120)) fail(400, 'Payment days must be between 0 and 120.');
  e.start_at = e.start_at.toISOString();
  e.end_at = e.end_at.toISOString();
  return e;
}

async function ownEvent(req, id = req.params.id) {
  const event = await db.get('SELECT * FROM events WHERE id = ? AND admin_id = ?', id, req.user.id);
  if (!event) fail(404, 'Event not found.');
  return event;
}

app.get('/api/admin/events', need('admin'), route(async (req) => ({
  events: await db.all(`
    SELECT e.*,
      (SELECT COUNT(*) FROM applications a WHERE a.event_id = e.id AND a.status = 'approved') AS approved_count,
      (SELECT COUNT(*) FROM applications a WHERE a.event_id = e.id AND a.status = 'pending') AS pending_count,
      (SELECT COUNT(*) FROM applications a WHERE a.event_id = e.id AND a.checkin_at IS NOT NULL) AS checked_in_count
    FROM events e WHERE e.admin_id = ? ORDER BY e.start_at DESC`, req.user.id),
})));

app.post('/api/admin/events', need('admin'), route(async (req) => {
  const e = readEvent(req.body);
  const { lastInsertRowid } = await db.run(`
    INSERT INTO events (admin_id, title, description, location_name, lat, lng, radius_m, start_at, end_at,
                        pay, pay_unit, dress_code, slots, min_rank, status, skills, languages, payment_days, terms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  req.user.id, e.title, e.description, e.location_name, e.lat, e.lng, e.radius_m, e.start_at, e.end_at,
  e.pay, e.pay_unit, e.dress_code, e.slots, e.min_rank, e.status, e.skills, e.languages, e.payment_days, e.terms, nowIso());
  return { ok: true, id: lastInsertRowid };
}));

app.put('/api/admin/events/:id', need('admin'), route(async (req) => {
  await ownEvent(req);
  const e = readEvent(req.body);
  await db.run(`
    UPDATE events SET title = ?, description = ?, location_name = ?, lat = ?, lng = ?, radius_m = ?, start_at = ?,
      end_at = ?, pay = ?, pay_unit = ?, dress_code = ?, slots = ?, min_rank = ?, status = ?,
      skills = ?, languages = ?, payment_days = ?, terms = ? WHERE id = ?`,
  e.title, e.description, e.location_name, e.lat, e.lng, e.radius_m, e.start_at, e.end_at, e.pay, e.pay_unit,
  e.dress_code, e.slots, e.min_rank, e.status, e.skills, e.languages, e.payment_days, e.terms, req.params.id);
  return { ok: true };
}));

app.delete('/api/admin/events/:id', need('admin'), route(async (req) => {
  const event = await ownEvent(req);
  // Delete children explicitly (the hosted database may not enforce ON DELETE CASCADE).
  await db.batch([
    ['DELETE FROM ratings WHERE application_id IN (SELECT id FROM applications WHERE event_id = ?)', event.id],
    ['DELETE FROM applications WHERE event_id = ?', event.id],
    ['DELETE FROM events WHERE id = ?', event.id],
  ]);
  return { ok: true };
}));

app.get('/api/admin/events/:id', need('admin'), route(async (req) => {
  const event = await ownEvent(req);
  const stats = await allWorkerStats();
  const apps = await db.all(`
    SELECT a.*, u.name, u.email, p.phone, p.avatar, p.city, p.languages, p.skills, p.experience,
           r.stars, r.punctuality, r.attitude, r.performance, r.comment AS rating_comment
    FROM applications a
    JOIN users u ON u.id = a.worker_id
    LEFT JOIN profiles p ON p.user_id = a.worker_id
    LEFT JOIN ratings r ON r.application_id = a.id
    WHERE a.event_id = ? ORDER BY a.created_at`, event.id);
  return {
    event,
    applications: apps.map((a) => ({ ...a, stats: stats.get(a.worker_id), earnings: shiftEarnings(event, a) })),
  };
}));

async function appForAdmin(req) {
  const app = await db.get('SELECT * FROM applications WHERE id = ?', req.params.id);
  if (!app) fail(404, 'Application not found.');
  const event = await ownEvent(req, app.event_id);
  return { app, event };
}

app.post('/api/admin/applications/:id/status', need('admin'), route(async (req) => {
  const { app, event } = await appForAdmin(req);
  const status = req.body.status;
  if (!['approved', 'rejected', 'pending'].includes(status)) fail(400, 'Unknown status.');
  if (app.status === 'cancelled') fail(400, 'The part-timer cancelled this application.');
  if (app.checkin_at && status !== 'approved') fail(400, 'This person has already checked in.');
  if (status === 'approved' && app.status !== 'approved' && (await approvedCount(event.id)) >= event.slots) {
    fail(400, `All ${event.slots} slots are filled. Raise the slot count to approve more.`);
  }
  await db.run('UPDATE applications SET status = ?, updated_at = ? WHERE id = ?', status, nowIso(), app.id);
  return { ok: true };
}));

// Deduct pay for breaking the event rules (late, wrong attire, poor work...). Amount 0 removes it.
app.post('/api/admin/applications/:id/deduct', need('admin'), route(async (req) => {
  const { app } = await appForAdmin(req);
  if (app.status !== 'approved') fail(400, 'You can only deduct from approved crew.');
  const amount = Math.round(Number(req.body.amount) * 100) / 100;
  if (!(amount >= 0 && amount <= 100000)) fail(400, 'Enter a valid amount.');
  const reason = text(req.body.reason, 300);
  if (amount > 0 && !reason) fail(400, 'Give a reason so the part-timer knows why.');
  await db.run('UPDATE applications SET deduction = ?, deduction_reason = ?, updated_at = ? WHERE id = ?',
    amount, amount > 0 ? reason : null, nowIso(), app.id);
  return { ok: true };
}));

app.post('/api/admin/applications/:id/rate', need('admin'), route(async (req) => {
  const { app, event } = await appForAdmin(req);
  if (app.status !== 'approved') fail(400, 'You can only rate approved crew.');
  if (!app.checkout_at && new Date(event.end_at) > new Date()) {
    fail(400, 'You can rate once they check out or the event ends.');
  }
  const scores = ['punctuality', 'attitude', 'performance'].map((k) => int(req.body[k]));
  if (scores.some((s) => !(s >= 1 && s <= 5))) fail(400, 'Give every category 1 to 5 stars.');
  const stars = Math.round((scores.reduce((a, b) => a + b, 0) / 3) * 10) / 10;
  await db.run(`
    INSERT INTO ratings (application_id, admin_id, worker_id, punctuality, attitude, performance, stars, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (application_id) DO UPDATE SET punctuality = excluded.punctuality, attitude = excluded.attitude,
      performance = excluded.performance, stars = excluded.stars, comment = excluded.comment, created_at = excluded.created_at`,
  app.id, req.user.id, app.worker_id, ...scores, stars, text(req.body.comment, 1000), nowIso());
  return { ok: true, stats: await workerStats(app.worker_id) };
}));

// ---------- organiser: crew directory ----------

app.get('/api/admin/workers', need('admin'), route(async () => {
  const stats = await allWorkerStats();
  const rows = await db.all(`
    SELECT u.id, u.name, u.email, u.created_at, p.phone, p.city, p.avatar, p.updated_at AS profile_updated
    FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE ${IS_CREW}`);
  const workers = rows.map((w) => ({ ...w, stats: stats.get(w.id) }));
  workers.sort((a, b) => b.stats.rank.level - a.stats.rank.level || b.stats.avgStars - a.stats.avgStars
    || b.stats.ratedJobs - a.stats.ratedJobs);
  return { workers };
}));

app.get('/api/admin/workers/:id', need('admin'), route(async (req) => {
  const user = await db.get(`SELECT u.id, u.name, u.email, u.created_at FROM users u WHERE u.id = ? AND ${IS_CREW}`, req.params.id);
  if (!user) fail(404, 'Part-timer not found.');
  return {
    user,
    profile: await getProfile(user.id),
    stats: await workerStats(user.id),
    history: await db.all(`
      SELECT a.id, a.status, a.checkin_at, a.checkout_at, e.title, e.start_at, e.location_name,
             r.stars, r.punctuality, r.attitude, r.performance, r.comment
      FROM applications a JOIN events e ON e.id = a.event_id LEFT JOIN ratings r ON r.application_id = a.id
      WHERE a.worker_id = ? ORDER BY e.start_at DESC`, user.id),
  };
}));

// ---------- errors ----------

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));
app.use((err, _req, res, _next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 413 ? 'Upload is too large.' : status === 500 ? 'Something went wrong.' : err.message });
});

export default app;
