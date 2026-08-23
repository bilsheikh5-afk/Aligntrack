const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes("render.com")
    ? { rejectUnauthorized: false }
    : false,
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'dentist',
      name TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      role TEXT NOT NULL DEFAULT 'dentist',
      used_by INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      patient TEXT NOT NULL,
      type TEXT,
      status TEXT,
      stage TEXT,
      lab TEXT,
      wear_hours_avg NUMERIC,
      flagged BOOLEAN DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT now(),
      owner_id INTEGER REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notes (
      id SERIAL PRIMARY KEY,
      case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      source TEXT DEFAULT 'gemini',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS photo_analyses (
      id SERIAL PRIMARY KEY,
      case_id TEXT REFERENCES cases(id) ON DELETE CASCADE,
      analysis TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // Seed an initial invite code + demo cases only if the DB is empty
  const { rows: userCount } = await pool.query("SELECT COUNT(*) FROM users");
  if (parseInt(userCount[0].count, 10) === 0) {
    const seedCode = process.env.SEED_INVITE_CODE || "WELCOME2026";
    await pool.query(
      "INSERT INTO invite_codes (code, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING",
      [seedCode]
    );
    console.log(`Seeded initial admin invite code: ${seedCode}`);
  }

  const { rows: caseCount } = await pool.query("SELECT COUNT(*) FROM cases");
  if (parseInt(caseCount[0].count, 10) === 0) {
    const seedPath = path.join(__dirname, "..", "data", "cases.seed.json");
    if (fs.existsSync(seedPath)) {
      const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
      for (const c of seed) {
        await pool.query(
          `INSERT INTO cases (id, patient, type, status, stage, lab, wear_hours_avg, flagged, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
          [c.id, c.patient, c.type, c.status, c.stage, c.lab, c.wearHoursAvg, c.flagged, c.updated]
        );
      }
      console.log(`Seeded ${seed.length} demo cases`);
    }
  }
}

module.exports = { pool, initSchema };
