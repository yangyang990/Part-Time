# ShiftCrew — part-timer management

One website, two kinds of users:

| Organiser (admin) | Part-timer |
|---|---|
| Create events/campaigns: title, description, **location pinned on a map** with a check-in radius, **start/end time**, **pay** (per hour / day / shift), **dress code**, crew slots, minimum rank | Set up a **profile + resume once** (photo, phone, city, experience, skills, CV file); edit any time |
| Review applicants (with their rank, rating and resume) → approve / decline | Browse open jobs and apply with an optional note |
| See live **attendance**: check-in/out time, selfie, distance from site, off-site check-out warning, hours and pay | **Check in / check out** with a selfie + GPS. Check-in is refused if you're outside the radius |
| **Rate** each person on punctuality, attitude and performance (1–5★) + written feedback | See your **rank**, progress to the next rank, and organisers' feedback |
| Crew leaderboard with rank filter and full profile history | |

## Ranks

| Rank | Needs |
|---|---|
| Rookie | everyone starts here |
| Trooper | 3+ rated shifts, 3.0★+ average |
| Ranger | 10+ rated shifts, 4.0★+ average |
| Elite | 25+ rated shifts, 4.5★+ average |

Organisers can lock an event to "Trooper and above", etc. Edit the thresholds in [lib/rank.js](lib/rank.js).

## Run it

Requires Node.js 22.13+ (uses the built-in SQLite).

```bash
npm install
npm run seed     # optional demo data
npm start        # http://localhost:3000
```

Demo logins (password `demo1234`): `admin@demo.test` (organiser), `worker@demo.test` (new part-timer),
`veteran@demo.test` (part-timer with rated history). To start fresh, stop the server and delete the `data/` folder.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `ORGANISER_CODE` | `ORGANISER2026` | Code needed to sign up as an organiser. **Change this.** |
| `CURRENCY` | `RM` | Currency shown on pay |
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Where the database and uploaded photos/resumes are stored |

## Rules worth knowing

- Check-in opens 60 minutes before start and closes at the end time (`CHECKIN_OPENS_MIN` in `server.js`).
- GPS check-in allows the radius plus up to 100 m of reported GPS inaccuracy.
- Check-out is never blocked, but is flagged to the organiser if it happened outside the area.
- Paid hours are counted only within the scheduled time (early arrival / late leaving isn't extra pay).
- Photos and resumes are private: a part-timer can only open their own files; organisers can open all.

## Going live

Phones only allow GPS and camera on **HTTPS** pages (localhost is the exception). Put it behind HTTPS
(e.g. Render, Railway, a VPS with Caddy/nginx) and keep the `data/` folder on persistent storage and backed up.

## Code map

- `server.js` — all API routes (auth, profile, events, applications, check-in/out, ratings)
- `lib/db.js` — SQLite schema · `lib/rank.js` — rank rules
- `public/js/admin.js` — organiser screens · `public/js/worker.js` — part-timer screens
- `public/js/ui.js`, `public/js/map.js` — shared UI helpers, Leaflet/OpenStreetMap map
