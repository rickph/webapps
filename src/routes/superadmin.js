const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const bcrypt  = require('bcryptjs');
const { requireAuth, requireSuperAdmin, generateToken } = require('../middleware/auth');
const { esc, levelBadge, statusBadge } = require('../helpers');

router.use(requireAuth);
router.use(requireSuperAdmin);

// ── SUPER ADMIN DASHBOARD ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // Ensure role column exists before querying
    try { await db.run("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'commissioner'"); } catch(e) {}
    // Ensure superadmin role is set correctly
    try { await db.run("UPDATE users SET role='superadmin', plan='pro' WHERE email='superadmin@phhoops.com'"); } catch(e) {}

    const [totals] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role != 'superadmin') as commissioners,
        (SELECT COUNT(*) FROM leagues) as leagues,
        (SELECT COUNT(*) FROM teams) as teams,
        (SELECT COUNT(*) FROM players) as players,
        (SELECT COUNT(*) FROM games WHERE status='final') as games
    `);

    const recentUsers = await db.query(`
      SELECT u.id, u.email, u.name, u.plan, u.role, u.created_at,
             COUNT(l.id) as league_count
      FROM users u
      LEFT JOIN leagues l ON l.user_id = u.id
      WHERE u.role != 'superadmin'
      GROUP BY u.id, u.email, u.name, u.plan, u.role, u.created_at
      ORDER BY u.created_at DESC
      LIMIT 10
    `);

    const recentLeagues = await db.query(`
      SELECT l.*, u.name as owner_name, u.email as owner_email,
        (SELECT COUNT(*) FROM teams WHERE league_id=l.id) as team_count,
        (SELECT COUNT(*) FROM players WHERE league_id=l.id) as player_count,
        (SELECT COUNT(*) FROM games WHERE league_id=l.id AND status='final') as game_count
      FROM leagues l
      JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC
      LIMIT 10
    `);

    res.send(superPage('Dashboard', req.user, `
      <div class="admin-header">
        <div>
          <h1>⚡ Super Admin Panel</h1>
          <p style="color:var(--gold);font-size:13px;margin-top:2px">Full system access — manage all commissioners and leagues</p>
        </div>
        <div class="ah-right">
          <a href="/admin" class="btn-ghost-sm">Commissioner View</a>
          <a href="/superadmin/commissioners" class="btn-primary-sm">👥 All Commissioners</a>
        </div>
      </div>

      <!-- SYSTEM STATS -->
      <div class="dash-stats" style="margin-bottom:28px">
        <div class="ds"><span style="color:var(--gold)">${totals.commissioners}</span><small>Commissioners</small></div>
        <div class="ds"><span style="color:var(--red)">${totals.leagues}</span><small>Total Leagues</small></div>
        <div class="ds"><span style="color:var(--teal)">${totals.teams}</span><small>Total Teams</small></div>
        <div class="ds"><span style="color:var(--purple)">${totals.players}</span><small>Total Players</small></div>
      </div>

      <!-- RECENT COMMISSIONERS -->
      <h3 style="font-family:'Russo One',sans-serif;font-size:16px;margin-bottom:14px;letter-spacing:.5px">
        Recent Commissioners
        <a href="/superadmin/commissioners" style="font-size:12px;color:var(--muted);font-family:'Outfit',sans-serif;font-weight:600;margin-left:12px">View All →</a>
      </h3>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:28px">
        <table class="stats-table">
          <thead><tr>
            <th>Commissioner</th>
            <th>Email</th>
            <th>Leagues</th>
            <th>Joined</th>
            <th>Actions</th>
          </tr></thead>
          <tbody>
            ${recentUsers.map(u => `
              <tr>
                <td style="font-weight:600">${esc(u.name)}</td>
                <td style="color:var(--muted)">${esc(u.email)}</td>
                <td><span style="color:var(--gold);font-weight:700">${u.league_count}</span></td>
                <td style="color:var(--muted);font-size:12px">${new Date(u.created_at).toLocaleDateString('en-PH')}</td>
                <td>
                  <a href="/superadmin/commissioner/${u.id}" class="btn-ghost-sm">View</a>
                  <a href="/superadmin/commissioner/${u.id}/delete" class="btn-danger-sm" data-confirm="Delete this commissioner and ALL their data?">🗑</a>
                </td>
              </tr>`).join('') || '<tr><td colspan="5" class="empty">No commissioners yet.</td></tr>'}
          </tbody>
        </table>
      </div>

      <!-- RECENT LEAGUES -->
      <h3 style="font-family:'Russo One',sans-serif;font-size:16px;margin-bottom:14px;letter-spacing:.5px">
        Recent Leagues
        <a href="/superadmin/leagues" style="font-size:12px;color:var(--muted);font-family:'Outfit',sans-serif;font-weight:600;margin-left:12px">View All →</a>
      </h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${recentLeagues.map(l => `
          <div style="background:var(--card);border:1px solid var(--border);border-left:3px solid var(--blue);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div style="flex:1">
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
                ${levelBadge(l.level)} ${statusBadge(l.status)}
              </div>
              <div style="font-weight:700;font-size:14px">${esc(l.name)}</div>
              <div style="font-size:12px;color:var(--muted)">📍 ${esc(l.location)} · By: ${esc(l.owner_name)}</div>
            </div>
            <div style="display:flex;gap:16px;font-size:12px;color:var(--muted)">
              <span><b style="color:var(--gold)">${l.team_count}</b> teams</span>
              <span><b style="color:var(--teal)">${l.player_count}</b> players</span>
              <span><b style="color:var(--red)">${l.game_count}</b> games</span>
            </div>
            <div class="row-actions">
              <a href="/superadmin/league/${l.id}" class="btn-ghost-sm">View</a>
              <a href="/league/${l.id}" class="btn-ghost-sm" target="_blank">🌐</a>
            </div>
          </div>`).join('') || '<div class="empty-state">No leagues yet.</div>'}
      </div>
    `));
  } catch (err) { console.error('Superadmin dashboard error:', err.message, err.stack); res.status(500).send('Server error: ' + err.message); }
});

// ── ALL COMMISSIONERS ─────────────────────────────────────────────────────────
router.get('/commissioners', async (req, res) => {
  try {
    const users = await db.query(`
      SELECT u.id, u.email, u.name, u.plan, u.role, u.created_at,
        COUNT(l.id) as league_count,
        (SELECT COUNT(*) FROM teams WHERE league_id IN (SELECT id FROM leagues WHERE user_id=u.id)) as team_count,
        (SELECT COUNT(*) FROM players WHERE league_id IN (SELECT id FROM leagues WHERE user_id=u.id)) as player_count
      FROM users u
      LEFT JOIN leagues l ON l.user_id = u.id
      WHERE u.role != 'superadmin'
      GROUP BY u.id, u.email, u.name, u.plan, u.role, u.created_at
      ORDER BY u.created_at DESC
    `);

    res.send(superPage('All Commissioners', req.user, `
      <div class="admin-header">
        <div>
          <a href="/superadmin" class="back-link">← Dashboard</a>
          <h1>👥 All Commissioners</h1>
          <p>${users.length} registered commissioners</p>
        </div>
        <div class="ah-right">
          <a href="/superadmin/create-commissioner" class="btn-primary-sm">+ Add Commissioner</a>
        </div>
      </div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden">
        <table class="stats-table">
          <thead><tr>
            <th>#</th><th>Name</th><th>Email</th><th>Leagues</th><th>Teams</th><th>Players</th><th>Joined</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${users.map((u,i) => `
              <tr>
                <td class="rank">${i+1}</td>
                <td style="font-weight:600">${esc(u.name)}</td>
                <td style="color:var(--muted);font-size:12px">${esc(u.email)}</td>
                <td><span style="color:var(--gold);font-weight:700">${u.league_count}</span></td>
                <td>${u.team_count}</td>
                <td>${u.player_count}</td>
                <td style="color:var(--muted);font-size:12px">${new Date(u.created_at).toLocaleDateString('en-PH')}</td>
                <td>
                  <a href="/superadmin/commissioner/${u.id}" class="btn-ghost-sm">View</a>
                  <a href="/superadmin/commissioner/${u.id}/reset-password" class="btn-ghost-sm">🔑 Reset PW</a>
                  <a href="/superadmin/commissioner/${u.id}/delete" class="btn-danger-sm" data-confirm="Delete ${esc(u.name)} and ALL their leagues/data?">🗑</a>
                </td>
              </tr>`).join('') || '<tr><td colspan="8" class="empty">No commissioners yet.</td></tr>'}
          </tbody>
        </table>
      </div>
      <script src="/js/admin.js"></script>
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

// ── CREATE COMMISSIONER ───────────────────────────────────────────────────────
router.get('/create-commissioner', (req, res) => {
  const err = req.query.error;
  res.send(superPage('Create Commissioner', req.user, `
    <div class="admin-header"><div>
      <a href="/superadmin/commissioners" class="back-link">← Commissioners</a>
      <h1>+ Create Commissioner</h1>
    </div></div>
    ${err ? `<div class="alert-error" style="max-width:480px;margin-bottom:16px">⚠ ${err === 'exists' ? 'Email already registered.' : 'Please fill all fields.'}</div>` : ''}
    <div class="card" style="max-width:480px">
      <form action="/superadmin/create-commissioner" method="POST">
        <div class="field-group"><label>Full Name</label>
          <input name="name" class="input" placeholder="Commissioner Name" required /></div>
        <div class="field-group"><label>Email</label>
          <input name="email" type="email" class="input" placeholder="commissioner@email.com" required /></div>
        <div class="field-group"><label>Password</label>
          <input name="password" type="password" class="input" placeholder="Min 6 characters" required /></div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <a href="/superadmin/commissioners" class="btn-ghost">Cancel</a>
          <button type="submit" class="btn-primary">Create Commissioner →</button>
        </div>
      </form>
    </div>
  `));
});

router.post('/create-commissioner', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name?.trim() || !email?.trim() || password?.length < 6)
      return res.redirect('/superadmin/create-commissioner?error=invalid');
    const existing = await db.queryOne('SELECT id FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (existing) return res.redirect('/superadmin/create-commissioner?error=exists');
    const hash = bcrypt.hashSync(password, 10);
    await db.run(
      `INSERT INTO users (email,password,name,plan,role) VALUES ($1,$2,$3,'free','commissioner')`,
      [email.toLowerCase().trim(), hash, name.trim()]
    );
    res.redirect('/superadmin/commissioners');
  } catch (err) { console.error(err); res.redirect('/superadmin/create-commissioner?error=invalid'); }
});

// ── VIEW COMMISSIONER ─────────────────────────────────────────────────────────
router.get('/commissioner/:id', async (req, res) => {
  try {
    const user = await db.queryOne('SELECT * FROM users WHERE id=$1 AND role!=\'superadmin\'', [req.params.id]);
    if (!user) return res.redirect('/superadmin/commissioners');

    const leagues = await db.query(`
      SELECT l.*,
        (SELECT COUNT(*) FROM teams WHERE league_id=l.id) as team_count,
        (SELECT COUNT(*) FROM players WHERE league_id=l.id) as player_count,
        (SELECT COUNT(*) FROM games WHERE league_id=l.id AND status='final') as game_count
      FROM leagues l WHERE l.user_id=$1 ORDER BY l.created_at DESC`, [user.id]);

    res.send(superPage(`Commissioner: ${esc(user.name)}`, req.user, `
      <div class="admin-header">
        <div>
          <a href="/superadmin/commissioners" class="back-link">← All Commissioners</a>
          <h1>${esc(user.name)}</h1>
          <p style="color:var(--muted);font-size:13px">${esc(user.email)} · Joined ${new Date(user.created_at).toLocaleDateString('en-PH')}</p>
        </div>
        <div class="ah-right">
          <a href="/superadmin/commissioner/${user.id}/login-as" class="btn-primary-sm">👤 Login As</a>
          <a href="/superadmin/commissioner/${user.id}/reset-password" class="btn-ghost-sm">🔑 Reset Password</a>
          <a href="/superadmin/commissioner/${user.id}/delete" class="btn-danger-sm" data-confirm="Delete ${esc(user.name)} and ALL their data?">🗑 Delete</a>
        </div>
      </div>

      <div class="dash-stats" style="margin-bottom:24px">
        <div class="ds"><span style="color:var(--gold)">${leagues.length}</span><small>Leagues</small></div>
        <div class="ds"><span style="color:var(--teal)">${leagues.reduce((a,l)=>a+parseInt(l.team_count),0)}</span><small>Teams</small></div>
        <div class="ds"><span style="color:var(--purple)">${leagues.reduce((a,l)=>a+parseInt(l.player_count),0)}</span><small>Players</small></div>
        <div class="ds"><span style="color:var(--red)">${leagues.reduce((a,l)=>a+parseInt(l.game_count),0)}</span><small>Games</small></div>
      </div>

      <h3 style="font-family:'Russo One',sans-serif;font-size:16px;margin-bottom:14px">Leagues</h3>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${leagues.map(l => `
          <div style="background:var(--card);border:1px solid var(--border);border-left:3px solid var(--red);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div style="flex:1">
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">${levelBadge(l.level)} ${statusBadge(l.status)}</div>
              <div style="font-weight:700">${esc(l.name)}</div>
              <div style="font-size:12px;color:var(--muted)">Admin Code: <code style="color:var(--text);background:rgba(240,244,255,.07);padding:1px 6px;border-radius:3px">${esc(l.admin_code)}</code></div>
            </div>
            <div style="font-size:12px;color:var(--muted);display:flex;gap:14px">
              <span><b style="color:var(--gold)">${l.team_count}</b> teams</span>
              <span><b style="color:var(--teal)">${l.player_count}</b> players</span>
            </div>
            <div class="row-actions">
              <a href="/superadmin/league/${l.id}" class="btn-ghost-sm">Manage</a>
              <a href="/league/${l.id}" class="btn-ghost-sm" target="_blank">🌐</a>
            </div>
          </div>`).join('') || '<div class="empty-state">No leagues yet.</div>'}
      </div>
      <script src="/js/admin.js"></script>
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

// ── LOGIN AS COMMISSIONER ─────────────────────────────────────────────────────
router.get('/commissioner/:id/login-as', async (req, res) => {
  try {
    const user = await db.queryOne('SELECT * FROM users WHERE id=$1 AND role!=\'superadmin\'', [req.params.id]);
    if (!user) return res.redirect('/superadmin/commissioners');
    // Save super admin session for return
    req.session.superAdminToken = req.session.token;
    req.session.token = require('jsonwebtoken').sign(
      { id: user.id, email: user.email, name: user.name, plan: user.plan, role: user.role || 'commissioner' },
      process.env.JWT_SECRET || 'phhoops-jwt-secret-change-in-production',
      { expiresIn: '2h' }
    );
    res.redirect('/admin');
  } catch (err) { console.error(err); res.redirect('/superadmin'); }
});

// ── RETURN TO SUPER ADMIN ─────────────────────────────────────────────────────
router.get('/return', (req, res) => {
  if (req.session.superAdminToken) {
    req.session.token = req.session.superAdminToken;
    delete req.session.superAdminToken;
  }
  res.redirect('/superadmin');
});

// ── RESET PASSWORD ────────────────────────────────────────────────────────────
router.get('/commissioner/:id/reset-password', async (req, res) => {
  const user = await db.queryOne('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!user) return res.redirect('/superadmin/commissioners');
  res.send(superPage('Reset Password', req.user, `
    <div class="admin-header"><div>
      <a href="/superadmin/commissioner/${user.id}" class="back-link">← Back</a>
      <h1>🔑 Reset Password</h1>
      <p>${esc(user.name)} — ${esc(user.email)}</p>
    </div></div>
    <div class="card" style="max-width:400px">
      <form action="/superadmin/commissioner/${user.id}/reset-password" method="POST">
        <div class="field-group"><label>New Password</label>
          <input name="password" type="password" class="input" placeholder="Min 6 characters" required /></div>
        <div class="field-group"><label>Confirm Password</label>
          <input name="confirm" type="password" class="input" placeholder="Repeat password" required /></div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <a href="/superadmin/commissioner/${user.id}" class="btn-ghost">Cancel</a>
          <button type="submit" class="btn-primary">Reset Password →</button>
        </div>
      </form>
    </div>
  `));
});

router.post('/commissioner/:id/reset-password', async (req, res) => {
  try {
    const { password, confirm } = req.body;
    if (!password || password.length < 6 || password !== confirm)
      return res.redirect(`/superadmin/commissioner/${req.params.id}/reset-password`);
    await db.run('UPDATE users SET password=$1 WHERE id=$2', [bcrypt.hashSync(password, 10), req.params.id]);
    res.redirect(`/superadmin/commissioner/${req.params.id}`);
  } catch (err) { console.error(err); res.redirect('/superadmin'); }
});

// ── DELETE COMMISSIONER ───────────────────────────────────────────────────────
router.get('/commissioner/:id/delete', async (req, res) => {
  try {
    const user = await db.queryOne('SELECT * FROM users WHERE id=$1 AND role!=\'superadmin\'', [req.params.id]);
    if (!user) return res.redirect('/superadmin/commissioners');
    // Cascade: delete all their leagues (which cascades to teams/players/games)
    const leagues = await db.query('SELECT id FROM leagues WHERE user_id=$1', [user.id]);
    for (const l of leagues) await db.run('DELETE FROM leagues WHERE id=$1', [l.id]);
    await db.run('DELETE FROM users WHERE id=$1', [user.id]);
    res.redirect('/superadmin/commissioners');
  } catch (err) { console.error(err); res.redirect('/superadmin'); }
});

// ── VIEW ANY LEAGUE (super admin access) ─────────────────────────────────────
router.get('/league/:id', async (req, res) => {
  try {
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
    if (!league) return res.redirect('/superadmin');

    const owner = await db.queryOne('SELECT * FROM users WHERE id=$1', [league.user_id]);
    const [teams, players, games] = await Promise.all([
      db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC', [league.id]),
      db.query(`SELECT p.*,t.name as team_name FROM players p LEFT JOIN teams t ON p.team_id=t.id WHERE p.league_id=$1 ORDER BY p.pts DESC`, [league.id]),
      db.query(`SELECT g.*,ht.name as home_name,at.name as away_name FROM games g LEFT JOIN teams ht ON g.home_team_id=ht.id LEFT JOIN teams at ON g.away_team_id=at.id WHERE g.league_id=$1 ORDER BY g.id DESC`, [league.id]),
    ]);

    res.send(superPage(esc(league.name), req.user, `
      <div class="admin-header">
        <div>
          <a href="/superadmin/commissioner/${league.user_id}" class="back-link">← Commissioner: ${esc(owner?.name||'Unknown')}</a>
          <h1>${esc(league.name)}</h1>
          <div style="margin-top:4px">${levelBadge(league.level)} ${statusBadge(league.status)}
            <span style="color:var(--muted);font-size:13px;margin-left:8px">📍 ${esc(league.location)} · ${esc(league.season)}</span>
          </div>
        </div>
        <div class="ah-right">
          <a href="/league/${league.id}" class="btn-ghost-sm" target="_blank">🌐 Public View</a>
          <a href="/superadmin/league/${league.id}/delete" class="btn-danger-sm" data-confirm="Delete this league and all its data?">🗑 Delete League</a>
        </div>
      </div>

      <!-- STATS -->
      <div class="mini-stats" style="margin-bottom:24px">
        ${[{v:teams.length,l:'Teams',c:'var(--red)'},{v:players.length,l:'Players',c:'var(--teal)'},
           {v:games.filter(g=>g.status==='final').length,l:'Played',c:'var(--purple)'},{v:games.filter(g=>g.status==='upcoming').length,l:'Upcoming',c:'var(--gold)'}]
          .map(s=>`<div class="ms"><div style="font-size:32px;font-weight:900;color:${s.c}">${s.v}</div><div class="ms-label">${s.l}</div></div>`).join('')}
      </div>

      <!-- STANDINGS -->
      <h3 style="font-family:'Russo One',sans-serif;font-size:15px;margin-bottom:12px">Standings</h3>
      <table class="stats-table" style="margin-bottom:20px">
        <thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>WIN%</th></tr></thead>
        <tbody>
          ${teams.map((t,i)=>`
            <tr><td class="rank ${i===0?'rank-top':''}">${i+1}</td>
            <td><div class="team-name-cell"><div class="team-dot" style="background:${t.color}"></div>${esc(t.name)}</div></td>
            <td class="green">${t.wins}</td><td class="red">${t.losses}</td>
            <td style="color:var(--gold)">${((t.wins/(t.wins+t.losses||1))*100).toFixed(1)}%</td></tr>`).join('')
            || '<tr><td colspan="5" class="empty">No teams yet.</td></tr>'}
        </tbody>
      </table>

      <!-- TOP PLAYERS -->
      <h3 style="font-family:'Russo One',sans-serif;font-size:15px;margin-bottom:12px">Top Players</h3>
      <table class="stats-table">
        <thead><tr><th>#</th><th>Player</th><th>Team</th><th>PTS</th><th>REB</th><th>AST</th><th>FG%</th></tr></thead>
        <tbody>
          ${players.slice(0,8).map((p,i)=>`
            <tr><td class="rank ${i===0?'rank-top':''}">${i+1}</td>
            <td style="font-weight:600">${esc(p.name)}</td>
            <td style="color:var(--muted)">${esc(p.team_name||'')}</td>
            <td class="orange">${p.pts}</td><td>${p.reb}</td><td>${p.ast}</td>
            <td class="teal">${p.fg}%</td></tr>`).join('')
            || '<tr><td colspan="7" class="empty">No players yet.</td></tr>'}
        </tbody>
      </table>
      <script src="/js/admin.js"></script>
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

// ── DELETE LEAGUE (super admin) ───────────────────────────────────────────────
router.get('/league/:id/delete', async (req, res) => {
  try {
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
    if (!league) return res.redirect('/superadmin');
    const ownerId = league.user_id;
    await db.run('DELETE FROM leagues WHERE id=$1', [req.params.id]);
    res.redirect(`/superadmin/commissioner/${ownerId}`);
  } catch (err) { console.error(err); res.redirect('/superadmin'); }
});

// ── ALL LEAGUES ───────────────────────────────────────────────────────────────
router.get('/leagues', async (req, res) => {
  try {
    const leagues = await db.query(`
      SELECT l.*, u.name as owner_name,
        (SELECT COUNT(*) FROM teams WHERE league_id=l.id) as team_count,
        (SELECT COUNT(*) FROM players WHERE league_id=l.id) as player_count
      FROM leagues l JOIN users u ON l.user_id=u.id
      ORDER BY l.created_at DESC
    `);
    res.send(superPage('All Leagues', req.user, `
      <div class="admin-header">
        <div>
          <a href="/superadmin" class="back-link">← Dashboard</a>
          <h1>🏆 All Leagues</h1>
          <p>${leagues.length} total leagues across all commissioners</p>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${leagues.map(l => `
          <div style="background:var(--card);border:1px solid var(--border);border-left:3px solid var(--blue);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
            <div style="flex:1">
              <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">${levelBadge(l.level)} ${statusBadge(l.status)}</div>
              <div style="font-weight:700">${esc(l.name)}</div>
              <div style="font-size:12px;color:var(--muted)">📍 ${esc(l.location)} · Commissioner: <b style="color:var(--text)">${esc(l.owner_name)}</b></div>
            </div>
            <div style="font-size:12px;color:var(--muted);display:flex;gap:14px">
              <span><b style="color:var(--gold)">${l.team_count}</b> teams</span>
              <span><b style="color:var(--teal)">${l.player_count}</b> players</span>
            </div>
            <div class="row-actions">
              <a href="/superadmin/league/${l.id}" class="btn-ghost-sm">View</a>
              <a href="/league/${l.id}" class="btn-ghost-sm" target="_blank">🌐</a>
              <a href="/superadmin/league/${l.id}/delete" class="btn-danger-sm" data-confirm="Delete this league?">🗑</a>
            </div>
          </div>`).join('') || '<div class="empty-state">No leagues yet.</div>'}
      </div>
      <script src="/js/admin.js"></script>
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

// ── SHARED HELPERS ────────────────────────────────────────────────────────────
function superPage(title, user, content, req = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#e63329">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="PH HOOPS">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src-elem 'self' 'unsafe-inline'; script-src-attr 'self' 'unsafe-inline' 'unsafe-hashes'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:;">
<title>${title} | PH Hoops Super Admin</title>
<link rel="stylesheet" href="/css/main.css">
</head>
<body class="dark-bg">
<nav class="topnav" style="border-bottom-color:var(--gold)">
  <div class="nav-brand">
    <a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px">
      <img src="/icons/icon-192.png" alt="PH Hoops" style="width:40px;height:40px;border-radius:10px;object-fit:cover;display:block;flex-shrink:0">
      <div class="nav-brand-text">
        <div class="brand-text">PH HOOPS</div>
        <div class="brand-sub" style="color:var(--gold)">Super Admin</div>
      </div>
    </a>
  </div>
  <div class="nav-center" style="font-size:11px;color:var(--gold);letter-spacing:2px;font-weight:700;opacity:.7">SYSTEM PANEL</div>
  <div class="nav-actions">
    <span style="font-size:13px;color:var(--muted)">${esc(user.name)}</span>
    <span class="pro-badge" style="background:var(--gold-dim);color:var(--gold)">⚡ SUPER ADMIN</span>
    <a href="/superadmin/return" class="btn-ghost-sm" id="returnBtn" style="display:none">← Return</a>
    <a href="/logout" class="btn-ghost-sm">Logout</a>
  </div>
</nav>
<div style="background:var(--gold-dim);border-bottom:1px solid rgba(245,200,66,.2);padding:6px 24px;font-size:11px;color:var(--gold);font-weight:700;letter-spacing:1.5px;text-align:center">
  ⚡ SUPER ADMIN MODE — You have full access to all data
</div>
<div class="admin-wrap">${content}</div>
<script>
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js');
}
</script>
</body>
</html>`;
}

module.exports = router;
