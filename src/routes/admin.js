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
          <a href="/admin/league/${l.id}/edit" class="btn-ghost-sm">✏ Edit</a>
          <a href="/league/${l.id}" class="btn-ghost-sm" target="_blank">🌐 View</a>
          <a href="/admin/league/${l.id}/delete" class="btn-danger-sm" data-confirm="Delete this league and ALL its data?">🗑</a>
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
                <a href="/admin/league/${league.id}/edit-game/${g.id}" class="btn-ghost-sm">✏ Edit</a>
                <a href="/admin/league/${league.id}/game-stats/${g.id}" class="btn-ghost-sm" title="Enter/Edit Player Stats">📋 Stats</a>
                ${g.status!=='final'?`<a href="/admin/league/${league.id}/score/${g.id}" class="btn-teal-sm">🔴 Live</a>`:''}
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
      SELECT g.*,ht.name as home_name,at.name as away_name,
             ht.id as htid, at.id as atid, ht.color as home_color, at.color as away_color
      FROM games g
      LEFT JOIN teams ht ON g.home_team_id=ht.id
      LEFT JOIN teams at ON g.away_team_id=at.id
      WHERE g.id=$1`, [req.params.gid]);
    if (!league || !game || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');

    const homePlayers = game.htid ? await db.query(
      'SELECT * FROM players WHERE team_id=$1 ORDER BY pos,name', [game.htid]) : [];
    const awayPlayers = game.atid ? await db.query(
      'SELECT * FROM players WHERE team_id=$1 ORDER BY pos,name', [game.atid]) : [];

    const existingStats = await db.query('SELECT * FROM game_stats WHERE game_id=$1', [game.id]);
    const statMap = {};
    existingStats.forEach(s => { statMap[s.player_id] = s; });

    const allPlayers = [...homePlayers, ...awayPlayers];
    const allPlayerIds = allPlayers.map(p => p.id).join(',');

    const homeColor = game.home_color || '#e63946';
    const awayColor = game.away_color || '#457b9d';

    // Build player list sidebar
    const playerListHTML = `
      <div class="lsc-section-label" style="color:${homeColor}">${esc(game.home_name||'Home')}</div>
      ${homePlayers.map(p => {
        const s = statMap[p.id] || {};
        return `<div class="lsc-player" data-pid="${p.id}" data-name="${esc(p.name)}" data-pos="${p.pos}" data-jersey="${p.jersey||''}" data-team="${esc(game.home_name||'Home')}" data-color="${homeColor}"
          data-fg2m="${s.fg2m||0}" data-fg2a="${s.fg2a||0}" data-fg3m="${s.fg3m||0}" data-fg3a="${s.fg3a||0}" data-ftm="${s.ftm||0}" data-fta="${s.fta||0}" data-oreb="${s.oreb||0}" data-dreb="${s.dreb||0}" data-ast="${s.ast||0}" data-stl="${s.stl||0}" data-blk="${s.blk||0}" data-to="${s.to_val||0}" data-foul="${s.foul||0}">
          <span class="lsc-player-pos">${p.pos}</span>
          <span class="lsc-player-name">${esc(p.name)}</span>
          <span class="lsc-player-pts">${s.pts||0}</span>
        </div>`;
      }).join('')}
      <div class="lsc-section-label" style="color:${awayColor};margin-top:12px">${esc(game.away_name||'Away')}</div>
      ${awayPlayers.map(p => {
        const s = statMap[p.id] || {};
        return `<div class="lsc-player" data-pid="${p.id}" data-name="${esc(p.name)}" data-pos="${p.pos}" data-jersey="${p.jersey||''}" data-team="${esc(game.away_name||'Away')}" data-color="${awayColor}"
          data-fg2m="${s.fg2m||0}" data-fg2a="${s.fg2a||0}" data-fg3m="${s.fg3m||0}" data-fg3a="${s.fg3a||0}" data-ftm="${s.ftm||0}" data-fta="${s.fta||0}" data-oreb="${s.oreb||0}" data-dreb="${s.dreb||0}" data-ast="${s.ast||0}" data-stl="${s.stl||0}" data-blk="${s.blk||0}" data-to="${s.to_val||0}" data-foul="${s.foul||0}">
          <span class="lsc-player-pos">${p.pos}</span>
          <span class="lsc-player-name">${esc(p.name)}</span>
          <span class="lsc-player-pts">${s.pts||0}</span>
        </div>`;
      }).join('')}
    `;

    res.send(adminPage('Live Score', req.user, `
      <style>
        .lsc-wrap { display:grid; grid-template-columns:280px 1fr; gap:16px; max-width:1100px; }
        .lsc-scoreboard { background:linear-gradient(135deg,#1a2a6c,#2a4db5); border-radius:14px; padding:24px 28px; margin-bottom:16px; position:relative; }
        .lsc-live-badge { background:#ff4757; color:#fff; font-size:11px; font-weight:800; padding:3px 10px; border-radius:20px; letter-spacing:1px; display:inline-flex; align-items:center; gap:5px; margin-bottom:16px; }
        .lsc-live-dot { width:7px; height:7px; border-radius:50%; background:#fff; animation:pulse 1s infinite; }
        .lsc-teams { display:flex; align-items:center; justify-content:space-between; }
        .lsc-team { text-align:center; flex:1; }
        .lsc-team-logo { width:52px; height:52px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:16px; font-weight:800; color:#fff; margin:0 auto 8px; }
        .lsc-team-name { font-size:16px; font-weight:700; color:#fff; margin-bottom:6px; }
        .lsc-score { font-size:72px; font-weight:900; color:#fff; line-height:1; }
        .lsc-vs { color:rgba(255,255,255,.4); font-size:18px; font-weight:700; flex-shrink:0; padding:0 20px; }
        .lsc-qtr { position:absolute; top:24px; right:28px; text-align:right; }
        .lsc-qtr-label { font-size:11px; color:rgba(255,255,255,.5); letter-spacing:1px; font-weight:700; }
        .lsc-qtr-val { font-size:22px; font-weight:800; color:#f7c948; }
        .lsc-end-btn { background:rgba(255,255,255,.15); color:#fff; border:1px solid rgba(255,255,255,.25); padding:8px 18px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; margin-top:16px; }
        .lsc-sidebar { background:#0f1a2e; border-radius:12px; padding:16px; overflow-y:auto; max-height:calc(100vh - 180px); }
        .lsc-section-label { font-size:10px; font-weight:800; letter-spacing:2px; text-transform:uppercase; margin-bottom:8px; padding:4px 8px; border-radius:4px; background:rgba(255,255,255,.06); }
        .lsc-player { display:flex; align-items:center; gap:8px; padding:10px 12px; border-radius:8px; cursor:pointer; border:1px solid transparent; margin-bottom:4px; transition:all .15s; }
        .lsc-player:hover { background:rgba(255,255,255,.06); }
        .lsc-player.active { background:rgba(255,107,53,.12); border-color:#ff6b35; }
        .lsc-player-pos { font-size:10px; font-weight:700; background:rgba(255,255,255,.1); color:#aaa; padding:2px 5px; border-radius:3px; flex-shrink:0; }
        .lsc-player-name { flex:1; font-size:13px; font-weight:600; color:#ddd; }
        .lsc-player-pts { font-size:13px; font-weight:800; color:#ff6b35; min-width:24px; text-align:right; }
        .lsc-panel { background:#0f1a2e; border-radius:12px; padding:20px; }
        .lsc-panel-header { margin-bottom:16px; }
        .lsc-panel-name { font-size:20px; font-weight:800; color:#fff; }
        .lsc-panel-sub { font-size:13px; color:#666; margin-top:2px; }
        .lsc-panel-pts { font-size:32px; font-weight:900; color:#ff6b35; text-align:right; line-height:1; }
        .lsc-panel-pts-label { font-size:10px; color:#666; font-weight:700; letter-spacing:1px; text-align:right; }
        .lsc-shot-grid { display:grid; grid-template-columns:1fr auto 1fr auto 1fr; gap:8px; align-items:center; margin-bottom:16px; }
        .lsc-shot-btn { padding:12px 8px; border-radius:8px; border:none; font-weight:800; font-size:14px; cursor:pointer; transition:all .15s; width:100%; }
        .lsc-shot-btn.make { background:#e63946; color:#fff; }
        .lsc-shot-btn.make:hover { background:#c1121f; transform:scale(1.03); }
        .lsc-shot-btn.miss { background:rgba(255,255,255,.08); color:#aaa; border:1px solid rgba(255,255,255,.12); }
        .lsc-shot-btn.miss:hover { background:rgba(255,255,255,.13); color:#fff; }
        .lsc-minus { background:none; border:none; color:#ff4444; font-size:18px; font-weight:700; cursor:pointer; padding:0 4px; }
        .lsc-stat-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:4px; }
        .lsc-stat-box { background:rgba(255,255,255,.04); border:1px solid rgba(255,255,255,.08); border-radius:8px; padding:12px; }
        .lsc-stat-label { font-size:10px; font-weight:700; color:#666; letter-spacing:1px; margin-bottom:6px; }
        .lsc-stat-val { font-size:22px; font-weight:800; color:#fff; text-align:center; margin-bottom:8px; }
        .lsc-stat-btns { display:flex; justify-content:space-between; }
        .lsc-stat-btn { background:none; border:none; font-size:18px; font-weight:700; cursor:pointer; padding:0 8px; transition:color .15s; }
        .lsc-stat-btn.minus { color:#ff4444; }
        .lsc-stat-btn.plus  { color:#00d4aa; }
        .lsc-stat-btn:hover { opacity:.7; }
        .lsc-save-bar { display:flex; gap:10px; margin-top:16px; }
        .lsc-empty { color:#444; text-align:center; padding:40px; font-size:14px; }
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:.3} }
        @media(max-width:700px){ .lsc-wrap{grid-template-columns:1fr;} .lsc-sidebar{max-height:200px;} }
      </style>

      <a href="/admin/league/${league.id}" class="back-link" style="display:inline-block;margin-bottom:16px">← Back to League</a>

      <!-- SCOREBOARD -->
      <div class="lsc-scoreboard">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span class="lsc-live-badge"><span class="lsc-live-dot"></span> LIVE</span>
          <span style="color:rgba(255,255,255,.5);font-size:13px">${esc(game.date||'')}</span>
        </div>
        <div class="lsc-teams">
          <div class="lsc-team">
            <div class="lsc-team-logo" style="background:${homeColor}" id="sb-home-logo">${esc((game.home_name||'H').substring(0,3).toUpperCase())}</div>
            <div class="lsc-team-name">${esc(game.home_name||'Home')}</div>
            <div class="lsc-score" id="sb-home-score">${game.home_score||0}</div>
          </div>
          <div class="lsc-vs">VS</div>
          <div class="lsc-team">
            <div class="lsc-team-logo" style="background:${awayColor}" id="sb-away-logo">${esc((game.away_name||'A').substring(0,3).toUpperCase())}</div>
            <div class="lsc-team-name">${esc(game.away_name||'Away')}</div>
            <div class="lsc-score" id="sb-away-score">${game.away_score||0}</div>
          </div>
        </div>
        <div class="lsc-qtr">
          <div class="lsc-qtr-label">QUARTER</div>
          <div class="lsc-qtr-val" id="sb-qtr">${game.quarter||1}</div>
          <div style="display:flex;gap:4px;margin-top:4px">
            <button class="lsc-end-btn" style="padding:4px 10px;font-size:12px" id="qtrMinus">−</button>
            <button class="lsc-end-btn" style="padding:4px 10px;font-size:12px" id="qtrPlus">+</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:16px;align-items:center">
          <button class="lsc-end-btn" id="saveProgressBtn">💾 Save Progress</button>
          <button class="lsc-end-btn" id="endGameBtn" style="background:rgba(255,71,87,.25);border-color:rgba(255,71,87,.4)">⏹ End Game</button>
        </div>
      </div>

      <!-- MAIN LAYOUT -->
      <div class="lsc-wrap">
        <!-- PLAYER LIST -->
        <div class="lsc-sidebar">
          <div style="font-size:11px;color:#555;font-weight:700;letter-spacing:2px;margin-bottom:12px">SELECT PLAYER</div>
          ${allPlayers.length > 0 ? playerListHTML : '<div class="lsc-empty">No players added yet.<br><a href="/admin/league/${league.id}/add-player" style="color:#ff6b35">Add players first →</a></div>'}
        </div>

        <!-- STAT PANEL -->
        <div class="lsc-panel" id="statPanel">
          <div class="lsc-empty" id="noPlayerMsg">
            👆 Select a player from the left to record stats
          </div>
          <div id="playerPanel" style="display:none">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
              <div class="lsc-panel-header">
                <div class="lsc-panel-name" id="pp-name">—</div>
                <div class="lsc-panel-sub" id="pp-sub">—</div>
              </div>
              <div>
                <div class="lsc-panel-pts" id="pp-pts">0</div>
                <div class="lsc-panel-pts-label">POINTS</div>
              </div>
            </div>

            <!-- FIBA SHOT BUTTONS -->
            <div style="font-size:10px;color:#555;font-weight:700;letter-spacing:1.5px;margin-bottom:10px;text-align:center">RECORDING: <span id="pp-recording"></span></div>
            <div style="display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:6px;align-items:center;justify-items:center;margin-bottom:6px">
              <button class="lsc-shot-btn make" id="btn-2pt">+2 PT</button>
              <button class="lsc-minus" id="btn-2pt-minus">−</button>
              <button class="lsc-shot-btn miss" id="btn-miss2">Miss 2</button>
              <button class="lsc-minus" id="btn-miss2-minus">−</button>
              <button class="lsc-shot-btn make" id="btn-3pt">+3 PT</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:6px;align-items:center;justify-items:center;margin-bottom:16px">
              <button class="lsc-minus" id="btn-3pt-minus">−</button>
              <div></div>
              <button class="lsc-shot-btn miss" id="btn-miss3">Miss 3</button>
              <button class="lsc-minus" id="btn-miss3-minus">−</button>
              <div></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr auto 1fr auto 1fr;gap:6px;align-items:center;justify-items:center;margin-bottom:16px">
              <button class="lsc-shot-btn make" id="btn-ft">+1 FT</button>
              <button class="lsc-minus" id="btn-ft-minus">−</button>
              <button class="lsc-shot-btn miss" id="btn-missft">Miss FT</button>
              <button class="lsc-minus" id="btn-missft-minus">−</button>
              <div></div>
            </div>

            <!-- FIBA SHOOTING LINE -->
            <div style="background:rgba(255,255,255,.04);border-radius:6px;padding:8px 12px;font-size:12px;color:#888;margin-bottom:12px;font-weight:600;letter-spacing:.5px;text-align:center" id="pp-fg-line">0/0 2PT &nbsp; 0/0 3PT &nbsp; 0/0 FT</div>

            <!-- FIBA STAT COUNTERS -->
            <div class="lsc-stat-grid">
              ${[
                {k:'oreb',label:'OREB',desc:'Off. Reb'},
                {k:'dreb',label:'DREB',desc:'Def. Reb'},
                {k:'ast', label:'AST', desc:'Assists'},
                {k:'stl', label:'STL', desc:'Steals'},
                {k:'blk', label:'BLK', desc:'Blocks'},
                {k:'to',  label:'TO',  desc:'Turnovers'},
                {k:'foul',label:'FOUL',desc:'Pers. Fouls'},
              ].map(s => `
              <div class="lsc-stat-box">
                <div class="lsc-stat-label">${s.label}</div>
                <div class="lsc-stat-val" id="pp-${s.k}">0</div>
                <div class="lsc-stat-btns">
                  <button class="lsc-stat-btn minus" data-stat="${s.k}" data-dir="-1">−</button>
                  <button class="lsc-stat-btn plus"  data-stat="${s.k}" data-dir="1">+</button>
                </div>
              </div>`).join('')}
            </div>

            <!-- FIBA EFF + PERCENTAGES -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px">
              <div style="background:rgba(255,107,53,.08);border:1px solid rgba(255,107,53,.2);border-radius:8px;padding:10px;text-align:center">
                <div style="font-size:10px;color:#ff6b35;font-weight:700;letter-spacing:1px">EFF</div>
                <div style="font-size:22px;font-weight:800;color:#ff6b35" id="pp-eff">0</div>
              </div>
              <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:10px;text-align:center">
                <div style="font-size:10px;color:#666;font-weight:700;letter-spacing:1px">FG%</div>
                <div style="font-size:18px;font-weight:800;color:#fff" id="pp-fgp">—</div>
              </div>
              <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:10px;text-align:center">
                <div style="font-size:10px;color:#666;font-weight:700;letter-spacing:1px">3P%</div>
                <div style="font-size:18px;font-weight:800;color:#fff" id="pp-fg3p">—</div>
              </div>
              <div style="background:rgba(255,255,255,.04);border-radius:8px;padding:10px;text-align:center">
                <div style="font-size:10px;color:#666;font-weight:700;letter-spacing:1px">FT%</div>
                <div style="font-size:18px;font-weight:800;color:#fff" id="pp-ftp">—</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- HIDDEN FORM for submission -->
      <form id="scoreForm" action="/admin/league/${league.id}/score/${game.id}" method="POST" style="display:none">
        <input type="hidden" name="player_ids"  id="f-player-ids"  value="${allPlayerIds}" />
        <input type="hidden" name="home_score"  id="f-home-score"  value="${game.home_score||0}" />
        <input type="hidden" name="away_score"  id="f-away-score"  value="${game.away_score||0}" />
        <input type="hidden" name="quarter"     id="f-quarter"     value="${game.quarter||1}" />
        <input type="hidden" name="status"      id="f-status"      value="${game.status||'ongoing'}" />
        <input type="hidden" name="save_type"   id="f-save-type"   value="save" />
        <!-- Player stat hidden fields populated by JS -->
        <div id="f-player-fields"></div>
      </form>

      <script src="/js/livescore.js"></script>
      <script>
        // Pass server data to JS
        window.LSC_DATA = {
          homeTeam: "${esc(game.home_name||'Home')}",
          awayTeam: "${esc(game.away_name||'Away')}",
          stats: ${JSON.stringify(statMap)}
        };
      </script>
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});


router.post('/league/:id/score/:gid', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const { home_score, away_score, status, save_type, player_ids } = req.body;
    const game = await db.queryOne('SELECT * FROM games WHERE id=$1', [req.params.gid]);
    const { computeGameStats, computeSeasonAverages } = require('../fiba-stats');

    const isFinal  = save_type === 'final' || status === 'final';
    const newStatus = isFinal ? 'final' : (status || 'ongoing');

    // Update game score
    await db.run(
      'UPDATE games SET home_score=$1,away_score=$2,status=$3,quarter=$4 WHERE id=$5',
      [home_score||0, away_score||0, newStatus, req.body.quarter||1, req.params.gid]
    );

    // Save FIBA player stats per game
    if (player_ids) {
      const ids2 = player_ids.split(',').filter(Boolean);
      for (const pid of ids2) {
        const g = {
          fg2m:  parseInt(req.body['fg2m_'+pid])  || 0,
          fg2a:  parseInt(req.body['fg2a_'+pid])  || 0,
          fg3m:  parseInt(req.body['fg3m_'+pid])  || 0,
          fg3a:  parseInt(req.body['fg3a_'+pid])  || 0,
          ftm:   parseInt(req.body['ftm_'+pid])   || 0,
          fta:   parseInt(req.body['fta_'+pid])   || 0,
          oreb:  parseInt(req.body['oreb_'+pid])  || 0,
          dreb:  parseInt(req.body['dreb_'+pid])  || 0,
          ast:   parseInt(req.body['ast_'+pid])   || 0,
          stl:   parseInt(req.body['stl_'+pid])   || 0,
          blk:   parseInt(req.body['blk_'+pid])   || 0,
          to_val:parseInt(req.body['to_'+pid])    || 0,
          foul:  parseInt(req.body['foul_'+pid])  || 0,
        };

        // Upsert game stats (FIBA columns)
        await db.run(`
          INSERT INTO game_stats
            (game_id,player_id,league_id,fg2m,fg2a,fg3m,fg3a,ftm,fta,oreb,dreb,ast,stl,blk,to_val,foul)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT (game_id,player_id)
          DO UPDATE SET
            fg2m=$4,fg2a=$5,fg3m=$6,fg3a=$7,ftm=$8,fta=$9,
            oreb=$10,dreb=$11,ast=$12,stl=$13,blk=$14,to_val=$15,foul=$16
        `, [req.params.gid, pid, req.params.id,
            g.fg2m,g.fg2a,g.fg3m,g.fg3a,g.ftm,g.fta,
            g.oreb,g.dreb,g.ast,g.stl,g.blk,g.to_val,g.foul]);
      }

      // Always recalculate FIBA season averages immediately
      for (const pid of ids2) {
        const allGames = await db.query(
          'SELECT * FROM game_stats WHERE player_id=$1 AND league_id=$2',
          [pid, req.params.id]
        );
        if (!allGames.length) continue;
        const season = computeSeasonAverages(allGames);
        const av = season.averages;
        const tot = season.totals;

        // Upsert player season stats
        await db.run(`
          INSERT INTO player_season_stats
            (player_id,league_id,gp,pts,fg2m,fg2a,fg3m,fg3a,ftm,fta,
             oreb,dreb,reb,ast,stl,blk,to_val,foul,fgp,fg2p,fg3p,ftp,eff)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
          ON CONFLICT (player_id,league_id)
          DO UPDATE SET
            gp=$3,pts=$4,fg2m=$5,fg2a=$6,fg3m=$7,fg3a=$8,ftm=$9,fta=$10,
            oreb=$11,dreb=$12,reb=$13,ast=$14,stl=$15,blk=$16,to_val=$17,
            foul=$18,fgp=$19,fg2p=$20,fg3p=$21,ftp=$22,eff=$23
        `, [pid, req.params.id, season.gp,
            av.pts, av.fg2m, av.fg2a, av.fg3m, av.fg3a, av.ftm, av.fta,
            av.oreb, av.dreb, av.reb, av.ast, av.stl, av.blk, av.to,
            av.foul, av.fgp, av.fg2p, av.fg3p, av.ftp, av.eff]);

        // Also update the main players table for backward compatibility
        await db.run(`
          UPDATE players SET
            gp=$1, pts=$2, reb=$3, ast=$4, stl=$5, blk=$6, fg=$7
          WHERE id=$8
        `, [season.gp, av.pts, av.reb, av.ast, av.stl, av.blk, av.fgp, pid]);
      }
    }

    // Update W/L when final
    if (isFinal && game) {
      const h = Number(home_score), a = Number(away_score);
      if (h > a) {
        if (game.home_team_id) await db.run('UPDATE teams SET wins=wins+1 WHERE id=$1',[game.home_team_id]);
        if (game.away_team_id) await db.run('UPDATE teams SET losses=losses+1 WHERE id=$1',[game.away_team_id]);
      } else if (a > h) {
        if (game.away_team_id) await db.run('UPDATE teams SET wins=wins+1 WHERE id=$1',[game.away_team_id]);
        if (game.home_team_id) await db.run('UPDATE teams SET losses=losses+1 WHERE id=$1',[game.home_team_id]);
      }
    }

    if (isFinal) {
      res.redirect('/admin/league/' + req.params.id);
    } else {
      res.redirect('/admin/league/' + req.params.id + '/score/' + req.params.gid);
    }
  } catch (err) {
    console.error('Score save error:', err);
    res.redirect('/admin/league/' + req.params.id);
  }
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

// ── EDIT LEAGUE ───────────────────────────────────────────────────────────────
router.get('/league/:id/edit', async (req, res) => {
  try {
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
    if (!league || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const err = req.query.error;
    res.send(adminPage('Edit League', req.user, `
      <div class="admin-header"><div>
        <a href="/admin" class="back-link">← Back to Dashboard</a>
        <h1>Edit League</h1>
      </div></div>
      ${err ? `<div class="alert-error" style="max-width:540px;margin-bottom:16px">⚠ League name and admin code are required.</div>` : ''}
      <div class="card" style="max-width:540px">
        <form action="/admin/league/${league.id}/edit" method="POST">
          <div class="field-group"><label>League Name</label>
            <input name="name" class="input" value="${esc(league.name)}" required /></div>
          <div class="field-group"><label>Level</label>
            <select name="level" class="input">
              ${LEVEL_OPTIONS.map(l => `<option value="${l}" ${l === league.level ? 'selected' : ''}>${l}</option>`).join('')}
            </select></div>
          <div class="field-group"><label>Location</label>
            <input name="location" class="input" value="${esc(league.location)}" /></div>
          <div class="field-group"><label>Season / Tournament Name</label>
            <input name="season" class="input" value="${esc(league.season)}" /></div>
          <div class="field-group"><label>Status</label>
            <select name="status" class="input">
              <option value="upcoming"  ${league.status === 'upcoming'  ? 'selected' : ''}>Upcoming</option>
              <option value="ongoing"   ${league.status === 'ongoing'   ? 'selected' : ''}>Ongoing</option>
              <option value="completed" ${league.status === 'completed' ? 'selected' : ''}>Completed</option>
            </select></div>
          <div class="field-group"><label>Admin Code</label>
            <input name="admin_code" class="input" value="${esc(league.admin_code)}" required /></div>
          <div class="field-group"><label>Visibility</label>
            <select name="is_public" class="input">
              <option value="1" ${league.is_public ? 'selected' : ''}>Public — anyone can view</option>
              <option value="0" ${!league.is_public ? 'selected' : ''}>Private — hidden from public</option>
            </select></div>
          <div style="display:flex;gap:10px;margin-top:20px">
            <a href="/admin" class="btn-ghost">Cancel</a>
            <button type="submit" class="btn-primary">Save Changes →</button>
          </div>
        </form>
      </div>
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

router.post('/league/:id/edit', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const { name, level, location, season, status, admin_code, is_public } = req.body;
    if (!name?.trim() || !admin_code?.trim()) {
      return res.redirect(`/admin/league/${req.params.id}/edit?error=missing`);
    }
    await db.run(
      'UPDATE leagues SET name=$1,level=$2,location=$3,season=$4,status=$5,admin_code=$6,is_public=$7 WHERE id=$8',
      [name.trim(), level, location||'', season||'', status||'upcoming', admin_code.trim(), is_public === '1', req.params.id]
    );
    res.redirect('/admin');
  } catch (err) { console.error(err); res.redirect('/admin'); }
});

// ── EDIT GAME ─────────────────────────────────────────────────────────────────
router.get('/league/:id/edit-game/:gid', async (req, res) => {
  try {
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
    const game   = await db.queryOne('SELECT * FROM games WHERE id=$1', [req.params.gid]);
    if (!league || !game || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const teams = await db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY name', [req.params.id]);
    const topts = `<option value="">Select team</option>` +
      teams.map(t => `<option value="${t.id}" ${game.home_team_id == t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
    const topts2 = `<option value="">Select team</option>` +
      teams.map(t => `<option value="${t.id}" ${game.away_team_id == t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('');

    res.send(adminPage('Edit Game', req.user, `
      <div class="admin-header"><div>
        <a href="/admin/league/${league.id}" class="back-link">← Back</a>
        <h1>Edit Game</h1>
      </div></div>
      <div class="card" style="max-width:540px">
        <form action="/admin/league/${league.id}/edit-game/${game.id}" method="POST">
          <div class="field-group"><label>Home Team</label>
            <select name="home_team_id" class="input">${topts}</select></div>
          <div class="field-group"><label>Away Team</label>
            <select name="away_team_id" class="input">${topts2}</select></div>
          <div class="field-group"><label>Date</label>
            <input name="date" class="input" value="${esc(game.date||'')}" placeholder="e.g. May 1, 2025" /></div>
          <div class="field-group"><label>Venue / Court</label>
            <input name="venue" class="input" value="${esc(game.venue||'')}" placeholder="e.g. Brgy. Court Name" /></div>
          <div class="field-group"><label>Status</label>
            <select name="status" class="input">
              <option value="upcoming" ${game.status==='upcoming'?'selected':''}>Upcoming</option>
              <option value="ongoing"  ${game.status==='ongoing' ?'selected':''}>Ongoing</option>
              <option value="final"    ${game.status==='final'   ?'selected':''}>Final</option>
            </select></div>
          <div class="field-group"><label>Home Score</label>
            <input name="home_score" type="number" class="input" value="${game.home_score||0}" /></div>
          <div class="field-group"><label>Away Score</label>
            <input name="away_score" type="number" class="input" value="${game.away_score||0}" /></div>
          <div style="display:flex;gap:10px;margin-top:20px">
            <a href="/admin/league/${league.id}" class="btn-ghost">Cancel</a>
            <button type="submit" class="btn-primary">Save Changes →</button>
          </div>
        </form>
      </div>
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

router.post('/league/:id/edit-game/:gid', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const { home_team_id, away_team_id, date, venue, status, home_score, away_score } = req.body;
    await db.run(
      'UPDATE games SET home_team_id=$1,away_team_id=$2,date=$3,venue=$4,status=$5,home_score=$6,away_score=$7 WHERE id=$8',
      [home_team_id||null, away_team_id||null, date||'TBD', venue||'TBD', status||'upcoming', home_score||0, away_score||0, req.params.gid]
    );
    res.redirect(`/admin/league/${req.params.id}`);
  } catch (err) { console.error(err); res.redirect(`/admin/league/${req.params.id}`); }
});

// ── POST-GAME STATS ENTRY ─────────────────────────────────────────────────────
router.get('/league/:id/game-stats/:gid', async (req, res) => {
  try {
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
    const game   = await db.queryOne(`
      SELECT g.*,ht.name as home_name,at.name as away_name,
             ht.id as htid, at.id as atid, ht.color as home_color, at.color as away_color
      FROM games g
      LEFT JOIN teams ht ON g.home_team_id=ht.id
      LEFT JOIN teams at ON g.away_team_id=at.id
      WHERE g.id=$1`, [req.params.gid]);
    if (!league || !game || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');

    const homePlayers = game.htid ? await db.query(
      'SELECT * FROM players WHERE team_id=$1 ORDER BY pos,name', [game.htid]) : [];
    const awayPlayers = game.atid ? await db.query(
      'SELECT * FROM players WHERE team_id=$1 ORDER BY pos,name', [game.atid]) : [];

    // Get existing game stats
    const existingStats = await db.query('SELECT * FROM game_stats WHERE game_id=$1', [game.id]);
    const statMap = {};
    existingStats.forEach(s => { statMap[s.player_id] = s; });

    const allPlayers = [...homePlayers, ...awayPlayers];
    const allPlayerIds = allPlayers.map(p => p.id).join(',');
    const homeColor = game.home_color || '#e63946';
    const awayColor = game.away_color || '#457b9d';

    function statRow(p) {
      const s = statMap[p.id] || {};
      const val = (k, def=0) => s[k] != null ? s[k] : def;
      return `
        <tr style="border-bottom:1px solid rgba(255,255,255,.06)">
          <td style="padding:10px 12px;white-space:nowrap">
            <span class="pos-badge">${p.pos}</span>
            <span style="font-weight:600;margin-left:6px">#${p.jersey} ${esc(p.name)}</span>
          </td>
          ${['fg2m','fg2a','fg3m','fg3a','ftm','fta','oreb','dreb','ast','stl','blk','to_val','foul'].map(k => `
          <td style="padding:6px 4px;text-align:center">
            <input type="number" name="${k}_${p.id}" value="${val(k)}" min="0"
              style="width:52px;text-align:center;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;color:#fff;font-size:13px;font-weight:700;padding:5px 2px;outline:none" />
          </td>`).join('')}
        </tr>`;
    }

    const hasStats = existingStats.length > 0;

    res.send(adminPage(`Game Stats — ${esc(game.home_name||'Home')} vs ${esc(game.away_name||'Away')}`, req.user, `
      <div class="admin-header">
        <div>
          <a href="/admin/league/${league.id}" class="back-link">← Back to League</a>
          <h1>📋 ${hasStats ? 'Edit' : 'Enter'} Post-Game Stats</h1>
          <p style="color:#666;font-size:13px;margin-top:4px">
            ${esc(game.home_name||'Home')} vs ${esc(game.away_name||'Away')} &nbsp;·&nbsp;
            ${esc(game.date||'TBD')} &nbsp;·&nbsp; ${esc(game.venue||'')}
          </p>
        </div>
      </div>

      <!-- SCORELINE -->
      <div style="background:linear-gradient(135deg,#1a2a6c,#2a4db5);border-radius:12px;padding:20px 28px;margin-bottom:24px;display:flex;align-items:center;justify-content:center;gap:32px">
        <div style="text-align:center">
          <div style="font-size:13px;color:rgba(255,255,255,.6);margin-bottom:4px">${esc(game.home_name||'Home')}</div>
          <div style="font-size:48px;font-weight:900;color:#00d4aa">${game.home_score||0}</div>
        </div>
        <div style="color:rgba(255,255,255,.3);font-size:20px;font-weight:700">FINAL</div>
        <div style="text-align:center">
          <div style="font-size:13px;color:rgba(255,255,255,.6);margin-bottom:4px">${esc(game.away_name||'Away')}</div>
          <div style="font-size:48px;font-weight:900;color:#ff6b35">${game.away_score||0}</div>
        </div>
      </div>

      ${hasStats ? '<div class="alert-info" style="margin-bottom:16px">📋 Stats already recorded for this game. Update them below and save.</div>' : ''}

      ${allPlayers.length === 0 ? `
        <div class="empty-state">
          <div class="es-icon">👤</div>
          <div>No players added to these teams yet.</div>
          <a href="/admin/league/${league.id}/add-player" class="btn-primary" style="margin-top:12px">Add Players →</a>
        </div>` : `

      <form action="/admin/league/${league.id}/game-stats/${game.id}" method="POST">
        <input type="hidden" name="player_ids" value="${allPlayerIds}" />

        <!-- HOME TEAM -->
        ${homePlayers.length > 0 ? `
        <div class="card" style="margin-bottom:20px;overflow-x:auto">
          <div style="font-size:15px;font-weight:800;color:${homeColor};margin-bottom:16px;display:flex;align-items:center;gap:8px">
            <div style="width:4px;height:20px;background:${homeColor};border-radius:2px"></div>
            ${esc(game.home_name||'Home Team')}
            <span style="font-size:11px;color:#555;font-weight:600;margin-left:4px">— Player Stats</span>
          </div>
          <table style="width:100%;border-collapse:collapse;min-width:700px">
            <thead>
              <tr style="border-bottom:1px solid rgba(255,107,53,.25)">
                <th style="padding:8px 12px;text-align:left;font-size:10px;color:#ff6b35;letter-spacing:1px;font-weight:700">PLAYER</th>
                ${['2PM','2PA','3PM','3PA','FTM','FTA','OREB','DREB','AST','STL','BLK','TO','FOUL'].map(h=>`
                <th style="padding:8px 4px;text-align:center;font-size:10px;color:#ff6b35;letter-spacing:1px;font-weight:700;min-width:52px">${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody>${homePlayers.map(p => statRow(p)).join('')}</tbody>
          </table>
        </div>` : ''}

        <!-- AWAY TEAM -->
        ${awayPlayers.length > 0 ? `
        <div class="card" style="margin-bottom:20px;overflow-x:auto">
          <div style="font-size:15px;font-weight:800;color:${awayColor};margin-bottom:16px;display:flex;align-items:center;gap:8px">
            <div style="width:4px;height:20px;background:${awayColor};border-radius:2px"></div>
            ${esc(game.away_name||'Away Team')}
            <span style="font-size:11px;color:#555;font-weight:600;margin-left:4px">— Player Stats</span>
          </div>
          <table style="width:100%;border-collapse:collapse;min-width:700px">
            <thead>
              <tr style="border-bottom:1px solid rgba(0,212,170,.25)">
                <th style="padding:8px 12px;text-align:left;font-size:10px;color:#00d4aa;letter-spacing:1px;font-weight:700">PLAYER</th>
                ${['2PM','2PA','3PM','3PA','FTM','FTA','OREB','DREB','AST','STL','BLK','TO','FOUL'].map(h=>`
                <th style="padding:8px 4px;text-align:center;font-size:10px;color:#00d4aa;letter-spacing:1px;font-weight:700;min-width:52px">${h}</th>`).join('')}
              </tr>
            </thead>
            <tbody>${awayPlayers.map(p => statRow(p)).join('')}</tbody>
          </table>
        </div>` : ''}

        <!-- FIBA LEGEND -->
        <div style="background:rgba(255,255,255,.03);border-radius:8px;padding:14px 18px;margin-bottom:20px;font-size:11px;color:#555;line-height:2">
          <b style="color:#888">FIBA STAT GUIDE:</b>
          2PM/2PA = 2-point made/attempted &nbsp;·&nbsp;
          3PM/3PA = 3-point made/attempted &nbsp;·&nbsp;
          FTM/FTA = Free throw made/attempted &nbsp;·&nbsp;
          OREB = Offensive rebound &nbsp;·&nbsp;
          DREB = Defensive rebound &nbsp;·&nbsp;
          AST = Assists &nbsp;·&nbsp;
          STL = Steals &nbsp;·&nbsp;
          BLK = Blocks &nbsp;·&nbsp;
          TO = Turnovers &nbsp;·&nbsp;
          FOUL = Personal fouls
        </div>

        <div style="display:flex;gap:10px;align-items:center">
          <a href="/admin/league/${league.id}" class="btn-ghost">Cancel</a>
          <button type="submit" class="btn-primary">
            ✅ Save Stats &amp; Update Season Averages
          </button>
        </div>
      </form>`}
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

router.post('/league/:id/game-stats/:gid', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const { player_ids } = req.body;
    const { computeSeasonAverages } = require('../fiba-stats');

    if (player_ids) {
      const ids = player_ids.split(',').filter(Boolean);

      for (const pid of ids) {
        const g = {
          fg2m:  parseInt(req.body['fg2m_'+pid])  || 0,
          fg2a:  parseInt(req.body['fg2a_'+pid])  || 0,
          fg3m:  parseInt(req.body['fg3m_'+pid])  || 0,
          fg3a:  parseInt(req.body['fg3a_'+pid])  || 0,
          ftm:   parseInt(req.body['ftm_'+pid])   || 0,
          fta:   parseInt(req.body['fta_'+pid])   || 0,
          oreb:  parseInt(req.body['oreb_'+pid])  || 0,
          dreb:  parseInt(req.body['dreb_'+pid])  || 0,
          ast:   parseInt(req.body['ast_'+pid])   || 0,
          stl:   parseInt(req.body['stl_'+pid])   || 0,
          blk:   parseInt(req.body['blk_'+pid])   || 0,
          to_val:parseInt(req.body['to_val_'+pid])|| 0,
          foul:  parseInt(req.body['foul_'+pid])  || 0,
        };

        // Skip players with all zero stats
        const hasStats = Object.values(g).some(v => v > 0);
        if (!hasStats) continue;

        // Upsert game stats
        await db.run(`
          INSERT INTO game_stats
            (game_id,player_id,league_id,fg2m,fg2a,fg3m,fg3a,ftm,fta,oreb,dreb,ast,stl,blk,to_val,foul)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT (game_id,player_id)
          DO UPDATE SET
            fg2m=$4,fg2a=$5,fg3m=$6,fg3a=$7,ftm=$8,fta=$9,
            oreb=$10,dreb=$11,ast=$12,stl=$13,blk=$14,to_val=$15,foul=$16
        `, [req.params.gid, pid, req.params.id,
            g.fg2m,g.fg2a,g.fg3m,g.fg3a,g.ftm,g.fta,
            g.oreb,g.dreb,g.ast,g.stl,g.blk,g.to_val,g.foul]);
      }

      // Recalculate FIBA season averages for all players
      for (const pid of ids) {
        const allGames = await db.query(
          'SELECT * FROM game_stats WHERE player_id=$1 AND league_id=$2',
          [pid, req.params.id]
        );
        if (!allGames.length) continue;

        const season = computeSeasonAverages(allGames);
        const av = season.averages;

        // Upsert season stats
        await db.run(`
          INSERT INTO player_season_stats
            (player_id,league_id,gp,pts,fg2m,fg2a,fg3m,fg3a,ftm,fta,
             oreb,dreb,reb,ast,stl,blk,to_val,foul,fgp,fg2p,fg3p,ftp,eff)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
          ON CONFLICT (player_id,league_id)
          DO UPDATE SET
            gp=$3,pts=$4,fg2m=$5,fg2a=$6,fg3m=$7,fg3a=$8,ftm=$9,fta=$10,
            oreb=$11,dreb=$12,reb=$13,ast=$14,stl=$15,blk=$16,to_val=$17,
            foul=$18,fgp=$19,fg2p=$20,fg3p=$21,ftp=$22,eff=$23
        `, [pid, req.params.id, season.gp,
            av.pts, av.fg2m, av.fg2a, av.fg3m, av.fg3a, av.ftm, av.fta,
            av.oreb, av.dreb, av.reb, av.ast, av.stl, av.blk, av.to,
            av.foul, av.fgp, av.fg2p, av.fg3p, av.ftp, av.eff]);

        // Update main players table for public view
        await db.run(`
          UPDATE players SET gp=$1,pts=$2,reb=$3,ast=$4,stl=$5,blk=$6,fg=$7
          WHERE id=$8
        `, [season.gp, av.pts, av.reb, av.ast, av.stl, av.blk, av.fgp, pid]);
      }
    }

    res.redirect(`/admin/league/${req.params.id}?tab=games&saved=1`);
  } catch (err) {
    console.error('Post-game stats error:', err);
    res.redirect(`/admin/league/${req.params.id}`);
  }
});
