const express = require('express');
const router  = express.Router();
const db      = require('../db/database');
const { optionalAuth } = require('../middleware/auth');
const { esc, levelColor, levelBadge, statusBadge, page } = require('../helpers');

router.use(optionalAuth);

// ── LANDING PAGE ──────────────────────────────────────────────────────────────
const LEADER_COLS = {
  pts: { col: 'pss.pts', label: 'PPG' },
  reb: { col: 'pss.reb', label: 'RPG' },
  ast: { col: 'pss.ast', label: 'APG' },
  stl: { col: 'pss.stl', label: 'SPG' },
  blk: { col: 'pss.blk', label: 'BPG' },
  eff: { col: 'pss.eff', label: 'EFF' },
};

router.get('/', async (req, res) => {
  try {
    const gameSelect = `
      SELECT g.*, ht.name as home_name, ht.color as home_color,
             at.name as away_name, at.color as away_color,
             l.name as league_name, l.id as league_id
      FROM games g
      JOIN leagues l ON g.league_id = l.id AND l.is_public = true
      LEFT JOIN teams ht ON g.home_team_id = ht.id
      LEFT JOIN teams at ON g.away_team_id = at.id`;

    const [
      leagues, [totals], liveGames, upcomingGames, recentResults, leaderRows,
    ] = await Promise.all([
      db.query(
        `SELECT l.*,
          (SELECT COUNT(*) FROM teams   WHERE league_id=l.id) as team_count,
          (SELECT COUNT(*) FROM players WHERE league_id=l.id) as player_count,
          (SELECT COUNT(*) FROM games   WHERE league_id=l.id AND status='final') as game_count
         FROM leagues l WHERE l.is_public=true ORDER BY l.created_at DESC`
      ),
      db.query(`
        SELECT
          (SELECT COUNT(*) FROM leagues) as leagues,
          (SELECT COUNT(*) FROM teams)   as teams,
          (SELECT COUNT(*) FROM players) as players,
          (SELECT COUNT(*) FROM games WHERE status='final') as games
      `),
      db.query(`${gameSelect} WHERE g.status='ongoing' ORDER BY g.id DESC LIMIT 6`),
      db.query(`${gameSelect} WHERE g.status='upcoming' ORDER BY g.id DESC LIMIT 6`),
      db.query(`${gameSelect} WHERE g.status='final' ORDER BY g.id DESC LIMIT 6`),
      Promise.all(Object.entries(LEADER_COLS).map(([key, { col }]) =>
        db.query(`
          SELECT p.name, p.pos, p.jersey, p.photo_url, t.name as team_name, t.color as team_color,
                 l.name as league_name, pss.${key} as value
          FROM player_season_stats pss
          JOIN players p ON p.id = pss.player_id
          JOIN leagues l ON l.id = pss.league_id AND l.is_public = true
          LEFT JOIN teams t ON p.team_id = t.id
          WHERE pss.gp > 0
          ORDER BY ${col} DESC NULLS LAST
          LIMIT 5
        `).then(rows => [key, rows])
      )),
    ]);

    const leaders = {};
    leaderRows.forEach(([key, rows]) => { leaders[key] = rows; });

    res.send(renderLanding({
      leagues, totals, liveGames, upcomingGames, recentResults, leaders, user: req.user,
    }));
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
      db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC, losses ASC, (pts_for - pts_against) DESC, pts_for DESC', [league.id]),
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
function renderLanding({ leagues, totals, liveGames, upcomingGames, recentResults, leaders, user }) {
  const initials = (name) => (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const teamBadge = (name, color) => `<span class="badge" style="background:${esc(color || '#5c6b93')}">${esc(initials(name))}</span>`;

  function gameCard(g, mode) {
    // mode: 'live' | 'upcoming' | 'final'
    const league = `<span class="gcard-league">${esc(g.league_name)}</span>`;
    if (mode === 'live') {
      const homeWin = (g.home_score || 0) >= (g.away_score || 0);
      return `<div class="gcard is-live">
        <div class="gcard-top"><span class="status-chip live"><span class="live-dot"></span>Live</span>${league}</div>
        <div class="team-row"><div class="team-id">${teamBadge(g.home_name, g.home_color)}<span class="team-name">${esc(g.home_name || 'TBD')}</span></div><span class="team-score ${homeWin ? 'win' : 'lose'} num">${g.home_score || 0}</span></div>
        <div class="team-row"><div class="team-id">${teamBadge(g.away_name, g.away_color)}<span class="team-name">${esc(g.away_name || 'TBD')}</span></div><span class="team-score ${!homeWin ? 'win' : 'lose'} num">${g.away_score || 0}</span></div>
        <div class="gcard-meta live">Q${g.quarter || 1}${g.venue ? ' · ' + esc(g.venue) : ''}</div>
        <a class="btn btn-accent" href="/league/${g.league_id}/game/${g.id}">Watch Live</a>
      </div>`;
    }
    if (mode === 'final') {
      const homeWin = (g.home_score || 0) > (g.away_score || 0);
      return `<div class="gcard">
        <div class="gcard-top"><span class="status-chip final">Final</span>${league}</div>
        <div class="team-row"><div class="team-id">${teamBadge(g.home_name, g.home_color)}<span class="team-name">${esc(g.home_name || 'TBD')}</span></div><span class="team-score ${homeWin ? 'win' : 'lose'} num">${g.home_score || 0}</span></div>
        <div class="team-row"><div class="team-id">${teamBadge(g.away_name, g.away_color)}<span class="team-name">${esc(g.away_name || 'TBD')}</span></div><span class="team-score ${!homeWin ? 'win' : 'lose'} num">${g.away_score || 0}</span></div>
        <a class="btn btn-ghost" href="/league/${g.league_id}/game/${g.id}">Box Score</a>
      </div>`;
    }
    return `<div class="gcard">
      <div class="gcard-top"><span class="status-chip upcoming">Upcoming</span>${league}</div>
      <div class="team-row"><div class="team-id">${teamBadge(g.home_name, g.home_color)}<span class="team-name">${esc(g.home_name || 'TBD')}</span></div></div>
      <div class="team-row"><div class="team-id">${teamBadge(g.away_name, g.away_color)}<span class="team-name">${esc(g.away_name || 'TBD')}</span></div></div>
      <div class="gcard-meta">${esc(g.date || 'Date TBD')}${g.venue ? ' · ' + esc(g.venue) : ''}</div>
      <a class="btn btn-ghost" href="/league/${g.league_id}">League Page</a>
    </div>`;
  }

  const emptyRail = (msg) => `<div class="empty">${msg}</div>`;

  const liveSection = liveGames.length
    ? `<div class="rail">${liveGames.map(g => gameCard(g, 'live')).join('')}</div>`
    : emptyRail(`<b>No games are live right now.</b>Check the upcoming schedule below, or browse a league's page directly.`);

  const upcomingSection = upcomingGames.length
    ? `<div class="rail">${upcomingGames.map(g => gameCard(g, 'upcoming')).join('')}</div>`
    : emptyRail(`<b>No games scheduled yet.</b>Commissioners can add games from their league dashboard.`);

  const resultsSection = recentResults.length
    ? `<div class="results">${recentResults.map(g => {
        const homeWin = (g.home_score || 0) > (g.away_score || 0);
        return `<div class="rrow">
          <span class="rleague">${esc(g.league_name)}</span>
          <div class="rteams">
            <div class="rt ${homeWin ? 'winner' : ''}"><b>${esc(g.home_name || 'TBD')}</b><b class="num">${g.home_score || 0}</b></div>
            <div class="rt ${!homeWin ? 'winner' : ''}"><span>${esc(g.away_name || 'TBD')}</span><span class="num">${g.away_score || 0}</span></div>
          </div>
          <a class="rlink" href="/league/${g.league_id}/game/${g.id}">Box Score ›</a>
        </div>`;
      }).join('')}</div>`
    : emptyRail(`<b>No results yet.</b>Final scores will show up here once games are completed.`);

  const leagueCards = leagues.length
    ? leagues.slice(0, 6).map(l => {
        const isOngoing = l.status === 'ongoing';
        return `<a class="lcard" href="/league/${l.id}">
          <div class="lcard-top">
            <div><span class="lmark">${esc(initials(l.name))}</span><h3>${esc(l.name)}</h3><div class="loc">${esc(l.level || '')}${l.location ? ' · ' + esc(l.location) : ''}</div></div>
            ${isOngoing ? `<span class="status-chip live"><span class="live-dot"></span>Live</span>` : ''}
          </div>
          <div class="lcard-stats">
            <div><b class="num">${l.team_count}</b><span>Teams</span></div>
            <div><b class="num">${esc(l.season || '—')}</b><span>Season</span></div>
            <div><b class="num">${l.game_count}</b><span>Games</span></div>
          </div>
        </a>`;
      }).join('')
    : `<div class="empty"><b>No public leagues yet.</b>Be the first commissioner to <a href="/register" style="color:var(--accent)">start a league</a>.</div>`;

  const LEADER_META = {
    pts: 'PPG', reb: 'RPG', ast: 'APG', stl: 'SPG', blk: 'BPG', eff: 'EFF',
  };
  const leaderPanels = Object.entries(LEADER_META).map(([key, label]) => {
    const rows = leaders[key] || [];
    const body = rows.length
      ? rows.map((p, i) => `<div class="lb-row">
          <span class="lb-rank num">${i + 1}</span>
          ${p.photo_url
            ? `<img class="lb-avatar" src="/uploads/players/${esc(p.photo_url)}" alt="">`
            : `<span class="lb-avatar" style="background:${esc(p.team_color || '#5c6b93')}">${esc(initials(p.name))}</span>`}
          <span class="lb-id"><b>${esc(p.name)}</b><span>${esc(p.team_name || '')}${p.league_name ? ' · ' + esc(p.league_name) : ''}</span></span>
          <span class="lb-val"><b class="num">${Number(p.value || 0).toFixed(1)}</b><span>${label}</span></span>
        </div>`).join('')
      : `<div class="empty"><b>No stats recorded yet for this category.</b>Leaders appear once commissioners log game stats.</div>`;
    return `<div class="lb-panel" data-panel="${key}" ${key === 'pts' ? '' : 'hidden'}>${body}</div>`;
  }).join('');

  const leaderTabs = Object.entries(LEADER_META).map(([key, label], i) =>
    `<button type="button" class="tab${i === 0 ? ' active' : ''}" data-cat="${key}">${label.slice(0, 3) === 'EFF' ? 'Efficiency' : { pts: 'Scoring', reb: 'Rebounding', ast: 'Assists', stl: 'Steals', blk: 'Blocks' }[key]}</button>`
  ).join('');

  const isLive = liveGames.length > 0;

  return page('HoopStats Pilipinas — The Digital Home of Philippine Grassroots Basketball', `
  <style>
    body{ background:var(--hs-bg); }
    #hs{
      --hs-bg:#f4f6fb; --hs-bg-2:#eaeef8;
      --hs-surface:#ffffff; --hs-surface-2:#f1f4fa; --hs-surface-3:#e4e9f5;
      --hs-border:rgba(13,30,90,.12); --hs-border-strong:rgba(13,30,90,.22);
      --hs-text:#0e1638; --hs-text-2:rgba(14,22,56,.70); --hs-text-3:rgba(14,22,56,.46); --hs-text-4:rgba(14,22,56,.28);
      --hs-accent:#ce1126; --hs-accent-strong:#a80e1f; --hs-accent-dim:rgba(206,17,38,.10); --hs-accent-border:rgba(206,17,38,.4);
      --hs-blue:#0d2e9c; --hs-blue-strong:#081f6e; --hs-rank2:#0d2e9c;
      --hs-live:#ce1126; --hs-live-dim:rgba(206,17,38,.14);
      --hs-win:#1f8a52;
      --hs-on-navy-text:#ffffff; --hs-on-navy-text-2:rgba(255,255,255,.76); --hs-on-navy-text-3:rgba(255,255,255,.52);
      --hs-on-navy-border:rgba(255,255,255,.18); --hs-on-navy-border-strong:rgba(255,255,255,.3);
      font-family:'Outfit',sans-serif; color:var(--hs-text); background:var(--hs-bg); font-size:15px; line-height:1.55;
    }
    /* Dark mode: header/hero/footer stay on-brand navy in both themes; only content
       surfaces (cards, tables, backgrounds) swap. See #hsThemeToggle for the switch. */
    @media (prefers-color-scheme:dark){
      html:not([data-theme="light"]) #hs{
        --hs-bg:#0a0e1a; --hs-bg-2:#0d1220;
        --hs-surface:#121a30; --hs-surface-2:#182142; --hs-surface-3:#1f2a52;
        --hs-border:rgba(255,255,255,.08); --hs-border-strong:rgba(255,255,255,.16);
        --hs-text:#eef1fb; --hs-text-2:rgba(238,241,251,.72); --hs-text-3:rgba(238,241,251,.48); --hs-text-4:rgba(238,241,251,.28);
        --hs-accent:#ff5670; --hs-accent-strong:#ff7c90; --hs-accent-dim:rgba(255,86,112,.16); --hs-accent-border:rgba(255,86,112,.4);
        --hs-rank2:#7c9bff; --hs-live:#ff5670; --hs-live-dim:rgba(255,86,112,.18);
        --hs-win:#3ddc8a;
      }
    }
    html[data-theme="dark"] #hs{
      --hs-bg:#0a0e1a; --hs-bg-2:#0d1220;
      --hs-surface:#121a30; --hs-surface-2:#182142; --hs-surface-3:#1f2a52;
      --hs-border:rgba(255,255,255,.08); --hs-border-strong:rgba(255,255,255,.16);
      --hs-text:#eef1fb; --hs-text-2:rgba(238,241,251,.72); --hs-text-3:rgba(238,241,251,.48); --hs-text-4:rgba(238,241,251,.28);
      --hs-accent:#ff5670; --hs-accent-strong:#ff7c90; --hs-accent-dim:rgba(255,86,112,.16); --hs-accent-border:rgba(255,86,112,.4);
      --hs-rank2:#7c9bff; --hs-live:#ff5670; --hs-live-dim:rgba(255,86,112,.18);
      --hs-win:#3ddc8a;
    }
    #hs *,#hs *::before,#hs *::after{ box-sizing:border-box; }
    #hs h1,#hs h2,#hs h3,#hs h4{ font-family:'Barlow Condensed',sans-serif; font-weight:900; text-transform:uppercase; letter-spacing:.3px; margin:0; }
    #hs a{ color:inherit; text-decoration:none; }
    #hs button{ font-family:'Outfit',sans-serif; cursor:pointer; }
    #hs .num{ font-variant-numeric:tabular-nums; }
    #hs .wrap{ max-width:1180px; margin:0 auto; padding:0 24px; }
    @media (max-width:640px){ #hs .wrap{ padding:0 16px; } }

    #hs header.hsite{ position:sticky; top:0; z-index:40; background:linear-gradient(180deg, var(--hs-blue), var(--hs-blue-strong)); border-bottom:1px solid var(--hs-on-navy-border); }
    #hs .hnav-row{ display:flex; align-items:center; justify-content:space-between; gap:20px; height:64px; }
    #hs .hbrand{ display:flex; align-items:center; gap:9px; font-family:'Barlow Condensed',sans-serif; font-weight:900; font-size:21px; color:var(--hs-on-navy-text); white-space:nowrap; }
    #hs .hbrand-mark{ width:52px; height:52px; flex:none; object-fit:contain; display:block; }
    #hs nav.hprimary{ display:flex; align-items:center; gap:2px; }
    #hs nav.hprimary a{ font-size:13px; font-weight:700; letter-spacing:.4px; text-transform:uppercase; color:var(--hs-on-navy-text-2); padding:9px 13px; border-radius:7px; }
    #hs nav.hprimary a:hover{ color:var(--hs-on-navy-text); background:rgba(255,255,255,.10); }
    #hs nav.hprimary a.live-link{ color:#ff5b6e; }
    #hs .live-dot{ width:6px; height:6px; border-radius:50%; background:var(--hs-live); display:inline-block; margin-right:6px; }
    #hs .hnav-actions{ display:flex; align-items:center; gap:10px; }
    #hs .btn{ font-weight:700; font-size:13px; letter-spacing:.4px; text-transform:uppercase; border-radius:7px; padding:10px 18px; border:1px solid transparent; white-space:nowrap; display:inline-block; }
    #hs .btn-accent{ background:var(--hs-accent); color:#fff; }
    #hs .btn-accent:hover{ background:#e2263c; }
    #hs .btn-ghost{ background:transparent; color:var(--hs-text); border-color:var(--hs-border-strong); }
    #hs .btn-ghost:hover{ background:var(--hs-surface-2); }
    #hs .btn-ghost-inverse{ background:transparent; color:var(--hs-on-navy-text); border-color:var(--hs-on-navy-border-strong); }
    #hs .btn-ghost-inverse:hover{ background:rgba(255,255,255,.10); }
    #hs .btn-on-accent{ background:#ffffff; color:var(--hs-accent-strong); }
    #hs .btn-sm{ padding:7px 14px; font-size:11.5px; }
    #hs .theme-toggle{ position:relative; width:44px; height:24px; flex:none; border-radius:99px; border:1px solid var(--hs-on-navy-border-strong); background:rgba(255,255,255,.10); padding:0; -webkit-appearance:none; appearance:none; cursor:pointer; }
    #hs .theme-toggle .knob{ position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#fff; display:flex; align-items:center; justify-content:center; transition:left .18s ease; color:var(--hs-blue-strong); }
    #hs .theme-toggle .knob svg{ width:12px; height:12px; }
    #hs .theme-toggle .i-moon{ display:none; }
    html[data-theme="dark"] #hs .theme-toggle .knob{ left:22px; }
    html[data-theme="dark"] #hs .theme-toggle .i-sun{ display:none; }
    html[data-theme="dark"] #hs .theme-toggle .i-moon{ display:block; }
    @media (prefers-color-scheme:dark){
      html:not([data-theme="light"]) #hs .theme-toggle .knob{ left:22px; }
      html:not([data-theme="light"]) #hs .theme-toggle .i-sun{ display:none; }
      html:not([data-theme="light"]) #hs .theme-toggle .i-moon{ display:block; }
    }
    #hs .hhamburger{ display:none; flex-direction:column; gap:4px; background:none; border:0; padding:6px; }
    #hs .hhamburger span{ width:20px; height:2px; background:var(--hs-on-navy-text); border-radius:2px; }
    #hs .hmobile-menu{ display:none; background:var(--hs-blue-strong); border-top:1px solid var(--hs-on-navy-border); }
    #hs .hmobile-menu.open{ display:block; }
    #hs .hmobile-menu a{ display:block; padding:14px 24px; font-size:13px; font-weight:700; letter-spacing:.6px; text-transform:uppercase; color:var(--hs-on-navy-text-2); border-top:1px solid rgba(255,255,255,.08); }
    #hs .hmobile-menu a:first-child{ border-top:none; }
    @media (max-width:1060px){
      #hs nav.hprimary{ display:none; }
      #hs .hnav-actions .btn-ghost-inverse{ display:none; }
      #hs .hhamburger{ display:flex; }
    }
    @media (max-width:540px){
      /* Logo mark + Sign In/Dashboard button + toggle + hamburger no longer
         fit alongside the full wordmark at phone widths; drop the text and
         keep just the mark so the header doesn't overflow the viewport. */
      #hs header.hsite .hbrand{ font-size:0; gap:0; }
      #hs .hnav-row{ gap:12px; }
      #hs .hnav-actions{ gap:6px; }
    }

    #hs .hero{ position:relative; overflow:hidden; padding:64px 0 56px;
      background: radial-gradient(120% 90% at 50% -10%, rgba(255,255,255,.10), transparent 60%),
                  radial-gradient(70% 55% at 88% 6%, rgba(206,17,38,.22), transparent 60%),
                  linear-gradient(160deg, var(--hs-blue), var(--hs-blue-strong)); }
    #hs .hero-inner{ text-align:center; display:flex; flex-direction:column; align-items:center; gap:20px; }
    #hs .eyebrow{ display:inline-flex; align-items:center; gap:7px; font-size:12px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase; color:var(--hs-on-navy-text); background:rgba(255,255,255,.12); border:1px solid var(--hs-on-navy-border-strong); padding:6px 14px; border-radius:99px; }
    #hs .hero h1{ font-size:clamp(36px,6.4vw,72px); line-height:.98; color:var(--hs-on-navy-text); }
    #hs .hero h1 .pop{ color:#ff4d63; }
    #hs .hero .tagline{ font-family:'Barlow Condensed',sans-serif; font-weight:700; font-size:15px; letter-spacing:2.6px; text-transform:uppercase; color:var(--hs-on-navy-text-2); margin:0; }
    #hs .hero p.lead{ max-width:520px; color:var(--hs-on-navy-text-2); font-size:16px; line-height:1.6; }
    #hs .hero-ctas{ display:flex; gap:12px; flex-wrap:wrap; justify-content:center; }
    #hs .hero-ctas .btn{ padding:13px 24px; font-size:13px; }
    #hs .hero-stats{ display:flex; gap:28px; margin-top:8px; flex-wrap:wrap; justify-content:center; }
    #hs .hero-stats div{ text-align:center; }
    #hs .hero-stats b{ display:block; font-family:'Barlow Condensed',sans-serif; font-weight:900; font-size:28px; color:var(--hs-on-navy-text); }
    #hs .hero-stats span{ font-size:11px; color:var(--hs-on-navy-text-3); text-transform:uppercase; letter-spacing:1px; }

    #hs section.hblock{ padding:48px 0; border-bottom:1px solid var(--hs-border); }
    #hs .hblock-head{ display:flex; align-items:baseline; justify-content:space-between; gap:16px; margin-bottom:20px; flex-wrap:wrap; }
    #hs .hblock-head h2{ font-size:26px; display:flex; align-items:center; gap:10px; }
    #hs .hsee-all{ font-size:12px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:var(--hs-text-2); border-bottom:1px solid var(--hs-border-strong); padding-bottom:2px; }
    #hs .hsee-all:hover{ color:var(--hs-accent); border-color:var(--hs-accent); }

    #hs .rail{ display:flex; gap:14px; overflow-x:auto; padding-bottom:6px; }
    #hs .rail > *{ flex:none; }
    #hs .gcard{ width:260px; background:var(--hs-surface); border:1px solid var(--hs-border); border-radius:10px; padding:16px; display:flex; flex-direction:column; gap:12px; }
    #hs .gcard.is-live{ border-color:var(--hs-live-dim); background:linear-gradient(180deg, rgba(206,17,38,.06), var(--hs-surface) 40%); }
    #hs .gcard-top{ display:flex; align-items:center; justify-content:space-between; gap:8px; }
    #hs .status-chip{ font-size:10.5px; font-weight:800; letter-spacing:1px; text-transform:uppercase; padding:4px 8px; border-radius:5px; display:inline-flex; align-items:center; gap:5px; flex:none; }
    #hs .status-chip.live{ background:var(--hs-live-dim); color:var(--hs-live); }
    #hs .status-chip.upcoming{ background:var(--hs-surface-3); color:var(--hs-text-2); }
    #hs .status-chip.final{ background:var(--hs-surface-3); color:var(--hs-text-3); }
    #hs .gcard-league{ font-size:11px; color:var(--hs-text-3); font-weight:600; text-transform:uppercase; letter-spacing:.4px; text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #hs .team-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; }
    #hs .team-id{ display:flex; align-items:center; gap:9px; min-width:0; }
    #hs .badge{ width:26px; height:26px; border-radius:7px; flex:none; display:flex; align-items:center; justify-content:center; font-family:'Barlow Condensed',sans-serif; font-weight:800; font-size:12px; color:#fff; }
    #hs .team-name{ font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #hs .team-score{ font-family:'Barlow Condensed',sans-serif; font-weight:900; font-size:21px; }
    #hs .team-score.win{ color:var(--hs-text); }
    #hs .team-score.lose{ color:var(--hs-text-3); }
    #hs .gcard-meta{ font-size:12px; color:var(--hs-text-3); }
    #hs .gcard-meta.live{ color:var(--hs-live); font-weight:700; }
    #hs .gcard .btn{ width:100%; text-align:center; padding:9px; font-size:11.5px; }

    #hs .empty{ border:1px dashed var(--hs-border-strong); border-radius:10px; padding:32px 22px; text-align:center; color:var(--hs-text-3); font-size:13.5px; width:100%; }
    #hs .empty b{ display:block; color:var(--hs-text-2); font-size:15px; margin-bottom:6px; font-family:'Outfit',sans-serif; font-weight:700; text-transform:none; letter-spacing:0; }

    #hs .lgrid{ display:flex; flex-wrap:wrap; gap:14px; }
    #hs .lcard{ flex:1 1 280px; background:var(--hs-surface); border:1px solid var(--hs-border); border-radius:10px; padding:18px; display:flex; flex-direction:column; gap:14px; }
    #hs .lcard-top{ display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
    #hs .lmark{ width:38px; height:38px; border-radius:9px; display:flex; align-items:center; justify-content:center; font-family:'Barlow Condensed',sans-serif; font-weight:900; font-size:15px; flex:none; background:var(--hs-accent-dim); color:var(--hs-accent); border:1px solid var(--hs-accent-border); }
    #hs .lcard h3{ font-size:18px; margin-top:10px; }
    #hs .lcard .loc{ font-size:12px; color:var(--hs-text-3); margin-top:2px; text-transform:none; letter-spacing:0; font-weight:500; font-family:'Outfit',sans-serif; }
    #hs .lcard-stats{ display:flex; gap:18px; padding-top:12px; border-top:1px solid var(--hs-border); }
    #hs .lcard-stats div b{ display:block; font-family:'Barlow Condensed',sans-serif; font-weight:800; font-size:17px; }
    #hs .lcard-stats div span{ font-size:10.5px; color:var(--hs-text-3); text-transform:uppercase; letter-spacing:.5px; }

    #hs .tabs{ display:flex; gap:6px; flex-wrap:wrap; margin-bottom:16px; }
    #hs .tab{ background:var(--hs-surface); border:1px solid var(--hs-border); color:var(--hs-text-2); font-size:12px; font-weight:700; letter-spacing:.4px; text-transform:uppercase; padding:8px 14px; border-radius:99px; }
    #hs .tab.active{ background:var(--hs-accent); border-color:var(--hs-accent); color:#fff; }
    #hs .tab:not(.active):hover{ border-color:var(--hs-border-strong); color:var(--hs-text); }
    #hs .lb-panel{ display:flex; flex-direction:column; border:1px solid var(--hs-border); border-radius:10px; overflow:hidden; }
    #hs .lb-row{ display:flex; align-items:center; gap:14px; padding:12px 16px; background:var(--hs-surface); border-bottom:1px solid var(--hs-border); }
    #hs .lb-row:last-child{ border-bottom:none; }
    #hs .lb-rank{ width:20px; font-family:'Barlow Condensed',sans-serif; font-weight:800; font-size:16px; color:var(--hs-text-3); flex:none; }
    #hs .lb-row:nth-child(1) .lb-rank{ color:var(--hs-accent); }
    #hs .lb-row:nth-child(2) .lb-rank{ color:var(--hs-rank2); }
    #hs .lb-row:nth-child(3) .lb-rank{ color:#5c6b93; }
    #hs .lb-avatar{ width:34px; height:34px; border-radius:50%; flex:none; display:flex; align-items:center; justify-content:center; font-family:'Barlow Condensed',sans-serif; font-weight:800; font-size:12.5px; color:#fff; object-fit:cover; }
    #hs .lb-id{ flex:1; min-width:0; }
    #hs .lb-id b{ display:block; font-size:14px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    #hs .lb-id span{ font-size:11.5px; color:var(--hs-text-3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block; }
    #hs .lb-val{ text-align:right; flex:none; }
    #hs .lb-val b{ font-family:'Barlow Condensed',sans-serif; font-weight:900; font-size:20px; color:var(--hs-accent); }
    #hs .lb-val span{ display:block; font-size:10px; color:var(--hs-text-3); text-transform:uppercase; letter-spacing:.5px; }

    #hs .results{ display:flex; flex-direction:column; border:1px solid var(--hs-border); border-radius:10px; overflow:hidden; }
    #hs .rrow{ display:flex; align-items:center; gap:16px; padding:13px 18px; background:var(--hs-surface); border-bottom:1px solid var(--hs-border); flex-wrap:wrap; }
    #hs .rrow:last-child{ border-bottom:none; }
    #hs .rleague{ font-size:11px; color:var(--hs-text-3); text-transform:uppercase; letter-spacing:.4px; font-weight:700; width:150px; flex:none; }
    #hs .rteams{ display:flex; flex-direction:column; gap:4px; flex:1; min-width:180px; }
    #hs .rt{ display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13px; }
    #hs .rt b{ font-family:'Barlow Condensed',sans-serif; font-weight:800; font-size:15px; }
    #hs .rt.winner b, #hs .rt.winner span{ color:var(--hs-win); }
    #hs .rlink{ font-size:11.5px; font-weight:700; color:var(--hs-text-3); flex:none; }
    #hs .rlink:hover{ color:var(--hs-accent); }

    #hs .cband{ padding:44px 0; background:linear-gradient(135deg, var(--hs-accent), var(--hs-accent-strong)); }
    #hs .cband-inner{ display:flex; align-items:center; justify-content:space-between; gap:24px; flex-wrap:wrap; }
    #hs .cband h2{ font-size:24px; margin-bottom:6px; color:#fff; }
    #hs .cband p{ color:rgba(255,255,255,.85); font-size:14px; max-width:420px; }

    #hs footer.hfoot{ padding:44px 0 24px; background:linear-gradient(180deg, var(--hs-blue), var(--hs-blue-strong)); }
    #hs .hfoot-top{ display:flex; justify-content:space-between; gap:40px; flex-wrap:wrap; margin-bottom:28px; }
    #hs .hfoot-brand p{ color:var(--hs-on-navy-text-3); font-size:13px; max-width:260px; margin-top:10px; }
    #hs .hfoot-cols{ display:flex; gap:44px; flex-wrap:wrap; }
    #hs .hfoot-col h4{ font-size:11px; letter-spacing:1px; color:var(--hs-on-navy-text-3); margin-bottom:10px; font-weight:700; text-transform:uppercase; }
    #hs .hfoot-col a{ display:block; font-size:13px; color:var(--hs-on-navy-text-2); margin-bottom:8px; }
    #hs .hfoot-col a:hover{ color:#ff8f9c; }
    #hs .hfoot-bottom{ border-top:1px solid var(--hs-on-navy-border); padding-top:18px; display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; font-size:12px; color:var(--hs-on-navy-text-3); }
  </style>

  <div id="hs">
    <header class="hsite">
      <div class="wrap hnav-row">
        <a class="hbrand" href="/"><img class="hbrand-mark" src="/icons/logo-watermark.png?v=2" alt="HoopStats Pilipinas logo">HOOPSTATS PILIPINAS</a>
        <nav class="hprimary">
          <a href="/">Home</a>
          <a href="#hs-live" class="live-link"><span class="live-dot"></span>Live</a>
          <a href="#hs-games">Games</a>
          <a href="#hs-leagues">Leagues</a>
          <a href="#hs-players">Players</a>
          <a href="/install">Install</a>
        </nav>
        <div class="hnav-actions">
          <button class="theme-toggle" id="hsThemeToggle" type="button" aria-label="Toggle dark mode" aria-pressed="false">
            <span class="knob">
              <svg class="i-sun" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="4" fill="currentColor"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M10 1.5v2M10 16.5v2M18.5 10h-2M3.5 10h-2M15.6 4.4l-1.4 1.4M5.8 14.2l-1.4 1.4M15.6 15.6l-1.4-1.4M5.8 5.8L4.4 4.4"/></g></svg>
              <svg class="i-moon" viewBox="0 0 20 20" fill="none"><path d="M16 12.3A7 7 0 1 1 7.7 4a5.6 5.6 0 0 0 8.3 8.3z" fill="currentColor"/></svg>
            </span>
          </button>
          ${user ? `<a class="btn btn-ghost-inverse btn-sm" href="/admin">Commissioner Portal</a>` : `<a class="btn btn-ghost-inverse btn-sm" href="/register">Start a League</a>`}
          ${user ? `<a class="btn btn-accent btn-sm" href="/admin">My Dashboard</a>` : `<a class="btn btn-accent btn-sm" href="/login">Sign In</a>`}
          <button class="hhamburger" id="hsHamburger" type="button" aria-label="Menu" aria-expanded="false"><span></span><span></span><span></span></button>
        </div>
      </div>
      <div class="hmobile-menu" id="hsMobileMenu">
        <a href="/">Home</a>
        <a href="#hs-live">Live</a>
        <a href="#hs-games">Games</a>
        <a href="#hs-leagues">Leagues</a>
        <a href="#hs-players">Players</a>
        <a href="/install">Install App</a>
        ${user ? `<a href="/admin">My Dashboard</a>` : `<a href="/login">Sign In</a><a href="/register">Create Account</a>`}
      </div>
    </header>

    <main>
      <section class="hero">
        <div class="wrap hero-inner">
          ${isLive ? `<span class="eyebrow"><span class="live-dot"></span>${liveGames.length} game${liveGames.length > 1 ? 's' : ''} live right now</span>` : ''}
          <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
            <h1>YOUR GAME.<br>YOUR STATS.<br><span class="pop">YOUR STORY.</span></h1>
            <p class="tagline">THE HOME OF PH BASKETBALL STATS.</p>
          </div>
          <p class="lead">Scores, stats, standings, players and games from grassroots basketball across the Philippines &mdash; from the barangay court to the big stage.</p>
          <div class="hero-ctas">
            <a class="btn btn-accent" href="#hs-live">Watch Live</a>
            <a class="btn btn-ghost-inverse" href="#hs-leagues">Explore Leagues</a>
          </div>
          <div class="hero-stats">
            <div><b class="num">${totals.leagues}</b><span>Leagues</span></div>
            <div><b class="num">${totals.teams}</b><span>Teams</span></div>
            <div><b class="num">${totals.players}</b><span>Players Tracked</span></div>
          </div>
        </div>
      </section>

      <section class="hblock" id="hs-live">
        <div class="wrap">
          <div class="hblock-head"><h2><span class="live-dot"></span>Live Now</h2></div>
          ${liveSection}
        </div>
      </section>

      <section class="hblock" id="hs-games">
        <div class="wrap">
          <div class="hblock-head"><h2>Upcoming Games</h2></div>
          ${upcomingSection}
        </div>
      </section>

      <section class="hblock" id="hs-leagues">
        <div class="wrap">
          <div class="hblock-head"><h2>Public Leagues</h2><a class="hsee-all" href="/register">Start your own →</a></div>
          <div class="lgrid">${leagueCards}</div>
        </div>
      </section>

      <section class="hblock" id="hs-players">
        <div class="wrap">
          <div class="hblock-head"><h2>Top Performers</h2></div>
          <div class="tabs" role="tablist">${leaderTabs}</div>
          ${leaderPanels}
        </div>
      </section>

      <section class="hblock" style="border-bottom:none;">
        <div class="wrap">
          <div class="hblock-head"><h2>Latest Results</h2></div>
          ${resultsSection}
        </div>
      </section>

      <section class="cband">
        <div class="wrap cband-inner">
          <div>
            <h2>For Commissioners</h2>
            <p>Create your league, manage teams and rosters, run live scoring courtside, and publish results &mdash; free to start.</p>
          </div>
          <a class="btn btn-on-accent" href="/register" style="padding:13px 24px;">Start Your League</a>
        </div>
      </section>
    </main>

    <footer class="hfoot">
      <div class="wrap">
        <div class="hfoot-top">
          <div class="hfoot-brand">
            <a class="hbrand" href="/"><img class="hbrand-mark" src="/icons/logo-watermark.png?v=2" alt="HoopStats Pilipinas logo">HOOPSTATS PILIPINAS</a>
            <p>The digital home of Philippine grassroots basketball. From the barangay court to the big stage.</p>
          </div>
          <div class="hfoot-cols">
            <div class="hfoot-col">
              <h4>Platform</h4>
              <a href="#hs-live">Live</a><a href="#hs-games">Games</a><a href="#hs-leagues">Leagues</a><a href="#hs-players">Players</a><a href="/install">Install App</a>
            </div>
            <div class="hfoot-col">
              <h4>Commissioners</h4>
              <a href="/register">Start a League</a><a href="/login">Sign In</a>
            </div>
            <div class="hfoot-col">
              <h4>Company</h4>
              <a href="/terms">Terms of Use</a><a href="/privacy">Privacy Policy</a>
            </div>
          </div>
        </div>
        <div class="hfoot-bottom">
          <span>&copy; ${new Date().getFullYear()} HoopStats Pilipinas</span>
          <span>Stats powered by the FIBA 2024 EFF engine</span>
        </div>
      </div>
    </footer>
  </div>

  <script>
    (function(){
      var themeBtn = document.getElementById('hsThemeToggle');
      if (themeBtn) {
        var isDark = function(){
          var attr = document.documentElement.getAttribute('data-theme');
          if (attr === 'dark') return true;
          if (attr === 'light') return false;
          return window.matchMedia('(prefers-color-scheme: dark)').matches;
        };
        var syncThemeBtn = function(){ themeBtn.setAttribute('aria-pressed', String(isDark())); };
        themeBtn.addEventListener('click', function(){
          var next = isDark() ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', next);
          try { localStorage.setItem('hoopstats-theme', next); } catch(e){}
          syncThemeBtn();
        });
        syncThemeBtn();
      }
      var hb = document.getElementById('hsHamburger');
      var menu = document.getElementById('hsMobileMenu');
      if (hb && menu) {
        hb.addEventListener('click', function(){
          var open = menu.classList.toggle('open');
          hb.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        document.addEventListener('click', function(e){
          if (menu.classList.contains('open') && !menu.contains(e.target) && !hb.contains(e.target)) {
            menu.classList.remove('open');
            hb.setAttribute('aria-expanded', 'false');
          }
        });
      }
      var tabs = document.querySelectorAll('#hs .tab');
      tabs.forEach(function(tab){
        tab.addEventListener('click', function(){
          tabs.forEach(function(t){ t.classList.remove('active'); });
          tab.classList.add('active');
          document.querySelectorAll('#hs .lb-panel').forEach(function(p){
            p.hidden = p.getAttribute('data-panel') !== tab.getAttribute('data-cat');
          });
        });
      });
    })();
  </script>
  `);
}

function renderLeaguePage(league, teams, players, games, user, seasonStats = {}, sort = { col: "pts", dir: "desc", tab: "standings" }, req = {}) {
  const sorted = {
    reb: [...players].sort((a,b)=>b.reb-a.reb),
    ast: [...players].sort((a,b)=>b.ast-a.ast),
    stl: [...players].sort((a,b)=>b.stl-a.stl),
    blk: [...players].sort((a,b)=>b.blk-a.blk),
    fg:  [...players].filter(p=>p.gp>0).sort((a,b)=>b.fg-a.fg),
  };
  const ptsLeader = players[0];
  const rebLeader = sorted.reb[0];
  const astLeader = sorted.ast[0];
  const stlLeader = sorted.stl[0];
  const blkLeader = sorted.blk[0];
  const fgLeader  = sorted.fg[0];

  return page(`${esc(league.name)} | HoopStats`, `
    <nav class="topnav">
      <div class="topnav-inner">
        <div class="nav-brand">
          <a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px">
            <img src="/icons/icon-192.png?v=4" alt="HoopStats" style="width:38px;height:38px;border-radius:8px;object-fit:contain;display:block;flex-shrink:0">
            <div class="nav-brand-text">
              <div class="brand-text">HOOPSTATS</div>
              <div class="brand-sub">Pilipinas</div>
            </div>
          </a>
        </div>
        <div class="nav-actions">
          <a href="/" class="nav-btn-orange">← Leagues</a>
          ${user ? `<a href="/admin" class="nav-btn-orange">Admin Panel</a>` : `<a href="/login" class="nav-btn-orange">Login</a>`}
        </div>
      </div>
    </nav>
    <div class="league-header">
      <div class="lh-inner">
        <div class="lh-top">${levelBadge(league.level)} ${statusBadge(league.status)}</div>
        <h1 class="lh-title">${esc(league.name)}</h1>
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

    <div style="max-width:960px;margin:0 auto;padding:24px 24px 60px"><!-- PAGE WRAPPER -->
    <div style="font-size:0;margin:-6px;margin-bottom:28px;display:block;width:100%">
      ${[
        {label:'PTS', key:'pts', val:ptsLeader?.pts, name:ptsLeader?.name, id:ptsLeader?.id, c:'var(--orange)'},
        {label:'REB', key:'reb', val:rebLeader?.reb, name:rebLeader?.name, id:rebLeader?.id, c:'#00d4aa'},
        {label:'AST', key:'ast', val:astLeader?.ast, name:astLeader?.name, id:astLeader?.id, c:'#a78bfa'},
        {label:'STL', key:'stl', val:stlLeader?.stl, name:stlLeader?.name, id:stlLeader?.id, c:'#f7c948'},
        {label:'BLK', key:'blk', val:blkLeader?.blk, name:blkLeader?.name, id:blkLeader?.id, c:'#60a5fa'},
        {label:'FG%', key:'fg',  val:fgLeader?.fg != null ? fgLeader.fg+'%' : null, name:fgLeader?.name, id:fgLeader?.id, c:'#34d399'},
      ].map(s=>`
        ${s.id
          ? `<a href="/league/${league.id}/player/${s.id}" style="display:inline-block;vertical-align:top;width:calc(33.33% - 12px);min-width:140px;margin:6px;background:#161616;border:1px solid rgba(255,255,255,.07);border-top:2px solid var(--orange);border-radius:8px;padding:16px;text-decoration:none;color:inherit;box-sizing:border-box;transition:border-color .15s,transform .15s,box-shadow .15s" class="leader-card-link">`
          : `<div style="display:inline-block;vertical-align:top;width:calc(33.33% - 12px);min-width:140px;margin:6px;background:#161616;border:1px solid rgba(255,255,255,.07);border-top:2px solid rgba(255,255,255,.1);border-radius:8px;padding:16px;box-sizing:border-box">`}
          <div class="leader-label">${s.label} LEADER</div>
          <div class="leader-val" style="color:${s.c}">${s.val ?? '—'}</div>
          <div class="leader-name">${esc(s.name ?? 'N/A')}</div>
        ${s.id ? `</a>` : `</div>`}`).join('')}
    </div><!-- /leaders row -->

    <style>
      /* Leader cards: 3-col desktop, 2-col tablet, adapt mobile */
      @media(min-width:640px){.leader-card-link,.leader-card{width:calc(33.33% - 12px)!important}}
      @media(max-width:639px){.leader-card-link,.leader-card{width:calc(50% - 12px)!important}}
      a.leader-card-link:hover{border-color:rgba(249,115,22,.5)!important;transform:translateY(-2px);box-shadow:0 6px 20px rgba(249,115,22,.15)}
      a.leader-card-link:hover .leader-name{color:#f97316}
      .pub-tabs{display:-webkit-box!important;display:-webkit-flex!important;display:flex!important;-webkit-flex-direction:row!important;flex-direction:row!important;gap:0!important;border-bottom:1px solid rgba(255,255,255,.08)!important;margin-bottom:20px!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch!important;background:transparent!important;flex-wrap:nowrap!important;width:100%!important}
      .pub-tabs::-webkit-scrollbar{display:none!important}
      .ptab{display:-webkit-inline-box!important;display:-webkit-inline-flex!important;display:inline-flex!important;-webkit-box-align:center!important;-webkit-align-items:center!important;align-items:center!important;gap:5px!important;padding:12px 18px!important;font-size:12px!important;font-weight:800!important;letter-spacing:.5px!important;text-transform:uppercase!important;font-family:Outfit,sans-serif!important;color:rgba(255,255,255,.4)!important;background:transparent!important;background-color:transparent!important;border:none!important;border-top:none!important;border-left:none!important;border-right:none!important;border-bottom:2px solid transparent!important;outline:none!important;cursor:pointer!important;white-space:nowrap!important;-webkit-appearance:none!important;-moz-appearance:none!important;appearance:none!important;flex-shrink:0!important;box-shadow:none!important;border-radius:0!important}
      .ptab:hover{color:rgba(255,255,255,.8)!important}
      .ptab.active{color:#f97316!important;border-bottom-color:#f97316!important;background:transparent!important;background-color:transparent!important}
      @media(max-width:640px){.ptab{padding:10px 13px!important;font-size:11px!important}}
    </style>
    <div class="pub-tabs"><div style="display:-webkit-box;display:-webkit-flex;display:flex;-webkit-flex-direction:row;flex-direction:row;gap:0;flex-wrap:nowrap;min-width:100%">
      <button class="ptab active" data-tab="standings">🏆 Standings</button>
      <button class="ptab" data-tab="leaderboard">📊 Leader Board</button>
      <button class="ptab" data-tab="players">👤 Player Stats</button>
      <button class="ptab" data-tab="games">🏀 Games</button>
      <button class="ptab" data-tab="schedule">📅 Schedule</button>
    </div></div>

    <div class="pub-content">

      <div id="tab-leaderboard" class="tab-pane hidden">
        ${(()=>{
          const f1 = v => (parseFloat(v)||0).toFixed(1);
          function abbr(n){ return (n||'').split(/\s+/).map(function(w){return w[0]||'';}).join('').toUpperCase().slice(0,4); }
          // Use players array — already has name, team_name, pts, reb, ast, stl, blk, fg3m, ftm
          // Merge with seasonStats for per-game averages
          const allP = players.map(function(p){
            var ss = seasonStats[p.id] || {};
            return {
              name: p.name, team_name: p.team_name||'',
              pts:   parseFloat(ss.pts  || p.pts  || 0),
              reb:   parseFloat(ss.reb  || p.reb  || 0),
              ast:   parseFloat(ss.ast  || p.ast  || 0),
              blk:   parseFloat(ss.blk  || p.blk  || 0),
              stl:   parseFloat(ss.stl  || p.stl  || 0),
              to_val:parseFloat(ss.to_val|| 0),
              fg3m:  parseFloat(ss.fg3m || 0),
              ftm:   parseFloat(ss.ftm  || 0),
            };
          });
          function top(field){ return allP.slice().filter(function(p){return p.name;}).sort(function(a,b){return (b[field]||0)-(a[field]||0);}).slice(0,10); }
          const cats = [
            {title:'POINTS',          rows:top('pts'),    fn:function(p){return f1(p.pts);}},
            {title:'REBOUNDS',        rows:top('reb'),    fn:function(p){return f1(p.reb);}},
            {title:'ASSISTS',         rows:top('ast'),    fn:function(p){return f1(p.ast);}},
            {title:'BLOCKS',          rows:top('blk'),    fn:function(p){return f1(p.blk);}},
            {title:'STEALS',          rows:top('stl'),    fn:function(p){return f1(p.stl);}},
            {title:'TURNOVERS',       rows:top('to_val'), fn:function(p){return f1(p.to_val);}},
            {title:'3-POINTERS MADE', rows:top('fg3m'),   fn:function(p){return f1(p.fg3m);}},
            {title:'FREE THROWS MADE',rows:top('ftm'),    fn:function(p){return f1(p.ftm);}},
          ];
          function renderCat(cat){
            var rows = cat.rows.length
              ? cat.rows.map(function(p,i){
                  var val; try{val=cat.fn(p);}catch(e){val='0.0';}
                  var isFirst = i===0;
                  return '<tr style="border-bottom:1px solid rgba(255,255,255,.05)">'+
                    '<td style="padding:7px 6px 7px 10px;font-size:11px;color:rgba(255,255,255,.3);font-weight:700;white-space:nowrap;width:20px">'+(i+1)+'.</td>'+
                    '<td style="padding:7px 4px;font-size:13px;font-weight:'+(isFirst?800:600)+';color:'+(isFirst?'#fff':'rgba(255,255,255,.75)')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:110px">'+esc(p.name)+'</td>'+
                    '<td style="padding:7px 4px;font-size:10px;color:rgba(255,255,255,.3);font-weight:700;white-space:nowrap">'+esc(abbr(p.team_name))+'</td>'+
                    '<td style="padding:7px 10px 7px 4px;font-size:13px;font-weight:900;color:#f97316;text-align:right;white-space:nowrap">'+val+'</td>'+
                  '</tr>';
                }).join('')
              : '<tr><td colspan="4" style="padding:12px 10px;font-size:12px;color:rgba(255,255,255,.25)">No stats yet</td></tr>';
            return '<div style="background:#111;border:1px solid rgba(255,255,255,.07);border-radius:8px;overflow:hidden;margin-bottom:10px">'+
              '<div style="padding:10px 12px;background:#161616;border-bottom:1px solid rgba(255,255,255,.07);font-size:10px;font-weight:900;letter-spacing:1.5px;color:rgba(255,255,255,.4);text-transform:uppercase">'+cat.title+'</div>'+
              '<table style="width:100%;border-collapse:collapse;table-layout:fixed">'+rows+'</table>'+
            '</div>';
          }
          // ── FIBA EFF MVP RACE — 100% inline styles, no CSS classes ──────────
          // EFF = PTS + REB + AST + STL + BLK - (FGA-FGM) - (FTA-FTM) - TO
          const mvpPlayers = players.map(function(p){
            var ss  = seasonStats[p.id] || {};
            var gp  = parseFloat(ss.gp     || p.gp   || 0);
            if (!gp) return null;
            // Use per-game averages already stored in player_season_stats
            // eff column is the FIBA EFF already computed by the server on save
            var pts = parseFloat(ss.pts    || 0);
            var reb = parseFloat(ss.reb    || 0);
            var ast = parseFloat(ss.ast    || 0);
            var stl = parseFloat(ss.stl    || 0);
            var blk = parseFloat(ss.blk    || 0);
            // Recompute EFF accurately using stored totals (per-game averages)
            var fgm = parseFloat(ss.fg2m||0) + parseFloat(ss.fg3m||0);
            var fga = parseFloat(ss.fg2a||0) + parseFloat(ss.fg3a||0);
            var ftm = parseFloat(ss.ftm    || 0);
            var fta = parseFloat(ss.fta    || 0);
            var to  = parseFloat(ss.to_val || 0);
            // These are per-game averages already, so use directly
            var eff = pts + reb + ast + stl + blk - (fga-fgm) - (fta-ftm) - to;
            return { name:p.name, team_name:p.team_name||'', pts:pts, reb:reb, ast:ast, stl:stl, blk:blk, gp:gp, eff:eff };
          }).filter(function(p){ return p !== null; })
            .sort(function(a,b){ return b.eff - a.eff; })
            .slice(0, 5);

          function renderMVP(){
            if (!mvpPlayers.length) {
              return '<p style="padding:20px;font-size:13px;color:rgba(255,255,255,.3);text-align:center">No qualifying players yet — need at least 1 game played.</p>';
            }
            var medals = ['🥇','🥈','🥉'];
            return mvpPlayers.map(function(p, i){
              var isFirst  = i === 0;
              var effDisp  = (p.eff >= 0 ? '+' : '') + p.eff.toFixed(1);
              var effColor = isFirst ? '#f97316' : 'rgba(255,255,255,.55)';
              var rowBg    = isFirst ? 'rgba(249,115,22,.07)' : 'rgba(255,255,255,.03)';
              var rowBord  = isFirst ? '1px solid rgba(249,115,22,.3)' : '1px solid rgba(255,255,255,.06)';
              var ptsW     = Math.min(100, (p.pts/30)*100).toFixed(0);
              var rebW     = Math.min(100, (p.reb/15)*100).toFixed(0);
              var astW     = Math.min(100, (p.ast/10)*100).toFixed(0);
              var stlW     = Math.min(100, (p.stl/5)*100).toFixed(0);
              var blkW     = Math.min(100, (p.blk/5)*100).toFixed(0);
              var medal    = medals[i] || ((i+1)+'.');
              return (
                '<div style="display:table;width:100%;table-layout:fixed;background:'+rowBg+';border:'+rowBord+';border-radius:7px;margin-bottom:6px;padding:10px 12px;box-sizing:border-box">'+
                  /* rank + name cell */
                  '<div style="display:table-cell;width:44%;vertical-align:middle;padding-right:8px">'+
                    '<div style="display:table;width:100%">'+
                      '<div style="display:table-cell;width:28px;vertical-align:middle;font-size:18px;text-align:center">'+medal+'</div>'+
                      '<div style="display:table-cell;vertical-align:middle;padding-left:8px">'+
                        '<div style="font-size:13px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(p.name)+'</div>'+
                        '<div style="font-size:10px;color:rgba(255,255,255,.35);font-weight:600;margin-top:2px">'+esc(abbr(p.team_name))+' &nbsp;·&nbsp; '+p.gp+' GP</div>'+
                      '</div>'+
                    '</div>'+
                  '</div>'+
                  /* EFF score cell */
                  '<div style="display:table-cell;width:18%;vertical-align:middle;text-align:right;padding-right:10px">'+
                    '<div style="font-family:Barlow Condensed,sans-serif;font-size:22px;font-weight:900;color:'+effColor+';line-height:1">'+effDisp+'</div>'+
                    '<div style="font-size:9px;font-weight:800;letter-spacing:1.5px;color:rgba(255,255,255,.28);text-transform:uppercase;margin-top:2px">EFF</div>'+
                  '</div>'+
                  /* mini bars cell */
                  '<div style="display:table-cell;width:38%;vertical-align:middle">'+
                    /* PTS bar */
                    '<div style="display:table;width:100%;margin-bottom:4px">'+
                      '<div style="display:table-cell;width:22px;font-size:9px;font-weight:800;color:rgba(255,255,255,.28);letter-spacing:1px;vertical-align:middle">PTS</div>'+
                      '<div style="display:table-cell;vertical-align:middle;padding:0 5px">'+
                        '<div style="height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden">'+
                          '<div style="height:4px;width:'+ptsW+'%;background:#f97316;border-radius:2px"></div>'+
                        '</div>'+
                      '</div>'+
                      '<div style="display:table-cell;width:28px;font-size:10px;font-weight:700;color:rgba(255,255,255,.4);text-align:right;vertical-align:middle">'+p.pts.toFixed(1)+'</div>'+
                    '</div>'+
                    /* REB bar */
                    '<div style="display:table;width:100%;margin-bottom:4px">'+
                      '<div style="display:table-cell;width:22px;font-size:9px;font-weight:800;color:rgba(255,255,255,.28);letter-spacing:1px;vertical-align:middle">REB</div>'+
                      '<div style="display:table-cell;vertical-align:middle;padding:0 5px">'+
                        '<div style="height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden">'+
                          '<div style="height:4px;width:'+rebW+'%;background:#00d4aa;border-radius:2px"></div>'+
                        '</div>'+
                      '</div>'+
                      '<div style="display:table-cell;width:28px;font-size:10px;font-weight:700;color:rgba(255,255,255,.4);text-align:right;vertical-align:middle">'+p.reb.toFixed(1)+'</div>'+
                    '</div>'+
                    /* AST bar */
                    '<div style="display:table;width:100%;margin-bottom:4px">'+
                      '<div style="display:table-cell;width:22px;font-size:9px;font-weight:800;color:rgba(255,255,255,.28);letter-spacing:1px;vertical-align:middle">AST</div>'+
                      '<div style="display:table-cell;vertical-align:middle;padding:0 5px">'+
                        '<div style="height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden">'+
                          '<div style="height:4px;width:'+astW+'%;background:#a78bfa;border-radius:2px"></div>'+
                        '</div>'+
                      '</div>'+
                      '<div style="display:table-cell;width:28px;font-size:10px;font-weight:700;color:rgba(255,255,255,.4);text-align:right;vertical-align:middle">'+p.ast.toFixed(1)+'</div>'+
                    '</div>'+
                    /* STL bar */
                    '<div style="display:table;width:100%;margin-bottom:4px">'+
                      '<div style="display:table-cell;width:22px;font-size:9px;font-weight:800;color:rgba(255,255,255,.28);letter-spacing:1px;vertical-align:middle">STL</div>'+
                      '<div style="display:table-cell;vertical-align:middle;padding:0 5px">'+
                        '<div style="height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden">'+
                          '<div style="height:4px;width:'+stlW+'%;background:#f7c948;border-radius:2px"></div>'+
                        '</div>'+
                      '</div>'+
                      '<div style="display:table-cell;width:28px;font-size:10px;font-weight:700;color:rgba(255,255,255,.4);text-align:right;vertical-align:middle">'+p.stl.toFixed(1)+'</div>'+
                    '</div>'+
                    /* BLK bar */
                    '<div style="display:table;width:100%">'+
                      '<div style="display:table-cell;width:22px;font-size:9px;font-weight:800;color:rgba(255,255,255,.28);letter-spacing:1px;vertical-align:middle">BLK</div>'+
                      '<div style="display:table-cell;vertical-align:middle;padding:0 5px">'+
                        '<div style="height:4px;background:rgba(255,255,255,.08);border-radius:2px;overflow:hidden">'+
                          '<div style="height:4px;width:'+blkW+'%;background:#60a5fa;border-radius:2px"></div>'+
                        '</div>'+
                      '</div>'+
                      '<div style="display:table-cell;width:28px;font-size:10px;font-weight:700;color:rgba(255,255,255,.4);text-align:right;vertical-align:middle">'+p.blk.toFixed(1)+'</div>'+
                    '</div>'+
                  '</div>'+
                '</div>'
              );
            }).join('');
          }

          var mvpSection =
            '<div style="background:#111;border:1px solid rgba(249,115,22,.2);border-radius:8px;overflow:hidden;margin-bottom:16px">'+
              '<div style="padding:12px 16px;background:rgba(249,115,22,.07);border-bottom:1px solid rgba(249,115,22,.15)">'+
                '<div style="font-family:Barlow Condensed,sans-serif;font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#fff">🏆 MVP RACE</div>'+
                '<div style="font-size:10px;color:rgba(255,255,255,.35);margin-top:3px">FIBA EFF = PTS+REB+AST+STL+BLK−Missed FG−Missed FT−TO</div>'+
              '</div>'+
              '<div style="padding:12px 14px">'+renderMVP()+'</div>'+
            '</div>';

          // 2-column layout using display:table for cross-browser compat
          var leftCats  = cats.filter(function(_,i){return i%2===0;});
          var rightCats = cats.filter(function(_,i){return i%2===1;});
          var lbHtml = '<div style="display:table;width:100%;table-layout:fixed;border-collapse:separate;border-spacing:8px 0">'+
            '<div style="display:table-cell;width:50%;vertical-align:top">'+leftCats.map(renderCat).join('')+'</div>'+
            '<div style="display:table-cell;width:50%;vertical-align:top">'+rightCats.map(renderCat).join('')+'</div>'+
          '</div>';
          return mvpSection + lbHtml;
        })()}
      </div>
      <div id="tab-standings" class="tab-pane">
        ${(()=>{
          // Detect if any teams are tied on WIN% — show tiebreaker columns
          const hasTies = teams.some((t,i,arr) => i > 0 && arr[i-1].wins === t.wins && arr[i-1].losses === t.losses);
          const hasPtsData = teams.some(t => (t.pts_for||0) > 0);
          const showTb  = hasTies; // Always show tiebreaker cols when tied — pts cols show 0 until Fix Standings is clicked
          return '<div class="table-scroll"><table class="stats-table">'
            + '<thead><tr>'
            + '<th>#</th><th>Team</th><th>W</th><th>L</th><th>WIN%</th>'
            + (showTb ? '<th title="Points For">PF</th><th title="Points Against">PA</th><th title="Point Differential">DIFF</th>' : '')
            + '</tr></thead>'
            + '<tbody>'
            + (teams.map((t,i,arr)=>{
                const gp   = t.wins + t.losses;
                const pct  = gp > 0 ? ((t.wins/gp)*100).toFixed(1) : '0.0';
                const diff = (t.pts_for||0) - (t.pts_against||0);
                // Tiebreaker indicator: show 'T' badge if same WIN% as adjacent team
                const tiedWithPrev = i > 0 && arr[i-1].wins === t.wins && arr[i-1].losses === t.losses;
                const tiedWithNext = i < arr.length-1 && arr[i+1].wins === t.wins && arr[i+1].losses === t.losses;
                const isTied = tiedWithPrev || tiedWithNext;
                return '<tr>'
                  + '<td class="rank '+(i<2?'rank-top':'')+'">'+(i+1)+(isTied?'<span style="font-size:8px;color:#f7c948;vertical-align:super;margin-left:2px">T</span>':'')+'</td>'
                  + '<td><div class="team-name-cell"><div class="team-dot" style="background:'+t.color+'"></div><a href="/league/'+league.id+'/team/'+t.id+'" class="team-link">'+esc(t.name)+'</a></div></td>'
                  + '<td class="green">'+t.wins+'</td>'
                  + '<td class="red">'+t.losses+'</td>'
                  + '<td style="color:var(--gold);font-weight:700">'+pct+'%</td>'
                  + (showTb ? '<td style="color:rgba(255,255,255,.5)">'+  (hasPtsData?(t.pts_for||0):'—')  +'</td>'
                            + '<td style="color:rgba(255,255,255,.5)">'+  (hasPtsData?(t.pts_against||0):'—')+'</td>'
                            + '<td style="color:'+(diff>=0&&hasPtsData?'#00d4aa':'rgba(255,255,255,.3)')+';font-weight:700">'+(hasPtsData?(diff>0?'+':'')+diff:'—')+'</td>' : '')
                  + '</tr>';
              }).join('') || '<tr><td colspan="8" class="empty">No teams yet.</td></tr>')
            + '</tbody></table>'
            + (showTb ? '<div style="font-size:11px;color:rgba(255,255,255,.3);padding:8px 4px">' + '<span style="color:#f7c948;font-weight:800">T</span> = Tied on WIN% — ranked by Head-to-Head → Point Differential → Points Scored' + (!hasPtsData ? ' &nbsp;·&nbsp; <span style="color:rgba(249,115,22,.6)">Click "Fix Standings" to compute point data</span>' : '') + '</div>' : '')
            + '</div>';
        })()}
      </div>

      <div id="tab-players" class="tab-pane hidden">
        <div style="font-size:11px;color:#555;margin-bottom:8px;font-weight:600">
          💡 Click any column header to sort
        </div>
        <div class="table-scroll">
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

      <div id="tab-games" class="tab-pane hidden">
        ${(()=>{
          const finalGames  = games.filter(function(g){ return g.status==='final'; });
          if (!finalGames.length) {
            return '<div class="empty-state"><div class="es-icon">🏀</div><div>No completed games yet.</div></div>';
          }
          return finalGames.map(function(g){
            const homeWin   = (g.home_score||0) > (g.away_score||0);
            const homeCls   = homeWin  ? 'color:#00d4aa;font-weight:900' : 'color:rgba(255,255,255,.55);font-weight:700';
            const awayCls   = !homeWin ? 'color:#00d4aa;font-weight:900' : 'color:rgba(255,255,255,.55);font-weight:700';
            return '<a href="/league/'+league.id+'/game/'+g.id+'" style="display:block;text-decoration:none;color:inherit">'
              + '<div class="game-row game-row-clickable" style="cursor:pointer">'
              +   '<div style="display:table;width:100%">'
                  // Home team
              +     '<div style="display:table-cell;width:38%;vertical-align:middle;padding-right:10px">'
              +       '<div style="font-size:13px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(g.home_name||'Home')+'</div>'
              +       '<div style="font-size:10px;font-weight:800;letter-spacing:.5px;margin-top:3px;padding:2px 7px;border-radius:3px;display:inline-block;background:'+(homeWin?'rgba(0,212,170,.12)':'rgba(255,255,255,.04)')+';color:'+(homeWin?'#00d4aa':'rgba(255,255,255,.3)')+'">'+( homeWin?'WIN':'LOSS')+'</div>'
              +     '</div>'
                  // Score
              +     '<div style="display:table-cell;width:24%;vertical-align:middle;text-align:center">'
              +       '<div style="display:flex;align-items:center;justify-content:center;gap:8px">'
              +         '<span style="font-family:Barlow Condensed,sans-serif;font-size:28px;font-weight:900;'+homeCls+'">'+g.home_score+'</span>'
              +         '<span style="font-size:11px;font-weight:700;color:rgba(255,255,255,.2)">—</span>'
              +         '<span style="font-family:Barlow Condensed,sans-serif;font-size:28px;font-weight:900;'+awayCls+'">'+g.away_score+'</span>'
              +       '</div>'
              +       '<div style="font-size:9px;font-weight:800;letter-spacing:1.5px;color:rgba(255,255,255,.2);text-transform:uppercase;margin-top:2px">FINAL</div>'
              +     '</div>'
                  // Away team
              +     '<div style="display:table-cell;width:38%;vertical-align:middle;padding-left:10px;text-align:right">'
              +       '<div style="font-size:13px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(g.away_name||'Away')+'</div>'
              +       '<div style="font-size:10px;font-weight:800;letter-spacing:.5px;margin-top:3px;padding:2px 7px;border-radius:3px;display:inline-block;background:'+(!homeWin?'rgba(0,212,170,.12)':'rgba(255,255,255,.04)')+';color:'+(!homeWin?'#00d4aa':'rgba(255,255,255,.3)')+'">'+(!homeWin?'WIN':'LOSS')+'</div>'
              +     '</div>'
              +   '</div>'
              +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">'
              +     '<span style="font-size:11px;color:rgba(255,255,255,.3)">📍 '+esc(g.venue||'TBD')+' · '+esc(g.date||'TBD')+'</span>'
              +     '<span style="font-size:11px;font-weight:800;color:rgba(249,115,22,.8);letter-spacing:.5px">BOX SCORE →</span>'
              +   '</div>'
              + '</div></a>';
          }).join('');
        })()}
      </div>

      <div id="tab-schedule" class="tab-pane hidden">
        ${games.map(g=>`
          <div class="game-row${g.status==='final'?' game-row-clickable':''}" ${g.status==='final'?`onclick="window.location='/league/${league.id}/game/${g.id}'"`:''}>
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
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:6px">
              ${statusBadge(g.status)}
              ${g.status==='final'?'<span style="font-size:11px;color:rgba(249,115,22,.7);font-weight:700;letter-spacing:.5px">BOX SCORE →</span>':''}
            </div>
          </div>`).join('') || '<div class="empty-state"><div class="es-icon">📅</div><div>No games scheduled.</div></div>'}
      </div>
    </div><!-- /pub-content -->
    </div><!-- /PAGE WRAPPER -->

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

    function statBox(label, value, color) {
      color = color || 'rgba(255,255,255,.8)';
      const valStr = String(value);
      const fontSize = valStr.length >= 6 ? '18px' : valStr.length >= 5 ? '20px' : '26px';
      // Pure inline styles — no CSS class dependency whatsoever
      return '<div style="display:inline-block;vertical-align:top;background:#161616;border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:14px 10px;text-align:center;width:calc(33.33% - 6px);min-width:80px;margin:3px;box-sizing:border-box">'
        + '<div style="font-size:9px;font-weight:800;letter-spacing:1.5px;color:rgba(255,255,255,.3);text-transform:uppercase;margin-bottom:6px">' + label + '</div>'
        + '<div style="font-size:' + fontSize + ';font-weight:900;color:' + color + ';line-height:1;font-family:Barlow Condensed,sans-serif">' + value + '</div>'
        + '</div>';
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
        <div style="font-size:0;margin:-3px;margin-bottom:20px">
          ${statBox('PTS', pts,      'var(--red)')}
          ${statBox('REB', reb,      'var(--teal)')}
          ${statBox('AST', ast,      'var(--purple)')}
          ${statBox('STL', stl,      'var(--gold)')}
          ${statBox('BLK', blk,      '#60a5fa')}
          ${statBox('GP',  gp,       'var(--muted)')}
          ${statBox('FG%', fgp+'%',  'var(--teal)')}
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

// ── PUBLIC BOX SCORE ─────────────────────────────────────────────────────────
router.get('/league/:lid/game/:gid', async (req, res) => {
  try {
    const { lid, gid } = req.params;
    const user = req.user || null;

    const [league, game, allStats] = await Promise.all([
      db.queryOne('SELECT * FROM leagues WHERE id=$1', [lid]),
      db.queryOne(
        `SELECT g.*,
           ht.name as home_name, ht.color as home_color,
           at.name as away_name, at.color as away_color
         FROM games g
         LEFT JOIN teams ht ON g.home_team_id=ht.id
         LEFT JOIN teams at ON g.away_team_id=at.id
         WHERE g.id=$1 AND g.league_id=$2`, [gid, lid]),
      db.query(
        `SELECT gs.*, p.name, p.jersey, p.pos, p.team_id,
           t.name as team_name, t.color as team_color
         FROM game_stats gs
         JOIN players p ON gs.player_id = p.id
         JOIN teams   t ON p.team_id = t.id
         WHERE gs.game_id=$1
         ORDER BY t.id, (gs.fg2m*2+gs.fg3m*3+gs.ftm) DESC`, [gid]),
    ]);

    if (!league || !game) return res.redirect('/league/' + lid);

    const homeWin = (game.home_score||0) > (game.away_score||0);

    // Split stats by team
    const homeStats = allStats.filter(r => r.team_id === game.home_team_id);
    const awayStats = allStats.filter(r => r.team_id === game.away_team_id);

    function calcPts(r) { return (r.fg2m||0)*2 + (r.fg3m||0)*3 + (r.ftm||0); }
    function calcReb(r) { return (r.oreb||0) + (r.dreb||0); }

    function teamTotals(rows) {
      return rows.reduce((t,r) => {
        t.pts += calcPts(r); t.reb += calcReb(r);
        t.ast += r.ast||0; t.stl += r.stl||0; t.blk += r.blk||0;
        t.to  += r.to_val||0;
        t.fgm += (r.fg2m||0)+(r.fg3m||0);
        t.fga += (r.fg2a||0)+(r.fg3a||0);
        t.ftm += r.ftm||0; t.fta += r.fta||0;
        return t;
      }, {pts:0,reb:0,ast:0,stl:0,blk:0,to:0,fgm:0,fga:0,ftm:0,fta:0});
    }

    function playerRow(r, i) {
      const pts = calcPts(r), reb = calcReb(r);
      const fgm = (r.fg2m||0)+(r.fg3m||0);
      const fga = (r.fg2a||0)+(r.fg3a||0);
      const fg  = fga > 0 ? fgm+'/'+fga : '—';
      const ft  = (r.fta||0) > 0 ? (r.ftm||0)+'/'+(r.fta||0) : '—';
      const top = i === 0;
      const nameHtml = (r.jersey ? '<span style="font-size:10px;color:rgba(255,255,255,.35);margin-right:5px">#'+esc(r.jersey)+'</span>' : '')
                     + '<span style="font-weight:'+(top?'800':'600')+'">'+esc(r.name||'—')+'</span>'
                     + (r.pos ? '<span style="margin-left:6px;background:#1c2a3a;color:#60a5fa;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:700">'+esc(r.pos)+'</span>' : '');
      return '<tr style="border-bottom:1px solid rgba(255,255,255,.05)">'
        + '<td class="bx-td-name">'+nameHtml+'</td>'
        + '<td class="bx-td" style="color:'+(top?'#f97316':'rgba(255,255,255,.8)')+';font-weight:'+(top?900:700)+'">'+pts+'</td>'
        + '<td class="bx-td">'+reb+'</td>'
        + '<td class="bx-td">'+(r.ast||0)+'</td>'
        + '<td class="bx-td">'+(r.stl||0)+'</td>'
        + '<td class="bx-td">'+(r.blk||0)+'</td>'
        + '<td class="bx-td">'+(r.to_val||0)+'</td>'
        + '<td class="bx-td bx-fg">'+fg+'</td>'
        + '<td class="bx-td bx-fg">'+ft+'</td>'
        + '</tr>';
    }

    function totalRow(t) {
      const fg = t.fga > 0 ? t.fgm+'/'+t.fga : '—';
      const ft = t.fta > 0 ? t.ftm+'/'+t.fta : '—';
      return '<tr style="background:rgba(255,255,255,.03);border-top:1px solid rgba(255,255,255,.12)">'
        + '<td class="bx-td-name" style="font-size:11px;font-weight:800;letter-spacing:.5px;color:rgba(255,255,255,.5)">TEAM TOTALS</td>'
        + '<td class="bx-td" style="color:#f97316;font-weight:900">'+t.pts+'</td>'
        + '<td class="bx-td">'+t.reb+'</td>'
        + '<td class="bx-td">'+t.ast+'</td>'
        + '<td class="bx-td">'+t.stl+'</td>'
        + '<td class="bx-td">'+t.blk+'</td>'
        + '<td class="bx-td">'+t.to+'</td>'
        + '<td class="bx-td bx-fg">'+fg+'</td>'
        + '<td class="bx-td bx-fg">'+ft+'</td>'
        + '</tr>';
    }

    function teamTable(name, color, rows) {
      if (!rows.length) return '<div style="padding:16px;color:rgba(255,255,255,.3);font-size:13px">No stats recorded for '+esc(name)+'</div>';
      const tot = teamTotals(rows);
      return '<div style="background:#111;border:1px solid rgba(255,255,255,.08);border-radius:10px;overflow:hidden;margin-bottom:16px">'
        + '<div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.08);border-left:3px solid '+(color||'#f97316')+';background:#161616;display:flex;align-items:center;justify-content:space-between">'
        + '<span style="font-family:Barlow Condensed,sans-serif;font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:.5px">'+esc(name)+'</span>'
        + '</div>'
        + '<div style="overflow-x:auto;-webkit-overflow-scrolling:touch">'
        + '<table style="width:100%;border-collapse:collapse;min-width:480px">'
        + '<thead><tr style="background:#161616">'
        + '<th class="bx-th-name">PLAYER</th>'
        + '<th class="bx-th">PTS</th><th class="bx-th">REB</th><th class="bx-th">AST</th>'
        + '<th class="bx-th">STL</th><th class="bx-th">BLK</th><th class="bx-th">TO</th>'
        + '<th class="bx-th">FG</th><th class="bx-th">FT</th>'
        + '</tr></thead>'
        + '<tbody>'
        + rows.map((r,i) => playerRow(r,i)).join('')
        + totalRow(tot)
        + '</tbody></table></div></div>';
    }

    res.send(page(esc(game.home_name||'') + ' vs ' + esc(game.away_name||'') + ' | ' + esc(league.name), `
      <style>
        .bx-td-name{padding:10px 14px;font-size:13px;min-width:150px;white-space:nowrap}
        .bx-td{padding:10px 10px;font-size:13px;text-align:center;color:rgba(255,255,255,.65);font-weight:600;white-space:nowrap}
        .bx-fg{font-size:12px;color:rgba(255,255,255,.45)!important;font-weight:500!important}
        .bx-th-name{padding:9px 14px;font-size:10px;font-weight:800;letter-spacing:1.5px;color:rgba(255,255,255,.35);text-transform:uppercase;text-align:left}
        .bx-th{padding:9px 10px;font-size:10px;font-weight:800;letter-spacing:1.5px;color:rgba(255,255,255,.35);text-transform:uppercase;text-align:center;white-space:nowrap}
        .game-row-clickable{cursor:pointer;transition:border-color .15s}
        .game-row-clickable:hover{border-color:rgba(249,115,22,.4)!important;background:rgba(249,115,22,.04)!important}
      </style>
      <nav class="topnav">
        <div class="topnav-inner">
          <div class="nav-brand">
            <a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px">
              <img src="/icons/icon-192.png?v=4" alt="HoopStats" style="width:38px;height:38px;border-radius:8px;object-fit:contain;flex-shrink:0">
              <div class="nav-brand-text"><div class="brand-text">HOOPSTATS</div><div class="brand-sub">Pilipinas</div></div>
            </a>
          </div>
          <div class="nav-actions">
            <a href="/league/${esc(league.id)}" class="nav-btn-orange">← Back to League</a>
            ${user ? '<a href="/admin" class="nav-btn-orange">Admin Panel</a>' : '<a href="/login" class="nav-btn-orange">Login</a>'}
          </div>
        </div>
      </nav>

      <div style="max-width:960px;margin:0 auto;padding:32px 24px 80px">

        <!-- SCOREBOARD -->
        <div style="background:#111;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:28px 20px 24px;margin-bottom:24px">
          <div style="text-align:center;font-size:11px;font-weight:800;letter-spacing:2px;color:rgba(255,255,255,.3);text-transform:uppercase;margin-bottom:20px">
            📍 ${esc(game.venue||'TBD')} &nbsp;·&nbsp; ${esc(game.date||'TBD')}
          </div>
          <table style="width:100%;border-collapse:collapse;max-width:560px;margin:0 auto">
            <tr>
              <td style="width:40%;vertical-align:middle;text-align:left">
                <div style="font-family:Barlow Condensed,sans-serif;font-size:clamp(18px,3.5vw,26px);font-weight:900;text-transform:uppercase;color:#fff;margin-bottom:6px">${esc(game.home_name||'Home')}</div>
                <span style="display:inline-block;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:800;letter-spacing:1px;background:${homeWin?'rgba(0,212,170,.15)':'rgba(255,255,255,.05)'};color:${homeWin?'#00d4aa':'rgba(255,255,255,.35)'}">${homeWin?'WIN':'LOSS'}</span>
              </td>
              <td style="width:20%;text-align:center;vertical-align:middle">
                <div style="font-family:Barlow Condensed,sans-serif;font-size:clamp(42px,9vw,72px);font-weight:900;line-height:1;color:${homeWin?'#00d4aa':'rgba(255,255,255,.65)'}">${game.home_score??'—'}</div>
                <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:rgba(255,255,255,.2);margin:8px 0">FINAL</div>
                <div style="font-family:Barlow Condensed,sans-serif;font-size:clamp(42px,9vw,72px);font-weight:900;line-height:1;color:${!homeWin?'#00d4aa':'rgba(255,255,255,.65)'}">${game.away_score??'—'}</div>
              </td>
              <td style="width:40%;vertical-align:middle;text-align:right">
                <div style="font-family:Barlow Condensed,sans-serif;font-size:clamp(18px,3.5vw,26px);font-weight:900;text-transform:uppercase;color:#fff;margin-bottom:6px">${esc(game.away_name||'Away')}</div>
                <span style="display:inline-block;padding:3px 10px;border-radius:4px;font-size:10px;font-weight:800;letter-spacing:1px;background:${!homeWin?'rgba(0,212,170,.15)':'rgba(255,255,255,.05)'};color:${!homeWin?'#00d4aa':'rgba(255,255,255,.35)'}">${!homeWin?'WIN':'LOSS'}</span>
              </td>
            </tr>
          </table>
        </div>

        <!-- BOX SCORE -->
        <div style="font-family:Barlow Condensed,sans-serif;font-size:22px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px;display:flex;align-items:center;gap:8px">
          📊 Box Score
          <span style="font-size:11px;font-weight:700;color:rgba(255,255,255,.3);letter-spacing:1px;font-family:'Outfit',sans-serif">Per game stats</span>
        </div>

        ${teamTable(game.home_name, game.home_color, homeStats)}
        ${teamTable(game.away_name, game.away_color, awayStats)}

        ${(!homeStats.length && !awayStats.length) ? '<div style="text-align:center;padding:40px;color:rgba(255,255,255,.25);font-size:14px">No box score data recorded for this game yet.</div>' : ''}

      </div>
    `));
  } catch(err) {
    console.error('Box score error:', err);
    res.redirect('/league/' + req.params.lid);
  }
});

// ── TERMS OF USE ──────────────────────────────────────────────────────────────
router.get('/terms', (req, res) => {
  res.send(page('Terms of Use | HoopStats Pilipinas', `
    <nav class="topnav">
      <div class="topnav-inner">
        <div class="nav-brand">
          <a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px">
            <img src="/icons/icon-192.png?v=4" alt="HoopStats" style="width:38px;height:38px;border-radius:8px;object-fit:contain;flex-shrink:0">
            <div class="nav-brand-text">
              <div class="brand-text">HOOPSTATS</div>
              <div class="brand-sub">Pilipinas</div>
            </div>
          </a>
        </div>
        <div class="nav-actions">
          <a href="/" class="nav-btn-orange">← Home</a>
        </div>
      </div>
    </nav>
    <div style="max-width:800px;margin:0 auto;padding:48px 24px 80px">
      <div style="margin-bottom:32px">
        <div style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:var(--orange);margin-bottom:12px">Legal</div>
        <h1 style="font-family:'Barlow Condensed',sans-serif;font-size:clamp(36px,5vw,52px);font-weight:900;text-transform:uppercase;letter-spacing:-.5px;margin-bottom:8px">Terms of Use</h1>
        <p style="font-size:13px;color:rgba(255,255,255,.35)">Last updated: June 2025 &nbsp;·&nbsp; Effective immediately upon use</p>
      </div>

      <div style="background:#161616;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:28px 32px;margin-bottom:16px">
        <p style="font-size:14px;color:rgba(255,255,255,.6);line-height:1.8">
          Welcome to <strong style="color:#fff">HoopStats Pilipinas</strong> ("HoopStats," "we," "our," or "us"). By accessing or using our platform at hoopstats-ph.up.railway.app or any associated mobile application (collectively, the "Service"), you agree to be bound by these Terms of Use. If you do not agree, please discontinue use immediately.
        </p>
      </div>

      ${[
        {
          num:'1', title:'Acceptance of Terms',
          body:`By registering an account or using any part of the Service, you confirm that you are at least 13 years of age and have the legal capacity to enter into these Terms. Use of the Service by minors under 13 is prohibited without verifiable parental consent.`
        },
        {
          num:'2', title:'Description of Service',
          body:`HoopStats Pilipinas is a basketball league management platform designed for Philippine basketball communities. It allows commissioners to create and manage leagues, track player statistics using FIBA 2024 standards, operate live scoring, and share results publicly. The Service is provided on a free-to-start basis with potential premium features in the future.`
        },
        {
          num:'3', title:'User Accounts',
          body:`You are responsible for maintaining the confidentiality of your account credentials. You agree to (a) provide accurate and complete registration information; (b) notify us immediately of any unauthorized use of your account; (c) not share your login credentials with others; and (d) not create multiple accounts to circumvent restrictions. HoopStats reserves the right to suspend or terminate accounts that violate these Terms.`
        },
        {
          num:'4', title:'Commissioner Responsibilities',
          body:`As a league commissioner, you are solely responsible for: (a) the accuracy of all player information, statistics, and game records entered into the platform; (b) obtaining consent from players and team members before adding their personal information; (c) ensuring that your league operations comply with applicable laws and regulations; and (d) the conduct of all users under your league's admin code.`
        },
        {
          num:'5', title:'Player Data and Consent',
          body:`Commissioners who add player profiles must ensure they have obtained appropriate consent from players or their legal guardians (for minors) before entering personal data such as names, positions, jersey numbers, photos, and statistics. Players or their guardians may request removal of their data at any time by contacting the league commissioner or HoopStats directly.`
        },
        {
          num:'6', title:'Prohibited Conduct',
          body:`You agree not to: (a) use the Service for any unlawful purpose; (b) upload false, misleading, or defamatory content; (c) impersonate any person or entity; (d) attempt to gain unauthorized access to any part of the Service or its infrastructure; (e) use automated tools to scrape, crawl, or harvest data without permission; (f) interfere with or disrupt the Service's servers or networks; or (g) use the platform to promote gambling, betting, or match-fixing activities.`
        },
        {
          num:'7', title:'Intellectual Property',
          body:`All content, features, and functionality of the Service — including but not limited to text, graphics, logos, icons, and software — are the exclusive property of HoopStats Pilipinas and are protected by applicable intellectual property laws. You are granted a limited, non-exclusive, non-transferable license to use the Service solely for its intended purpose. You may not copy, modify, distribute, or create derivative works without our express written permission.`
        },
        {
          num:'8', title:'User-Generated Content',
          body:`By uploading content (including player photos, team logos, and other media) to the Service, you grant HoopStats a non-exclusive, worldwide, royalty-free license to use, display, and distribute that content in connection with operating and improving the Service. You represent that you own or have the necessary rights to such content and that it does not infringe any third-party rights.`
        },
        {
          num:'9', title:'Public League Pages',
          body:`Leagues marked as "public" will be accessible to anyone with the link, including non-registered users. Commissioners should carefully consider what information is made public. HoopStats is not responsible for how publicly accessible data is used by third parties.`
        },
        {
          num:'10', title:'Disclaimer of Warranties',
          body:`THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. HOOPSTATS DOES NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR COMPLETELY SECURE. USE OF THE SERVICE IS AT YOUR SOLE RISK.`
        },
        {
          num:'11', title:'Limitation of Liability',
          body:`TO THE MAXIMUM EXTENT PERMITTED BY LAW, HOOPSTATS PILIPINAS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM YOUR USE OF OR INABILITY TO USE THE SERVICE, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT YOU PAID TO US IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM.`
        },
        {
          num:'12', title:'Modifications to the Service and Terms',
          body:`HoopStats reserves the right to modify, suspend, or discontinue the Service (or any part thereof) at any time without prior notice. We may also update these Terms from time to time. Continued use of the Service after any changes constitutes your acceptance of the revised Terms. We will make reasonable efforts to notify registered users of material changes via email or in-app notification.`
        },
        {
          num:'13', title:'Governing Law',
          body:`These Terms shall be governed by and construed in accordance with the laws of the Republic of the Philippines, without regard to its conflict of law provisions. Any dispute arising under these Terms shall be subject to the exclusive jurisdiction of the courts of the Philippines.`
        },
        {
          num:'14', title:'Contact Us',
          body:`If you have questions about these Terms, please contact us through the platform's public channels or by emailing the league administrator. We will do our best to respond within a reasonable timeframe.`
        },
      ].map(s => `
        <div style="margin-bottom:16px;padding:24px 32px;background:#111;border:1px solid rgba(255,255,255,.07);border-radius:10px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <div style="width:28px;height:28px;border-radius:50%;background:rgba(249,115,22,.15);border:1px solid rgba(249,115,22,.3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:var(--orange);flex-shrink:0">${s.num}</div>
            <h2 style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:.3px">${s.title}</h2>
          </div>
          <p style="font-size:14px;color:rgba(255,255,255,.58);line-height:1.85;margin-left:40px">${s.body}</p>
        </div>
      `).join('')}

      <div style="margin-top:32px;padding:20px 32px;background:rgba(249,115,22,.06);border:1px solid rgba(249,115,22,.2);border-radius:10px;text-align:center">
        <p style="font-size:13px;color:rgba(255,255,255,.5);line-height:1.7">
          By using HoopStats Pilipinas, you acknowledge that you have read, understood, and agree to these Terms of Use.<br>
          <a href="/privacy" style="color:var(--orange);font-weight:700">Privacy Policy</a> &nbsp;·&nbsp;
          <a href="/" style="color:var(--orange);font-weight:700">Back to Home</a>
        </p>
      </div>
    </div>
  `));
});

// ── PRIVACY POLICY ────────────────────────────────────────────────────────────
router.get('/privacy', (req, res) => {
  res.send(page('Privacy Policy | HoopStats Pilipinas', `
    <nav class="topnav">
      <div class="topnav-inner">
        <div class="nav-brand">
          <a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px">
            <img src="/icons/icon-192.png?v=4" alt="HoopStats" style="width:38px;height:38px;border-radius:8px;object-fit:contain;flex-shrink:0">
            <div class="nav-brand-text">
              <div class="brand-text">HOOPSTATS</div>
              <div class="brand-sub">Pilipinas</div>
            </div>
          </a>
        </div>
        <div class="nav-actions">
          <a href="/" class="nav-btn-orange">← Home</a>
        </div>
      </div>
    </nav>
    <div style="max-width:800px;margin:0 auto;padding:48px 24px 80px">
      <div style="margin-bottom:32px">
        <div style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:var(--orange);margin-bottom:12px">Legal</div>
        <h1 style="font-family:'Barlow Condensed',sans-serif;font-size:clamp(36px,5vw,52px);font-weight:900;text-transform:uppercase;letter-spacing:-.5px;margin-bottom:8px">Privacy Policy</h1>
        <p style="font-size:13px;color:rgba(255,255,255,.35)">Last updated: June 2025 &nbsp;·&nbsp; Applies to all users of HoopStats Pilipinas</p>
      </div>

      <div style="background:#161616;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:28px 32px;margin-bottom:16px">
        <p style="font-size:14px;color:rgba(255,255,255,.6);line-height:1.8">
          HoopStats Pilipinas ("we," "our," or "us") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our basketball league management platform. We comply with the <strong style="color:#fff">Republic Act No. 10173</strong> — the Data Privacy Act of 2012 of the Philippines — and applicable international privacy standards.
        </p>
      </div>

      ${[
        {
          num:'1', title:'Information We Collect',
          subsections:[
            {sub:'Account Information', text:'When you register, we collect your name, email address, and password (stored as a bcrypt hash). We never store your password in plain text.'},
            {sub:'League & Player Data', text:'Commissioners may enter player names, jersey numbers, positions, photos, and game statistics. This data is provided voluntarily by the commissioner who is responsible for obtaining player consent.'},
            {sub:'Usage Data', text:'We automatically collect information about how you interact with the Service, including IP addresses, browser type, pages visited, time spent, and device information. This helps us improve the platform.'},
            {sub:'Uploaded Media', text:'Profile photos and team logos uploaded to the platform are stored securely on our servers.'},
          ]
        },
        {
          num:'2', title:'How We Use Your Information',
          subsections:[
            {sub:'Service Operation', text:'To create and manage your account, display league data, process live scores, and generate standings and statistics.'},
            {sub:'Communication', text:'To send important account notifications, service updates, and respond to your inquiries. We do not send marketing emails without your explicit consent.'},
            {sub:'Platform Improvement', text:'To analyze usage patterns, diagnose technical issues, and improve the features and performance of the Service.'},
            {sub:'Legal Compliance', text:'To comply with applicable laws, respond to lawful requests, and protect the rights and safety of our users and the public.'},
          ]
        },
        {
          num:'3', title:'Public Information',
          body:`Leagues set to "public" by the commissioner will have their standings, player statistics, game results, and schedules visible to anyone with the league link — no account required. Commissioners are responsible for ensuring appropriate consent before making player data publicly accessible. Players or their guardians may request their data be made private at any time.`
        },
        {
          num:'4', title:'Data Sharing and Disclosure',
          body:`We do not sell, trade, or rent your personal information to third parties. We may share data only in the following circumstances: (a) with service providers who assist in operating the platform (e.g., Railway for hosting, database providers) under strict confidentiality obligations; (b) when required by law, court order, or government authority; (c) to protect the rights, property, or safety of HoopStats, our users, or the public; or (d) in connection with a business transfer, merger, or acquisition, with appropriate notice to users.`
        },
        {
          num:'5', title:'Data Security',
          body:`We implement industry-standard security measures including: (a) bcrypt hashing for all passwords; (b) HTTPS/TLS encryption for all data in transit; (c) JWT-based authentication with secure session management; (d) database access restricted to authorized services only; and (e) regular security reviews. However, no method of transmission or storage is 100% secure. We encourage you to use strong, unique passwords and report any suspected security issues immediately.`
        },
        {
          num:'6', title:'Your Rights Under the Data Privacy Act (RA 10173)',
          body:`As a data subject, you have the following rights: (a) <strong>Right to be Informed</strong> — know how your data is collected and used; (b) <strong>Right to Access</strong> — request a copy of your personal data we hold; (c) <strong>Right to Rectification</strong> — request correction of inaccurate data; (d) <strong>Right to Erasure</strong> — request deletion of your personal data, subject to legal retention requirements; (e) <strong>Right to Object</strong> — object to processing of your data for specific purposes; (f) <strong>Right to Data Portability</strong> — receive your data in a structured, machine-readable format; and (g) <strong>Right to Lodge a Complaint</strong> — file a complaint with the National Privacy Commission (NPC) of the Philippines.`
        },
        {
          num:'7', title:'Children\'s Privacy',
          body:`The Service is not directed to children under 13. We do not knowingly collect personal information from children under 13 without verifiable parental consent. If you believe a child under 13 has provided personal information through our platform without consent, please contact us immediately and we will take steps to remove such information.`
        },
        {
          num:'8', title:'Cookies and Tracking',
          body:`We use session cookies essential for authentication and platform functionality. We do not use advertising cookies or third-party tracking pixels. You may disable cookies in your browser settings, but this may affect platform functionality, particularly the ability to stay logged in.`
        },
        {
          num:'9', title:'Data Retention',
          body:`We retain your account data for as long as your account is active. League and player data is retained for the duration of the league season and may be archived for historical records. You may request deletion of your account and associated data at any time. Certain data may be retained for legal compliance purposes even after account deletion.`
        },
        {
          num:'10', title:'Third-Party Services',
          body:`Our platform is hosted on Railway (railway.app). Your data is stored on servers they provide. We encourage you to review Railway's privacy policy. We use Google Fonts for typography (loaded from Google's servers). No other third-party services have access to your personal data.`
        },
        {
          num:'11', title:'Changes to This Policy',
          body:`We may update this Privacy Policy periodically. We will notify registered users of significant changes via email or in-app notification. The "Last updated" date at the top of this page reflects the most recent revision. Continued use of the Service after changes constitutes acceptance of the updated policy.`
        },
        {
          num:'12', title:'Contact & Data Privacy Officer',
          body:`For privacy-related concerns, requests to exercise your rights, or to report a data breach, please contact the HoopStats Pilipinas Data Privacy Officer through the platform. We will respond to all verifiable requests within 30 days in accordance with RA 10173. You also have the right to lodge a complaint with the National Privacy Commission (NPC) at www.privacy.gov.ph.`
        },
      ].map(s => `
        <div style="margin-bottom:16px;padding:24px 32px;background:#111;border:1px solid rgba(255,255,255,.07);border-radius:10px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:${s.subsections ? 16 : 12}px">
            <div style="width:28px;height:28px;border-radius:50%;background:rgba(249,115,22,.15);border:1px solid rgba(249,115,22,.3);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:var(--orange);flex-shrink:0">${s.num}</div>
            <h2 style="font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:.3px">${s.title}</h2>
          </div>
          ${s.subsections ? s.subsections.map(ss => `
            <div style="margin-left:40px;margin-bottom:14px">
              <div style="font-size:12px;font-weight:800;color:var(--orange);letter-spacing:.5px;margin-bottom:4px">${ss.sub}</div>
              <p style="font-size:14px;color:rgba(255,255,255,.58);line-height:1.85">${ss.text}</p>
            </div>
          `).join('') : `<p style="font-size:14px;color:rgba(255,255,255,.58);line-height:1.85;margin-left:40px">${s.body}</p>`}
        </div>
      `).join('')}

      <div style="margin-top:32px;padding:20px 32px;background:rgba(249,115,22,.06);border:1px solid rgba(249,115,22,.2);border-radius:10px;text-align:center">
        <p style="font-size:13px;color:rgba(255,255,255,.5);line-height:1.7">
          Your privacy matters to us. We are committed to transparent, responsible data practices.<br>
          <a href="/terms" style="color:var(--orange);font-weight:700">Terms of Use</a> &nbsp;·&nbsp;
          <a href="/" style="color:var(--orange);font-weight:700">Back to Home</a>
        </p>
      </div>
    </div>
  `));
});
