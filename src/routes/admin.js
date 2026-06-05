const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { esc, levelBadge, statusBadge, levelColor } = require('../helpers');
const multer      = require('multer');
const { importGameStats, generateTemplate } = require('../import-stats');

// Spreadsheet upload (memory storage — no disk write needed)
const uploadSheet = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xlsx, .xls or .csv files allowed'), ok);
  },
}).single('statsFile');

router.use(requireAuth);

const LEVEL_OPTIONS = ['Barangay','City/Municipal','Provincial','Regional'];
const TEAM_COLORS   = ['#e63946','#c1121f','#f4a261','#e9c46a','#f7c948','#8ac926','#2a9d8f','#00d4aa','#457b9d','#1982c4','#264653','#023e8a','#6a4c93','#a78bfa','#e76f51','#ff6b35','#ff4757','#ffffff','#cccccc','#111111'];
const COLOR_NAMES   = {
  '#e63946': 'Red',
  '#c1121f': 'Dark Red',
  '#f4a261': 'Peach',
  '#e9c46a': 'Sand',
  '#f7c948': 'Yellow',
  '#8ac926': 'Lime Green',
  '#2a9d8f': 'Teal',
  '#00d4aa': 'Mint',
  '#457b9d': 'Steel Blue',
  '#1982c4': 'Blue',
  '#264653': 'Dark Teal',
  '#023e8a': 'Navy',
  '#6a4c93': 'Dark Purple',
  '#a78bfa': 'Lavender',
  '#e76f51': 'Burnt Orange',
  '#ff6b35': 'Orange',
  '#ff4757': 'Hot Red',
  '#ffffff': 'White',
  '#cccccc': 'Light Gray',
  '#111111': 'Black',
};
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
        <div class="stat-card" style="--c:#f97316"><div class="stat-val">${leagues.length}</div><div class="stat-lbl">My Leagues</div></div>
        <div class="stat-card" style="--c:#00d4aa"><div class="stat-val">${totals.teams}</div><div class="stat-lbl">Teams</div></div>
        <div class="stat-card" style="--c:#a78bfa"><div class="stat-val">${totals.players}</div><div class="stat-lbl">Players</div></div>
        <div class="stat-card" style="--c:#f7c948"><div class="stat-val">${totals.games}</div><div class="stat-lbl">Games Played</div></div>
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

    const [teams, players, games, seasonStats] = await Promise.all([
      db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC, losses ASC', [lid]),
      db.query(`SELECT p.*,t.name as team_name FROM players p
                LEFT JOIN teams t ON p.team_id=t.id
                WHERE p.league_id=$1 ORDER BY p.pts DESC`, [lid]),
      db.query(`SELECT g.*,ht.name as home_name,at.name as away_name FROM games g
                LEFT JOIN teams ht ON g.home_team_id=ht.id
                LEFT JOIN teams at ON g.away_team_id=at.id
                WHERE g.league_id=$1 ORDER BY g.id DESC`, [lid]),
      db.query(`SELECT pss.*,p.name,p.pos,t.name as team_name FROM player_season_stats pss
                LEFT JOIN players p ON pss.player_id=p.id
                LEFT JOIN teams t ON p.team_id=t.id
                WHERE pss.league_id=$1 AND pss.gp>0`, [lid]),
    ]);

    const topts = teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');
    const upcomingGames = games.filter(g=>g.status!=='final');
    const lastGame = games.find(g=>g.status==='final');

    // Build daily leaders from last final game
    async function getDailyLeaders(gameId) {
      if (!gameId) return [];
      return db.query(`SELECT gs.*,p.name,p.pos,t.name as team_name
                       FROM game_stats gs
                       LEFT JOIN players p ON gs.player_id=p.id
                       LEFT JOIN teams t ON p.team_id=t.id
                       WHERE gs.game_id=$1`, [gameId]);
    }
    const dailyStats = lastGame ? await getDailyLeaders(lastGame.id) : [];

    // Compute game totals for daily leaders
    function gameTotal(stats, field) {
      return [...stats].sort((a,b)=>(b[field]||0)-(a[field]||0)).slice(0,5);
    }
    function gamePts(s) { return (s.fg2m||0)*2+(s.fg3m||0)*3+(s.ftm||0); }
    const dailySorted = {
      pts:  [...dailyStats].sort((a,b)=>gamePts(b)-gamePts(a)).slice(0,5),
      reb:  gameTotal(dailyStats,'oreb').map((s,i,arr)=>({...s,reb:(s.oreb||0)+(s.dreb||0)})).sort((a,b)=>b.reb-a.reb).slice(0,5),
      ast:  gameTotal(dailyStats,'ast'),
      blk:  gameTotal(dailyStats,'blk'),
      stl:  gameTotal(dailyStats,'stl'),
      to:   gameTotal(dailyStats,'to_val'),
      fg3m: gameTotal(dailyStats,'fg3m'),
      ftm:  gameTotal(dailyStats,'ftm'),
    };

    // Season leaders
    const seasonSorted = {
      pts:  [...seasonStats].sort((a,b)=>b.pts-a.pts).slice(0,5),
      reb:  [...seasonStats].sort((a,b)=>b.reb-a.reb).slice(0,5),
      ast:  [...seasonStats].sort((a,b)=>b.ast-a.ast).slice(0,5),
      blk:  [...seasonStats].sort((a,b)=>b.blk-a.blk).slice(0,5),
      stl:  [...seasonStats].sort((a,b)=>b.stl-a.stl).slice(0,5),
      to:   [...seasonStats].sort((a,b)=>b.to_val-a.to_val).slice(0,5),
      fg3m: [...seasonStats].sort((a,b)=>b.fg3m-a.fg3m).slice(0,5),
      ftm:  [...seasonStats].sort((a,b)=>b.ftm-a.ftm).slice(0,5),
    };

    function leaderRows(arr, valFn) {
      if (!arr.length) return '<div style="font-size:12px;color:rgba(255,255,255,.25);padding:8px 0">No data yet</div>';
      return arr.map((p,i)=>`
        <div class="tp-row">
          <span class="tp-rank">${i+1}.</span>
          <span class="tp-name">${esc(p.name)}</span>
          <span class="tp-team">${esc(p.team_name||'')}</span>
          <span class="tp-val">${valFn(p)}</span>
        </div>`).join('');
    }

    function buildLeadersSection(sorted, isDailyMode) {
      const ptsVal  = isDailyMode ? (p=>gamePts(p))          : (p=>p.pts?.toFixed(1)||'0');
      const rebVal  = isDailyMode ? (p=>p.reb||0)             : (p=>p.reb?.toFixed(1)||'0');
      const astVal  = isDailyMode ? (p=>p.ast||0)             : (p=>p.ast?.toFixed(1)||'0');
      const blkVal  = isDailyMode ? (p=>p.blk||0)             : (p=>p.blk?.toFixed(1)||'0');
      const stlVal  = isDailyMode ? (p=>p.stl||0)             : (p=>p.stl?.toFixed(1)||'0');
      const toVal   = isDailyMode ? (p=>p.to_val||0)          : (p=>p.to_val?.toFixed(1)||'0');
      const fg3mVal = isDailyMode ? (p=>p.fg3m||0)            : (p=>p.fg3m?.toFixed(1)||'0');
      const ftmVal  = isDailyMode ? (p=>p.ftm||0)             : (p=>p.ftm?.toFixed(1)||'0');
      return `
        <div class="tp-grid">
          <div class="tp-col">
            <div class="tp-col-title">POINTS</div>
            ${leaderRows(sorted.pts, ptsVal)}
          </div>
          <div class="tp-col">
            <div class="tp-col-title">REBOUNDS</div>
            ${leaderRows(sorted.reb, rebVal)}
          </div>
          <div class="tp-col">
            <div class="tp-col-title">ASSISTS</div>
            ${leaderRows(sorted.ast, astVal)}
          </div>
          <div class="tp-col">
            <div class="tp-col-title">BLOCKS</div>
            ${leaderRows(sorted.blk, blkVal)}
          </div>
          <div class="tp-col">
            <div class="tp-col-title">STEALS</div>
            ${leaderRows(sorted.stl, stlVal)}
          </div>
          <div class="tp-col">
            <div class="tp-col-title">TURNOVERS</div>
            ${leaderRows(sorted.to, toVal)}
          </div>
          <div class="tp-col">
            <div class="tp-col-title">THREE POINTERS MADE</div>
            ${leaderRows(sorted.fg3m, fg3mVal)}
          </div>
          <div class="tp-col">
            <div class="tp-col-title">FREE THROWS MADE</div>
            ${leaderRows(sorted.ftm, ftmVal)}
          </div>
        </div>`;
    }

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
          <a href="/admin/league/${league.id}/recalc-standings" class="btn-ghost-sm" title="Fix standings if W/L counts seem wrong">🔄 Fix Standings</a>
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
        <!-- TOP PERFORMERS — Daily Leaders / Season Leaders -->
        <div class="tp-wrap">
          <!-- Tab switcher -->
          <div class="tp-tabs">
            <button class="tp-tab active" onclick="switchTpTab(this,'tp-daily')">
              📊 Daily Leaders ${lastGame ? `<span class="tp-game-label">${esc(lastGame.home_name||'')} vs ${esc(lastGame.away_name||'')}</span>` : ''}
            </button>
            <button class="tp-tab" onclick="switchTpTab(this,'tp-season')">
              🏆 Season Leaders
            </button>
          </div>
          <!-- Daily -->
          <div id="tp-daily" class="tp-pane">
            ${dailyStats.length
              ? (lastGame ? `<div class="tp-date">${esc(lastGame.date||'')}</div>` : '') + buildLeadersSection(dailySorted, true)
              : '<div class="tp-empty">No completed games yet. Stats will appear here after the first game is finalized.</div>'}
          </div>
          <!-- Season -->
          <div id="tp-season" class="tp-pane" style="display:none">
            ${seasonStats.length
              ? buildLeadersSection(seasonSorted, false)
              : '<div class="tp-empty">No season stats yet. Stats appear after games are completed.</div>'}
          </div>
        </div>
        <script>
        function switchTpTab(btn,paneId){
          document.querySelectorAll('.tp-tab').forEach(function(b){b.classList.remove('active')});
          document.querySelectorAll('.tp-pane').forEach(function(p){p.style.display='none'});
          btn.classList.add('active');
          document.getElementById(paneId).style.display='block';
        }
        </script>
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
                <a href="/admin/league/${league.id}/import-stats/${g.id}" class="btn-ghost-sm" title="Import Stats from Spreadsheet" style="color:var(--teal)">📤 Import</a>
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

      <script src="/js/admin.js?v31"></script>
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
      <form action="/admin/league/${league.id}/add-team" method="POST" enctype="multipart/form-data">
        <div class="field-group"><label>Team Logo / Photo <span style="color:var(--muted);font-size:11px">(optional)</span></label>
          <div style="display:flex;align-items:center;gap:14px">
            <div style="width:56px;height:56px;border-radius:10px;background:var(--card2);border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">🏀</div>
            <div style="flex:1">
              <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" class="input" style="padding:6px" />
              <div style="font-size:11px;color:var(--muted);margin-top:3px">JPG, PNG or WebP · Max 3MB</div>
            </div>
          </div>
        </div>
        <div class="field-group"><label>Team Name</label>
          <input name="name" class="input" placeholder="e.g. Purok 1 Ballers" required /></div>
        <div class="field-group"><label>Color</label>
          <select name="color" class="input">
            ${TEAM_COLORS.map(c=>`<option value="${c}" style="background:${c};color:${c==='#ffffff'||c==='#cccccc'?'#000':'#fff'}">${COLOR_NAMES[c]||c}</option>`).join('')}
          </select></div>
        <div class="field-group"><label>Bio / Description <span style="color:var(--muted);font-size:11px">(optional)</span></label>
          <textarea name="bio" class="input" rows="2" placeholder="e.g. Barangay champions 2024, home court: Plaza..."></textarea></div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <a href="/admin/league/${league.id}" class="btn-ghost">Cancel</a>
          <button type="submit" class="btn-primary">Add Team →</button>
        </div>
      </form>
    </div>
  `));
});

router.post('/league/:id/add-team', (req, res) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3*1024*1024 } }).single('photo');
  upload(req, res, async (err) => {
    try {
      if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
      const { name, color, bio } = req.body;
      if (!name?.trim()) return res.redirect(`/admin/league/${req.params.id}/add-team`);
      let photo_url = null;
      if (req.file) {
        const path = require('path'), fs = require('fs');
        const dir  = path.join(__dirname, '../../public/uploads/teams');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ext  = path.extname(req.file.originalname).toLowerCase() || '.jpg';
        const fname = Date.now() + '-' + Math.round(Math.random()*1e6) + ext;
        fs.writeFileSync(path.join(dir, fname), req.file.buffer);
        photo_url = fname;
      }
      await db.run(
        'INSERT INTO teams (league_id,name,color,photo_url,bio) VALUES ($1,$2,$3,$4,$5)',
        [req.params.id, name.trim(), color||'#e63946', photo_url, bio?.trim()||null]
      );
      res.redirect(`/admin/league/${req.params.id}`);
    } catch (e) { console.error(e); res.redirect(`/admin/league/${req.params.id}`); }
  });
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
      <form action="/admin/league/${league.id}/edit-team/${team.id}" method="POST" enctype="multipart/form-data">
        <div class="field-group"><label>Team Logo / Photo <span style="color:var(--muted);font-size:11px">(optional)</span></label>
          <div style="display:flex;align-items:center;gap:14px">
            ${team.photo_url
              ? `<img src="/uploads/teams/${esc(team.photo_url)}" style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:2px solid var(--border);flex-shrink:0">`
              : `<div style="width:56px;height:56px;border-radius:10px;background:var(--card2);border:2px dashed var(--border);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">🏀</div>`}
            <div style="flex:1">
              <input name="photo" type="file" accept="image/jpeg,image/png,image/webp" class="input" style="padding:6px" />
              <div style="font-size:11px;color:var(--muted);margin-top:3px">Upload new photo to replace · Max 3MB</div>
            </div>
          </div>
        </div>
        <div class="field-group"><label>Team Name</label>
          <input name="name" class="input" value="${esc(team.name)}" required /></div>
        <div class="field-group"><label>Color</label>
          <select name="color" class="input">
            ${TEAM_COLORS.map(c=>`<option value="${c}" ${c===team.color?'selected':''}>${COLOR_NAMES[c]||c}</option>`).join('')}
          </select></div>
        <div class="field-group"><label>Bio / Description <span style="color:var(--muted);font-size:11px">(optional)</span></label>
          <textarea name="bio" class="input" rows="2" placeholder="Team description...">${team.bio?esc(team.bio):''}</textarea></div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <a href="/admin/league/${league.id}" class="btn-ghost">Cancel</a>
          <button type="submit" class="btn-primary">Save Changes →</button>
        </div>
      </form>
    </div>
  `));
});

router.post('/league/:id/edit-team/:tid', (req, res) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3*1024*1024 } }).single('photo');
  upload(req, res, async (err) => {
    try {
      if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
      const { name, color, bio } = req.body;
      if (!name?.trim()) return res.redirect(`/admin/league/${req.params.id}/edit-team/${req.params.tid}`);
      let photo_url = null;
      if (req.file) {
        const path = require('path'), fs = require('fs');
        const dir  = path.join(__dirname, '../../public/uploads/teams');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ext  = path.extname(req.file.originalname).toLowerCase() || '.jpg';
        const fname = Date.now() + '-' + Math.round(Math.random()*1e6) + ext;
        fs.writeFileSync(path.join(dir, fname), req.file.buffer);
        photo_url = fname;
      }
      if (photo_url) {
        await db.run('UPDATE teams SET name=$1,color=$2,bio=$3,photo_url=$4 WHERE id=$5',
          [name.trim(), color||'#e63946', bio?.trim()||null, photo_url, req.params.tid]);
      } else {
        await db.run('UPDATE teams SET name=$1,color=$2,bio=$3 WHERE id=$4',
          [name.trim(), color||'#e63946', bio?.trim()||null, req.params.tid]);
      }
      res.redirect(`/admin/league/${req.params.id}`);
    } catch (e) { console.error(e); res.redirect(`/admin/league/${req.params.id}`); }
  });
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

router.post('/league/:id/add-player', (req, res) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3*1024*1024 } }).single('photo');
  upload(req, res, async (err) => {
    try {
      if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
      const { team_id, name, pos, jersey, bio } = req.body;
      if (!name?.trim()) return res.redirect(`/admin/league/${req.params.id}/add-player`);
      let photo_url = null;
      if (req.file) {
        const path = require('path');
        const fs   = require('fs');
        const dir  = path.join(__dirname, '../../public/uploads/players');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ext  = path.extname(req.file.originalname).toLowerCase() || '.jpg';
        const fname = Date.now() + '-' + Math.round(Math.random()*1e6) + ext;
        fs.writeFileSync(path.join(dir, fname), req.file.buffer);
        photo_url = fname;
      }
      await db.run(
        'INSERT INTO players (league_id,team_id,name,pos,jersey,gp,pts,reb,ast,stl,blk,fg,photo_url,bio) VALUES ($1,$2,$3,$4,$5,0,0,0,0,0,0,0,$6,$7)',
        [req.params.id, team_id, name.trim(), pos||'', jersey||0, photo_url, bio?.trim()||null]
      );
      res.redirect(`/admin/league/${req.params.id}`);
    } catch (e) { console.error(e); res.redirect(`/admin/league/${req.params.id}`); }
  });
});

router.get('/league/:id/edit-player/:pid', async (req, res) => {
  const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
  const player = await db.queryOne('SELECT * FROM players WHERE id=$1', [req.params.pid]);
  if (!league || !player || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
  const teams = await db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY name', [req.params.id]);
  res.send(adminPage('Edit Player', req.user, playerForm(league, teams, player)));
});

router.post('/league/:id/edit-player/:pid', (req, res) => {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3*1024*1024 } }).single('photo');
  upload(req, res, async (err) => {
    try {
      if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
      const { team_id, name, pos, jersey, bio } = req.body;
      if (!name?.trim()) return res.redirect(`/admin/league/${req.params.id}/edit-player/${req.params.pid}`);

      let photo_url = null;
      if (req.file) {
        const path = require('path');
        const fs   = require('fs');
        const dir  = path.join(__dirname, '../../public/uploads/players');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const ext  = path.extname(req.file.originalname).toLowerCase() || '.jpg';
        const fname = Date.now() + '-' + Math.round(Math.random()*1e6) + ext;
        fs.writeFileSync(path.join(dir, fname), req.file.buffer);
        photo_url = fname;
      }

      if (photo_url) {
        await db.run(
          'UPDATE players SET team_id=$1,name=$2,pos=$3,jersey=$4,bio=$5,photo_url=$6 WHERE id=$7',
          [team_id, name.trim(), pos||'', jersey||0, bio?.trim()||null, photo_url, req.params.pid]
        );
      } else {
        await db.run(
          'UPDATE players SET team_id=$1,name=$2,pos=$3,jersey=$4,bio=$5 WHERE id=$6',
          [team_id, name.trim(), pos||'', jersey||0, bio?.trim()||null, req.params.pid]
        );
      }
      res.redirect(`/admin/league/${req.params.id}`);
    } catch (e) { console.error(e); res.redirect(`/admin/league/${req.params.id}`); }
  });
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
        <div class="field-group">
          <label>Date &amp; Time</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div>
              <input name="game_date" type="date" class="input"
                     style="color-scheme:dark;cursor:pointer" />
              <div style="font-size:11px;color:var(--muted);margin-top:3px">Date</div>
            </div>
            <div>
              <input name="game_time" type="time" class="input"
                     style="color-scheme:dark;cursor:pointer" value="09:00" />
              <div style="font-size:11px;color:var(--muted);margin-top:3px">Time</div>
            </div>
          </div>
          <input name="date" type="hidden" id="addGameDate" />
        </div>
        <!-- date picker wired in admin.js -->
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

    const homePlayers = game.htid ? await db.query('SELECT * FROM players WHERE team_id=$1 ORDER BY pos,name', [game.htid]) : [];
    const awayPlayers = game.atid ? await db.query('SELECT * FROM players WHERE team_id=$1 ORDER BY pos,name', [game.atid]) : [];
    const existingStats = await db.query('SELECT * FROM game_stats WHERE game_id=$1', [game.id]);
    const statMap = {};
    existingStats.forEach(s => { statMap[s.player_id] = s; });

    const allPlayerIds = [...homePlayers, ...awayPlayers].map(p => p.id).join(',');
    const homeColor = game.home_color || '#e63329';
    const awayColor = game.away_color || '#457b9d';

    // Helper to build player row HTML — used for both sides
    function playerRow(p, side, color, teamName) {
      const s = statMap[p.id] || {};
      // Compute pts from raw shot stats (game_stats has fg2m/fg3m/ftm, not pts)
      const pts = ((s.fg2m||0)*2) + ((s.fg3m||0)*3) + (s.ftm||0);
      return `<div class="lsc-player"
        data-pid="${p.id}"
        data-name="${esc(p.name)}"
        data-pos="${p.pos||''}"
        data-jersey="${p.jersey||'?'}"
        data-team="${esc(teamName)}"
        data-color="${color}"
        data-side="${side}"
        data-fg2m="${s.fg2m||0}" data-fg2a="${s.fg2a||0}"
        data-fg3m="${s.fg3m||0}" data-fg3a="${s.fg3a||0}"
        data-ftm="${s.ftm||0}"  data-fta="${s.fta||0}"
        data-oreb="${s.oreb||0}" data-dreb="${s.dreb||0}"
        data-ast="${s.ast||0}"  data-stl="${s.stl||0}"
        data-blk="${s.blk||0}"  data-to="${s.to_val||0}"
        data-foul="${s.foul||0}">
        <div class="lsc-player-num" style="background:${color}99">${p.jersey||'?'}</div>
        <div class="lsc-player-info">
          <div class="lsc-player-name">${esc(p.name)}</div>
          <div class="lsc-player-pos">${p.pos||''}</div>
        </div>
        <div>
          <div class="lsc-player-pts" id="row-pts-${p.id}">${pts}</div>
          <div class="lsc-player-pts-lbl">PTS</div>
        </div>
      </div>`;
    }

    res.send(adminPage('Live Score', req.user, `
      <style>
        body { overflow:hidden; margin:0; }
        *{ box-sizing:border-box; }
        .ls { display:flex; flex-direction:column; height:100vh; margin:-24px; background:#0b0f1e; color:#e8eaf0; font-family:'Outfit',sans-serif; }
        .ls-nav { display:flex; align-items:center; gap:0; background:#0d1225; border-bottom:1px solid rgba(255,255,255,.07); height:44px; flex-shrink:0; padding:0 12px; }
        .ls-nav-tab { padding:0 16px; height:100%; display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; letter-spacing:.5px; color:rgba(255,255,255,.4); cursor:pointer; border-bottom:2px solid transparent; transition:all .15s; white-space:nowrap; }
        .ls-nav-tab.active { color:#fff; border-bottom-color:#e63329; }
        .live-dot { width:7px; height:7px; border-radius:50%; background:#e63329; animation:pulse 1.5s infinite; flex-shrink:0; display:inline-block; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        .ls-nav-spacer { flex:1; }
        .ls-nav-actions { display:flex; gap:8px; }
        .ls-nav-btn { padding:5px 14px; border-radius:6px; font-size:12px; font-weight:700; cursor:pointer; border:1px solid rgba(255,255,255,.15); background:rgba(255,255,255,.06); color:#e8eaf0; font-family:'Outfit',sans-serif; transition:all .15s; }
        .ls-nav-btn:hover { background:rgba(255,255,255,.12); }
        .ls-nav-btn.end { background:#e63329; border-color:#e63329; color:#fff; }
        .ls-nav-btn.end:hover { background:#c72820; }
        .ls-sb { background:linear-gradient(180deg,#1b2748 0%,#111930 100%); border-bottom:1px solid rgba(255,255,255,.08); padding:10px 20px; flex-shrink:0; }
        .ls-sb-inner { display:flex; align-items:center; justify-content:space-between; max-width:900px; margin:0 auto; gap:12px; }
        .ls-team-block { flex:1; display:flex; align-items:center; gap:10px; }
        .ls-team-block.away { flex-direction:row-reverse; text-align:right; }
        .ls-logo { width:46px; height:46px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-family:'Russo One',sans-serif; font-size:14px; font-weight:900; color:#fff; flex-shrink:0; }
        .ls-team-name { font-size:13px; font-weight:800; color:#fff; text-transform:uppercase; letter-spacing:.5px; }
        .ls-team-sub { font-size:10px; color:rgba(255,255,255,.35); margin-top:2px; display:flex; align-items:center; gap:8px; }
        .ls-team-sub.right { justify-content:flex-end; }
        .ls-score-block { text-align:center; flex-shrink:0; min-width:220px; }
        .ls-score-nums { display:flex; align-items:center; justify-content:center; gap:10px; }
        .ls-score { font-size:62px; font-weight:900; color:#fff; line-height:1; font-family:'Russo One',sans-serif; }
        .ls-score-adj-col { display:flex; flex-direction:column; gap:4px; }
        .ls-score-adj { width:24px; height:24px; border-radius:6px; border:1px solid rgba(255,255,255,.2); background:rgba(255,255,255,.08); color:rgba(255,255,255,.7); font-size:14px; font-weight:700; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all .15s; }
        .ls-score-adj:hover { background:rgba(255,255,255,.22); }
        .ls-score-sep { font-size:36px; font-weight:900; color:rgba(255,255,255,.2); }
        .ls-qtr-block { display:flex; flex-direction:column; align-items:center; gap:3px; margin-top:4px; }
        .ls-qtr-label { font-size:10px; color:rgba(255,255,255,.4); font-weight:700; letter-spacing:1px; }
        .ls-qtr-val { font-size:20px; font-weight:900; color:#f7c948; }
        .ls-qtr-ctrl { display:flex; gap:4px; align-items:center; }
        .ls-qtr-btn { width:22px; height:22px; border-radius:4px; border:1px solid rgba(255,255,255,.2); background:rgba(255,255,255,.08); color:#fff; font-size:13px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
        .ls-qtr-btn:hover { background:rgba(255,255,255,.18); }
        .ls-live-badge { display:inline-flex; align-items:center; gap:4px; background:rgba(230,51,41,.2); border:1px solid rgba(230,51,41,.4); color:#ff6b6b; font-size:10px; font-weight:800; padding:2px 8px; border-radius:20px; letter-spacing:1px; margin-top:4px; }
        .ls-main { display:grid; grid-template-columns:240px 1fr 260px; flex:1; overflow:hidden; }
        .ls-left { background:#0d1225; border-right:1px solid rgba(255,255,255,.06); overflow-y:auto; display:flex; flex-direction:column; }
        .ls-left-head { padding:10px 14px 6px; flex-shrink:0; }
        .ls-left-title { font-size:10px; font-weight:800; letter-spacing:2px; color:rgba(255,255,255,.35); }
        .ls-search { margin:6px 0; display:flex; align-items:center; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.08); border-radius:7px; padding:5px 10px; gap:6px; }
        .ls-search input { background:none; border:none; outline:none; color:#e8eaf0; font-size:12px; width:100%; font-family:'Outfit',sans-serif; }
        .ls-search input::placeholder { color:rgba(255,255,255,.25); }
        .ls-team-label { font-size:10px; font-weight:800; letter-spacing:1.5px; padding:8px 14px 4px; }
        .lsc-player { display:flex; align-items:center; gap:8px; padding:8px 14px; cursor:pointer; transition:background .12s; border-left:3px solid transparent; }
        .lsc-player:hover { background:rgba(255,255,255,.04); }
        .lsc-player.active { background:rgba(255,255,255,.07); border-left-color:var(--pc,#e63329); }
        .lsc-player-num { width:28px; height:28px; border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; color:#fff; flex-shrink:0; }
        .lsc-player-info { flex:1; min-width:0; }
        .lsc-player-name { font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .lsc-player-pos { font-size:10px; color:rgba(255,255,255,.35); margin-top:1px; }
        .lsc-player-pts { font-size:14px; font-weight:800; color:#f97316; }
        .lsc-player-pts-lbl { font-size:9px; color:rgba(255,255,255,.3); }
        .ls-center { display:flex; flex-direction:column; overflow:hidden; background:#0b0f1e; }
        .ls-tabs { display:flex; border-bottom:1px solid rgba(255,255,255,.07); background:#0d1225; flex-shrink:0; }
        .ls-tab { padding:10px 16px; font-size:11px; font-weight:700; letter-spacing:.5px; color:rgba(255,255,255,.35); cursor:pointer; border-bottom:2px solid transparent; transition:all .15s; }
        .ls-tab.active { color:#fff; border-bottom-color:#e63329; background:rgba(255,255,255,.03); }
        .ls-tab-content { flex:1; overflow-y:auto; overflow-x:hidden; display:none; flex-direction:column; min-height:0; }
        .ls-tab-content.active { display:flex; }
        .ls-pp-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; color:rgba(255,255,255,.2); gap:10px; font-size:13px; flex:1; }
        .ls-pp-hdr { background:#131d38; padding:14px 20px 12px; border-bottom:1px solid rgba(255,255,255,.07); display:flex; align-items:flex-start; justify-content:space-between; flex-shrink:0; }
        .ls-pp-name { font-size:20px; font-weight:900; color:#fff; font-family:'Russo One',sans-serif; }
        .ls-pp-role { font-size:12px; color:rgba(255,255,255,.4); margin-top:2px; }
        .ls-pp-pts-big { font-size:40px; font-weight:900; color:#f97316; line-height:1; }
        .ls-pp-pts-lbl { font-size:10px; color:rgba(255,255,255,.3); text-align:right; letter-spacing:1px; }
        .ls-rec-label { font-size:10px; font-weight:800; letter-spacing:2px; color:rgba(255,255,255,.25); padding:8px 20px 4px; flex-shrink:0; }
        .ls-shots { padding:8px 20px 6px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:7px; flex-shrink:0; }
        .ls-shot { padding:14px 8px; border-radius:9px; font-size:13px; font-weight:800; cursor:pointer; border:none; display:flex; flex-direction:column; align-items:center; gap:3px; transition:all .12s; font-family:'Outfit',sans-serif; }
        .ls-shot:active { transform:scale(.97); }
        .ls-shot.make-2,.ls-shot.make-ft { background:#e63329; color:#fff; }
        .ls-shot.make-3 { background:#2563eb; color:#fff; }
        .ls-shot.miss { background:rgba(255,255,255,.07); color:rgba(255,255,255,.6); border:1px solid rgba(255,255,255,.1); }
        .ls-shot-sub { font-size:10px; font-weight:700; letter-spacing:.5px; opacity:.8; }
        .ls-fg-row { font-size:11px; color:rgba(255,255,255,.4); text-align:center; padding:4px 20px 8px; flex-shrink:0; }
        .ls-counters { padding:6px 20px 12px; display:grid; grid-template-columns:1fr 1fr 1fr; gap:7px; flex-shrink:0; }
        .ls-cnt { background:#111829; border:1px solid rgba(255,255,255,.08); border-radius:9px; padding:10px 8px; text-align:center; }
        .ls-cnt-lbl { font-size:10px; font-weight:800; letter-spacing:1px; color:rgba(255,255,255,.35); margin-bottom:5px; }
        .ls-cnt-val { font-size:24px; font-weight:900; color:#fff; line-height:1; margin-bottom:6px; }
        .ls-cnt-btns { display:flex; gap:5px; justify-content:center; }
        .ls-cnt-btn { flex:1; padding:5px 0; border-radius:6px; font-size:13px; font-weight:700; cursor:pointer; border:none; font-family:'Outfit',sans-serif; transition:all .12s; }
        .ls-cnt-btn.minus { background:rgba(255,71,87,.15); color:#ff4757; }
        .ls-cnt-btn.minus:hover { background:rgba(255,71,87,.3); }
        .ls-cnt-btn.plus  { background:rgba(34,197,94,.15); color:#22c55e; }
        .ls-cnt-btn.plus:hover  { background:rgba(34,197,94,.3); }
        .ls-undo { display:flex; align-items:center; justify-content:center; gap:6px; padding:8px; color:rgba(255,255,255,.3); font-size:12px; font-weight:700; cursor:pointer; border-top:1px solid rgba(255,255,255,.06); flex-shrink:0; transition:color .15s; }
        .ls-undo:hover { color:rgba(255,255,255,.6); }
        .ls-box { padding:12px 16px; overflow-x:auto; }
        .ls-box table { width:100%; border-collapse:collapse; font-size:11px; }
        .ls-box th { padding:5px 6px; text-align:center; color:rgba(255,255,255,.35); font-weight:700; letter-spacing:.5px; font-size:10px; border-bottom:1px solid rgba(255,255,255,.08); }
        .ls-box th:first-child { text-align:left; }
        .ls-box td { padding:6px; text-align:center; border-bottom:1px solid rgba(255,255,255,.04); color:rgba(255,255,255,.8); }
        .ls-box td:first-child { text-align:left; font-weight:600; }
        .ls-box .pts-cell { color:#f97316; font-weight:800; }
        .ls-box-team-hdr { font-size:10px; font-weight:800; letter-spacing:2px; padding:10px 6px 5px; }
        .ls-pbp { display:flex; flex-direction:column; overflow:hidden; }
        .ls-pbp-entry { display:flex; align-items:center; gap:10px; padding:9px 16px; border-bottom:1px solid rgba(255,255,255,.04); flex-shrink:0; }
        .ls-pbp-time { font-size:11px; color:rgba(255,255,255,.3); font-weight:700; min-width:28px; }
        .ls-pbp-num { width:26px; height:26px; border-radius:7px; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:800; color:#fff; flex-shrink:0; }
        .ls-pbp-text { flex:1; font-size:12px; color:rgba(255,255,255,.7); }
        .ls-pbp-badge { font-size:11px; font-weight:800; padding:2px 8px; border-radius:20px; flex-shrink:0; }
        .ls-pbp-badge.pos { background:rgba(34,197,94,.15); color:#22c55e; }
        .ls-pbp-badge.neg { background:rgba(255,71,87,.12); color:#ff4757; }
        .ls-leaders { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:12px 16px; }
        .ls-leader-card { background:#111829; border:1px solid rgba(255,255,255,.07); border-radius:10px; padding:10px 12px; display:flex; align-items:center; gap:10px; }
        .ls-leader-avatar { width:34px; height:34px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; color:#fff; flex-shrink:0; }
        .ls-leader-info { flex:1; min-width:0; }
        .ls-leader-name { font-size:12px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .ls-leader-team { font-size:10px; color:rgba(255,255,255,.3); }
        .ls-leader-stat { font-size:22px; font-weight:900; color:#f97316; line-height:1; }
        .ls-leader-stat-lbl { font-size:9px; color:rgba(255,255,255,.3); }
        .ls-right { background:#0d1225; border-left:1px solid rgba(255,255,255,.06); overflow-y:auto; display:flex; flex-direction:column; }
        .ls-right-hdr { padding:12px 14px 8px; border-bottom:1px solid rgba(255,255,255,.07); flex-shrink:0; }
        .ls-right-title { font-size:12px; font-weight:800; }
        .ls-mini-sb { background:#131d38; border-radius:9px; margin:10px 12px; padding:10px 12px; }
        .ls-mini-row { display:flex; align-items:center; justify-content:space-between; }
        .ls-mini-score { font-size:24px; font-weight:900; color:#fff; }
        .ls-mini-badge { font-size:9px; background:rgba(230,51,41,.2); color:#ff6b6b; border:1px solid rgba(230,51,41,.3); padding:2px 7px; border-radius:20px; font-weight:800; letter-spacing:1px; }
        .ls-rp { padding:10px 12px; }
        .ls-rp-hdr { background:#111829; border-radius:9px; padding:10px 12px; margin-bottom:8px; }
        .ls-rp-name { font-size:14px; font-weight:800; color:#fff; }
        .ls-rp-role { font-size:10px; color:rgba(255,255,255,.35); }
        .ls-rp-pts { font-size:28px; font-weight:900; color:#f97316; line-height:1; }
        .ls-rp-pts-lbl { font-size:9px; color:rgba(255,255,255,.3); }
        .ls-rp-stats { display:flex; gap:6px; margin-top:6px; flex-wrap:wrap; }
        .ls-rp-stat { background:#0d1225; border-radius:6px; padding:4px 8px; text-align:center; flex:1; min-width:40px; }
        .ls-rp-stat-v { font-size:14px; font-weight:800; color:#e8eaf0; }
        .ls-rp-stat-l { font-size:9px; color:rgba(255,255,255,.3); }
        .ls-rp-shots { display:grid; grid-template-columns:1fr 1fr 1fr; gap:5px; margin-top:8px; }
        .ls-rp-shot { padding:10px 4px; border-radius:7px; font-size:11px; font-weight:800; cursor:pointer; border:none; text-align:center; font-family:'Outfit',sans-serif; transition:all .12s; }
        .ls-rp-shot.make-2,.ls-rp-shot.make-ft { background:#e63329; color:#fff; }
        .ls-rp-shot.make-3 { background:#2563eb; color:#fff; }
        .ls-rp-shot.miss { background:rgba(255,255,255,.07); color:rgba(255,255,255,.5); border:1px solid rgba(255,255,255,.09); }
        .ls-rp-pbp { padding:0 12px 12px; }
        .ls-rp-pbp-title { font-size:11px; font-weight:800; color:rgba(255,255,255,.4); letter-spacing:1px; padding:8px 0 6px; }

        /* ── TABLET (820px) ── */
        @media(max-width:820px){
          .ls-score { font-size:48px; }
          .ls-main  { grid-template-columns: 200px 1fr 0; }
          .ls-right { display:none; }
        }

        /* ── MOBILE (600px) ── */
        @media(max-width:600px){
          /* Full page scrolls naturally */
          body { overflow:auto !important; }
          .ls  { height:auto; min-height:100vh; overflow:visible; }
          .ls-main { display:flex; flex-direction:column; overflow:visible; }

          /* Compact nav */
          .ls-nav { padding:0 8px; height:40px; }
          .ls-nav-tab { padding:0 8px; font-size:11px; }
          .ls-nav-btn { padding:4px 10px; font-size:11px; }

          /* Compact scoreboard */
          .ls-sb { padding:8px 12px; }
          .ls-sb-inner { gap:6px; }
          .ls-score { font-size:40px; }
          .ls-score-sep { font-size:22px; }
          .ls-score-adj { width:20px; height:20px; font-size:12px; }
          .ls-logo { width:34px; height:34px; font-size:11px; }
          .ls-team-name { font-size:11px; }
          .ls-team-sub  { font-size:9px; }
          .ls-score-block { min-width:150px; }
          .ls-live-badge { font-size:9px; padding:2px 6px; }

          /* LEFT: search bar only — players hidden until search */
          .ls-left {
            order:1;
            display:flex !important;
            flex-direction:column;
            height:auto;
            border-right:none;
            border-bottom:1px solid rgba(255,255,255,.08);
            overflow:visible;
          }
          .ls-left-head { padding:8px 12px 6px; }
          .ls-search { margin:4px 0; }

          /* Team labels & player rows HIDDEN by default on mobile */
          .ls-team-label { display:none; }
          #homePlayerList,
          #awayPlayerList { display:none; }

          /* Shown when search active (toggled by JS) */
          #homePlayerList.mobile-visible,
          #awayPlayerList.mobile-visible {
            display:flex;
            flex-direction:row;
            overflow-x:auto;
            padding-bottom:6px;
            scroll-snap-type:x mandatory;
          }

          .lsc-player {
            flex-direction:column; align-items:center; justify-content:center;
            min-width:68px; max-width:68px; padding:8px 4px;
            text-align:center; border-left:none;
            border-bottom:3px solid transparent;
            scroll-snap-align:start; flex-shrink:0;
          }
          .lsc-player.active { border-bottom-color:var(--pc,#e63329); border-left:none; }
          .lsc-player-num  { width:30px; height:30px; font-size:12px; }
          .lsc-player-name { font-size:10px; white-space:nowrap; overflow:hidden;
                             text-overflow:ellipsis; max-width:60px; }
          .lsc-player-pos  { font-size:9px; }
          .lsc-player-pts  { font-size:13px; }
          .lsc-player-pts-lbl { font-size:8px; }

          /* Center: natural height, no overflow clipping */
          .ls-center { order:2; overflow:visible; display:block; height:auto; }
          .ls-tabs   { overflow-x:auto; flex-shrink:0; }
          .ls-tab    { padding:8px 12px; font-size:10px; white-space:nowrap; }
          .ls-tab-content         { display:none; height:auto; overflow:visible; flex:none; }
          .ls-tab-content.active  { display:block; }

          /* Stat panel */
          .ls-pp-hdr   { padding:10px 14px; }
          .ls-pp-name  { font-size:16px; }
          .ls-pp-pts-big { font-size:30px; }
          .ls-shots    { padding:8px 12px; gap:5px; }
          .ls-shot     { padding:11px 4px; font-size:12px; }
          .ls-shot-sub { font-size:9px; }
          .ls-counters { padding:4px 12px 10px; gap:5px; }
          .ls-cnt      { padding:8px 4px; }
          .ls-cnt-val  { font-size:20px; }
          .ls-cnt-lbl  { font-size:9px; }
          .ls-cnt-btn  { padding:4px 0; font-size:12px; }
          .ls-fg-row   { padding:4px 12px 6px; font-size:10px; }
          .ls-undo     { padding:8px; font-size:11px; }

          /* Box/PBP/Leaders: natural height, horizontal scroll for table */
          .ls-box { padding:8px; overflow-x:auto; }
          .ls-box table { font-size:10px; min-width:420px; }
          .ls-box th, .ls-box td { padding:4px 5px; }

          /* Hide right panel */
          .ls-right { display:none !important; }
        }
      </style>

      <div class="ls">

        <nav class="ls-nav">
          <div class="ls-nav-tab active" data-tab="live"><span class="live-dot"></span> LIVE GAME</div>
          <div class="ls-nav-tab" data-tab="box">BOX SCORE</div>
          <div class="ls-nav-spacer"></div>
          <div class="ls-nav-actions">
            <a href="/admin/league/${league.id}" class="ls-nav-btn" style="text-decoration:none">← League</a>
            <button class="ls-nav-btn" id="btn-save">💾 Save</button>
            <button class="ls-nav-btn end" id="btn-end">⏹ End Game</button>
          </div>
        </nav>

        <div class="ls-sb">
          <div class="ls-sb-inner">
            <div class="ls-team-block">
              <div class="ls-logo" style="background:${homeColor}">${esc((game.home_name||'H').substring(0,3).toUpperCase())}</div>
              <div>
                <div class="ls-team-name">${esc(game.home_name||'Home')}</div>
                <div class="ls-team-sub">FOULS <span id="home-fouls">0</span> &nbsp;|&nbsp; TO: <span id="home-to">0</span></div>
              </div>
            </div>

            <div class="ls-score-block">
              <div class="ls-score-nums">
                <div class="ls-score-adj-col">
                  <button class="ls-score-adj" id="home-score-plus">+</button>
                  <button class="ls-score-adj" id="home-score-minus">−</button>
                </div>
                <div class="ls-score" id="sb-home-score">${game.home_score||0}</div>
                <div class="ls-score-sep">:</div>
                <div class="ls-score" id="sb-away-score">${game.away_score||0}</div>
                <div class="ls-score-adj-col">
                  <button class="ls-score-adj" id="away-score-plus">+</button>
                  <button class="ls-score-adj" id="away-score-minus">−</button>
                </div>
              </div>
              <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin-top:4px">
                <div class="ls-qtr-block">
                  <div class="ls-qtr-label">QUARTER</div>
                  <div class="ls-qtr-ctrl">
                    <button class="ls-qtr-btn" id="qtr-minus">−</button>
                    <div class="ls-qtr-val" id="sb-qtr">${game.quarter||1}</div>
                    <button class="ls-qtr-btn" id="qtr-plus">+</button>
                  </div>
                </div>
                <div class="ls-live-badge"><span class="live-dot"></span> LIVE</div>
              </div>
            </div>

            <div class="ls-team-block away">
              <div class="ls-logo" style="background:${awayColor}">${esc((game.away_name||'A').substring(0,3).toUpperCase())}</div>
              <div style="text-align:right">
                <div class="ls-team-name">${esc(game.away_name||'Away')}</div>
                <div class="ls-team-sub right">FOULS <span id="away-fouls">0</span> &nbsp;|&nbsp; TO: <span id="away-to">0</span></div>
              </div>
            </div>
          </div>
        </div>

        <div class="ls-main">

          <!-- LEFT: HOME + AWAY PLAYERS -->
          <div class="ls-left">
            <div class="ls-left-head">
              <div class="ls-left-title">SELECT PLAYER</div>
              <div class="ls-search">
                <span style="opacity:.4">⌕</span>
                <input type="text" id="playerSearch" placeholder="Name or jersey #..." />
              </div>
            </div>
            <div class="ls-team-label" style="color:${homeColor}">${esc((game.home_name||'HOME').toUpperCase())}</div>
            <div id="homePlayerList">
              <div class="ls-team-strip-label" style="color:${homeColor};display:none">${esc((game.home_name||'HOME').toUpperCase())}</div>
              ${homePlayers.length ? homePlayers.map(p=>playerRow(p,'home',homeColor,game.home_name||'Home')).join('') : '<div style="padding:10px 14px;font-size:12px;color:rgba(255,255,255,.25)">No players</div>'}
            </div>
            <div class="ls-team-label" style="color:${awayColor};margin-top:4px">${esc((game.away_name||'AWAY').toUpperCase())}</div>
            <div id="awayPlayerList">
              <div class="ls-team-strip-label" style="color:${awayColor};display:none">${esc((game.away_name||'AWAY').toUpperCase())}</div>
              ${awayPlayers.length ? awayPlayers.map(p=>playerRow(p,'away',awayColor,game.away_name||'Away')).join('') : '<div style="padding:10px 14px;font-size:12px;color:rgba(255,255,255,.25)">No players</div>'}
            </div>
          </div>

          <!-- CENTER -->
          <div class="ls-center">
            <div class="ls-tabs">
              <div class="ls-tab active" data-ctab="live">LIVE GAME</div>
              <div class="ls-tab" data-ctab="box">BOX SCORE</div>
              <div class="ls-tab" data-ctab="pbp">PLAY BY PLAY</div>
              <div class="ls-tab" data-ctab="leaders">LEADERS</div>
            </div>

            <!-- LIVE TAB -->
            <div class="ls-tab-content active" id="ctab-live">
              <div class="ls-pp-empty" id="noPlayerMsg">
                <div style="font-size:36px">👆</div>
                <div>Select a player to record stats</div>
              </div>
              <div id="playerPanel" style="display:none;flex-direction:column;flex:1;overflow-y:auto">
                <div class="ls-pp-hdr">
                  <div>
                    <div class="ls-pp-name" id="pp-name">—</div>
                    <div class="ls-pp-role" id="pp-sub">—</div>
                  </div>
                  <div style="text-align:right">
                    <div class="ls-pp-pts-big" id="pp-pts">0</div>
                    <div class="ls-pp-pts-lbl">PTS</div>
                  </div>
                </div>
                <div class="ls-rec-label">RECORDING: <span id="pp-recording"></span></div>
                <div class="ls-shots">
                  <button class="ls-shot make-ft" id="btn-ft"><span style="font-size:18px">+1</span><span class="ls-shot-sub">FREE THROW</span></button>
                  <button class="ls-shot make-2"  id="btn-2pt"><span style="font-size:18px">+2</span><span class="ls-shot-sub">2 POINTS</span></button>
                  <button class="ls-shot make-3"  id="btn-3pt"><span style="font-size:18px">+3</span><span class="ls-shot-sub">3 POINTS</span></button>
                  <button class="ls-shot miss" id="btn-missft"><span>✕</span><span class="ls-shot-sub">MISS FT</span></button>
                  <button class="ls-shot miss" id="btn-miss2"><span>✕</span><span class="ls-shot-sub">MISS 2PT</span></button>
                  <button class="ls-shot miss" id="btn-miss3"><span>✕</span><span class="ls-shot-sub">MISS 3PT</span></button>
                </div>
                <div class="ls-fg-row" id="pp-fg-line">0/0 2PT · 0/0 3PT · 0/0 FT</div>
                <div class="ls-counters">
                  ${[{k:'oreb',l:'OFF REB'},{k:'dreb',l:'DEF REB'},{k:'ast',l:'ASSIST'},
                     {k:'stl',l:'STEAL'},{k:'blk',l:'BLOCK'},{k:'to',l:'TURNOVER'},
                     {k:'foul',l:'FOUL'}].map(s=>`
                  <div class="ls-cnt" ${s.k==='foul'?'style="border-color:rgba(255,71,87,.25)"':''}>
                    <div class="ls-cnt-lbl" ${s.k==='foul'?'style="color:#ff4757"':''}>${s.l}</div>
                    <div class="ls-cnt-val" id="pp-${s.k}">0</div>
                    <div class="ls-cnt-btns">
                      <button class="ls-cnt-btn minus" data-stat="${s.k}" data-dir="-1">−</button>
                      <button class="ls-cnt-btn plus"  data-stat="${s.k}" data-dir="1">+</button>
                    </div>
                  </div>`).join('')}
                  <div class="ls-cnt" style="border-color:rgba(249,115,22,.2)">
                    <div class="ls-cnt-lbl" style="color:#f97316">EFF</div>
                    <div class="ls-cnt-val" style="color:#f97316;font-size:20px" id="pp-eff">0</div>
                    <div style="height:28px"></div>
                  </div>
                  <div class="ls-cnt">
                    <div class="ls-cnt-lbl">FG%</div>
                    <div class="ls-cnt-val" style="font-size:16px" id="pp-fgp">—</div>
                    <div style="height:28px"></div>
                  </div>
                </div>
                <div class="ls-undo" id="btn-undo">↩ UNDO LAST ACTION</div>
              </div>
            </div>

            <!-- BOX SCORE TAB -->
            <div class="ls-tab-content" id="ctab-box">
              <div class="ls-box">
                <div class="ls-box-team-hdr" style="color:${homeColor}">${esc(game.home_name||'HOME')}</div>
                <table><thead><tr><th>PLAYER</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>FG</th><th>3PT</th><th>FT</th></tr></thead><tbody id="boxHomeTbody"></tbody></table>
                <div class="ls-box-team-hdr" style="color:${awayColor};margin-top:12px">${esc(game.away_name||'AWAY')}</div>
                <table><thead><tr><th>PLAYER</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>FG</th><th>3PT</th><th>FT</th></tr></thead><tbody id="boxAwayTbody"></tbody></table>
              </div>
            </div>

            <!-- PBP TAB -->
            <div class="ls-tab-content" id="ctab-pbp">
              <div class="ls-pbp" id="pbpLog" style="overflow-y:auto;flex:1">
                <div style="padding:24px;color:rgba(255,255,255,.25);font-size:13px;text-align:center">No plays yet — select a player and start scoring</div>
              </div>
            </div>

            <!-- LEADERS TAB -->
            <div class="ls-tab-content" id="ctab-leaders">
              <div style="padding:12px 16px;font-size:10px;font-weight:800;letter-spacing:1px;color:rgba(255,255,255,.35)">GAME LEADERS</div>
              <div class="ls-leaders" id="leadersGrid"></div>
            </div>
          </div>

          <!-- RIGHT -->
          <div class="ls-right">
            <div class="ls-right-hdr"><div class="ls-right-title">Live Game</div></div>
            <div class="ls-mini-sb">
              <div class="ls-mini-row">
                <div><div style="font-size:10px;color:rgba(255,255,255,.35);font-weight:700">${esc((game.home_name||'HME').substring(0,3).toUpperCase())}</div><div class="ls-mini-score" id="mini-home">${game.home_score||0}</div></div>
                <div style="text-align:center"><div class="ls-mini-badge">● LIVE</div><div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:4px">Q<span id="mini-qtr">${game.quarter||1}</span></div></div>
                <div style="text-align:right"><div style="font-size:10px;color:rgba(255,255,255,.35);font-weight:700">${esc((game.away_name||'AWY').substring(0,3).toUpperCase())}</div><div class="ls-mini-score" id="mini-away">${game.away_score||0}</div></div>
              </div>
            </div>
            <div class="ls-rp" id="rightPlayerPanel" style="display:none">
              <div class="ls-rp-hdr">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                  <div><div class="ls-rp-name" id="rp-name">—</div><div class="ls-rp-role" id="rp-role">—</div></div>
                  <div style="text-align:right"><div class="ls-rp-pts" id="rp-pts">0</div><div class="ls-rp-pts-lbl">PTS</div></div>
                </div>
                <div class="ls-rp-stats">
                  <div class="ls-rp-stat"><div class="ls-rp-stat-v" id="rp-reb">0</div><div class="ls-rp-stat-l">REB</div></div>
                  <div class="ls-rp-stat"><div class="ls-rp-stat-v" id="rp-ast">0</div><div class="ls-rp-stat-l">AST</div></div>
                  <div class="ls-rp-stat"><div class="ls-rp-stat-v" id="rp-stl">0</div><div class="ls-rp-stat-l">STL</div></div>
                  <div class="ls-rp-stat"><div class="ls-rp-stat-v" id="rp-blk">0</div><div class="ls-rp-stat-l">BLK</div></div>
                </div>
              </div>
              <div class="ls-rp-shots">
                <button class="ls-rp-shot make-ft" data-action="ft">+1 FT</button>
                <button class="ls-rp-shot make-2"  data-action="2pt">+2 PT</button>
                <button class="ls-rp-shot make-3"  data-action="3pt">+3 PT</button>
                <button class="ls-rp-shot miss" data-action="missft">MISS FT</button>
                <button class="ls-rp-shot miss" data-action="miss2">MISS 2</button>
                <button class="ls-rp-shot miss" data-action="miss3">MISS 3</button>
              </div>
            </div>
            <div class="ls-rp-pbp">
              <div class="ls-rp-pbp-title">Play by Play</div>
              <div id="miniPbpLog"></div>
            </div>
          </div>
        </div>
      </div>

      <form id="scoreForm" action="/admin/league/${league.id}/score/${game.id}" method="POST" style="display:none">
        <input type="hidden" name="player_ids"  id="f-player-ids"  value="${allPlayerIds}" />
        <input type="hidden" name="home_score"  id="f-home-score"  value="${game.home_score||0}" />
        <input type="hidden" name="away_score"  id="f-away-score"  value="${game.away_score||0}" />
        <input type="hidden" name="quarter"     id="f-quarter"     value="${game.quarter||1}" />
        <input type="hidden" name="status"      id="f-status"      value="${game.status||'ongoing'}" />
        <input type="hidden" name="save_type"   id="f-save-type"   value="save" />
        <div id="f-player-fields"></div>
      </form>

      <div id="lsc-data"
        data-home-team="${esc(game.home_name||'Home')}"
        data-away-team="${esc(game.away_name||'Away')}"
        data-home-color="${homeColor}"
        data-away-color="${awayColor}"
        style="display:none"></div>

      <script src="/js/livescore.js?v31"></script>
    `));
  } catch (err) { console.error('Live score error:', err); res.status(500).send('Server error'); }
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

    // Always recalculate W/L from scratch when status changes to final
    // This prevents double-counting if End Game is clicked multiple times
    if (isFinal) {
      await recalcStandings(req.params.id, db);
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
    doc.fillColor('#f97316').fontSize(22).font('Helvetica-Bold').text('HOOPSTATS Pilipinas',40,18);
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
      <script src="/js/admin.js?v31"></script>
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
      <h1>${player ? 'Edit Player' : 'Add Player'}</h1>
      <p style="color:#666;font-size:13px;margin-top:4px">
        ${player ? 'Update player information below.' : 'Add player to the roster. Stats will be calculated automatically from game entries.'}
      </p>
    </div></div>
    <div class="card" style="max-width:480px">
      <form action="/admin/league/${league.id}/${player?`edit-player/${player.id}`:'add-player'}" method="POST" enctype="multipart/form-data">
        <div class="field-group"><label>Full Name</label>
          <input name="name" class="input" placeholder="e.g. Juan dela Cruz" value="${v('name')}" required /></div>
        <div class="modal-grid">
          <div class="field-group"><label>Jersey #</label>
            <input name="jersey" type="number" class="input" placeholder="0" value="${v('jersey','')}" /></div>
          <div class="field-group"><label>Position</label>
            <select name="pos" class="input">
              <option value="">Select position</option>
              ${POSITIONS.map(p=>`<option ${v('pos')===p?'selected':''}>${p}</option>`).join('')}
            </select></div>
        </div>
        <div class="field-group"><label>Team</label>
          <select name="team_id" class="input">
            <option value="">Select team</option>
            ${teams.map(t=>`<option value="${t.id}" ${player?.team_id==t.id?'selected':''}>${esc(t.name)}</option>`).join('')}
          </select></div>
        <div style="display:flex;gap:10px;margin-top:24px">
          <a href="/admin/league/${league.id}" class="btn-ghost">Cancel</a>
          <button type="submit" class="btn-primary">${player?'Save Changes':'Add Player'} →</button>
        </div>
      </form>
    </div>
    ${!player ? `
    <div style="max-width:480px;margin-top:16px;padding:14px 18px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;font-size:12px;color:#555;line-height:1.8">
      💡 <b style="color:#888">Stats are auto-calculated</b> from game entries.<br>
      Use <b style="color:#888">📋 Post-Game Stats</b> in the Games tab to enter box scores after each game.<br>
      Use <b style="color:#888">🔴 Live Score</b> to record stats in real time during a game.
    </div>` : ''}`;
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
  <div class="topnav-inner">
    <div class="nav-brand"><a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px"><img src="/icons/icon-192.png?v=4" alt="HoopStats Pilipinas" style="width:38px;height:38px;border-radius:8px;object-fit:contain;display:block;flex-shrink:0"><div class="nav-brand-text"><div class="brand-text">HOOPSTATS</div><div class="brand-sub">Pilipinas</div></div></a></div>
    <div style="flex:1"></div>
    <div class="nav-actions">
      <span style="font-size:13px;color:rgba(255,255,255,.4);font-weight:600">${esc(user.name)}</span>
      <a href="/logout" class="btn-ghost-sm">Logout</a>
    </div>
  </div>
</nav>
<div class="admin-wrap">${content}</div>
<script src="/js/admin.js?v31"></script>
</body>
</html>`;
}

// ── RECALC STANDINGS ──────────────────────────────────────────────────────────
async function recalcStandings(leagueId, dbRef) {
  // Step 1: Reset all teams to 0-0
  await dbRef.run(
    'UPDATE teams SET wins=0, losses=0 WHERE league_id=$1',
    [leagueId]
  );
  // Step 2: Get all FINAL games
  const finalGames = await dbRef.query(
    `SELECT * FROM games WHERE league_id=$1 AND status='final'`,
    [leagueId]
  );
  // Step 3: Tally W/L from actual scores
  for (const g of finalGames) {
    const h = Number(g.home_score);
    const a = Number(g.away_score);
    if (h === a) continue;
    if (h > a) {
      if (g.home_team_id) await dbRef.run('UPDATE teams SET wins=wins+1   WHERE id=$1', [g.home_team_id]);
      if (g.away_team_id) await dbRef.run('UPDATE teams SET losses=losses+1 WHERE id=$1', [g.away_team_id]);
    } else {
      if (g.away_team_id) await dbRef.run('UPDATE teams SET wins=wins+1   WHERE id=$1', [g.away_team_id]);
      if (g.home_team_id) await dbRef.run('UPDATE teams SET losses=losses+1 WHERE id=$1', [g.home_team_id]);
    }
  }
  console.log(`✅ Standings recalculated for league ${leagueId} — ${finalGames.length} final games processed`);
}

// ── DOWNLOAD STATS TEMPLATE ───────────────────────────────────────────────────
router.get('/league/:id/import-stats/template', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const players = await db.query(
      'SELECT name FROM players WHERE league_id=$1 ORDER BY name', [req.params.id]
    );
    const buf = generateTemplate(players);
    res.setHeader('Content-Disposition', 'attachment; filename="hoopstats-template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) { console.error(err); res.redirect('/admin'); }
});

// ── GET IMPORT STATS PAGE ─────────────────────────────────────────────────────
router.get('/league/:id/import-stats/:gid', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const [league, game, players] = await Promise.all([
      db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]),
      db.queryOne(
        `SELECT g.*, ht.name as home_name, at.name as away_name
         FROM games g
         LEFT JOIN teams ht ON g.home_team_id=ht.id
         LEFT JOIN teams at ON g.away_team_id=at.id
         WHERE g.id=$1`, [req.params.gid]
      ),
      db.query('SELECT * FROM players WHERE league_id=$1 ORDER BY name', [req.params.id]),
    ]);
    if (!league || !game) return res.redirect('/admin');

    const user = req.user;
    res.send(adminPage('Import Stats | ' + esc(league.name), user, `
      <div class="admin-header"><div>
        <a href="/admin/league/${league.id}" class="back-link">← Back</a>
        <h1>📤 Import Stats from Spreadsheet</h1>
        <p style="color:var(--muted);font-size:13px;margin-top:4px">
          ${esc(game.home_name||'TBD')} vs ${esc(game.away_name||'TBD')}
          ${game.date ? '· ' + esc(game.date) : ''}
        </p>
      </div></div>

      <!-- STEP 1: DOWNLOAD TEMPLATE -->
      <div class="card" style="max-width:600px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
          <div style="width:36px;height:36px;border-radius:50%;background:rgba(0,212,170,.15);border:1px solid rgba(0,212,170,.3);display:flex;align-items:center;justify-content:center;font-weight:900;color:var(--teal);font-size:16px;flex-shrink:0">1</div>
          <div>
            <div style="font-weight:700;font-size:15px">Download the Template</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">Pre-filled with all players in this league</div>
          </div>
        </div>
        <a href="/admin/league/${league.id}/import-stats/template"
           class="btn-primary" style="display:inline-flex;align-items:center;gap:8px">
          📥 Download Template (.xlsx)
        </a>
        <div style="margin-top:12px;padding:12px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;font-size:12px;color:var(--muted);line-height:1.8">
          <strong style="color:var(--text)">Template columns:</strong><br>
          Name · FG2M · FG2A · FG3M · FG3A · FTM · FTA · OREB · DREB · AST · STL · BLK · TO · Foul<br><br>
          <strong style="color:var(--text)">Tips:</strong><br>
          • Player names must match exactly (case-insensitive)<br>
          • Leave cells blank or 0 for stats not recorded<br>
          • CSV and Excel (.xlsx/.xls) are both accepted
        </div>
      </div>

      <!-- STEP 2: UPLOAD -->
      <div class="card" style="max-width:600px">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
          <div style="width:36px;height:36px;border-radius:50%;background:rgba(230,51,41,.15);border:1px solid rgba(230,51,41,.3);display:flex;align-items:center;justify-content:center;font-weight:900;color:var(--red);font-size:16px;flex-shrink:0">2</div>
          <div>
            <div style="font-weight:700;font-size:15px">Upload Filled Spreadsheet</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">Accepts .xlsx, .xls, or .csv · Max 5MB</div>
          </div>
        </div>
        <form action="/admin/league/${league.id}/import-stats/${game.id}" method="POST" enctype="multipart/form-data">
          <div class="field-group">
            <label>Select File</label>
            <input name="statsFile" type="file" class="input"
                   accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                   required style="padding:10px" />
          </div>
          <div style="display:flex;gap:10px;margin-top:20px">
            <a href="/admin/league/${league.id}" class="btn-ghost">Cancel</a>
            <button type="submit" class="btn-primary">📤 Import Stats →</button>
          </div>
        </form>
      </div>

      <!-- PLAYER LIST REFERENCE -->
      <div class="card" style="max-width:600px;margin-top:16px">
        <div style="font-weight:700;margin-bottom:10px;font-size:14px">👥 Players in this league (${players.length})</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${players.map(p => `
          <span style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:4px 10px;font-size:12px;font-weight:600">
            ${esc(p.name)}
          </span>`).join('')}
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--muted)">
          ⚠️ Names in spreadsheet must match exactly (spelling counts, case doesn't)
        </div>
      </div>
    `));
  } catch (err) { console.error(err); res.redirect('/admin'); }
});

// ── POST IMPORT STATS ─────────────────────────────────────────────────────────
router.post('/league/:id/import-stats/:gid', (req, res) => {
  uploadSheet(req, res, async (err) => {
    try {
      if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');

      if (err) {
        return res.send(adminPage('Import Error', req.user, `
          <div class="admin-header"><div>
            <a href="/admin/league/${req.params.id}/import-stats/${req.params.gid}" class="back-link">← Back</a>
            <h1>Import Error</h1>
          </div></div>
          <div class="card" style="max-width:600px">
            <div class="alert-error">❌ ${esc(err.message)}</div>
            <a href="/admin/league/${req.params.id}/import-stats/${req.params.gid}" class="btn-primary" style="margin-top:16px;display:inline-block">Try Again</a>
          </div>
        `));
      }

      if (!req.file) return res.redirect(`/admin/league/${req.params.id}/import-stats/${req.params.gid}`);

      const result = await importGameStats(req.file.buffer, {
        leagueId: req.params.id,
        gameId:   req.params.gid,
        db
      });

      // Recalculate season averages for imported players
      if (result.imported.length > 0) {
        const { computeSeasonAverages } = require('../fiba-stats');
        const leaguePlayers = await db.query(
          'SELECT * FROM players WHERE league_id=$1', [req.params.id]
        );
        for (const p of leaguePlayers) {
          const allGames = await db.query(
            'SELECT * FROM game_stats WHERE player_id=$1 AND league_id=$2', [p.id, req.params.id]
          );
          if (!allGames.length) continue;
          const season = computeSeasonAverages(allGames);
          if (!season) continue;
          const av = season.averages;
          await db.run(
            `INSERT INTO player_season_stats
               (player_id,league_id,gp,pts,reb,oreb,dreb,ast,stl,blk,to_val,foul,
                fg2m,fg2a,fg3m,fg3a,fgm,fga,ftm,fta,fgp,fg2p,fg3p,ftp,eff)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
             ON CONFLICT (player_id,league_id) DO UPDATE SET
               gp=$3,pts=$4,reb=$5,oreb=$6,dreb=$7,ast=$8,stl=$9,blk=$10,to_val=$11,foul=$12,
               fg2m=$13,fg2a=$14,fg3m=$15,fg3a=$16,fgm=$17,fga=$18,ftm=$19,fta=$20,
               fgp=$21,fg2p=$22,fg3p=$23,ftp=$24,eff=$25`,
            [p.id, req.params.id, season.gp,
             av.pts,av.reb,av.oreb,av.dreb,av.ast,av.stl,av.blk,av.to,av.foul,
             season.totals.fg2m,season.totals.fg2a,season.totals.fg3m,season.totals.fg3a,
             season.totals.fgm,season.totals.fga,season.totals.ftm,season.totals.fta,
             av.fgp,av.fg2p,av.fg3p,av.ftp,av.eff]
          );
          await db.run('UPDATE players SET gp=$1,pts=$2,reb=$3,ast=$4,stl=$5,blk=$6,fg=$7 WHERE id=$8',
            [season.gp, av.pts, av.reb, av.ast, av.stl, av.blk, av.fgp, p.id]);
        }
        // Recalc standings
        await recalcStandings(req.params.id, db);
      }

      const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);

      res.send(adminPage('Import Results | ' + esc(league.name), req.user, `
        <div class="admin-header"><div>
          <a href="/admin/league/${league.id}" class="back-link">← Back to League</a>
          <h1>📊 Import Results</h1>
        </div></div>
        <div class="card" style="max-width:640px">

          <!-- SUMMARY STRIP -->
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
            <div style="background:rgba(0,212,170,.08);border:1px solid rgba(0,212,170,.2);border-radius:10px;padding:16px;text-align:center">
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:40px;font-weight:900;color:#00d4aa;line-height:1">${result.imported.length}</div>
              <div style="font-size:10px;color:#00d4aa;font-weight:800;letter-spacing:1.5px;margin-top:6px">IMPORTED</div>
            </div>
            <div style="background:rgba(247,201,72,.06);border:1px solid rgba(247,201,72,.18);border-radius:10px;padding:16px;text-align:center">
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:40px;font-weight:900;color:#f7c948;line-height:1">${result.skipped.length}</div>
              <div style="font-size:10px;color:#f7c948;font-weight:800;letter-spacing:1.5px;margin-top:6px">SKIPPED</div>
            </div>
            <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:16px;text-align:center">
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:40px;font-weight:900;color:rgba(255,255,255,.4);line-height:1">${result.total}</div>
              <div style="font-size:10px;color:rgba(255,255,255,.4);font-weight:800;letter-spacing:1.5px;margin-top:6px">TOTAL ROWS</div>
            </div>
          </div>

          <!-- IMPORTED PLAYERS -->
          ${result.imported.length > 0 ? `
          <div style="margin-bottom:18px">
            <div style="font-size:11px;font-weight:800;color:#00d4aa;letter-spacing:1.5px;margin-bottom:10px;display:flex;align-items:center;gap:6px">
              ✅ SUCCESSFULLY IMPORTED
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${result.imported.map(n => `<span style="background:rgba(0,212,170,.08);border:1px solid rgba(0,212,170,.18);border-radius:5px;padding:4px 10px;font-size:12px;font-weight:600;color:#00d4aa">${esc(n)}</span>`).join('')}
            </div>
          </div>` : ''}

          <!-- SKIPPED PLAYERS -->
          ${result.skipped.length > 0 ? `
          <div style="margin-bottom:18px">
            <div style="font-size:11px;font-weight:800;color:#f7c948;letter-spacing:1.5px;margin-bottom:10px">
              ⚠️ SKIPPED — Name not found in league roster
            </div>
            <div style="background:rgba(247,201,72,.04);border:1px solid rgba(247,201,72,.12);border-radius:8px;padding:12px 14px">
              ${result.skipped.map(n => `<div style="font-size:12px;color:rgba(255,255,255,.5);padding:3px 0">• ${esc(n)}</div>`).join('')}
            </div>
            <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:8px">
              💡 Check player name spelling in the spreadsheet matches the roster exactly.
            </div>
          </div>` : ''}

          <!-- ERRORS -->
          ${result.errors.length > 0 ? `
          <div style="margin-bottom:18px">
            <div style="font-size:11px;font-weight:800;color:#f87171;letter-spacing:1.5px;margin-bottom:10px">❌ ERRORS</div>
            <div style="background:rgba(239,68,68,.05);border:1px solid rgba(239,68,68,.15);border-radius:8px;padding:12px 14px">
              ${result.errors.map(e => `<div style="font-size:12px;color:#f87171;padding:3px 0">• ${esc(e)}</div>`).join('')}
            </div>
          </div>` : ''}

          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
            <a href="/admin/league/${league.id}" class="btn-primary">← Back to League</a>
            <a href="/admin/league/${league.id}/import-stats/${req.params.gid}" class="btn-ghost">Import Another File</a>
          </div>
        </div>
      `));
    } catch (err) {
      console.error('Import error:', err);
      res.redirect('/admin/league/' + req.params.id);
    }
  });
});

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
          <div class="field-group">
            <label>Date &amp; Time</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div>
                <input name="game_date" type="date" class="input"
                       style="color-scheme:dark;cursor:pointer"
                       id="editGameDatePicker" />
                <div style="font-size:11px;color:var(--muted);margin-top:3px">Date</div>
              </div>
              <div>
                <input name="game_time" type="time" class="input"
                       style="color-scheme:dark;cursor:pointer"
                       id="editGameTimePicker" value="09:00" />
                <div style="font-size:11px;color:var(--muted);margin-top:3px">Time</div>
              </div>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:6px">
              Current: <span style="color:var(--text)">${esc(game.date||'Not set')}</span>
            </div>
            <input name="date" type="hidden" id="editGameDate" value="${esc(game.date||'')}" />
          </div>
          <!-- date picker wired in admin.js -->
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
    // Always recalc standings after any game edit - score or status may have changed
    await recalcStandings(req.params.id, db);
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

    // Recalc standings in case game is final
    await recalcStandings(req.params.id, db);
    res.redirect(`/admin/league/${req.params.id}?tab=games&saved=1`);
  } catch (err) {
    console.error('Post-game stats error:', err);
    res.redirect(`/admin/league/${req.params.id}`);
  }
});

// ── RECALCULATE ALL STANDINGS (manual fix route) ──────────────────────────────
router.get('/league/:id/recalc-standings', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    await recalcStandings(req.params.id, db);
    res.redirect(`/admin/league/${req.params.id}?recalc=1`);
  } catch (err) { console.error(err); res.redirect(`/admin/league/${req.params.id}`); }
});
