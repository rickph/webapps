const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { esc, levelBadge, statusBadge, levelColor } = require('../helpers');

router.use(requireAuth);

const LEVEL_OPTIONS = ['Barangay','City/Municipal','Provincial','Regional'];
const TEAM_COLORS   = ['#e63946','#457b9d','#2a9d8f','#e9c46a','#f4a261','#264653','#e76f51','#6a4c93','#1982c4','#8ac926'];
const POSITIONS     = ['PG','SG','SF','PF','C'];

async function ownsLeague(leagueId, userId) {
  const l = await db.queryOne('SELECT user_id FROM leagues WHERE id=$1', [leagueId]);
  return l && Number(l.user_id) === Number(userId);
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const leagues = await db.query(`
      SELECT l.*,
        (SELECT COUNT(*) FROM teams   WHERE league_id=l.id) as team_count,
        (SELECT COUNT(*) FROM players WHERE league_id=l.id) as player_count,
        (SELECT COUNT(*) FROM games   WHERE league_id=l.id AND status='final') as game_count
      FROM leagues l WHERE l.user_id=$1 ORDER BY l.created_at DESC`, [req.user.id]);

    const [totals] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM teams   WHERE league_id IN (SELECT id FROM leagues WHERE user_id=$1)) as teams,
        (SELECT COUNT(*) FROM players WHERE league_id IN (SELECT id FROM leagues WHERE user_id=$1)) as players,
        (SELECT COUNT(*) FROM games   WHERE league_id IN (SELECT id FROM leagues WHERE user_id=$1) AND status='final') as games
    `, [req.user.id]);

    const leagueCards = leagues.map(l => `
      <div class="admin-league-card">
        <div class="alc-top">${levelBadge(l.level)} ${statusBadge(l.status)}</div>
        <div class="alc-name">${esc(l.name)}</div>
        <div class="alc-loc">📍 ${esc(l.location)} · ${esc(l.season)}</div>
        <div class="alc-meta">Admin Code: <code>${esc(l.admin_code)}</code></div>
        <div class="alc-stats">
          <span class="acs"><b style="color:#ff6b35">${l.team_count}</b> Teams</span>
          <span class="acs"><b style="color:#00d4aa">${l.player_count}</b> Players</span>
          <span class="acs"><b style="color:#f7c948">${l.game_count}</b> Games</span>
        </div>
        <div class="alc-actions">
          <a href="/admin/league/${l.id}" class="btn-primary-sm">Manage →</a>
          <a href="/league/${l.id}" class="btn-ghost-sm" target="_blank">Public View</a>
          <a href="/admin/league/${l.id}/delete" class="btn-danger-sm" data-confirm="Delete this league and ALL its data?">Delete</a>
        </div>
      </div>`).join('');

    res.send(adminPage('Dashboard', req.user, `
      <div class="admin-header">
        <div>
          <h1>Welcome, ${esc(req.user.name)} 👋</h1>
          <p>Manage your basketball leagues</p>
        </div>
        <div class="ah-right">
          <a href="/admin/new-league" class="btn-primary">+ New League</a>
        </div>
      </div>
      <div class="dash-stats">
        <div class="ds"><span style="color:#ff6b35">${leagues.length}</span><small>My Leagues</small></div>
        <div class="ds"><span style="color:#00d4aa">${totals.teams}</span><small>Teams</small></div>
        <div class="ds"><span style="color:#a78bfa">${totals.players}</span><small>Players</small></div>
        <div class="ds"><span style="color:#f7c948">${totals.games}</span><small>Games Played</small></div>
      </div>
      <div class="league-grid-admin">
        ${leagueCards || '<div class="empty-state"><div class="es-icon">🏆</div><div>No leagues yet. <a href="/admin/new-league" style="color:#ff6b35">Create your first one!</a></div></div>'}
      </div>
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

// ── NEW LEAGUE (plain form page) ──────────────────────────────────────────────
router.get('/new-league', (req, res) => {
  const err = req.query.error;
  res.send(adminPage('New League', req.user, `
    <div class="admin-header">
      <div>
        <a href="/admin" class="back-link">← Back</a>
        <h1>Create New League</h1>
      </div>
    </div>
    ${err ? `<div class="alert-error" style="max-width:540px;margin-bottom:16px">⚠ ${err === 'missing' ? 'League name and admin code are required.' : 'Server error, please try again.'}</div>` : ''}
    <div class="card" style="max-width:540px">
      <form action="/admin/new-league" method="POST">
        <div class="field-group"><label>League Name</label>
          <input name="name" class="input" placeholder="e.g. Brgy. Poblacion Summer Cup" required /></div>
        <div class="field-group"><label>Level</label>
          <select name="level" class="input">
            ${LEVEL_OPTIONS.map(l=>`<option value="${l}">${l}</option>`).join('')}
          </select></div>
        <div class="field-group"><label>Location</label>
          <input name="location" class="input" placeholder="e.g. Barangay Poblacion, Makati City" /></div>
        <div class="field-group"><label>Season / Tournament Name</label>
          <input name="season" class="input" placeholder="e.g. Summer 2025" /></div>
        <div class="field-group"><label>Status</label>
          <select name="status" class="input">
            <option value="upcoming">Upcoming</option>
            <option value="ongoing">Ongoing</option>
          </select></div>
        <div class="field-group"><label>Admin Code <span style="color:#555;font-size:11px">(share with scorers)</span></label>
          <input name="admin_code" class="input" placeholder="e.g. BRGY2025" required /></div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <a href="/admin" class="btn-ghost">Cancel</a>
          <button type="submit" class="btn-primary">Create League →</button>
        </div>
      </form>
    </div>
  `));
});

router.post('/new-league', async (req, res) => {
  try {
    const { name, level, location, season, status, admin_code } = req.body;
    if (!name?.trim() || !admin_code?.trim()) return res.redirect('/admin/new-league?error=missing');
    await db.run(
      'INSERT INTO leagues (user_id,name,level,location,season,status,admin_code,is_public) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.user.id, name.trim(), level||'Barangay', location||'', season||'', status||'upcoming', admin_code.trim(), true]
    );
    res.redirect('/admin');
  } catch (err) { console.error(err); res.redirect('/admin/new-league?error=server'); }
});

// ── DELETE LEAGUE ─────────────────────────────────────────────────────────────
router.get('/league/:id/delete', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    await db.run('DELETE FROM leagues WHERE id=$1', [req.params.id]);
    res.redirect('/admin');
  } catch (err) { console.error(err); res.redirect('/admin'); }
});

// ── LEAGUE MANAGEMENT PAGE ────────────────────────────────────────────────────
router.get('/league/:id', async (req, res) => {
  try {
    const lid = req.params.id;
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [lid]);
    if (!league || !await ownsLeague(lid, req.user.id)) return res.redirect('/admin');

    const [teams, players, games] = await Promise.all([
      db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC, losses ASC', [lid]),
      db.query(`SELECT p.*,t.name as team_name FROM players p
                LEFT JOIN teams t ON p.team_id=t.id
                WHERE p.league_id=$1 ORDER BY p.pts DESC`, [lid]),
      db.query(`SELECT g.*,ht.name as home_name,at.name as away_name FROM games g
                LEFT JOIN teams ht ON g.home_team_id=ht.id
                LEFT JOIN teams at ON g.away_team_id=at.id
                WHERE g.league_id=$1 ORDER BY g.id DESC`, [lid]),
    ]);

    const topts = teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
    const upcomingGames = games.filter(g=>g.status!=='final');

    res.send(adminPage(esc(league.name), req.user, `
      <div class="admin-header">
        <div>
          <a href="/admin" class="back-link">← My Leagues</a>
          <h1>${esc(league.name)}</h1>
          <div class="lh-meta" style="margin-top:4px">
            ${levelBadge(league.level)} ${statusBadge(league.status)}
            <span style="color:#666;font-size:13px;margin-left:8px">📍 ${esc(league.location)} · ${esc(league.season)}</span>
          </div>
        </div>
        <div class="ah-right">
          <a href="/league/${league.id}" class="btn-ghost-sm" target="_blank">🌐 Public View</a>
          <a href="/admin/league/${league.id}/pdf" class="btn-ghost-sm">📄 PDF</a>
          <a href="/admin/league/${league.id}/bracket" class="btn-ghost-sm">🏆 Bracket</a>
        </div>
      </div>

      <div class="admin-tabs" id="adminTabs">
        <button class="atab active" data-tab="dashboard">📊 Dashboard</button>
        <button class="atab" data-tab="teams">👕 Teams</button>
        <button class="atab" data-tab="players">👤 Players</button>
        <button class="atab" data-tab="games">🏀 Games</button>
        <button class="atab" data-tab="livescore">🔴 Live Score</button>
      </div>

      <!-- DASHBOARD TAB -->
      <div id="tab-dashboard" class="atab-pane">
        <div class="mini-stats">
          ${[{v:teams.length,l:'Teams',c:'#ff6b35'},{v:players.length,l:'Players',c:'#00d4aa'},
             {v:games.filter(g=>g.status==='final').length,l:'Games Played',c:'#a78bfa'},
             {v:upcomingGames.length,l:'Upcoming',c:'#f7c948'}]
            .map(s=>`<div class="ms"><div style="font-size:36px;font-weight:800;color:${s.c}">${s.v}</div><div class="ms-label">${s.l}</div></div>`).join('')}
        </div>
        <h3 style="margin-bottom:12px">Top Performers</h3>
        <table class="stats-table">
          <thead><tr><th>#</th><th>Player</th><th>Team</th><th>PTS</th><th>REB</th><th>AST</th><th>FG%</th></tr></thead>
          <tbody>
            ${players.slice(0,8).map((p,i)=>`
              <tr><td class="rank ${i===0?'rank-top':''}">${i+1}</td>
              <td style="font-weight:600">${esc(p.name)}</td>
              <td class="sub-text">${esc(p.team_name||'')}</td>
              <td class="orange">${p.pts}</td><td>${p.reb}</td><td>${p.ast}</td>
              <td class="teal">${p.fg}%</td></tr>`).join('')
              || '<tr><td colspan="7" class="empty">No players yet.</td></tr>'}
          </tbody>
        </table>
      </div>

      <!-- TEAMS TAB -->
      <div id="tab-teams" class="atab-pane hidden">
        <div class="tab-action-bar">
          <h3>Teams (${teams.length})</h3>
          <a href="/admin/league/${league.id}/add-team" class="btn-primary">+ Add Team</a>
        </div>
        <div class="teams-list">
          ${teams.map(t=>`
            <div class="team-row">
              <div class="team-color-bar" style="background:${t.color}"></div>
              <div class="team-info">
                <div style="font-weight:700">${esc(t.name)}</div>
                <div class="sub-text">${players.filter(p=>p.team_id==t.id).length} players</div>
              </div>
              <div class="team-record"><span class="green">${t.wins}W</span> <span class="red">${t.losses}L</span></div>
              <div class="row-actions">
                <a href="/admin/league/${league.id}/edit-team/${t.id}" class="btn-ghost-sm">✏ Edit</a>
                <a href="/admin/league/${league.id}/delete-team/${t.id}" class="btn-danger-sm" data-confirm="Delete this team?">🗑</a>
              </div>
            </div>`).join('') || '<div class="empty-state">No teams yet.</div>'}
        </div>
      </div>

      <!-- PLAYERS TAB -->
      <div id="tab-players" class="atab-pane hidden">
        <div class="tab-action-bar">
          <h3>Players (${players.length})</h3>
          <a href="/admin/league/${league.id}/add-player" class="btn-primary">+ Add Player</a>
        </div>
        <div style="overflow-x:auto">
          <table class="stats-table">
            <thead><tr><th>#</th><th>Name</th><th>Team</th><th>POS</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG%</th><th></th></tr></thead>
            <tbody>
              ${players.map((p,i)=>`
                <tr>
                  <td class="rank">${i+1}</td>
                  <td><div style="font-weight:600">${esc(p.name)}</div><div class="sub-text">#${p.jersey}</div></td>
                  <td class="sub-text">${esc(p.team_name||'')}</td>
                  <td><span class="pos-badge">${p.pos}</span></td>
                  <td class="orange">${p.pts}</td><td>${p.reb}</td><td>${p.ast}</td>
                  <td>${p.stl}</td><td>${p.blk}</td><td class="teal">${p.fg}%</td>
                  <td>
                    <a href="/admin/league/${league.id}/edit-player/${p.id}" class="btn-ghost-sm">✏</a>
                    <a href="/admin/league/${league.id}/delete-player/${p.id}" class="btn-danger-sm" data-confirm="Delete this player?">🗑</a>
                  </td>
                </tr>`).join('') || '<tr><td colspan="11" class="empty">No players yet.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- GAMES TAB -->
      <div id="tab-games" class="atab-pane hidden">
        <div class="tab-action-bar">
          <h3>Games (${games.length})</h3>
          <a href="/admin/league/${league.id}/add-game" class="btn-primary">+ Schedule Game</a>
        </div>
        <div class="games-list">
          ${games.map(g=>`
            <div class="game-row">
              <div class="game-meta"><div class="game-date">${esc(g.date||'TBD')}</div><div class="game-venue">📍 ${esc(g.venue||'TBD')}</div></div>
              <div class="game-matchup">
                <span class="game-team">${esc(g.home_name||'TBD')}</span>
                ${g.status==='final'
                  ? `<div class="score-final"><span class="${g.home_score>=g.away_score?'score-win':'score-lose'}">${g.home_score}</span><span class="score-vs">FINAL</span><span class="${g.away_score>g.home_score?'score-win':'score-lose'}">${g.away_score}</span></div>`
                  : '<span class="vs-badge">VS</span>'}
                <span class="game-team">${esc(g.away_name||'TBD')}</span>
              </div>
              <div class="row-actions">
                ${statusBadge(g.status)}
                ${g.status!=='final'?`<a href="/admin/league/${league.id}/score/${g.id}" class="btn-teal-sm">🔴 Score</a>`:''}
                <a href="/admin/league/${league.id}/delete-game/${g.id}" class="btn-danger-sm" data-confirm="Delete this game?">🗑</a>
              </div>
            </div>`).join('') || '<div class="empty-state">No games scheduled.</div>'}
        </div>
      </div>

      <!-- LIVE SCORE TAB -->
      <div id="tab-livescore" class="atab-pane hidden">
        <h3 style="margin-bottom:16px">Select Game to Score</h3>
        <div class="games-list">
          ${upcomingGames.map(g=>`
            <div class="game-row">
              <div class="game-matchup">
                <span class="game-team">${esc(g.home_name||'?')}</span>
                <span class="vs-badge">VS</span>
                <span class="game-team">${esc(g.away_name||'?')}</span>
              </div>
              <div class="game-meta"><div class="game-date">${esc(g.date||'TBD')}</div></div>
              <a href="/admin/league/${league.id}/score/${g.id}" class="btn-teal-sm">🔴 Start Scoring</a>
            </div>`).join('') || '<div class="empty-state">No upcoming games. <a href="/admin/league/${league.id}/add-game" style="color:#ff6b35">Schedule a game first.</a></div>'}
        </div>
      </div>

      <script src="/js/admin.js"></script>
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

// ── ADD/EDIT TEAM ─────────────────────────────────────────────────────────────
router.get('/league/:id/add-team', async (req, res) => {
  const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
  if (!league || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
  res.send(adminPage('Add Team', req.user, `
    <div class="admin-header"><div>
      <a href="/admin/league/${league.id}#teams" class="back-link">← Back</a>
      <h1>Add Team</h1>
    </div></div>
    <div class="card" style="max-width:480px">
      <form action="/admin/league/${league.id}/add-team" method="POST">
        <div class="field-group"><label>Team Name</label>
          <input name="name" class="input" placeholder="e.g. Purok 1 Ballers" required /></div>
        <div class="field-group"><label>Color</label>
          <select name="color" class="input">
            ${TEAM_COLORS.map(c=>`<option value="${c}" style="background:${c}">${c}</option>`).join('')}
          </select></div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <a href="/admin/league/${league.id}" class="btn-ghost">Cancel</a>
          <button type="submit" class="btn-primary">Add Team →</button>
        </div>
      </form>
    </div>
  `));
});

router.post('/league/:id/add-team', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const { name, color } = req.body;
    if (!name?.trim()) return res.redirect(`/admin/league/${req.params.id}/add-team`);
    await db.run('INSERT INTO teams (league_id,name,color) VALUES ($1,$2,$3)',
      [req.params.id, name.trim(), color||'#e63946']);
    res.redirect(`/admin/league/${req.params.id}`);
  } catch (err) { console.error(err); res.redirect(`/admin/league/${req.params.id}`); }
});

router.get('/league/:id/edit-team/:tid', async (req, res) => {
  const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
  const team   = await db.queryOne('SELECT * FROM teams WHERE id=$1', [req.params.tid]);
  if (!league || !team || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
  res.send(adminPage('Edit Team', req.user, `
    <div class="admin-header"><div>
      <a href="/admin/league/${league.id}" class="back-link">← Back</a>
      <h1>Edit Team</h1>
    </div></div>
    <div class="card" style="max-width:480px">
      <form action="/admin/league/${league.id}/edit-team/${team.id}" method="POST">
        <div class="field-group"><label>Team Name</label>
          <input name="name" class="input" value="${esc(team.name)}" required /></div>
        <div class="field-group"><label>Color</label>
          <select name="color" class="input">
            ${TEAM_COLORS.map(c=>`<option value="${c}" ${c===team.color?'selected':''}>${c}</option>`).join('')}
          </select></div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <a href="/admin/league/${league.id}" class="btn-ghost">Cancel</a>
          <button type="submit" class="btn-primary">Save Changes →</button>
        </div>
      </form>
    </div>
  `));
});

router.post('/league/:id/edit-team/:tid', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    await db.run('UPDATE teams SET name=$1,color=$2 WHERE id=$3',
      [req.body.name, req.body.color, req.params.tid]);
    res.redirect(`/admin/league/${req.params.id}`);
  } catch (err) { console.error(err); res.redirect(`/admin/league/${req.params.id}`); }
});

router.get('/league/:id/delete-team/:tid', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    await db.run('DELETE FROM teams WHERE id=$1', [req.params.tid]);
    res.redirect(`/admin/league/${req.params.id}`);
  } catch (err) { console.error(err); res.redirect(`/admin/league/${req.params.id}`); }
});

// ── ADD/EDIT PLAYER ───────────────────────────────────────────────────────────
router.get('/league/:id/add-player', async (req, res) => {
  const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
  if (!league || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
  const teams = await db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY name', [req.params.id]);
  res.send(adminPage('Add Player', req.user, playerForm(league, teams, null)));
});

router.post('/league/:id/add-player', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const { team_id,name,pos,jersey,gp,pts,reb,ast,stl,blk,fg } = req.body;
    if (!name?.trim()) return res.redirect(`/admin/league/${req.params.id}/add-player`);
    await db.run(
      'INSERT INTO players (league_id,team_id,name,pos,jersey,gp,pts,reb,ast,stl,blk,fg) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [req.params.id,team_id,name.trim(),pos,jersey||0,gp||0,pts||0,reb||0,ast||0,stl||0,blk||0,fg||0]
    );
    res.redirect(`/admin/league/${req.params.id}`);
  } catch (err) { console.error(err); res.redirect(`/admin/league/${req.params.id}`); }
});

router.get('/league/:id/edit-player/:pid', async (req, res) => {
  const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
  const player = await db.queryOne('SELECT * FROM players WHERE id=$1', [req.params.pid]);
  if (!league || !player || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
  const teams = await db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY name', [req.params.id]);
  res.send(adminPage('Edit Player', req.user, playerForm(league, teams, player)));
});

router.post('/league/:id/edit-player/:pid', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const { team_id,name,pos,jersey,gp,pts,reb,ast,stl,blk,fg } = req.body;
    await db.run(
      'UPDATE players SET team_id=$1,name=$2,pos=$3,jersey=$4,gp=$5,pts=$6,reb=$7,ast=$8,stl=$9,blk=$10,fg=$11 WHERE id=$12',
      [team_id,name,pos,jersey||0,gp||0,pts||0,reb||0,ast||0,stl||0,blk||0,fg||0,req.params.pid]
    );
    res.redirect(`/admin/league/${req.params.id}`);
  } catch (err) { console.error(err); res.redirect(`/admin/league/${req.params.id}`); }
});

router.get('/league/:id/delete-player/:pid', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    await db.run('DELETE FROM players WHERE id=$1', [req.params.pid]);
    res.redirect(`/admin/league/${req.params.id}`);
  } catch (err) { console.error(err); res.redirect(`/admin/league/${req.params.id}`); }
});

// ── ADD GAME ──────────────────────────────────────────────────────────────────
router.get('/league/:id/add-game', async (req, res) => {
  const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
  if (!league || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
  const teams = await db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY name', [req.params.id]);
  const topts = `<option value="">Select team</option>` + teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
  res.send(adminPage('Add Game', req.user, `
    <div class="admin-header"><div>
      <a href="/admin/league/${league.id}" class="back-link">← Back</a>
      <h1>Schedule Game</h1>
    </div></div>
    <div class="card" style="max-width:540px">
      <form action="/admin/league/${league.id}/add-game" method="POST">
        <div class="field-group"><label>Home Team</label><select name="home_team_id" class="input">${topts}</select></div>
        <div class="field-group"><label>Away Team</label><select name="away_team_id" class="input">${topts}</select></div>
        <div class="field-group"><label>Date</label><input name="date" class="input" placeholder="e.g. May 1, 2025" /></div>
        <div class="field-group"><label>Venue / Court</label><input name="venue" class="input" placeholder="e.g. Brgy. Court Name" /></div>
        <div class="field-group"><label>Status</label>
          <select name="status" class="input">
            <option value="upcoming">Upcoming</option>
            <option value="ongoing">Ongoing</option>
            <option value="final">Final</option>
          </select></div>
        <div class="field-group"><label>Home Score</label><input name="home_score" type="number" class="input" value="0" /></div>
        <div class="field-group"><label>Away Score</label><input name="away_score" type="number" class="input" value="0" /></div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <a href="/admin/league/${league.id}" class="btn-ghost">Cancel</a>
          <button type="submit" class="btn-primary">Save Game →</button>
        </div>
      </form>
    </div>
  `));
});

router.post('/league/:id/add-game', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const { home_team_id,away_team_id,date,venue,status,home_score,away_score } = req.body;
    await db.run(
      'INSERT INTO games (league_id,home_team_id,away_team_id,home_score,away_score,date,venue,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.params.id,home_team_id||null,away_team_id||null,home_score||0,away_score||0,date||'TBD',venue||'TBD',status||'upcoming']
    );
    res.redirect(`/admin/league/${req.params.id}`);
  } catch (err) { console.error(err); res.redirect(`/admin/league/${req.params.id}`); }
});

router.get('/league/:id/delete-game/:gid', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    await db.run('DELETE FROM games WHERE id=$1', [req.params.gid]);
    res.redirect(`/admin/league/${req.params.id}`);
  } catch (err) { console.error(err); res.redirect(`/admin/league/${req.params.id}`); }
});

// ── LIVE SCORE PAGE ───────────────────────────────────────────────────────────
router.get('/league/:id/score/:gid', async (req, res) => {
  try {
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
    const game   = await db.queryOne(`
      SELECT g.*,ht.name as home_name,at.name as away_name
      FROM games g
      LEFT JOIN teams ht ON g.home_team_id=ht.id
      LEFT JOIN teams at ON g.away_team_id=at.id
      WHERE g.id=$1`, [req.params.gid]);
    if (!league || !game || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');

    res.send(adminPage('Live Score', req.user, `
      <div class="admin-header"><div>
        <a href="/admin/league/${league.id}" class="back-link">← Back</a>
        <h1>🔴 Live Scoring</h1>
        <p>${esc(game.home_name||'Home')} vs ${esc(game.away_name||'Away')}</p>
      </div></div>
      <div class="card card-hot" style="max-width:640px">
        <form action="/admin/league/${league.id}/score/${game.id}" method="POST">
          <div class="live-scoreboard" style="margin-bottom:24px">
            <div class="live-team">
              <div class="live-team-name">${esc(game.home_name||'Home')}</div>
              <input name="home_score" type="number" value="${game.home_score||0}"
                class="live-score" style="background:none;border:none;color:#00d4aa;width:120px;text-align:center;font-size:64px;font-weight:900;outline:none;" />
            </div>
            <div class="live-center">
              <div style="font-size:11px;color:#666;font-weight:700;letter-spacing:2px;margin-bottom:6px">QTR</div>
              <input name="quarter" type="number" min="1" max="4" value="1"
                style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#f7c948;width:70px;text-align:center;font-size:36px;font-weight:800;border-radius:6px;outline:none;" />
            </div>
            <div class="live-team">
              <div class="live-team-name">${esc(game.away_name||'Away')}</div>
              <input name="away_score" type="number" value="${game.away_score||0}"
                class="live-score" style="background:none;border:none;color:#ff6b35;width:120px;text-align:center;font-size:64px;font-weight:900;outline:none;" />
            </div>
          </div>
          <div class="field-group"><label>Status</label>
            <select name="status" class="input">
              <option value="ongoing" ${game.status==='ongoing'?'selected':''}>Ongoing</option>
              <option value="final"   ${game.status==='final'?'selected':''}>Final</option>
            </select></div>
          <div style="display:flex;gap:10px;margin-top:20px;justify-content:center">
            <a href="/admin/league/${league.id}" class="btn-ghost">Cancel</a>
            <button type="submit" class="btn-primary">✅ Save Score &amp; Update Standings</button>
          </div>
        </form>
      </div>
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

router.post('/league/:id/score/:gid', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const { home_score, away_score, status } = req.body;
    const game = await db.queryOne('SELECT * FROM games WHERE id=$1', [req.params.gid]);
    await db.run('UPDATE games SET home_score=$1,away_score=$2,status=$3 WHERE id=$4',
      [home_score||0, away_score||0, status||'ongoing', req.params.gid]);
    if (status === 'final' && game) {
      const h = Number(home_score), a = Number(away_score);
      if (h > a) {
        if (game.home_team_id) await db.run('UPDATE teams SET wins=wins+1 WHERE id=$1', [game.home_team_id]);
        if (game.away_team_id) await db.run('UPDATE teams SET losses=losses+1 WHERE id=$1', [game.away_team_id]);
      } else if (a > h) {
        if (game.away_team_id) await db.run('UPDATE teams SET wins=wins+1 WHERE id=$1', [game.away_team_id]);
        if (game.home_team_id) await db.run('UPDATE teams SET losses=losses+1 WHERE id=$1', [game.home_team_id]);
      }
    }
    res.redirect(`/admin/league/${req.params.id}`);
  } catch (err) { console.error(err); res.redirect(`/admin/league/${req.params.id}`); }
});

// ── PDF REPORT ────────────────────────────────────────────────────────────────
router.get('/league/:id/pdf', async (req, res) => {
  try {
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
    if (!league || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const [teams, players] = await Promise.all([
      db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC', [league.id]),
      db.query(`SELECT p.*,t.name as team_name FROM players p LEFT JOIN teams t ON p.team_id=t.id WHERE p.league_id=$1 ORDER BY p.pts DESC`, [league.id]),
    ]);
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin:40, size:'A4' });
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${league.name.replace(/[^a-z0-9]/gi,'_')}_stats.pdf"`);
    doc.pipe(res);
    doc.rect(0,0,595,80).fill('#0f0f1a');
    doc.fillColor('#ff6b35').fontSize(22).font('Helvetica-Bold').text('PH HOOPS',40,18);
    doc.fillColor('#ffffff').fontSize(14).text(league.name,40,44);
    doc.fillColor('#888888').fontSize(10).text(`${league.location} · ${league.season} · ${league.level}`,40,62);
    let y=100;
    doc.fillColor('#ff6b35').fontSize(13).font('Helvetica-Bold').text('TEAM STANDINGS',40,y);
    doc.moveTo(40,y+16).lineTo(555,y+16).strokeColor('#ff6b35').lineWidth(1).stroke();
    y+=26;
    doc.fillColor('#888').fontSize(9).font('Helvetica-Bold').text('#',40,y).text('TEAM',65,y).text('W',340,y).text('L',380,y).text('WIN%',415,y);
    y+=14;
    for (const [i,t] of teams.entries()) {
      if(i%2===0)doc.rect(40,y-2,515,17).fill('#0a0a12');
      const pct=((t.wins/(t.wins+t.losses||1))*100).toFixed(1);
      doc.fillColor(i<2?'#ff6b35':'#ccc').fontSize(9).font('Helvetica-Bold').text(`${i+1}`,42,y);
      doc.fillColor('#fff').font('Helvetica').text(t.name,65,y,{width:260});
      doc.fillColor('#00d4aa').text(`${t.wins}`,340,y);
      doc.fillColor('#ff4757').text(`${t.losses}`,380,y);
      doc.fillColor('#aaa').text(`${pct}%`,415,y);
      y+=17;
    }
    y+=18;
    if(y>720){doc.addPage();y=40;}
    doc.fillColor('#ff6b35').fontSize(13).font('Helvetica-Bold').text('PLAYER STATISTICS',40,y);
    doc.moveTo(40,y+16).lineTo(555,y+16).strokeColor('#ff6b35').lineWidth(1).stroke();
    y+=26;
    doc.fillColor('#888').fontSize(8).font('Helvetica-Bold')
      .text('#',40,y).text('PLAYER',58,y).text('TEAM',195,y).text('POS',295,y)
      .text('PTS',330,y).text('REB',360,y).text('AST',390,y).text('STL',420,y).text('BLK',450,y).text('FG%',480,y);
    y+=14;
    for (const [i,p] of players.entries()) {
      if(y>760){doc.addPage();y=40;}
      if(i%2===0)doc.rect(40,y-2,515,16).fill('#0a0a12');
      doc.fillColor(i===0?'#ff6b35':'#888').fontSize(8).font('Helvetica-Bold').text(`${i+1}`,42,y);
      doc.fillColor('#fff').font('Helvetica').text(p.name,58,y,{width:130});
      doc.fillColor('#aaa').text((p.team_name||'').slice(0,20),195,y).text(p.pos,295,y);
      doc.fillColor('#ff6b35').text(`${p.pts}`,330,y);
      doc.fillColor('#fff').text(`${p.reb}`,360,y).text(`${p.ast}`,390,y).text(`${p.stl}`,420,y).text(`${p.blk}`,450,y);
      doc.fillColor('#00d4aa').text(`${p.fg}%`,480,y);
      y+=16;
    }
    doc.fillColor('#444').fontSize(8).text(`Generated by PH Hoops · ${new Date().toLocaleDateString('en-PH')}`,40,800);
    doc.end();
  } catch (err) { console.error(err); res.status(500).send('Error generating PDF'); }
});

// ── BRACKET ───────────────────────────────────────────────────────────────────
router.get('/league/:id/bracket', async (req, res) => {
  try {
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
    if (!league || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const teams = await db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC', [league.id]);
    const seeded = teams.slice(0,8);
    const n = Math.pow(2, Math.ceil(Math.log2(Math.max(seeded.length,2))));
    while (seeded.length < n) seeded.push(null);
    const rounds = Math.log2(n);
    const rnames = ['Quarterfinals','Semifinals','Finals','Champion'];
    let matchups = [];
    for (let i=0; i<n/2; i++) matchups.push([seeded[i*2], seeded[i*2+1]]);
    let bracketHTML = '<div class="bracket-rounds">';
    for (let r=0; r<rounds; r++) {
      bracketHTML += `<div class="bracket-round"><div class="round-name">${rnames[r]||'Round '+(r+1)}</div>`;
      matchups.forEach(m => {
        bracketHTML += `<div class="bracket-match">
          <div class="bm-team${m[0]?'':' bye'}">${m[0]?esc(m[0].name):'BYE'}</div>
          <div class="bm-vs">vs</div>
          <div class="bm-team${m[1]?'':' bye'}">${m[1]?esc(m[1].name):'BYE'}</div>
        </div>`;
      });
      bracketHTML += '</div>';
      const next = [];
      for (let i=0; i<matchups.length; i+=2) next.push([null,null]);
      matchups = next.length ? next : [[null,null]];
    }
    bracketHTML += '</div>';
    res.send(adminPage(`Bracket — ${esc(league.name)}`, req.user, `
      <div class="admin-header">
        <div>
          <a href="/admin/league/${league.id}" class="back-link">← Back</a>
          <h1>🏆 Playoff Bracket</h1>
          <p>${esc(league.name)}</p>
        </div>
        <div class="ah-right"><button class="btn-ghost-sm" id="printBtn">🖨 Print</button></div>
      </div>
      <div class="bracket-container">
        <div class="bracket-info">Single-elimination — top ${teams.slice(0,8).length} teams by standings.</div>
        ${teams.length >= 2 ? bracketHTML : '<div class="empty-state">Need at least 2 teams.</div>'}
      </div>
      <script src="/js/admin.js"></script>
    `));
  } catch (err) { console.error(err); res.status(500).send('Error'); }
});

// ── DELETE LEAGUE ─────────────────────────────────────────────────────────────
router.get('/league/:id/delete', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    await db.run('DELETE FROM leagues WHERE id=$1', [req.params.id]);
    res.redirect('/admin');
  } catch (err) { console.error(err); res.redirect('/admin'); }
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
function playerForm(league, teams, player) {
  const v = (k, def='') => player ? esc(String(player[k]??def)) : def;
  return `
    <div class="admin-header"><div>
      <a href="/admin/league/${league.id}" class="back-link">← Back</a>
      <h1>${player ? 'Edit' : 'Add'} Player</h1>
    </div></div>
    <div class="card" style="max-width:600px">
      <form action="/admin/league/${league.id}/${player?`edit-player/${player.id}`:'add-player'}" method="POST">
        <div class="modal-grid">
          <div class="field-group"><label>Full Name</label>
            <input name="name" class="input" placeholder="Player name" value="${v('name')}" required /></div>
          <div class="field-group"><label>Jersey #</label>
            <input name="jersey" type="number" class="input" placeholder="0" value="${v('jersey','0')}" /></div>
          <div class="field-group"><label>Team</label>
            <select name="team_id" class="input">
              <option value="">Select team</option>
              ${teams.map(t=>`<option value="${t.id}" ${player?.team_id==t.id?'selected':''}>${esc(t.name)}</option>`).join('')}
            </select></div>
          <div class="field-group"><label>Position</label>
            <select name="pos" class="input">
              <option value="">Select</option>
              ${POSITIONS.map(p=>`<option ${v('pos')===p?'selected':''}>${p}</option>`).join('')}
            </select></div>
          <div class="field-group"><label>Games Played</label>
            <input name="gp"  type="number" class="input" placeholder="0" value="${v('gp','0')}" /></div>
          <div class="field-group"><label>Points/Game</label>
            <input name="pts" type="number" step="0.1" class="input" placeholder="0.0" value="${v('pts','0')}" /></div>
          <div class="field-group"><label>Rebounds/Game</label>
            <input name="reb" type="number" step="0.1" class="input" placeholder="0.0" value="${v('reb','0')}" /></div>
          <div class="field-group"><label>Assists/Game</label>
            <input name="ast" type="number" step="0.1" class="input" placeholder="0.0" value="${v('ast','0')}" /></div>
          <div class="field-group"><label>Steals/Game</label>
            <input name="stl" type="number" step="0.1" class="input" placeholder="0.0" value="${v('stl','0')}" /></div>
          <div class="field-group"><label>Blocks/Game</label>
            <input name="blk" type="number" step="0.1" class="input" placeholder="0.0" value="${v('blk','0')}" /></div>
          <div class="field-group"><label>FG%</label>
            <input name="fg"  type="number" step="0.1" class="input" placeholder="0.0" value="${v('fg','0')}" /></div>
        </div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <a href="/admin/league/${league.id}" class="btn-ghost">Cancel</a>
          <button type="submit" class="btn-primary">${player?'Save Changes':'Add Player'} →</button>
        </div>
      </form>
    </div>`;
}

function adminPage(title, user, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; script-src-elem 'self' 'unsafe-inline'; script-src-attr 'self' 'unsafe-inline' 'unsafe-hashes'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:;">
<title>${title} | PH Hoops Admin</title>
<link rel="stylesheet" href="/css/main.css">
</head>
<body class="dark-bg">
<nav class="topnav">
  <div class="nav-brand"><a href="/" style="color:inherit;text-decoration:none">🏀 <span class="brand-text">PH HOOPS</span></a></div>
  <div class="nav-center" style="font-size:11px;color:#555;letter-spacing:2px;font-weight:700">ADMIN</div>
  <div class="nav-actions">
    <span style="font-size:13px;color:#888">${esc(user.name)}</span>
    <a href="/logout" class="btn-ghost-sm">Logout</a>
  </div>
</nav>
<div class="admin-wrap">${content}</div>
<script src="/js/admin.js"></script>
</body>
</html>`;
}

module.exports = router;
