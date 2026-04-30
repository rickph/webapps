const { Pool } = require('pg');

// ─── CONNECTION POOL ─────────────────────────────────────────────────────────
// Set DATABASE_URL in your .env file.
// Examples:
//   Supabase:  postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
//   Railway:   postgresql://postgres:[password]@[host].railway.app:5432/railway
//   Local:     postgresql://postgres:password@localhost:5432/phhoops

let pool;

function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set.\n' +
      'Add it to your .env file.\n' +
      'Example: DATABASE_URL=postgresql://user:password@host:5432/dbname'
    );
  }
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err.message);
  });
  return pool;
}

// ─── QUERY HELPERS ───────────────────────────────────────────────────────────

/** Run a query, return all rows */
async function query(sql, params = []) {
  const client = getPool();
  const result = await client.query(sql, params);
  return result.rows;
}

/** Return first row or null */
async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/** Run a query, return nothing (INSERT/UPDATE/DELETE) */
async function run(sql, params = []) {
  const client = getPool();
  await client.query(sql, params);
}

/** Run inside a transaction */
async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── SCHEMA ──────────────────────────────────────────────────────────────────

async function initSchema() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id          SERIAL PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,
      name        TEXT NOT NULL,
      plan        TEXT NOT NULL DEFAULT 'free',
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS leagues (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      level       TEXT NOT NULL,
      location    TEXT NOT NULL,
      season      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'upcoming',
      is_public   BOOLEAN DEFAULT TRUE,
      admin_code  TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS teams (
      id          SERIAL PRIMARY KEY,
      league_id   INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      color       TEXT NOT NULL DEFAULT '#e63946',
      wins        INTEGER NOT NULL DEFAULT 0,
      losses      INTEGER NOT NULL DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS players (
      id          SERIAL PRIMARY KEY,
      team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      league_id   INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      pos         TEXT NOT NULL,
      jersey      INTEGER DEFAULT 0,
      gp          INTEGER DEFAULT 0,
      pts         NUMERIC(5,1) DEFAULT 0,
      reb         NUMERIC(5,1) DEFAULT 0,
      ast         NUMERIC(5,1) DEFAULT 0,
      stl         NUMERIC(5,1) DEFAULT 0,
      blk         NUMERIC(5,1) DEFAULT 0,
      fg          NUMERIC(5,1) DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS games (
      id            SERIAL PRIMARY KEY,
      league_id     INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
      home_team_id  INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      away_team_id  INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      home_score    INTEGER DEFAULT 0,
      away_score    INTEGER DEFAULT 0,
      date          TEXT,
      venue         TEXT,
      status        TEXT NOT NULL DEFAULT 'upcoming'
    )
  `);

  // FIBA-compliant game_stats table
  await run(`
    CREATE TABLE IF NOT EXISTS game_stats (
      id          SERIAL PRIMARY KEY,
      game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      league_id   INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
      -- Scoring (FIBA separates 2PT and 3PT)
      fg2m        INTEGER DEFAULT 0,  -- 2-point field goals made
      fg2a        INTEGER DEFAULT 0,  -- 2-point field goal attempts
      fg3m        INTEGER DEFAULT 0,  -- 3-point field goals made
      fg3a        INTEGER DEFAULT 0,  -- 3-point field goal attempts
      ftm         INTEGER DEFAULT 0,  -- free throws made
      fta         INTEGER DEFAULT 0,  -- free throw attempts
      -- Rebounds (FIBA separates offensive/defensive)
      oreb        INTEGER DEFAULT 0,  -- offensive rebounds
      dreb        INTEGER DEFAULT 0,  -- defensive rebounds
      -- Other FIBA stats
      ast         INTEGER DEFAULT 0,  -- assists
      stl         INTEGER DEFAULT 0,  -- steals
      blk         INTEGER DEFAULT 0,  -- blocks
      to_val      INTEGER DEFAULT 0,  -- turnovers
      foul        INTEGER DEFAULT 0,  -- personal fouls
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(game_id, player_id)
    )
  `);

  // Add quarter column to games table
  try { await run('ALTER TABLE games ADD COLUMN IF NOT EXISTS quarter INTEGER DEFAULT 1'); } catch(e) {}

  // Players table — add FIBA extended columns
  await run(`
    CREATE TABLE IF NOT EXISTS player_season_stats (
      id          SERIAL PRIMARY KEY,
      player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      league_id   INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
      gp          INTEGER DEFAULT 0,
      pts         NUMERIC(5,1) DEFAULT 0,
      fg2m        NUMERIC(5,1) DEFAULT 0,
      fg2a        NUMERIC(5,1) DEFAULT 0,
      fg3m        NUMERIC(5,1) DEFAULT 0,
      fg3a        NUMERIC(5,1) DEFAULT 0,
      ftm         NUMERIC(5,1) DEFAULT 0,
      fta         NUMERIC(5,1) DEFAULT 0,
      oreb        NUMERIC(5,1) DEFAULT 0,
      dreb        NUMERIC(5,1) DEFAULT 0,
      reb         NUMERIC(5,1) DEFAULT 0,
      ast         NUMERIC(5,1) DEFAULT 0,
      stl         NUMERIC(5,1) DEFAULT 0,
      blk         NUMERIC(5,1) DEFAULT 0,
      to_val      NUMERIC(5,1) DEFAULT 0,
      foul        NUMERIC(5,1) DEFAULT 0,
      fgp         NUMERIC(5,1) DEFAULT 0,
      fg2p        NUMERIC(5,1) DEFAULT 0,
      fg3p        NUMERIC(5,1) DEFAULT 0,
      ftp         NUMERIC(5,1) DEFAULT 0,
      eff         NUMERIC(5,1) DEFAULT 0,
      UNIQUE(player_id, league_id)
    )
  `);

  // Migrate old game_stats columns if upgrading
  for (const col of ['fg2m','fg2a','fg3m','fg3a','oreb','dreb','to_val','foul']) {
    try { await run('ALTER TABLE game_stats ADD COLUMN IF NOT EXISTS ' + col + ' INTEGER DEFAULT 0'); } catch(e) {}
  }

  console.log('✅ Schema ready');
}

// ─── SEED DATA ────────────────────────────────────────────────────────────────

async function seedData() {
  const existing = await queryOne('SELECT id FROM users WHERE email = $1', ['demo@phhoops.com']);
  if (existing) return;

  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('demo1234', 10);

  await transaction(async (client) => {
    // User
    const { rows: [user] } = await client.query(
      `INSERT INTO users (email, password, name, plan) VALUES ($1,$2,$3,$4) RETURNING id`,
      ['demo@phhoops.com', hash, 'Demo Commissioner', 'pro']
    );

    // League 1 — Barangay
    const { rows: [l1] } = await client.query(
      `INSERT INTO leagues (user_id,name,level,location,season,status,admin_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [user.id, 'Brgy. San Roque Basketball Cup', 'Barangay', 'San Roque, Marikina City', 'Summer 2025', 'ongoing', 'SRC2025']
    );

    // League 2 — City
    const { rows: [l2] } = await client.query(
      `INSERT INTO leagues (user_id,name,level,location,season,status,admin_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [user.id, 'Marikina City Inter-Barangay League', 'City/Municipal', 'Marikina City, Metro Manila', '2025 Season', 'ongoing', 'MKN2025']
    );

    // Teams for league 1
    const teamDefs1 = [
      ['Purok 1 Ballers', '#e63946', 4, 1],
      ['Sitio Bagong Pag-asa', '#457b9d', 3, 2],
      ['Zone 3 Warriors', '#2a9d8f', 2, 3],
      ['Purok 5 Eagles', '#e9c46a', 1, 4],
    ];
    const teamIds1 = [];
    for (const [name, color, wins, losses] of teamDefs1) {
      const { rows: [t] } = await client.query(
        `INSERT INTO teams (league_id,name,color,wins,losses) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [l1.id, name, color, wins, losses]
      );
      teamIds1.push(t.id);
    }

    // Teams for league 2
    const teamDefs2 = [
      ['Brgy. Concepcion Ballers', '#f4a261', 6, 0],
      ['Brgy. Nangka Knights', '#264653', 4, 2],
      ['Brgy. Tumana Tigers', '#e76f51', 3, 3],
    ];
    const teamIds2 = [];
    for (const [name, color, wins, losses] of teamDefs2) {
      const { rows: [t] } = await client.query(
        `INSERT INTO teams (league_id,name,color,wins,losses) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [l2.id, name, color, wins, losses]
      );
      teamIds2.push(t.id);
    }

    // Players
    const playerDefs = [
      [teamIds1[0], l1.id, 'Mark Reyes',     'PG',  7, 5, 22.4,  4.1,  6.8, 2.2, 0.4, 48.3],
      [teamIds1[0], l1.id, 'Joey Santos',    'SF', 23, 5, 18.6,  7.3,  2.1, 1.4, 1.2, 52.1],
      [teamIds1[1], l1.id, 'Gio dela Cruz',  'C',   0, 5, 15.2, 11.4,  1.0, 0.8, 2.6, 61.0],
      [teamIds1[2], l1.id, 'Andrei Bautista','SG',  3, 5, 20.0,  3.5,  4.2, 2.8, 0.2, 44.7],
      [teamIds2[0], l2.id, 'Renz Villanueva','PF', 32, 6, 24.1, 10.2,  2.4, 1.1, 1.8, 55.3],
      [teamIds2[1], l2.id, 'Kuya Bob Lim',   'PG',  5, 6, 17.8,  3.0,  9.1, 3.0, 0.1, 41.2],
    ];
    for (const p of playerDefs) {
      await client.query(
        `INSERT INTO players (team_id,league_id,name,pos,jersey,gp,pts,reb,ast,stl,blk,fg)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        p
      );
    }

    // Games
    const gameDefs = [
      [l1.id, teamIds1[0], teamIds1[1], 78, 65, 'Apr 20, 2025', 'Brgy. San Roque Court',  'final'],
      [l1.id, teamIds1[2], teamIds1[3], 55, 70, 'Apr 21, 2025', 'Purok 5 Mini Court',     'final'],
      [l1.id, teamIds1[0], teamIds1[2],  0,  0, 'Apr 27, 2025', 'Brgy. San Roque Court',  'upcoming'],
      [l2.id, teamIds2[0], teamIds2[1], 88, 72, 'Apr 19, 2025', 'Marikina Sports Complex','final'],
    ];
    for (const g of gameDefs) {
      await client.query(
        `INSERT INTO games (league_id,home_team_id,away_team_id,home_score,away_score,date,venue,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        g
      );
    }
  });

  console.log('✅ Demo data seeded');
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

async function initDb() {
  try {
    await initSchema();
    await seedData();
    console.log('✅ Database connected and ready');
  } catch (err) {
    console.error('❌ Database init failed:', err.message);
    throw err;
  }
}

module.exports = { query, queryOne, run, transaction, initDb, getPool };

