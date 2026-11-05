import { db, IS_CREW } from './db.js';

/**
 * Ranks, highest first. A worker holds the highest rank whose thresholds they meet.
 * jobs = number of shifts an organiser has rated; avg = average star rating (1–5).
 * Edit these to tune how hard it is to climb.
 */
export const RANKS = [
  { key: 'elite',   name: 'Elite',   minJobs: 25, minAvg: 4.5, blurb: 'Top performers. First pick for premium events.' },
  { key: 'ranger',  name: 'Ranger',  minJobs: 10, minAvg: 4.0, blurb: 'Experienced and reliable across many events.' },
  { key: 'trooper', name: 'Trooper', minJobs: 3,  minAvg: 3.0, blurb: 'Proven on the ground with good feedback.' },
  { key: 'rookie',  name: 'Rookie',  minJobs: 0,  minAvg: 0,   blurb: 'Just joined. Complete shifts to earn ratings.' },
];

/** Position on the ladder: rookie = 0, elite = 3. */
export const rankLevel = (key) => {
  const i = RANKS.findIndex((r) => r.key === key);
  return i < 0 ? 0 : RANKS.length - 1 - i;
};

export function computeRank(jobs, avg) {
  const rank = RANKS.find((r) => jobs >= r.minJobs && (jobs === 0 ? r.minAvg === 0 : avg >= r.minAvg));
  const idx = RANKS.indexOf(rank);
  const next = idx > 0 ? RANKS[idx - 1] : null;
  return {
    key: rank.key,
    name: rank.name,
    level: rankLevel(rank.key),
    next: next
      ? {
          key: next.key,
          name: next.name,
          jobsNeeded: Math.max(0, next.minJobs - jobs),
          minAvg: next.minAvg,
          avgOk: avg >= next.minAvg,
        }
      : null,
  };
}

const statsSql = `
  SELECT u.id AS worker_id,
         (SELECT COUNT(*) FROM ratings r WHERE r.worker_id = u.id) AS rated_jobs,
         (SELECT AVG(stars) FROM ratings r WHERE r.worker_id = u.id) AS avg_stars,
         (SELECT COUNT(*) FROM applications a WHERE a.worker_id = u.id AND a.checkout_at IS NOT NULL) AS completed
  FROM users u WHERE ${IS_CREW}`;

function shape(row) {
  const jobs = Number(row?.rated_jobs ?? 0);
  const avg = row?.avg_stars ? Math.round(row.avg_stars * 100) / 100 : 0;
  return { ratedJobs: jobs, avgStars: avg, completed: Number(row?.completed ?? 0), rank: computeRank(jobs, avg) };
}

export async function workerStats(workerId) {
  return shape(await db.get(`${statsSql} AND u.id = ?`, workerId));
}

/** Map of workerId -> stats for every worker. */
export async function allWorkerStats() {
  const map = new Map();
  for (const row of await db.all(statsSql)) map.set(row.worker_id, shape(row));
  return map;
}
