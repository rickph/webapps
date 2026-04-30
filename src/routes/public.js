const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { optionalAuth } = require('../middleware/auth');
const { esc, levelColor, levelBadge, statusBadge, page } = require('../helpers');

router.use(optionalAuth);

// ── LANDING PAGE ──────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const leagues = await db.query(
      `SELECT l.*,
        (SELECT COUNT(*) FROM teams   WHERE league_id=l.id) as team_count,
        (SELECT COUNT(*) FROM players WHERE league_id=l.id) as player_count,
        (SELECT COUNT(*) FROM games   WHERE league_id=l.id AND status='final') as game_count
       FROM leagues l WHERE l.is_public=true ORDER BY l.created_at DESC`
    );
    const [totals] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM leagues) as leagues,
        (SELECT COUNT(*) FROM teams)   as teams,
        (SELECT COUNT(*) FROM players) as players,
        (SELECT COUNT(*) FROM games WHERE status='final') as games
    `);
    res.send(renderLanding(leagues, totals, req.user));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

// ── PUBLIC LEAGUE PAGE ────────────────────────────────────────────────────────
router.get('/league/:id', async (req, res) => {
  try {
    const league = await db.queryOne(
      'SELECT * FROM leagues WHERE id=$1 AND is_public=true', [req.params.id]
    );
    if (!league) return res.status(404).send(notFound());

    const [teams, players, games] = await Promise.all([
      db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC, losses ASC', [league.id]),
      db.query(`SELECT p.*,t.name as team_name,t.color as team_color
                FROM players p LEFT JOIN teams t ON p.team_id=t.id
                WHERE p.league_id=$1 ORDER BY p.pts DESC`, [league.id]),
      db.query(`SELECT g.*,ht.name as home_name,at.name as away_name
                FROM games g
                LEFT JOIN teams ht ON g.home_team_id=ht.id
                LEFT JOIN teams at ON g.away_team_id=at.id
                WHERE g.league_id=$1 ORDER BY g.id DESC`, [league.id]),
    ]);
    res.send(renderLeaguePage(league, teams, players, games, req.user));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

// ── SCORER ACCESS ─────────────────────────────────────────────────────────────
router.post('/league/:id/access', async (req, res) => {
  try {
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
    if (!league) return res.status(404).send('Not found');
    if (req.body.code === league.admin_code) {
      if (!req.session.adminCodes) req.session.adminCodes = {};
      req.session.adminCodes[league.id] = league.admin_code;
      res.redirect(`/admin/league/${league.id}`);
    } else {
      res.redirect(`/league/${league.id}?error=badcode`);
    }
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

// ── RENDERERS ─────────────────────────────────────────────────────────────────
function renderLanding(leagues, stats, user) {
  const leagueCards = leagues.map(l => {
    const lc = levelColor(l.level);
    return `
    <a href="/league/${l.id}" class="league-card">
      <div class="lc-top">${levelBadge(l.level)} ${statusBadge(l.status)}</div>
      <div class="lc-name">${esc(l.name)}</div>
      <div class="lc-loc">📍 ${esc(l.location)} · ${esc(l.season)}</div>
      <div class="lc-stats">
        <div class="lcs"><span style="color:#ff6b35">${l.team_count}</span><small>Teams</small></div>
        <div class="lcs"><span style="color:#00d4aa">${l.game_count}</span><small>Games</small></div>
        <div class="lcs"><span style="color:#f7c948">${l.player_count}</span><small>Players</small></div>
      </div>
    </a>`;
  }).join('');

  return page('PH Hoops — Philippines Basketball Stats', `
    <nav class="topnav">
      <div class="nav-brand">🏀 <span class="brand-text">PH HOOPS</span></div>
      <div class="nav-actions">
        ${user
          ? `<a href="/admin" class="btn-nav">Admin Panel</a>`
          : `<a href="/login" class="btn-nav">Login</a><a href="/register" class="btn-primary-sm">Register Free</a>`}
      </div>
    </nav>
    <div class="hero">
      <div class="hero-inner">
        <div class="hero-eyebrow">🇵🇭 Philippine Basketball</div>
        <h1 class="hero-title">Stats &amp; League<br><span class="accent">Management</span></h1>
        <p class="hero-sub">From sitio courts to provincial arenas — manage your league, track every stat, share results publicly.</p>
        <div class="hero-btns">
          <a href="/register" class="btn-hero-primary">Start Free →</a>
          <a href="#leagues" class="btn-hero-ghost">View Leagues</a>
        </div>
        <div class="hero-stats">
          ${[['Leagues',stats.leagues,'#ff6b35'],['Teams',stats.teams,'#00d4aa'],['Players',stats.players,'#a78bfa'],['Games',stats.games,'#f7c948']]
            .map(([l,v,c])=>`<div class="hs"><span style="color:${c}">${v}</span><small>${l}</small></div>`).join('')}
        </div>
      </div>
    </div>
    <div class="section" id="leagues">
      <div class="section-inner">
        <div class="section-header">
          <h2>Active Leagues</h2>
          <div class="level-filters">
            ${['All','Barangay','City/Municipal','Provincial','Regional']
              .map(f=>`<button class="level-filter" data-level="${f}">${f}</button>`).join('')}
          </div>
        </div>
        <div class="league-grid" id="leagueGrid">
          ${leagueCards || '<div class="empty-state"><div class="es-icon">🏀</div><div>No public leagues yet.</div></div>'}
        </div>
      </div>
    </div>
    <script src="/js/public.js"></script>
  `);
}

function renderLeaguePage(league, teams, players, games, user) {
  const sorted = {
    reb: [...players].sort((a,b)=>b.reb-a.reb),
    ast: [...players].sort((a,b)=>b.ast-a.ast),
    stl: [...players].sort((a,b)=>b.stl-a.stl),
  };

  return page(`${esc(league.name)} | PH Hoops`, `
    <nav class="topnav">
      <div class="nav-brand"><a href="/" style="color:inherit;text-decoration:none">🏀 <span class="brand-text">PH HOOPS</span></a></div>
      <div class="nav-actions">
        ${user ? `<a href="/admin" class="btn-nav">Admin Panel</a>` : `<a href="/login" class="btn-nav">Login</a>`}
      </div>
    </nav>
    <div class="league-header">
      <div class="lh-inner">
        <div class="lh-top">${levelBadge(league.level)} ${statusBadge(league.status)}</div>
        <h1>${esc(league.name)}</h1>
        <div class="lh-meta">📍 ${esc(league.location)} &nbsp;·&nbsp; ${esc(league.season)}</div>
        ${!user ? `
        <details class="admin-access">
          <summary>🔐 Commissioner / Scorer Access</summary>
          <form action="/league/${league.id}/access" method="POST" style="display:flex;gap:8px;margin-top:10px">
            <input name="code" class="input-sm" placeholder="Enter admin code" />
            <button type="submit" class="btn-primary-sm">Enter</button>
          </form>
        </details>` : ''}
      </div>
    </div>

    <div class="pub-leaders">
      ${[
        {label:'PTS', val:players[0]?.pts,         name:players[0]?.name,         c:'#ff6b35'},
        {label:'REB', val:sorted.reb[0]?.reb,      name:sorted.reb[0]?.name,      c:'#00d4aa'},
        {label:'AST', val:sorted.ast[0]?.ast,      name:sorted.ast[0]?.name,      c:'#a78bfa'},
        {label:'STL', val:sorted.stl[0]?.stl,      name:sorted.stl[0]?.name,      c:'#f7c948'},
      ].map(s=>`
        <div class="leader-card">
          <div class="leader-label">${s.label} LEADER</div>
          <div class="leader-val" style="color:${s.c}">${s.val ?? '—'}</div>
          <div class="leader-name">${esc(s.name ?? 'N/A')}</div>
        </div>`).join('')}
    </div>

    <div class="pub-tabs"><div class="tabs-inner">
      <button class="ptab active" data-tab="standings">🏆 Standings</button>
      <button class="ptab" data-tab="players">👤 Player Stats</button>
      <button class="ptab" data-tab="schedule">📅 Schedule</button>
    </div></div>

    <div class="pub-content">
      <div id="tab-standings" class="tab-pane">
        <table class="stats-table">
          <thead><tr><th>#</th><th>Team</th><th>W</th><th>L</th><th>WIN%</th></tr></thead>
          <tbody>
            ${teams.map((t,i)=>`
              <tr>
                <td class="rank ${i<2?'rank-top':''}">${i+1}</td>
                <td><div class="team-name-cell"><div class="team-dot" style="background:${t.color}"></div>${esc(t.name)}</div></td>
                <td class="green">${t.wins}</td>
                <td class="red">${t.losses}</td>
                <td>${((t.wins/(t.wins+t.losses||1))*100).toFixed(1)}%</td>
              </tr>`).join('') || '<tr><td colspan="5" class="empty">No teams yet.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div id="tab-players" class="tab-pane hidden">
        <table class="stats-table">
          <thead><tr><th>#</th><th>Player</th><th>POS</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG%</th></tr></thead>
          <tbody>
            ${players.map((p,i)=>`
              <tr>
                <td class="rank">${i+1}</td>
                <td><div style="font-weight:600">${esc(p.name)}</div><div class="sub-text">${esc(p.team_name||'')}</div></td>
                <td><span class="pos-badge">${p.pos}</span></td>
                <td class="orange">${p.pts}</td><td>${p.reb}</td><td>${p.ast}</td>
                <td>${p.stl}</td><td>${p.blk}</td><td class="teal">${p.fg}%</td>
              </tr>`).join('') || '<tr><td colspan="9" class="empty">No players yet.</td></tr>'}
          </tbody>
        </table>
      </div>

      <div id="tab-schedule" class="tab-pane hidden">
        ${games.map(g=>`
          <div class="game-row">
            <div class="game-meta">
              <div class="game-date">${esc(g.date||'TBD')}</div>
              <div class="game-venue">📍 ${esc(g.venue||'TBD')}</div>
            </div>
            <div class="game-matchup">
              <span class="game-team">${esc(g.home_name||'TBD')}</span>
              ${g.status==='final'
                ? `<div class="score-final">
                    <span class="${g.home_score>=g.away_score?'score-win':'score-lose'}">${g.home_score}</span>
                    <span class="score-vs">FINAL</span>
                    <span class="${g.away_score>g.home_score?'score-win':'score-lose'}">${g.away_score}</span>
                   </div>`
                : '<span class="vs-badge">VS</span>'}
              <span class="game-team">${esc(g.away_name||'TBD')}</span>
            </div>
            ${statusBadge(g.status)}
          </div>`).join('') || '<div class="empty-state"><div class="es-icon">📅</div><div>No games scheduled.</div></div>'}
      </div>
    </div>

    <script src="/js/public.js"></script>
  `);
}

function notFound() {
  return page('Not Found', `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:16px;text-align:center">
      <div style="font-size:64px">🏀</div>
      <h1 style="font-family:'Russo One',sans-serif">Page Not Found</h1>
      <a href="/" style="color:#ff6b35">← Go Home</a>
    </div>`);
}

module.exports = router;
