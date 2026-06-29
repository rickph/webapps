/**
 * ONE-TIME FIX: Reset or create the superadmin account
 *
 * HOW TO RUN ON RAILWAY:
 * 1. Railway → your app → Settings → Deploy
 * 2. Change Start Command to: node reset-superadmin.js
 * 3. Redeploy → check logs for the result
 * 4. Change Start Command back to: node src/app.js
 * 5. Redeploy again
 *
 * HOW TO RUN LOCALLY:
 *   node reset-superadmin.js
 */
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const EMAIL    = 'superadmin@phhoops.com';
const PASSWORD = 'HoopStats@2026!';

async function run() {
  const client = await pool.connect();
  try {
    console.log('\n🔄 Resetting superadmin account...\n');

    // Ensure role column exists (in case of old schema)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'commissioner'`).catch(() => {});
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'`).catch(() => {});

    const hash = bcrypt.hashSync(PASSWORD, 10);

    const { rows } = await client.query(
      `INSERT INTO users (email, password, name, plan, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
         SET password = EXCLUDED.password,
             role     = 'superadmin',
             plan     = 'pro'
       RETURNING id, email, role`,
      [EMAIL, hash, 'Super Admin', 'pro', 'superadmin']
    );

    const user = rows[0];
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ SUPERADMIN ACCOUNT READY');
    console.log(`   ID:       ${user.id}`);
    console.log(`   Email:    ${user.email}`);
    console.log(`   Role:     ${user.role}`);
    console.log(`   Password: ${PASSWORD}`);
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
