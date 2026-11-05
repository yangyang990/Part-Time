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

Requires Node.js 20+. Locally it uses a SQLite file in `data/`, no accounts needed.

```bash
npm install
npm run seed     # optional demo data
npm run dev      # http://localhost:3000 (restarts when you edit server files)
```

Demo logins (password `demo1234`): `admin@demo.test` (organiser), `worker@demo.test` (new part-timer),
`veteran@demo.test` (part-timer with rated history). To start fresh, stop the server and delete the `data/` folder.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `ORGANISER_CODE` | `ORGANISER2026` | Code needed to sign up as an organiser. **Change this.** |
| `CURRENCY` | `RM` | Currency shown on pay |
| `PORT` | `3000` | Port to listen on |
| `DATA_DIR` | `./data` | Local only: where the database and uploads are stored |
| `TURSO_DATABASE_URL` | — | Production database (Turso). If set, used instead of the local file |
| `TURSO_AUTH_TOKEN` | — | Token for the Turso database |
| `BLOB_STORE_ID` / `BLOB_READ_WRITE_TOKEN` | — | Production file storage (Vercel Blob). Added automatically when you connect a Blob store |

## Rules worth knowing

- Check-in opens 60 minutes before start and closes at the end time (`CHECKIN_OPENS_MIN` in `app.js`).
- GPS check-in allows the radius plus up to 100 m of reported GPS inaccuracy.
- Check-out is never blocked, but is flagged to the organiser if it happened outside the area.
- Paid hours are counted only within the scheduled time (early arrival / late leaving isn't extra pay).
- Photos and resumes are private: a part-timer can only open their own files; organisers can open all.

## Deploy to Vercel

Vercel can't keep files between requests, so in production the database lives on **Turso** (free, SQLite-compatible)
and photos/resumes live in **Vercel Blob**. Locally nothing changes.

### 1. Create the Turso database (free)

1. Sign up at [turso.tech](https://turso.tech) and create a database (pick a region near your users, e.g. Singapore).
2. On the database page, copy the **URL** (starts with `libsql://`) and create a **token**.

### 2. Create the Vercel project

1. Push this repo to GitHub (already set up: `origin` → GitHub).
2. In [vercel.com](https://vercel.com) → **Add New → Project** → import the repo. Framework preset: **Other**.
   Leave build settings empty — `vercel.json` already sets everything.
3. Before clicking Deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `TURSO_DATABASE_URL` | the `libsql://…` URL from Turso |
| `TURSO_AUTH_TOKEN` | the Turso token |
| `ORGANISER_CODE` | your own secret code for organiser sign-up |

4. Click **Deploy**.

### 3. Add photo storage

1. In the Vercel project → **Storage** → **Create** → **Blob** (Access: **Private**) → connect it to this project.
   This adds `BLOB_STORE_ID` (or `BLOB_READ_WRITE_TOKEN` for older stores) automatically.
2. **Deployments** → latest → **⋯ → Redeploy** so the new variable is picked up.

The database tables are created automatically on the first request.

### Optional: demo data on the live site

```bash
TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… npm run seed
```

(In PowerShell: `$env:TURSO_DATABASE_URL="libsql://…"; $env:TURSO_AUTH_TOKEN="…"; npm run seed`.)

### Notes

- Phones only allow GPS and the camera on **HTTPS** — Vercel gives you that automatically.
- Uploads are limited to about 3 MB each (Vercel's request size limit is 4.5 MB). Photos are shrunk before upload.
- Photo and resume links go through the app, which checks who is logged in. Create the Blob store as
  **Private** — the files can then only be read with the server's token.
- Data you created locally (`data/`) is not copied to the live site.

## Code map

- `app.js` — all API routes (auth, profile, events, applications, check-in/out, ratings, deductions)
- `server.js` — runs the app locally · `api/index.js` + `vercel.json` — runs it on Vercel
- `lib/db.js` — database (Turso / local SQLite) and schema · `lib/storage.js` — uploads (Vercel Blob / local disk)
- `lib/rank.js` — rank rules
- `public/js/admin.js` — organiser screens · `public/js/worker.js` — part-timer screens
- `public/js/ui.js`, `public/js/map.js` — shared UI helpers, Leaflet/OpenStreetMap map
