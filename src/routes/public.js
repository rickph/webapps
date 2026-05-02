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

    // Server-side sort params
    const sortCol = req.query.sort || 'pts';
    const sortDir = req.query.dir  || 'desc';
    const tab     = req.query.tab  || 'standings';

    // Whitelist allowed sort columns to prevent SQL injection
    const allowed = ['pts','reb','ast','stl','blk','gp','fg','name'];
    const col = allowed.includes(sortCol) ? sortCol : 'pts';
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';

    const [teams, players, games, seasonStatsRows] = await Promise.all([
      db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC, losses ASC', [league.id]),
      db.query(`SELECT p.*,t.name as team_name,t.color as team_color
                FROM players p LEFT JOIN teams t ON p.team_id=t.id
                WHERE p.league_id=$1 ORDER BY p.${col} ${dir}`, [league.id]),
      db.query(`SELECT g.*,ht.name as home_name,at.name as away_name
                FROM games g
                LEFT JOIN teams ht ON g.home_team_id=ht.id
                LEFT JOIN teams at ON g.away_team_id=at.id
                WHERE g.league_id=$1 ORDER BY g.id DESC`, [league.id]),
      db.query('SELECT * FROM player_season_stats WHERE league_id=$1', [league.id]),
    ]);
    const seasonStats = {};
    seasonStatsRows.forEach(s => { seasonStats[s.player_id] = s; });
    res.send(renderLeaguePage(league, teams, players, games, req.user, seasonStats, { col, dir: sortDir, tab }));
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
      <div class="nav-brand"><a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px"><img src="/icons/icon-192.png?v=2" alt="PH Hoops" style="width:40px;height:40px;border-radius:10px;object-fit:cover;display:block;flex-shrink:0"><div class="nav-brand-text"><div class="brand-text">PH HOOPS</div><div class="brand-sub">League Manager</div></div></a></div>
      <div class="nav-actions">
        ${user
          ? `<a href="/admin" class="btn-nav">Admin Panel</a>`
          : `<a href="/login" class="btn-nav">Login</a><a href="/register" class="btn-primary-sm">Register Free</a>`}
      </div>
    </nav>
    <div class="hero">
      <div class="hero-inner">
        <img src="/icons/icon-192.png?v=2" alt="PH Hoops"
             style="width:90px;height:90px;border-radius:20px;object-fit:cover;
                    margin-bottom:20px;box-shadow:0 8px 32px rgba(230,51,41,.45);
                    border:2px solid rgba(245,200,66,.35)">
        <div class="hero-eyebrow">🇵🇭 Philippine Basketball</div>
        <h1 class="hero-title">Stats &amp; League<br><span class="accent">Management</span></h1>
        <p class="hero-sub">From sitio courts to provincial arenas — manage your league, track every stat, share results publicly.</p>
        <div class="hero-btns">
          <a href="/register" class="btn-hero-primary">Start Free →</a>
          <a href="#leagues" class="btn-hero-ghost">View Leagues</a>
          <a href="/install" class="btn-hero-ghost" style="border-color:rgba(245,200,66,.4);color:var(--gold)">
            📲 Install App
          </a>
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

function renderLeaguePage(league, teams, players, games, user, seasonStats = {}, sort = { col: "pts", dir: "desc", tab: "standings" }, req = {}) {
  const sorted = {
    reb: [...players].sort((a,b)=>b.reb-a.reb),
    ast: [...players].sort((a,b)=>b.ast-a.ast),
    stl: [...players].sort((a,b)=>b.stl-a.stl),
  };

  return page(`${esc(league.name)} | PH Hoops`, `
    <nav class="topnav">
      <div class="nav-brand"><a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px"><img src="/icons/icon-192.png?v=2" alt="PH Hoops" style="width:40px;height:40px;border-radius:10px;object-fit:cover;display:block;flex-shrink:0"><div class="nav-brand-text"><div class="brand-text">PH HOOPS</div><div class="brand-sub">League Manager</div></div></a></div>
      <div class="nav-actions">
        ${user ? `<a href="/admin" class="btn-nav">Admin Panel</a>` : `<a href="/login" class="btn-nav">Login</a>`}
      </div>
    </nav>
    <div class="league-header">
      <div class="lh-inner">
        <div class="lh-top">${levelBadge(league.level)} ${statusBadge(league.status)}</div>
        <h1>${esc(league.name)}</h1>
        <div class="lh-meta">📍 ${esc(league.location)} &nbsp;·&nbsp; ${esc(league.season)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          ${league.facebook_url ? `
            <a href="${esc(league.facebook_url)}" target="_blank" rel="noopener"
               style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:rgba(24,119,242,.12);border:1px solid rgba(24,119,242,.3);border-radius:7px;color:#4f8ef7;font-size:13px;font-weight:700;text-decoration:none;transition:background .15s"
               onmouseover="this.style.background='rgba(24,119,242,.22)'" onmouseout="this.style.background='rgba(24,119,242,.12)'">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              Facebook
            </a>` : ''}
          ${league.instagram_url ? `
            <a href="${esc(league.instagram_url)}" target="_blank" rel="noopener"
               style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:rgba(225,48,108,.1);border:1px solid rgba(225,48,108,.3);border-radius:7px;color:#e1306c;font-size:13px;font-weight:700;text-decoration:none;transition:background .15s"
               onmouseover="this.style.background='rgba(225,48,108,.2)'" onmouseout="this.style.background='rgba(225,48,108,.1)'">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
              Instagram
            </a>` : ''}
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://' + req.hostname + '/league/' + league.id)}" target="_blank" rel="noopener"
             style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:rgba(240,244,255,.06);border:1px solid rgba(240,244,255,.12);border-radius:7px;color:var(--muted);font-size:13px;font-weight:700;text-decoration:none;transition:background .15s"
             onmouseover="this.style.background='rgba(240,244,255,.12)'" onmouseout="this.style.background='rgba(240,244,255,.06)'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
            Share
          </a>
        </div>
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
        <div style="font-size:11px;color:#555;margin-bottom:8px;font-weight:600">
          💡 Click any column header to sort
        </div>
        <div style="overflow-x:auto">
        <table class="stats-table" id="playerStatsTable">
          <thead><tr>
            <th>#</th>
            <th>Player</th>
            <th>POS</th>
            ${sortTh('gp',  'GP',  'Games Played',     sort, league)}
            ${sortTh('pts', 'PTS', 'Points Per Game',   sort, league)}
            ${sortTh('reb', 'REB', 'Rebounds Per Game', sort, league)}
            ${sortTh('ast', 'AST', 'Assists Per Game',  sort, league)}
            ${sortTh('stl', 'STL', 'Steals Per Game',   sort, league)}
            ${sortTh('blk', 'BLK', 'Blocks Per Game',   sort, league)}
            <th title="Turnovers Per Game">TO</th>
            ${sortTh('fg',  'FG%', 'Field Goal % (FIBA: FGM/FGA)', sort, league)}
            <th title="3-Point %">3P%</th>
            <th title="Free Throw %">FT%</th>
            <th title="FIBA EFF = PTS+REB+AST+STL+BLK-(FGA-FGM)-(FTA-FTM)-TO">EFF</th>
          </tr></thead>
          <tbody id="playerTableBody">
            ${players.map((p,i) => {
              const ss   = seasonStats[p.id] || {};
              const fg3p = ss.fg3p != null ? ss.fg3p : '—';
              const ftp  = ss.ftp  != null ? ss.ftp  : '—';
              const eff  = ss.eff  != null ? ss.eff  : '—';
              const to   = ss.to_val != null ? ss.to_val : '—';
              const fgp  = p.fg != null ? p.fg : '—';
              return '<tr>' +
                '<td class="rank" data-val="' + (i+1) + '">' + (i+1) + '</td>' +
                '<td><div style="font-weight:600">' + esc(p.name) + '</div><div class="sub-text">' + esc(p.team_name||'') + '</div></td>' +
                '<td><span class="pos-badge">' + p.pos + '</span></td>' +
                '<td style="color:#888" data-val="' + (p.gp||0) + '">' + (p.gp||0) + '</td>' +
                '<td class="orange" data-val="' + (p.pts||0) + '">' + p.pts + '</td>' +
                '<td data-val="' + (p.reb||0) + '">' + p.reb + '</td>' +
                '<td data-val="' + (p.ast||0) + '">' + p.ast + '</td>' +
                '<td data-val="' + (p.stl||0) + '">' + p.stl + '</td>' +
                '<td data-val="' + (p.blk||0) + '">' + p.blk + '</td>' +
                '<td style="color:#ff4757" data-val="' + (to === '—' ? -1 : to) + '">' + to + '</td>' +
                '<td class="teal" data-val="' + (fgp === '—' ? -1 : fgp) + '">' + (fgp === '—' ? '—' : fgp + '%') + '</td>' +
                '<td style="color:#a78bfa" data-val="' + (fg3p === '—' ? -1 : fg3p) + '">' + (fg3p === '—' ? '—' : fg3p + '%') + '</td>' +
                '<td style="color:#f7c948" data-val="' + (ftp === '—' ? -1 : ftp) + '">' + (ftp === '—' ? '—' : ftp + '%') + '</td>' +
                '<td style="color:#ff6b35;font-weight:700" data-val="' + (eff === '—' ? -999 : eff) + '">' + eff + '</td>' +
                '</tr>';
            }).join('') || '<tr><td colspan="14" class="empty">No players yet.</td></tr>'}
          </tbody>
        </table>
        </div>
        <style>
          .sort-col { cursor:pointer; user-select:none; white-space:nowrap; }
          .sort-col:hover { color:#fff; background:rgba(255,107,53,.1); }
          .sort-col.sort-asc  { color:#ff6b35; }
          .sort-col.sort-desc { color:#ff6b35; }
          .sort-col.sort-asc  .sort-icon::after { content:'↑'; color:#ff6b35; }
          .sort-col.sort-desc .sort-icon::after { content:'↓'; color:#ff6b35; }
          .sort-icon { font-size:11px; opacity:.5; margin-left:2px; }
          .sort-col:hover .sort-icon { opacity:1; }
        </style>
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

// ── SORT HELPER ───────────────────────────────────────────────────────────────
function sortTh(col, label, title, sort, league) {
  const isActive = sort.col === col;
  const nextDir  = isActive && sort.dir === 'desc' ? 'asc' : 'desc';
  const icon     = isActive ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ' ↕';
  const style    = isActive ? 'color:#ff6b35;cursor:pointer;white-space:nowrap;user-select:none' : 'cursor:pointer;white-space:nowrap;user-select:none';
  return `<th title="${title}" style="${style}">
    <a href="/league/${league.id}?tab=players&sort=${col}&dir=${nextDir}"
       style="color:inherit;text-decoration:none;display:block">
      ${label}<span style="font-size:11px;margin-left:2px;opacity:.7">${icon}</span>
    </a>
  </th>`;
}

// ── INSTALL PAGE ──────────────────────────────────────────────────────────────
router.get('/install', (req, res) => {
  const { page } = require('../helpers');
  res.send(page('Install App | PH Hoops', `
    <nav class="topnav">
      <div class="nav-brand">
        <a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px">
          <img src="/icons/icon-192.png?v=2" alt="PH Hoops" style="width:40px;height:40px;border-radius:10px;object-fit:cover;display:block;flex-shrink:0">
          <div class="nav-brand-text">
            <div class="brand-text">PH HOOPS</div>
            <div class="brand-sub">League Manager</div>
          </div>
        </a>
      </div>
      <div class="nav-actions">
        <a href="/" class="btn-ghost-sm">← Back</a>
      </div>
    </nav>

    <div style="max-width:640px;margin:0 auto;padding:40px 20px 60px">

      <!-- HEADER -->
      <div style="text-align:center;margin-bottom:40px">
        <img src="/icons/icon-192.png?v=2" alt="PH Hoops"
             style="width:96px;height:96px;border-radius:22px;object-fit:cover;
                    box-shadow:0 8px 32px rgba(230,51,41,.4);
                    border:2px solid rgba(245,200,66,.3);margin-bottom:20px">
        <h1 style="font-family:'Russo One',sans-serif;font-size:28px;margin-bottom:8px">
          Install PH Hoops
        </h1>
        <p style="color:rgba(240,244,255,.55);font-size:15px">
          Add the app to your home screen for quick access — no App Store needed!
        </p>
      </div>

      <!-- ANDROID -->
      <div style="background:#0f1628;border:1px solid rgba(240,244,255,.09);border-left:4px solid #3ddc84;border-radius:12px;padding:24px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <div style="width:44px;height:44px;border-radius:10px;background:rgba(61,220,132,.12);border:1px solid rgba(61,220,132,.25);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🤖</div>
          <div>
            <div style="font-weight:800;font-size:16px">Android</div>
            <div style="font-size:12px;color:rgba(240,244,255,.45)">Chrome browser</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          ${[
            ['1', 'Open PH Hoops in <b>Chrome</b> on your Android phone'],
            ['2', 'Tap the <b>⋮ menu</b> (three dots) at the top right corner'],
            ['3', 'Tap <b>"Add to Home Screen"</b> from the menu'],
            ['4', 'Tap <b>"Add"</b> on the confirmation popup'],
            ['5', '🎉 The <b>PH Hoops icon</b> appears on your home screen!'],
          ].map(([num, text]) => `
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div style="width:28px;height:28px;border-radius:50%;background:rgba(61,220,132,.15);border:1px solid rgba(61,220,132,.3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#3ddc84;flex-shrink:0;margin-top:1px">${num}</div>
            <div style="font-size:14px;color:rgba(240,244,255,.8);line-height:1.6">${text}</div>
          </div>`).join('')}
        </div>
      </div>

      <!-- IPHONE -->
      <div style="background:#0f1628;border:1px solid rgba(240,244,255,.09);border-left:4px solid #007aff;border-radius:12px;padding:24px;margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <div style="width:44px;height:44px;border-radius:10px;background:rgba(0,122,255,.12);border:1px solid rgba(0,122,255,.25);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🍎</div>
          <div>
            <div style="font-weight:800;font-size:16px">iPhone / iPad</div>
            <div style="font-size:12px;color:rgba(240,244,255,.45)">Safari browser</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          ${[
            ['1', 'Open PH Hoops in <b>Safari</b> on your iPhone or iPad'],
            ['2', 'Tap the <b>Share button</b> (□ with an arrow pointing up) at the bottom of the screen'],
            ['3', 'Scroll down and tap <b>"Add to Home Screen"</b>'],
            ['4', 'Tap <b>"Add"</b> in the top right corner'],
            ['5', '🎉 The <b>PH Hoops icon</b> appears on your home screen!'],
          ].map(([num, text]) => `
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div style="width:28px;height:28px;border-radius:50%;background:rgba(0,122,255,.15);border:1px solid rgba(0,122,255,.3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#007aff;flex-shrink:0;margin-top:1px">${num}</div>
            <div style="font-size:14px;color:rgba(240,244,255,.8);line-height:1.6">${text}</div>
          </div>`).join('')}
        </div>
        <div style="margin-top:16px;padding:10px 14px;background:rgba(0,122,255,.08);border-radius:8px;font-size:12px;color:rgba(240,244,255,.5)">
          ⚠️ Must use <b style="color:rgba(240,244,255,.8)">Safari</b> — Chrome on iPhone does not support Add to Home Screen for PWAs.
        </div>
      </div>

      <!-- PC -->
      <div style="background:#0f1628;border:1px solid rgba(240,244,255,.09);border-left:4px solid #f5c842;border-radius:12px;padding:24px;margin-bottom:32px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <div style="width:44px;height:44px;border-radius:10px;background:rgba(245,200,66,.1);border:1px solid rgba(245,200,66,.25);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">💻</div>
          <div>
            <div style="font-weight:800;font-size:16px">Desktop / Laptop</div>
            <div style="font-size:12px;color:rgba(240,244,255,.45)">Chrome or Edge browser</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px">
          ${[
            ['1', 'Open PH Hoops in <b>Chrome</b> or <b>Edge</b> on your computer'],
            ['2', 'Look for the <b>install icon</b> (⊕) in the address bar on the right side'],
            ['3', 'Click it and select <b>"Install"</b>'],
            ['4', '🎉 PH Hoops opens like a <b>desktop app</b> with no browser chrome!'],
          ].map(([num, text]) => `
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div style="width:28px;height:28px;border-radius:50%;background:rgba(245,200,66,.12);border:1px solid rgba(245,200,66,.3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#f5c842;flex-shrink:0;margin-top:1px">${num}</div>
            <div style="font-size:14px;color:rgba(240,244,255,.8);line-height:1.6">${text}</div>
          </div>`).join('')}
        </div>
      </div>

      <!-- BACK BUTTON -->
      <div style="text-align:center">
        <a href="/" class="btn-hero-primary">← Back to Home</a>
      </div>

    </div>
  `));
});
