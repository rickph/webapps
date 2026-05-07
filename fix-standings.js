/**
 * ONE-TIME FIX: Reset all standings from actual game results
 * 
 * HOW TO RUN ON RAILWAY:
 * 1. Railway → your app → Settings → Deploy
 * 2. Change Start Command to: node fix-standings.js
 * 3. Deploy → check logs for output
 * 4. Change Start Command back to: node src/app.js
 * 5. Deploy again
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🔄 Fixing all standings from scratch...\n');

    // Get all leagues
    const { rows: leagues } = await client.query('SELECT id, name FROM leagues ORDER BY id');
    console.log(`Found ${leagues.length} leagues\n`);

    for (const league of leagues) {
      // Step 1: Reset all teams in this league to 0-0
      const { rowCount: resetCount } = await client.query(
        'UPDATE teams SET wins=0, losses=0 WHERE league_id=$1',
        [league.id]
      );

      // Step 2: Get all final games
      const { rows: games } = await client.query(
        `SELECT * FROM games WHERE league_id=$1 AND status='final'`,
        [league.id]
      );

      let wins = 0, losses = 0;

      // Step 3: Tally W/L
      for (const g of games) {
        const h = Number(g.home_score);
        const a = Number(g.away_score);
        if (h === a) continue;
        if (h > a) {
          if (g.home_team_id) { await client.query('UPDATE teams SET wins=wins+1 WHERE id=$1', [g.home_team_id]); wins++; }
          if (g.away_team_id) { await client.query('UPDATE teams SET losses=losses+1 WHERE id=$1', [g.away_team_id]); losses++; }
        } else {
          if (g.away_team_id) { await client.query('UPDATE teams SET wins=wins+1 WHERE id=$1', [g.away_team_id]); wins++; }
          if (g.home_team_id) { await client.query('UPDATE teams SET losses=losses+1 WHERE id=$1', [g.home_team_id]); losses++; }
        }
      }

      // Show result
      const { rows: teams } = await client.query(
        'SELECT name, wins, losses FROM teams WHERE league_id=$1 ORDER BY wins DESC',
        [league.id]
      );

      console.log(`✅ [${league.id}] ${league.name}`);
      console.log(`   ${games.length} final games processed`);
      teams.forEach(t => console.log(`   ${t.name}: ${t.wins}W - ${t.losses}L`));
      console.log('');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ ALL STANDINGS FIXED SUCCESSFULLY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

run();
