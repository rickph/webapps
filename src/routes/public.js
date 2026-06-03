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

    // Whitelist allowed sort columns → map to player_season_stats column
    const colMap = {
      pts:'pss.pts', reb:'pss.reb', ast:'pss.ast', stl:'pss.stl',
      blk:'pss.blk', gp:'pss.gp',  fg:'pss.fgp',  name:'p.name',
      fg3p:'pss.fg3p', ftp:'pss.ftp', eff:'pss.eff', to:'pss.to_val',
    };
    const col = colMap[sortCol] || 'pss.pts';
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';

    const [teams, players, games, seasonStatsRows] = await Promise.all([
      db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC, losses ASC', [league.id]),
      db.query(`SELECT p.*,t.name as team_name,t.color as team_color
                FROM players p
                LEFT JOIN teams t ON p.team_id=t.id
                LEFT JOIN player_season_stats pss ON pss.player_id=p.id AND pss.league_id=p.league_id
                WHERE p.league_id=$1
                ORDER BY COALESCE(${col},0) ${dir}, p.name ASC`, [league.id]),
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

  return page('HoopStats — Philippines Basketball Stats', `
    <nav class="topnav">
      <div class="nav-brand"><a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px"><img src="/icons/icon-192.png?v=4" alt="HoopStats" style="width:40px;height:40px;border-radius:10px;object-fit:cover;display:block;flex-shrink:0"><div class="nav-brand-text"><div class="brand-text">HOOPSTATS</div><div class="brand-sub">Pilipinas</div></div></a></div>
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
  const ptsLeader = players[0];
  const rebLeader = sorted.reb[0];
  const astLeader = sorted.ast[0];
  const stlLeader = sorted.stl[0];

  return page(`${esc(league.name)} | HoopStats`, `
    <nav class="topnav">
      <div class="nav-brand"><a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px"><img src="/icons/icon-192.png?v=4" alt="HoopStats" style="width:40px;height:40px;border-radius:10px;object-fit:cover;display:block;flex-shrink:0"><div class="nav-brand-text"><div class="brand-text">HOOPSTATS</div><div class="brand-sub">Pilipinas</div></div></a></div>
      <div class="nav-actions">
        <a href="/" class="btn-ghost-sm">← Leagues</a>
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
               >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              Facebook
            </a>` : ''}
          ${league.instagram_url ? `
            <a href="${esc(league.instagram_url)}" target="_blank" rel="noopener"
               style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:rgba(225,48,108,.1);border:1px solid rgba(225,48,108,.3);border-radius:7px;color:#e1306c;font-size:13px;font-weight:700;text-decoration:none;transition:background .15s"
               >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
              Instagram
            </a>` : ''}
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://' + req.hostname + '/league/' + league.id)}" target="_blank" rel="noopener"
             style="display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:rgba(240,244,255,.06);border:1px solid rgba(240,244,255,.12);border-radius:7px;color:var(--muted);font-size:13px;font-weight:700;text-decoration:none;transition:background .15s"
             >
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
        {label:'PTS', val:ptsLeader?.pts, name:ptsLeader?.name, id:ptsLeader?.id, c:'#ff6b35'},
        {label:'REB', val:rebLeader?.reb, name:rebLeader?.name, id:rebLeader?.id, c:'#00d4aa'},
        {label:'AST', val:astLeader?.ast, name:astLeader?.name, id:astLeader?.id, c:'#a78bfa'},
        {label:'STL', val:stlLeader?.stl, name:stlLeader?.name, id:stlLeader?.id, c:'#f7c948'},
      ].map(s=>`
        <div class="leader-card">
          <div class="leader-label">${s.label} LEADER</div>
          <div class="leader-val" style="color:${s.c}">${s.val ?? '—'}</div>
          ${s.id
            ? `<a href="/league/${league.id}/player/${s.id}" class="leader-name leader-link">${esc(s.name ?? 'N/A')}</a>`
            : `<div class="leader-name">${esc(s.name ?? 'N/A')}</div>`
          }
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
                <td><div class="team-name-cell"><div class="team-dot" style="background:${t.color}"></div><a href="/league/${league.id}/team/${t.id}" class="team-link">${esc(t.name)}</a></div></td>
                <td class="green">${t.wins}</td>
                <td class="red">${t.losses}</td>
                <td style="color:var(--gold);font-weight:700">${((t.wins/(t.wins+t.losses||1))*100).toFixed(1)}%</td>
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
            ${sortTh('to',  'TO',  'Turnovers Per Game',  sort, league)}
            ${sortTh('fg',  'FG%', 'Field Goal %',         sort, league)}
            ${sortTh('fg3p','3P%', '3-Point %',            sort, league)}
            ${sortTh('ftp', 'FT%', 'Free Throw %',         sort, league)}
            ${sortTh('eff', 'EFF', 'FIBA Efficiency',      sort, league)}
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
                '<td><a href="/league/' + league.id + '/player/' + p.id + '" style="color:inherit;text-decoration:none"><div style="font-weight:700;transition:color .15s" class="player-name-link">' + esc(p.name) + '</div><div class="sub-text">' + esc(p.team_name||'') + '</div></a></td>' +
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
  res.send(page('Install App | HoopStats', `
    <nav class="topnav">
      <div class="nav-brand">
        <a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px">
          <img src="/icons/icon-192.png?v=4" alt="HoopStats" style="width:40px;height:40px;border-radius:10px;object-fit:cover;display:block;flex-shrink:0">
          <div class="nav-brand-text">
            <div class="brand-text">HOOPSTATS</div>
            <div class="brand-sub">Pilipinas</div>
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
        <img src="/icons/icon-192.png?v=4" alt="HoopStats"
             style="width:96px;height:96px;border-radius:22px;object-fit:cover;
                    box-shadow:0 8px 32px rgba(230,51,41,.4);
                    border:2px solid rgba(245,200,66,.3);margin-bottom:20px">
        <h1 style="font-family:'Russo One',sans-serif;font-size:28px;margin-bottom:8px">
          Install HoopStats
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
            ['1', 'Open HoopStats in <b>Chrome</b> on your Android phone'],
            ['2', 'Tap the <b>⋮ menu</b> (three dots) at the top right corner'],
            ['3', 'Tap <b>"Add to Home Screen"</b> from the menu'],
            ['4', 'Tap <b>"Add"</b> on the confirmation popup'],
            ['5', '🎉 The <b>HoopStats icon</b> appears on your home screen!'],
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
            ['1', 'Open HoopStats in <b>Safari</b> on your iPhone or iPad'],
            ['2', 'Tap the <b>Share button</b> (□ with an arrow pointing up) at the bottom of the screen'],
            ['3', 'Scroll down and tap <b>"Add to Home Screen"</b>'],
            ['4', 'Tap <b>"Add"</b> in the top right corner'],
            ['5', '🎉 The <b>HoopStats icon</b> appears on your home screen!'],
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
            ['1', 'Open HoopStats in <b>Chrome</b> or <b>Edge</b> on your computer'],
            ['2', 'Look for the <b>install icon</b> (⊕) in the address bar on the right side'],
            ['3', 'Click it and select <b>"Install"</b>'],
            ['4', '🎉 HoopStats opens like a <b>desktop app</b> with no browser chrome!'],
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

// ── TEAM PAGE ─────────────────────────────────────────────────────────────────
router.get('/league/:id/team/:tid', async (req, res) => {
  try {
    const { page } = require('../helpers');
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1 AND is_public=true', [req.params.id]);
    if (!league) return res.redirect('/');
    const team = await db.queryOne('SELECT * FROM teams WHERE id=$1 AND league_id=$2', [req.params.tid, req.params.id]);
    if (!team) return res.redirect('/league/' + req.params.id);

    // Server-side sort
    const allowed = { pts:'pss.pts', reb:'pss.reb', ast:'pss.ast', stl:'pss.stl',
      blk:'pss.blk', gp:'pss.gp', fgp:'pss.fgp', fg3p:'pss.fg3p',
      ftp:'pss.ftp', eff:'pss.eff', to:'pss.to_val' };
    const sk  = allowed[req.query.sort] ? req.query.sort : 'pts';
    const sc  = allowed[sk];
    const sd  = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const nsd = sd === 'DESC' ? 'asc' : 'desc';

    const players = await db.query(
      `SELECT p.*, pss.pts as s_pts, pss.reb as s_reb, pss.ast as s_ast,
              pss.stl as s_stl, pss.blk as s_blk, pss.to_val as s_to,
              pss.fgp as s_fgp, pss.fg3p as s_fg3p, pss.ftp as s_ftp,
              pss.eff as s_eff, pss.gp as s_gp
       FROM players p
       LEFT JOIN player_season_stats pss ON pss.player_id=p.id AND pss.league_id=$2
       WHERE p.team_id=$1
       ORDER BY COALESCE(${sc},0) ${sd}, p.name ASC`,
      [team.id, league.id]
    );

    const games = await db.query(
      `SELECT g.*, ht.name as home_name, at.name as away_name
       FROM games g
       LEFT JOIN teams ht ON g.home_team_id=ht.id
       LEFT JOIN teams at ON g.away_team_id=at.id
       WHERE g.league_id=$1 AND (g.home_team_id=$2 OR g.away_team_id=$2) AND g.status='final'
       ORDER BY g.id DESC`,
      [league.id, team.id]
    );

    const standings = await db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC', [league.id]);
    const rank = standings.findIndex(t => t.id == team.id) + 1;
    const gp   = team.wins + team.losses;
    const winPct = gp > 0 ? ((team.wins/gp)*100).toFixed(1) : '0.0';

    // Sort link helper
    function th(col, label, color) {
      const active  = sk === col;
      const dir     = active && sd === 'DESC' ? 'asc' : 'desc';
      const arrow   = active ? (sd === 'DESC' ? ' ↓' : ' ↑') : ' ↕';
      const c       = active ? 'var(--gold)' : color;
      return `<th style="cursor:pointer;white-space:nowrap;color:${c}">
        <a href="/league/${league.id}/team/${team.id}?sort=${col}&dir=${dir}"
           style="color:inherit;text-decoration:none;display:block">
          ${label}<span style="font-size:10px;opacity:.7;margin-left:2px">${arrow}</span>
        </a></th>`;
    }

    const baseUrl = '/league/' + league.id + '/team/' + team.id;

    res.send(page(esc(team.name) + ' | ' + esc(league.name), `
      <nav class="topnav">
        <div class="nav-brand">
          <a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:12px">
            <img src="/icons/icon-192.png?v=4" alt="HoopStats" style="width:40px;height:40px;border-radius:10px;object-fit:contain;display:block;flex-shrink:0">
            <div class="nav-brand-text">
              <div class="brand-text">HOOPSTATS</div>
              <div class="brand-sub">Pilipinas</div>
            </div>
          </a>
        </div>
        <div class="nav-actions">
          <a href="/league/${league.id}" class="btn-ghost-sm">← Back to League</a>
        </div>
      </nav>

      <div style="max-width:900px;margin:0 auto;padding:28px 20px 60px">

        <!-- TEAM HEADER -->
        <div style="background:var(--card);border:1px solid var(--border);border-left:5px solid ${team.color};border-radius:14px;padding:24px 28px;margin-bottom:28px;display:flex;align-items:center;gap:20px;flex-wrap:wrap">
          <div style="width:60px;height:60px;border-radius:14px;background:${team.color};display:flex;align-items:center;justify-content:center;font-family:'Russo One',sans-serif;font-size:22px;color:#fff;flex-shrink:0">
            ${esc(team.name.substring(0,2).toUpperCase())}
          </div>
          <div style="flex:1;min-width:140px">
            <div style="font-family:'Russo One',sans-serif;font-size:22px;margin-bottom:4px">${esc(team.name)}</div>
            <div style="font-size:12px;color:var(--muted)">${esc(league.name)} · ${esc(league.level)} · ${esc(league.season)}</div>
          </div>
          <div style="display:flex;gap:24px;flex-wrap:wrap">
            <div style="text-align:center">
              <div style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:1px;margin-bottom:4px">RANK</div>
              <div style="font-size:34px;font-weight:900;color:var(--gold)">#${rank}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:1px;margin-bottom:4px">RECORD</div>
              <div style="font-size:28px;font-weight:900"><span style="color:var(--teal)">${team.wins}W</span> <span style="color:var(--red)">${team.losses}L</span></div>
            </div>
            <div style="text-align:center">
              <div style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:1px;margin-bottom:4px">WIN%</div>
              <div style="font-size:28px;font-weight:900;color:var(--gold)">${winPct}%</div>
            </div>
          </div>
        </div>

        <!-- ROSTER -->
        <h2 style="font-family:'Russo One',sans-serif;font-size:18px;margin-bottom:10px">👤 Roster &amp; Stats</h2>
        ${players.length > 0 ? `
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px">💡 Click any column header to sort</div>
        <div style="overflow-x:auto;margin-bottom:28px">
        <table class="stats-table">
          <thead><tr>
            <th style="text-align:center">#</th>
            <th>Player</th>
            <th>POS</th>
            ${th('gp',  'GP',  'var(--muted)')}
            ${th('pts', 'PTS', 'var(--red)')}
            ${th('reb', 'REB', 'var(--text)')}
            ${th('ast', 'AST', 'var(--text)')}
            ${th('stl', 'STL', 'var(--text)')}
            ${th('blk', 'BLK', 'var(--text)')}
            ${th('to',  'TO',  'var(--red)')}
            ${th('fgp', 'FG%', 'var(--teal)')}
            ${th('fg3p','3P%', 'var(--purple)')}
            ${th('ftp', 'FT%', 'var(--gold)')}
            ${th('eff', 'EFF', 'var(--gold)')}
          </tr></thead>
          <tbody>
            ${players.map(p => `<tr>
              <td style="text-align:center;color:var(--muted);font-weight:700">#${esc(String(p.jersey||'—'))}</td>
              <td style="font-weight:700">${esc(p.name)}</td>
              <td style="text-align:center"><span class="pos-badge">${p.pos||'—'}</span></td>
              <td style="text-align:center;color:var(--muted)">${p.s_gp||p.gp||0}</td>
              <td style="text-align:center;color:var(--red);font-weight:800">${p.s_pts||p.pts||0}</td>
              <td style="text-align:center">${p.s_reb||p.reb||0}</td>
              <td style="text-align:center">${p.s_ast||p.ast||0}</td>
              <td style="text-align:center">${p.s_stl||p.stl||0}</td>
              <td style="text-align:center">${p.s_blk||p.blk||0}</td>
              <td style="text-align:center;color:var(--red)">${p.s_to!=null?p.s_to:'—'}</td>
              <td style="text-align:center;color:var(--teal);font-weight:700">${p.s_fgp!=null?p.s_fgp+'%':(p.fg||0)+'%'}</td>
              <td style="text-align:center;color:var(--purple)">${p.s_fg3p!=null?p.s_fg3p+'%':'—'}</td>
              <td style="text-align:center;color:var(--gold);font-weight:700">${p.s_ftp!=null?p.s_ftp+'%':'—'}</td>
              <td style="text-align:center;color:var(--gold);font-weight:700">${p.s_eff!=null?p.s_eff:'—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
        </div>` : `
        <div class="empty-state" style="margin-bottom:28px"><div class="es-icon">👤</div><div>No players yet.</div></div>`}

        <!-- GAME RESULTS -->
        <h2 style="font-family:'Russo One',sans-serif;font-size:18px;margin-bottom:14px">🏀 Game Results</h2>
        ${games.length > 0 ? `
        <div style="display:flex;flex-direction:column;gap:8px">
          ${games.map(g => {
            const isHome     = g.home_team_id == team.id;
            const oppName    = isHome ? esc(g.away_name||'TBD') : esc(g.home_name||'TBD');
            const myScore    = isHome ? g.home_score : g.away_score;
            const theirScore = isHome ? g.away_score : g.home_score;
            const won        = myScore > theirScore;
            return `<div style="background:var(--card);border:1px solid var(--border);border-left:4px solid ${won?'var(--teal)':'var(--red)'};border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
              <div style="font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;background:${won?'var(--teal-dim)':'var(--red-dim)'};color:${won?'var(--teal)':'var(--red)'};flex-shrink:0">${won?'WIN':'LOSS'}</div>
              <div style="flex:1">
                <div style="font-weight:700">${isHome?'vs':'@'} ${oppName}</div>
                <div style="font-size:12px;color:var(--muted);margin-top:2px">📍 ${esc(g.venue||'TBD')} · ${esc(g.date||'TBD')}</div>
              </div>
              <div style="font-size:22px;font-weight:900">
                <span style="color:${won?'var(--teal)':'var(--text)'}">${myScore}</span>
                <span style="color:var(--muted);font-size:13px;margin:0 6px">—</span>
                <span style="color:${!won?'var(--red)':'var(--muted)'}">${theirScore}</span>
              </div>
            </div>`;
          }).join('')}
        </div>` : `
        <div class="empty-state"><div class="es-icon">🏀</div><div>No completed games yet.</div></div>`}

      </div>
    `));
  } catch(err) { console.error('Team page error:', err); res.redirect('/'); }
});

// ── PLAYER PROFILE PAGE ───────────────────────────────────────────────────────
router.get('/league/:id/player/:pid', async (req, res) => {
  try {
    const { page } = require('../helpers');

    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1 AND is_public=true', [req.params.id]);
    if (!league) return res.redirect('/');

    const player = await db.queryOne(
      `SELECT p.*, t.name as team_name, t.color as team_color, t.id as tid
       FROM players p LEFT JOIN teams t ON p.team_id=t.id
       WHERE p.id=$1 AND p.league_id=$2`,
      [req.params.pid, req.params.id]
    );
    if (!player) return res.redirect('/league/' + req.params.id);

    // Season stats
    const ss = await db.queryOne(
      'SELECT * FROM player_season_stats WHERE player_id=$1 AND league_id=$2',
      [player.id, league.id]
    );

    // Game log
    const gamelog = await db.query(
      `SELECT gs.*, g.date, g.venue, g.home_score, g.away_score, g.status,
              ht.name as home_name, at.name as away_name
       FROM game_stats gs
       JOIN games g ON gs.game_id=g.id
       LEFT JOIN teams ht ON g.home_team_id=ht.id
       LEFT JOIN teams at ON g.away_team_id=at.id
       WHERE gs.player_id=$1 AND gs.league_id=$2
       ORDER BY g.id DESC`,
      [player.id, league.id]
    );

    const photoUrl = player.photo_url ? '/uploads/players/' + player.photo_url : null;
    const pts  = ss?.pts  ?? player.pts  ?? 0;
    const reb  = ss?.reb  ?? player.reb  ?? 0;
    const ast  = ss?.ast  ?? player.ast  ?? 0;
    const stl  = ss?.stl  ?? player.stl  ?? 0;
    const blk  = ss?.blk  ?? player.blk  ?? 0;
    const fgp  = ss?.fgp  ?? player.fg   ?? 0;
    const fg3p = ss?.fg3p ?? null;
    const ftp  = ss?.ftp  ?? null;
    const eff  = ss?.eff  ?? null;
    const gp   = ss?.gp   ?? player.gp   ?? 0;

    function statBox(label, value, color='var(--text)') {
      return `<div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:16px;text-align:center;flex:1;min-width:80px">
        <div style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:1px;margin-bottom:6px">${label}</div>
        <div style="font-size:28px;font-weight:900;color:${color};line-height:1">${value}</div>
      </div>`;
    }

    res.send(page(esc(player.name) + ' | ' + esc(league.name), `
      <nav class="topnav">
        <div class="nav-brand">
          <a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:12px">
            <img src="/icons/icon-192.png?v=4" alt="HoopStats"
                 style="width:40px;height:40px;border-radius:10px;object-fit:contain;display:block;flex-shrink:0">
            <div class="nav-brand-text">
              <div class="brand-text">HOOPSTATS</div>
              <div class="brand-sub">Pilipinas</div>
            </div>
          </a>
        </div>
        <div class="nav-actions">
          <a href="/league/${league.id}?tab=players" class="btn-ghost-sm">← Player Stats</a>
          <a href="/league/${league.id}" class="btn-ghost-sm">League</a>
        </div>
      </nav>

      <div style="max-width:780px;margin:0 auto;padding:28px 20px 60px">

        <!-- PLAYER CARD -->
        <div style="background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px;margin-bottom:24px;display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap">
          <!-- Photo -->
          <div style="flex-shrink:0">
            ${photoUrl
              ? `<img src="${photoUrl}" alt="${esc(player.name)}"
                   style="width:110px;height:110px;border-radius:50%;object-fit:cover;border:3px solid ${player.team_color||'var(--border)'};">`
              : `<div style="width:110px;height:110px;border-radius:50%;background:${player.team_color||'var(--card2)'};display:flex;align-items:center;justify-content:center;font-size:42px;font-family:'Russo One',sans-serif;color:#fff;border:3px solid ${player.team_color||'var(--border)'}">
                  ${esc(player.name.charAt(0).toUpperCase())}
                </div>`}
          </div>
          <!-- Info -->
          <div style="flex:1;min-width:180px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px">
              <span class="pos-badge" style="font-size:13px;padding:4px 10px">${player.pos||'—'}</span>
              <span style="font-size:22px;color:var(--muted);font-weight:700">#${player.jersey||'—'}</span>
            </div>
            <div style="font-family:'Russo One',sans-serif;font-size:28px;margin-bottom:6px;line-height:1.1">${esc(player.name)}</div>
            ${player.team_name ? `
            <a href="/league/${league.id}/team/${player.tid}"
               style="display:inline-flex;align-items:center;gap:6px;color:var(--muted);text-decoration:none;font-size:13px;margin-bottom:8px">
              <div style="width:10px;height:10px;border-radius:50%;background:${player.team_color||'#888'}"></div>
              ${esc(player.team_name)}
            </a>` : ''}
            <div style="font-size:12px;color:var(--muted)">${esc(league.name)} · ${esc(league.season)}</div>
            ${player.bio ? `<p style="font-size:13px;color:rgba(240,244,255,.7);margin-top:10px;line-height:1.7">${esc(player.bio)}</p>` : ''}
          </div>
        </div>

        <!-- KEY STATS -->
        <h2 style="font-family:'Russo One',sans-serif;font-size:17px;margin-bottom:12px;letter-spacing:.5px">📊 Season Averages</h2>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">
          ${statBox('PTS', pts, 'var(--red)')}
          ${statBox('REB', reb, 'var(--teal)')}
          ${statBox('AST', ast, 'var(--purple)')}
          ${statBox('STL', stl, 'var(--gold)')}
          ${statBox('BLK', blk, 'var(--text)')}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:28px">
          ${statBox('GP',  gp,  'var(--muted)')}
          ${statBox('FG%', fgp+'%', 'var(--teal)')}
          ${fg3p!=null ? statBox('3P%', fg3p+'%', 'var(--purple)') : ''}
          ${ftp!=null  ? statBox('FT%', ftp+'%',  'var(--gold)') : ''}
          ${eff!=null  ? statBox('EFF', eff,       'var(--gold)') : ''}
        </div>

        <!-- GAME LOG -->
        ${gamelog.length > 0 ? `
        <h2 style="font-family:'Russo One',sans-serif;font-size:17px;margin-bottom:12px;letter-spacing:.5px">📋 Game Log</h2>
        <div style="overflow-x:auto;margin-bottom:20px">
        <table class="stats-table">
          <thead><tr>
            <th>Game</th>
            <th style="text-align:center;color:var(--red)">PTS</th>
            <th style="text-align:center">REB</th>
            <th style="text-align:center">AST</th>
            <th style="text-align:center">STL</th>
            <th style="text-align:center">BLK</th>
            <th style="text-align:center">TO</th>
            <th style="text-align:center;color:var(--teal)">FG</th>
            <th style="text-align:center;color:var(--purple)">3PT</th>
            <th style="text-align:center;color:var(--gold)">FT</th>
          </tr></thead>
          <tbody>
            ${gamelog.map(g => {
              const { computeGameStats } = require('../fiba-stats');
              const c = computeGameStats(g);
              return `<tr>
                <td>
                  <div style="font-weight:600;font-size:13px">${esc(g.home_name||'?')} vs ${esc(g.away_name||'?')}</div>
                  <div style="font-size:11px;color:var(--muted)">${esc(g.date||'TBD')} · ${esc(g.venue||'')}</div>
                </td>
                <td style="text-align:center;color:var(--red);font-weight:800">${c.pts}</td>
                <td style="text-align:center">${c.reb}</td>
                <td style="text-align:center">${c.ast}</td>
                <td style="text-align:center">${c.stl}</td>
                <td style="text-align:center">${c.blk}</td>
                <td style="text-align:center;color:var(--red)">${c.to}</td>
                <td style="text-align:center;color:var(--teal);font-size:12px">${g.fg2m}/${g.fg2a}</td>
                <td style="text-align:center;color:var(--purple);font-size:12px">${g.fg3m}/${g.fg3a}</td>
                <td style="text-align:center;color:var(--gold);font-size:12px">${g.ftm}/${g.fta}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
        </div>` : `
        <div class="empty-state"><div class="es-icon">📋</div><div>No game stats recorded yet.</div></div>`}

      </div>
    `));
  } catch(err) { console.error('Player profile error:', err); res.redirect('/'); }
});
