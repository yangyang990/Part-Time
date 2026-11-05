// Fills the database with demo data so you can click around.
//   npm run seed
// Demo logins (password for all: demo1234)
//   organiser:  admin@demo.test
//   part-timer: worker@demo.test   (new, no profile yet — shows the one-time setup)
//   part-timer: veteran@demo.test  (has past rated shifts — shows ranking)
// Set SEED_LAT / SEED_LNG to put the demo events near you so check-in works.
import { db, nowIso, hashPassword, tx } from './lib/db.js';

const LAT = Number(process.env.SEED_LAT) || 3.1579;
const LNG = Number(process.env.SEED_LNG) || 101.7116;
const PASSWORD = 'demo1234';
const hour = 36e5;
const at = (ms) => new Date(Date.now() + ms).toISOString();

if (db.prepare('SELECT 1 FROM users WHERE email = ?').get('admin@demo.test')) {
  console.log('Demo data already exists. Delete the data/ folder to start over.');
  process.exit(0);
}

tx(() => {
  const user = (email, name, role) =>
    Number(db.prepare('INSERT INTO users (email, password, role, name, can_organise, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(email, hashPassword(PASSWORD), role, name, role === 'admin' ? 1 : 0, nowIso()).lastInsertRowid);

  const admin = user('admin@demo.test', 'Demo Events Co.', 'admin');
  user('worker@demo.test', 'Alex Tan', 'worker');
  const vet = user('veteran@demo.test', 'Sam Lee', 'worker');
  db.prepare(`INSERT INTO profiles (user_id, phone, city, languages, experience, skills, about, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(vet, '+60 12-345 6789', 'Kuala Lumpur', 'English, Malay, Mandarin',
      'Roadshow promoter (2 yrs), usher at concerts, F&B crew.', 'Crowd control, sampling, MC',
      'Friendly and always on time.', nowIso());

  const event = (e) => Number(db.prepare(`
    INSERT INTO events (admin_id, title, description, location_name, lat, lng, radius_m, start_at, end_at,
                        pay, pay_unit, dress_code, slots, min_rank, status, skills, languages, payment_days, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(admin, e.title, e.description ?? null, e.location, LAT + (e.dLat || 0), LNG + (e.dLng || 0), e.radius || 200,
      e.start, e.end, e.pay, e.unit, e.dress, e.slots, e.minRank || 'rookie', 'open',
      e.skills ?? null, e.languages ?? null, 14, nowIso()).lastInsertRowid);

  event({
    title: 'Mall Roadshow — Product Sampling',
    description: 'Hand out samples and invite shoppers to the booth. Briefing 15 minutes before start.',
    location: 'Main Atrium, City Mall', start: at(-0.5 * hour), end: at(6 * hour),
    pay: 12, unit: 'hour', dress: 'Black T-shirt, black jeans, white sneakers. Name tag provided.', slots: 4,
    skills: 'Promotion, Product sampling, Sales', languages: 'Malay, Chinese (Mandarin)',
  });
  event({
    title: 'Music Festival Ushers',
    description: 'Ticket scanning and crowd guidance at gates. Dinner provided.',
    location: 'Stadium Gate C', start: at(3 * 24 * hour), end: at(3 * 24 * hour + 8 * hour), dLat: 0.01,
    pay: 120, unit: 'day', dress: 'All black. Closed shoes. Comfortable for standing.', slots: 10,
    skills: 'Usher, Crowd control', languages: 'English, Malay',
  });
  event({
    title: 'VIP Gala Dinner Host',
    description: 'Welcome guests, guide to tables, assist the MC.',
    location: 'Grand Ballroom, Hotel', start: at(7 * 24 * hour), end: at(7 * 24 * hour + 5 * hour), dLng: 0.01,
    pay: 200, unit: 'shift', dress: 'Formal: black suit or black dress. Hair neatly tied.', slots: 3, minRank: 'trooper',
    skills: 'MC / Host, Customer service', languages: 'English, Chinese (Mandarin), Cantonese',
  });

  // Past shifts for the veteran so the ranking has something to show.
  const comments = ['Great energy with customers.', 'Punctual and helpful.', 'Handled the crowd well.',
    'Very reliable.', 'Good, a bit quiet at the start.'];
  for (let i = 0; i < 5; i++) {
    const start = at(-(i + 2) * 7 * 24 * hour);
    const end = at(-(i + 2) * 7 * 24 * hour + 5 * hour);
    const ev = event({ title: `Past Roadshow #${i + 1}`, location: 'City Mall', start, end, pay: 12, unit: 'hour',
      dress: 'Black T-shirt', slots: 4 });
    db.prepare('UPDATE events SET status = ? WHERE id = ?').run('closed', ev);
    const app = Number(db.prepare(`
      INSERT INTO applications (event_id, worker_id, status, created_at, updated_at, checkin_at, checkin_lat, checkin_lng,
                                checkin_distance, checkout_at, checkout_lat, checkout_lng, checkout_distance)
      VALUES (?, ?, 'approved', ?, ?, ?, ?, ?, 12, ?, ?, ?, 15)`)
      .run(ev, vet, start, start, start, LAT, LNG, end, LAT, LNG).lastInsertRowid);
    const [p, a, f] = [[5, 5, 4], [4, 5, 4], [5, 4, 4], [4, 4, 5], [4, 4, 3]][i];
    db.prepare(`INSERT INTO ratings (application_id, admin_id, worker_id, punctuality, attitude, performance, stars, comment, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(app, admin, vet, p, a, f, Math.round(((p + a + f) / 3) * 10) / 10, comments[i], end);
  }
});

console.log('Demo data created. Password for all demo accounts: demo1234');
console.log('  organiser: admin@demo.test   part-timers: worker@demo.test, veteran@demo.test');
