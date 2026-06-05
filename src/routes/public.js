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
  const tickerBase = [
    ...leagues.slice(0,5).map(l => l.name.toUpperCase() + ' \u2014 ' + (l.status||'UPCOMING').toUpperCase()),
    '\uD83C\uDFC0 LIVE FIBA STATS TRACKING',
    '\u26A1 REAL-TIME LEADERBOARDS',
    `\uD83D\uDC5F ${stats.players} PLAYERS TRACKED`,
    '\uD83D\uDCF2 AVAILABLE AS PWA \u2014 INSTALL NOW',
    '\uD83C\uDFC6 FIBA 2024 STANDARD STATS ENGINE',
    '\uD83C\uDDF5\uD83C\uDDED BUILT FOR PHILIPPINE BASKETBALL',
  ];
  const ticker = [...tickerBase,...tickerBase]
    .map(t => `<span class="ti">${t}</span>`).join('');

  const leagueRows = leagues.map(l => {
    const isOngoing = l.status === 'ongoing';
    const lc = l.level==='Barangay'?'var(--orange)':l.level==='City/Municipal'?'#6b9fff':l.level==='Provincial'?'#00d4aa':'#a78bfa';
    const statusBadge = isOngoing
      ? `<span class="son">&#x25CF; ONGOING</span>`
      : `<span class="sup">${(l.status||'UPCOMING').toUpperCase()}</span>`;
    return `<a href="/league/${l.id}" class="lrow" data-level="${esc(l.level)}">
      <div>
        <div class="lname">${esc(l.name)}</div>
        <div class="lmeta">
          <span>&#x1F4CD; ${esc(l.location)}</span>
          <span>&#x1F465; ${l.team_count} Teams</span>
          <span>&#x1F4C5; ${esc(l.season)}</span>
          <span style="color:${lc}">${esc(l.level)}</span>
        </div>
      </div>
      <div class="lright">${statusBadge}<span class="larr">&#x203A;</span></div>
    </a>`;
  }).join('') || `<div style="padding:40px;text-align:center;color:rgba(255,255,255,.25);font-size:14px">No public leagues yet. <a href="/register" style="color:var(--orange)">Be the first!</a></div>`;

  return page('HoopStats Pilipinas — Philippine Basketball Stats Platform', `
    <style>
      body{background:#0a0a0a}
      :root{--orange:#f97316;--orange-d:#ea580c;--orange-dim:rgba(249,115,22,.1);--black:#0a0a0a;--d1:#111;--d2:#161616;--d3:#1c1c1c;--border:rgba(255,255,255,.07);--border2:rgba(255,255,255,.13)}
      /* NAV */
      .lp-nav{position:sticky;top:0;z-index:200;background:rgba(10,10,10,.92);backdrop-filter:blur(20px);border-bottom:1px solid var(--border);height:70px;transition:all .3s;display:flex;align-items:center;justify-content:center}
      .lp-nav.scrolled{background:rgba(10,10,10,.99);box-shadow:0 4px 24px rgba(0,0,0,.5)}
      .lp-nav-inner{max-width:1260px;width:100%;margin:0 auto;padding:0 40px;display:flex;align-items:center;gap:0;height:100%}.lp-logo{display:flex;align-items:center;gap:12px;margin-right:40px;flex-shrink:0;text-decoration:none;color:inherit}
      .lp-logo img{width:44px;height:44px;border-radius:9px;object-fit:contain}
      .lp-logo-name{font-family:'Barlow Condensed',sans-serif;font-size:21px;font-weight:900;letter-spacing:1px;background:linear-gradient(135deg,#f97316,#fb923c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1.1}
      .lp-logo-sub{font-size:9px;color:#f97316;letter-spacing:3.5px;font-weight:700;text-transform:uppercase;opacity:.85}
      .lp-nav-links{display:flex;align-items:center;gap:0}
      .lp-nav-links a{color:rgba(255,255,255,.42);font-size:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;padding:8px 18px;border-radius:4px;transition:color .15s}
      .lp-nav-links a:hover{color:#fff}
      .lp-nav-actions{display:flex;align-items:center;gap:10px;margin-left:auto;flex-shrink:0}
      .lp-btn-signin{color:rgba(255,255,255,.55);font-size:13px;font-weight:700;padding:8px 14px;cursor:pointer;background:none;border:none;font-family:'Outfit',sans-serif;transition:color .15s;text-decoration:none}
      .lp-btn-signin:hover{color:#fff}
      .lp-btn-cta{background:var(--orange);color:#fff;border:none;border-radius:5px;padding:10px 22px;font-size:13px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;cursor:pointer;font-family:'Outfit',sans-serif;transition:all .15s;white-space:nowrap;text-decoration:none;display:inline-flex;align-items:center}
      .lp-btn-cta:hover{background:var(--orange-d);transform:translateY(-1px);box-shadow:0 6px 20px rgba(249,115,22,.35);color:#fff}
      /* HERO */
      .lp-hero{position:relative;min-height:100vh;display:flex;align-items:center;overflow:hidden;background:var(--black)}
      .lp-hero-bg{position:absolute;inset:0;background:url('https://images.unsplash.com/photo-1546519638-68e109498ffc?w=1600&q=80') right center/cover no-repeat;filter:grayscale(15%) brightness(.75)}
      .lp-hero-bg::before{content:'';position:absolute;inset:0;background:linear-gradient(105deg,rgba(10,10,10,.92) 25%,rgba(10,10,10,.55) 50%,rgba(10,10,10,.05) 100%);z-index:1}
      .lp-hero-bg::after{content:'';position:absolute;inset:0;z-index:0}
      .lp-hero-inner{position:relative;z-index:3;width:100%;display:flex;align-items:center;min-height:100vh}
      .lp-hero-content{max-width:660px;padding:80px 0 100px}.lp-badge{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(249,115,22,.7);border-radius:4px;padding:7px 16px;margin-bottom:36px;font-size:11px;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:#f97316;background:rgba(249,115,22,.06)}
      .lp-badge::before{content:'\\25CF';font-size:7px;animation:blink 1.8s infinite}
      @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
      .lp-h1{font-family:'Barlow Condensed',sans-serif;font-size:clamp(58px,7.5vw,108px);font-weight:900;line-height:.92;text-transform:uppercase;letter-spacing:-1px;white-space:nowrap}
      .lp-h1 .accent{color:#f97316;font-style:italic}
      .lp-h1 .ghost{color:rgba(255,255,255,.18);font-style:italic;display:block;letter-spacing:-2px}
      .lp-hero-sub{font-size:17px;color:rgba(255,255,255,.56);line-height:1.78;max-width:560px;margin:28px 0 40px}
      .lp-hero-btns{display:flex;gap:14px;flex-wrap:wrap}
      .lp-btn-primary{background:var(--orange);color:#fff;border:none;border-radius:5px;padding:17px 34px;font-size:14px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;cursor:pointer;font-family:'Outfit',sans-serif;display:inline-flex;align-items:center;gap:10px;box-shadow:0 8px 32px rgba(249,115,22,.3);transition:all .2s;text-decoration:none}
      .lp-btn-primary:hover{background:var(--orange-d);transform:translateY(-2px);box-shadow:0 12px 40px rgba(249,115,22,.45);color:#fff}
      .lp-btn-ghost{background:rgba(255,255,255,.04);color:#fff;border:1.5px solid rgba(255,255,255,.22);border-radius:5px;padding:17px 32px;font-size:14px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;cursor:pointer;font-family:'Outfit',sans-serif;display:inline-flex;align-items:center;gap:8px;transition:all .2s;text-decoration:none}
      .lp-btn-ghost:hover{border-color:var(--orange);color:var(--orange);background:rgba(249,115,22,.06);text-decoration:none}
      /* STATS STRIP */
      .lp-stats{background:var(--d1);display:grid;grid-template-columns:repeat(4,1fr);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
      .lp-sc{padding:36px 24px;text-align:center;border-right:1px solid var(--border);position:relative;overflow:hidden;transition:background .2s}
      .lp-sc:last-child{border-right:none}
      .lp-sc:hover{background:rgba(249,115,22,.04)}
      .lp-sc::after{content:'';position:absolute;bottom:0;left:50%;right:50%;height:2px;background:var(--orange);transition:all .3s;opacity:0}
      .lp-sc:hover::after{left:0;right:0;opacity:1}
      .lp-sn{font-family:'Barlow Condensed',sans-serif;font-size:62px;font-weight:900;color:var(--orange);line-height:1;display:block;letter-spacing:-1px}
      .lp-sl{font-size:10px;font-weight:800;letter-spacing:3px;color:rgba(255,255,255,.32);text-transform:uppercase;margin-top:8px;display:block}
      /* TICKER */
      .lp-ticker-wrap{background:var(--orange);overflow:hidden;padding:11px 0;position:relative}
      .lp-ticker-wrap::before,.lp-ticker-wrap::after{content:'';position:absolute;top:0;bottom:0;width:60px;z-index:2;pointer-events:none}
      .lp-ticker-wrap::before{left:0;background:linear-gradient(to right,var(--orange),transparent)}
      .lp-ticker-wrap::after{right:0;background:linear-gradient(to left,var(--orange),transparent)}
      .lp-ticker{display:flex;animation:lpTick 40s linear infinite;white-space:nowrap}
      .ti{display:inline-flex;align-items:center;font-size:12px;font-weight:800;letter-spacing:1.8px;text-transform:uppercase;color:#fff;padding:0 28px;flex-shrink:0}
      .ti::after{content:'\\25C6';margin-left:28px;opacity:.4;font-size:7px}
      @keyframes lpTick{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
      /* SECTION */
      .lp-section{padding:110px 40px}
      .lp-si{max-width:1260px;margin:0 auto}
      .lp-eyebrow{font-size:11px;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:var(--orange);margin-bottom:14px;display:block}
      /* FEATURES */
      .lp-feat-bg{background:var(--d1)}
      .lp-fhead{display:grid;grid-template-columns:1fr 1.1fr;gap:64px;align-items:flex-end;margin-bottom:72px}
      .lp-ftitle{font-family:'Barlow Condensed',sans-serif;font-size:clamp(46px,5.5vw,72px);font-weight:900;text-transform:uppercase;line-height:.92;letter-spacing:-1px}
      .lp-ftitle .ol{color:var(--orange)}
      .lp-fright p{font-size:16px;color:rgba(255,255,255,.38);line-height:1.85;max-width:440px;margin-left:auto}
      .lp-fgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:rgba(255,255,255,.08);border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,.09)}
      .lp-fc{background:var(--d2);padding:40px 36px;position:relative;transition:background .25s;cursor:default}
      .lp-fc:hover{background:#1e1e1e}
      .lp-fc:hover .lp-fcg{opacity:1}
      .lp-fcg{position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--orange),transparent);opacity:0;transition:opacity .25s}
      .lp-ftag{position:absolute;top:24px;right:24px;font-size:9px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.25);border:1px solid rgba(255,255,255,.1);padding:4px 9px;border-radius:3px}
      .lp-ficon{width:52px;height:52px;border-radius:10px;background:rgba(249,115,22,.12);border:1px solid rgba(249,115,22,.15);display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:26px;transition:all .2s}
      .lp-fc:hover .lp-ficon{background:rgba(249,115,22,.2);border-color:rgba(249,115,22,.35)}
      .lp-fct{font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
      .lp-fcd{font-size:13.5px;color:rgba(255,255,255,.36);line-height:1.78}
      /* HOW */
      .lp-how-bg{background:var(--black);position:relative;overflow:hidden}
      .lp-how-bg::before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:48px 48px;pointer-events:none}
      .lp-hgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;margin-top:64px;position:relative}
      .lp-hgrid::before{content:'';position:absolute;top:36px;left:calc(16.66% + 20px);right:calc(16.66% + 20px);height:1px;background:linear-gradient(90deg,transparent,var(--orange),transparent);opacity:.35}
      .lp-hstep{text-align:center}
      .lp-hnum{width:72px;height:72px;border-radius:50%;border:1px solid rgba(249,115,22,.3);background:rgba(249,115,22,.07);display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:900;color:var(--orange);margin:0 auto 24px;position:relative;z-index:1;transition:all .3s}
      .lp-hstep:hover .lp-hnum{background:rgba(249,115,22,.18);border-color:rgba(249,115,22,.6);box-shadow:0 0 32px rgba(249,115,22,.2)}
      .lp-ht{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
      .lp-hd{font-size:14px;color:rgba(255,255,255,.4);line-height:1.75;max-width:260px;margin:0 auto}
      /* LEAGUES */
      .lp-ll{display:grid;grid-template-columns:400px 1fr;gap:96px;align-items:start}
      .lp-lt{font-family:'Barlow Condensed',sans-serif;font-size:clamp(50px,6.5vw,80px);font-weight:900;text-transform:uppercase;line-height:.9;letter-spacing:-1.5px;margin:14px 0 22px}
      .lp-lt span{color:var(--orange)}
      .lp-ld{font-size:14.5px;color:rgba(255,255,255,.38);line-height:1.82;margin-bottom:30px;max-width:380px}
      .lp-lvl{list-style:none;margin-bottom:36px;display:flex;flex-direction:column;gap:12px}
      .lp-lvl li{display:flex;align-items:center;gap:12px;font-size:14.5px;font-weight:600;color:rgba(255,255,255,.62)}
      .lp-lvl li::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--orange);flex-shrink:0;box-shadow:0 0 8px rgba(249,115,22,.5)}
      .lp-lphoto{border-radius:10px;overflow:hidden;margin-top:10px;position:relative}
      .lp-lphoto img{width:100%;height:220px;object-fit:cover;filter:grayscale(20%) brightness(.78);transition:filter .4s;display:block}
      .lp-lphoto:hover img{filter:grayscale(0%) brightness(.9)}
      .lp-lphoto-cap{position:absolute;bottom:12px;left:14px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.5)}
      .lp-lfilt{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}
      .lp-lfbtn{padding:7px 16px;border-radius:4px;font-size:11px;font-weight:800;background:transparent;color:rgba(255,255,255,.35);border:1px solid rgba(255,255,255,.1);cursor:pointer;transition:all .15s;letter-spacing:.8px;text-transform:uppercase;font-family:'Outfit',sans-serif}
      .lp-lfbtn.active,.lp-lfbtn:hover{background:rgba(249,115,22,.1);color:var(--orange);border-color:rgba(249,115,22,.3)}
      .lp-llist{display:flex;flex-direction:column;gap:8px}
      .lrow{background:var(--d2);border:1px solid rgba(255,255,255,.07);border-left:3px solid var(--orange);border-radius:7px;padding:22px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer;transition:all .2s;text-decoration:none;color:inherit}
      .lrow:hover{background:var(--d3);border-color:rgba(249,115,22,.3);transform:translateX(5px);box-shadow:0 4px 24px rgba(0,0,0,.4);text-decoration:none;color:inherit}
      .lname{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#fff;margin-bottom:7px}
      .lmeta{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:12px;color:rgba(255,255,255,.38)}
      .lright{display:flex;align-items:center;gap:12px;flex-shrink:0}
      .son{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:800;letter-spacing:1px;color:var(--orange);background:rgba(249,115,22,.1);padding:5px 12px;border-radius:4px;white-space:nowrap}
      .sup{display:inline-flex;align-items:center;font-size:11px;font-weight:800;letter-spacing:1px;color:rgba(255,255,255,.38);border:1px solid rgba(255,255,255,.1);padding:5px 12px;border-radius:4px;white-space:nowrap}
      .larr{color:rgba(255,255,255,.18);font-size:20px;transition:all .2s;line-height:1}
      .lrow:hover .larr{color:var(--orange);transform:translateX(3px)}
      .lp-lva{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:18px 24px;margin-top:8px;background:var(--d2);border:1px solid rgba(255,255,255,.06);border-radius:7px;font-size:12px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.28);cursor:pointer;transition:color .15s;text-decoration:none}
      .lp-lva:hover{color:var(--orange)}
      /* TESTIMONIALS */
      .lp-social-bg{background:var(--d1);position:relative;overflow:hidden}
      .lp-social-bg::after{content:'';position:absolute;top:-200px;right:-200px;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(249,115,22,.07) 0%,transparent 70%);pointer-events:none}
      .lp-sgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:60px}
      .lp-scard{background:var(--d3);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:32px;position:relative;overflow:hidden;transition:border-color .2s}
      .lp-scard:hover{border-color:rgba(249,115,22,.25)}
      .lp-scard::before{content:'\\275D';position:absolute;top:12px;right:20px;font-size:64px;color:rgba(249,115,22,.05);font-family:serif;line-height:1}
      .lp-stext{font-size:14.5px;color:rgba(255,255,255,.55);line-height:1.8;margin-bottom:24px;font-style:italic}
      .lp-sauth{display:flex;align-items:center;gap:12px}
      .lp-savt{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--orange),var(--orange-d));display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;color:#fff;flex-shrink:0;font-family:'Barlow Condensed',sans-serif}
      .lp-sname{font-size:13px;font-weight:700}
      .lp-srole{font-size:11px;color:rgba(255,255,255,.35);margin-top:2px}
      .lp-sstars{color:var(--orange);font-size:12px;margin-bottom:16px;letter-spacing:2px}
      /* CTA */
      .lp-cta-box{background:linear-gradient(135deg,#1a0f00,#0f0f0f);border:1px solid rgba(249,115,22,.2);border-radius:16px;padding:80px;text-align:center;position:relative;overflow:hidden;max-width:900px;margin:0 auto}
      .lp-cta-box::before{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 60% 60% at 50% 0%,rgba(249,115,22,.12) 0%,transparent 70%)}
      .lp-ctitle{font-family:'Barlow Condensed',sans-serif;font-size:clamp(40px,6vw,72px);font-weight:900;text-transform:uppercase;line-height:.95;letter-spacing:-1px;margin-bottom:20px;position:relative}
      .lp-ctitle span{color:var(--orange)}
      .lp-csub{font-size:16px;color:rgba(255,255,255,.45);max-width:480px;margin:0 auto 36px;line-height:1.75;position:relative}
      .lp-cbtns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;position:relative}
      /* FOOTER */
      .lp-footer{background:#080808;border-top:1px solid rgba(255,255,255,.06);padding:64px 40px 40px}
      .lp-fi{max-width:1260px;margin:0 auto}
      .lp-ftop{display:grid;grid-template-columns:280px 1fr 1fr 1fr;gap:48px;margin-bottom:56px}
      .lp-fbrand img{width:44px;height:44px;border-radius:9px;object-fit:contain;margin-bottom:16px}
      .lp-fbname{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:900;letter-spacing:1px;background:linear-gradient(135deg,#f97316,#fb923c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:10px}
      .lp-fbdesc{font-size:13px;color:rgba(255,255,255,.28);line-height:1.7;max-width:220px}
      .lp-fcolt{font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.32);margin-bottom:20px}
      .lp-fcol a{display:block;font-size:13px;color:rgba(255,255,255,.35);margin-bottom:12px;transition:color .15s;cursor:pointer;text-decoration:none}
      .lp-fcol a:hover{color:var(--orange)}
      .lp-fbot{display:flex;align-items:center;justify-content:space-between;padding-top:28px;border-top:1px solid rgba(255,255,255,.06);flex-wrap:wrap;gap:12px}
      .lp-fcopy{font-size:12px;color:rgba(255,255,255,.18)}
      .lp-fbadge{display:inline-flex;align-items:center;gap:8px;background:rgba(249,115,22,.08);border:1px solid rgba(249,115,22,.2);border-radius:4px;padding:6px 14px;font-size:11px;font-weight:800;letter-spacing:1px;color:var(--orange)}
      /* SCROLL ANIM */
      .lp-anim{opacity:0;transform:translateY(20px);transition:opacity .6s ease,transform .6s ease}
      .lp-anim.visible{opacity:1;transform:none}
      /* RESPONSIVE */
      @media(max-width:960px){
        .lp-nav-inner{padding:0 28px}
        .lp-nav-links{display:none}
        .lp-fhead{grid-template-columns:1fr;gap:20px}
        .lp-fright p{margin-left:0}
        .lp-fgrid{grid-template-columns:repeat(2,1fr)}
        .lp-hgrid{grid-template-columns:1fr;gap:32px}
        .lp-hgrid::before{display:none}
        .lp-ll{grid-template-columns:1fr;gap:52px}
        .lp-sgrid{grid-template-columns:repeat(2,1fr)}
        .lp-ftop{grid-template-columns:1fr 1fr;gap:36px}
        .lp-stats{grid-template-columns:repeat(2,1fr)}
        .lp-sc:nth-child(2){border-right:none}
        .lp-sc:nth-child(3){border-top:1px solid var(--border)}
        .lp-section{padding:80px 32px}.lp-footer{padding:52px 32px 36px}
        .lp-cta-box{padding:60px 40px}
        .lp-footer{padding:52px 32px 36px}
      }
      @media(max-width:640px){
        .lp-nav{height:62px}.lp-nav-inner{padding:0 16px}
        .lp-logo img{width:38px;height:38px}
        .lp-logo-name{font-size:18px}
        .lp-hero-content{padding:64px 0 80px}
        .lp-h1{font-size:clamp(44px,12vw,72px);white-space:normal}
        .lp-hero-sub{font-size:15px}
        .lp-btn-primary,.lp-btn-ghost{padding:14px 24px;font-size:13px}
        .lp-sn{font-size:44px}
        .lp-sc{padding:24px 14px}
        .lp-section{padding:60px 20px}.lp-footer{padding:44px 20px 32px}
        .lp-fgrid{grid-template-columns:1fr}
        .lp-fc{padding:30px 24px}
        .lp-sgrid{grid-template-columns:1fr}
        .lp-cta-box{padding:48px 24px;border-radius:12px}
        .lp-footer{padding:44px 20px 32px}
        .lp-ftop{grid-template-columns:1fr}
        .lp-fbot{flex-direction:column;align-items:flex-start}
      }
    </style>

    <!-- NAV -->
    <nav class="lp-nav" id="lpNav">
      <div class="lp-nav-inner">
        <a href="/" class="lp-logo">
          <img src="/icons/icon-192.png?v=4" alt="HoopStats Pilipinas">
          <div><div class="lp-logo-name">HOOPSTATS</div><div class="lp-logo-sub">Pilipinas</div></div>
        </a>
        <div class="lp-nav-links">
          <a href="#features">FEATURES</a>
          <a href="#how">HOW IT WORKS</a>
          <a href="#leagues">LEAGUES</a>
          <a href="/install">INSTALL</a>
        </div>
        <div class="lp-nav-actions">
          ${user
            ? `<a href="/admin" class="lp-btn-signin">My Dashboard</a><a href="/admin" class="lp-btn-cta">Go to Admin</a>`
            : `<a href="/login" class="lp-btn-signin">Sign In</a><a href="/register" class="lp-btn-cta">GET STARTED</a>`}
        </div>
      </div>
    </nav>

    <!-- HERO -->
    <section class="lp-hero" id="hero">
      <div class="lp-hero-bg"></div>
      <div class="lp-hero-inner">
        <div class="lp-si" style="width:100%">
          <div class="lp-hero-content">
            <div class="lp-badge">Philippine Basketball Stats Platform</div>
            <h1 class="lp-h1">
              WHERE <span class="accent">PINOY</span><br>
              HOOPS GETS<br>
              <span class="ghost">TRACKED.</span>
            </h1>
            <p class="lp-hero-sub">From barangay courts to provincial arenas — HoopStats Pilipinas gives every league the tools to manage games, track every stat, and share results with the community.</p>
            <div class="lp-hero-btns">
              <a href="/register" class="lp-btn-primary">START YOUR LEAGUE &rarr;</a>
              <a href="#features" class="lp-btn-ghost">SEE FEATURES</a>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- STATS STRIP -->
    <div class="lp-stats">
      <div class="lp-sc"><span class="lp-sn">${stats.leagues}</span><span class="lp-sl">Active Leagues</span></div>
      <div class="lp-sc"><span class="lp-sn">${stats.teams}</span><span class="lp-sl">Teams</span></div>
      <div class="lp-sc"><span class="lp-sn">${stats.players}</span><span class="lp-sl">Players Tracked</span></div>
      <div class="lp-sc"><span class="lp-sn">${stats.games}</span><span class="lp-sl">Games Recorded</span></div>
    </div>

    <!-- TICKER -->
    <div class="lp-ticker-wrap">
      <div class="lp-ticker">${ticker}</div>
    </div>

    <!-- FEATURES -->
    <section class="lp-section lp-feat-bg" id="features">
      <div class="lp-si">
        <div class="lp-fhead lp-anim">
          <div>
            <span class="lp-eyebrow">Platform Features</span>
            <h2 class="lp-ftitle">EVERYTHING YOUR<br><span class="ol">LEAGUE NEEDS</span></h2>
          </div>
          <div class="lp-fright"><p>Built specifically for Philippine basketball culture — from impromptu sitio leagues to organized provincial tournaments. Free to start, powerful to use.</p></div>
        </div>
        <div class="lp-fgrid">
          ${[
            {icon:'&#x1F3C6;',tag:'CORE',    title:'LEAGUE MANAGEMENT',     desc:'Create and manage leagues from barangay to regional level. Set up brackets, schedules, and standings in minutes.'},
            {icon:'&#x1F4CA;',tag:'ANALYTICS',title:'LIVE STATS TRACKING',  desc:'Record points, rebounds, assists, steals, blocks per player per game. Real-time leaderboards updated as games progress.'},
            {icon:'&#x1F517;',tag:'SOCIAL',   title:'PUBLIC RESULTS SHARING',desc:'Share game results and standings with your community instantly. No account needed to view — just a link.'},
            {icon:'&#x1F4F1;',tag:'MOBILE',   title:'PROGRESSIVE WEB APP',  desc:'Install HoopStats like a native app on any device. Works great on the sidelines with an unstable connection.'},
            {icon:'&#x1F464;',tag:'PLAYERS',  title:'PLAYER PROFILES',       desc:'Every player gets a full stats history across seasons and leagues. Track improvement over time.'},
            {icon:'&#x1F6E1;',tag:'PRICING',  title:'FREE TO START',          desc:'Register your league for free. No credit card. No hidden fees. Built for community organizers, not corporations.'},
          ].map(f=>`
          <div class="lp-fc lp-anim">
            <div class="lp-fcg"></div>
            <span class="lp-ftag">${f.tag}</span>
            <div class="lp-ficon">${f.icon}</div>
            <div class="lp-fct">${f.title}</div>
            <p class="lp-fcd">${f.desc}</p>
          </div>`).join('')}
        </div>
      </div>
    </section>

    <!-- HOW IT WORKS -->
    <section class="lp-section lp-how-bg" id="how">
      <div class="lp-si">
        <div style="text-align:center;max-width:520px;margin:0 auto" class="lp-anim">
          <span class="lp-eyebrow">How It Works</span>
          <h2 class="lp-ftitle" style="font-size:clamp(40px,5vw,62px)">UP AND RUNNING<br><span class="ol">IN MINUTES</span></h2>
        </div>
        <div class="lp-hgrid">
          <div class="lp-hstep lp-anim"><div class="lp-hnum">1</div><div class="lp-ht">Create Your League</div><p class="lp-hd">Sign up free and set up your league in minutes. Add teams, players, and schedule your games.</p></div>
          <div class="lp-hstep lp-anim"><div class="lp-hnum">2</div><div class="lp-ht">Track Every Game</div><p class="lp-hd">Use the live scorer on your phone courtside. Record every basket, rebound, steal and foul in real time.</p></div>
          <div class="lp-hstep lp-anim"><div class="lp-hnum">3</div><div class="lp-ht">Share With Everyone</div><p class="lp-hd">Your public league page is live instantly. Share the link — fans see standings, stats, and game results.</p></div>
        </div>
      </div>
    </section>

    <!-- LEAGUES -->
    <section class="lp-section" style="background:var(--black)" id="leagues">
      <div class="lp-si">
        <div class="lp-ll">
          <div class="lp-anim">
            <span class="lp-eyebrow">Active Leagues</span>
            <h2 class="lp-lt">FROM SITIO<br>TO <span>ARENA</span></h2>
            <p class="lp-ld">HoopStats supports all levels of Philippine basketball administration — from informal barangay pickup games to formal regional competitions.</p>
            <ul class="lp-lvl">
              <li>Barangay Level</li>
              <li>City / Municipal Level</li>
              <li>Provincial Level</li>
              <li>Regional Level</li>
            </ul>
            <div class="lp-lphoto">
              <img src="https://images.unsplash.com/photo-1504450758481-7338eba7524a?w=700&q=70" alt="Philippine basketball court" loading="lazy"/>
              <span class="lp-lphoto-cap">Barangay Court, Philippines</span>
            </div>
          </div>
          <div>
            <div class="lp-lfilt" id="lpLeagueFilters">
              ${['All','Barangay','City/Municipal','Provincial','Regional']
                .map(f=>`<button class="lp-lfbtn${f==='All'?' active':''}" data-level="${f}">${f}</button>`).join('')}
            </div>
            <div class="lp-llist" id="lpLeagueList">${leagueRows}</div>
            <a href="#" class="lp-lva">VIEW ALL LEAGUES &rsaquo;</a>
          </div>
        </div>
      </div>
    </section>

    <!-- TESTIMONIALS -->
    <section class="lp-section lp-social-bg">
      <div class="lp-si">
        <div style="text-align:center;max-width:520px;margin:0 auto" class="lp-anim">
          <span class="lp-eyebrow">From the Community</span>
          <h2 class="lp-ftitle" style="font-size:clamp(38px,5vw,58px)">TRUSTED BY<br><span class="ol">PINOY COACHES</span></h2>
        </div>
        <div class="lp-sgrid">
          <div class="lp-scard lp-anim"><div class="lp-sstars">&#x2605;&#x2605;&#x2605;&#x2605;&#x2605;</div><p class="lp-stext">"Finally an app that understands Pinoy basketball. Super easy to set up our barangay league. My players love seeing their stats after every game."</p><div class="lp-sauth"><div class="lp-savt">JR</div><div><div class="lp-sname">Jun Rey Santos</div><div class="lp-srole">Commissioner &middot; Brgy. San Roque Basketball Cup</div></div></div></div>
          <div class="lp-scard lp-anim"><div class="lp-sstars">&#x2605;&#x2605;&#x2605;&#x2605;&#x2605;</div><p class="lp-stext">"Ginamit namin sa aming city league. Ang ganda ng live scorer — real time pa ang stats. Walang issues kahit mabagal ang internet sa court."</p><div class="lp-sauth"><div class="lp-savt">MC</div><div><div class="lp-sname">Mark Corpuz</div><div class="lp-srole">League Director &middot; Marikina City Basketball</div></div></div></div>
          <div class="lp-scard lp-anim"><div class="lp-sstars">&#x2605;&#x2605;&#x2605;&#x2605;&#x2605;</div><p class="lp-stext">"The player profiles are a game changer. Parents can see their kids' stats after every game. We share the link on our Facebook group and everyone loves it."</p><div class="lp-sauth"><div class="lp-savt">AL</div><div><div class="lp-sname">Armando Lim</div><div class="lp-srole">Coach &middot; Nuvali Canlubang League</div></div></div></div>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section class="lp-section" style="background:var(--black)">
      <div class="lp-si">
        <div class="lp-cta-box lp-anim">
          <h2 class="lp-ctitle">READY TO TRACK<br><span>YOUR LEAGUE?</span></h2>
          <p class="lp-csub">Join Philippine basketball commissioners who track their leagues with HoopStats. Free to start — no credit card needed.</p>
          <div class="lp-cbtns">
            <a href="/register" class="lp-btn-primary">START YOUR LEAGUE FREE &rarr;</a>
            <a href="/install"  class="lp-btn-ghost">&#x1F4F2; Install as App</a>
          </div>
        </div>
      </div>
    </section>

    <!-- FOOTER -->
    <footer class="lp-footer">
      <div class="lp-fi">
        <div class="lp-ftop">
          <div class="lp-fbrand">
            <img src="/icons/icon-192.png?v=4" alt="HoopStats Pilipinas">
            <div class="lp-fbname">HOOPSTATS PILIPINAS</div>
            <p class="lp-fbdesc">Philippine Basketball Stats Platform — From barangay to arena. Built for the community. &#x1F1F5;&#x1F1ED;</p>
          </div>
          <div class="lp-fcol"><div class="lp-fcolt">Platform</div><a href="#features">Features</a><a href="#how">How It Works</a><a href="#leagues">View Leagues</a><a href="/install">Install App</a></div>
          <div class="lp-fcol"><div class="lp-fcolt">Account</div><a href="/login">Sign In</a><a href="/register">Register Free</a><a href="/admin">Admin Panel</a></div>
          <div class="lp-fcol"><div class="lp-fcolt">Legal</div><a href="#">Privacy Policy</a><a href="#">Terms of Use</a><a href="#">Contact</a></div>
        </div>
        <div class="lp-fbot">
          <div class="lp-fcopy">&copy; ${new Date().getFullYear()} HoopStats Pilipinas. All rights reserved.</div>
          <div class="lp-fbadge">&#x1F3C0; FIBA 2024 STATS ENGINE</div>
          <div class="lp-fcopy">Built with &#x2764;&#xFE0F; for Philippine Basketball</div>
        </div>
      </div>
    </footer>

    <script src="/js/public.js?v31"></script>
    <script>
      // Nav scroll
      window.addEventListener('scroll',function(){
        document.getElementById('lpNav').classList.toggle('scrolled',window.scrollY>40);
      },{passive:true});
      // League filter
      var lpFilters = document.getElementById('lpLeagueFilters');
      if(lpFilters){
        lpFilters.addEventListener('click',function(e){
          var b=e.target.closest('.lp-lfbtn');if(!b)return;
          document.querySelectorAll('.lp-lfbtn').forEach(function(x){x.classList.remove('active')});
          b.classList.add('active');
          var lv=b.getAttribute('data-level');
          document.querySelectorAll('.lrow').forEach(function(r){
            r.style.display=(lv==='All'||r.getAttribute('data-level')===lv)?'':'none';
          });
        });
      }
      // Scroll animation
      var lpObs=new IntersectionObserver(function(entries){
        entries.forEach(function(e){if(e.isIntersecting){e.target.classList.add('visible')}});
      },{threshold:0.08});
      document.querySelectorAll('.lp-anim').forEach(function(el){lpObs.observe(el)});
    </script>
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
      <div class="topnav-inner">
      <div class="nav-brand"><a href="/" style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:10px"><img src="/icons/icon-192.png?v=4" alt="HoopStats" style="width:40px;height:40px;border-radius:10px;object-fit:contain;display:block;flex-shrink:0"><div class="nav-brand-text"><div class="brand-text">HOOPSTATS</div><div class="brand-sub">Pilipinas</div></div></a></div>
      <div class="nav-actions">
        <a href="/" class="btn-ghost-sm">← Leagues</a>
        ${user ? `<a href="/admin" class="btn-nav">Admin Panel</a>` : `<a href="/login" class="btn-nav">Login</a>`}
      </div>
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

    <div style="background:var(--dark-1);border-bottom:1px solid var(--border);padding:16px 0">
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
    </div>

    <div class="pub-tabs"><div class="tabs-inner">
      <button class="ptab active" data-tab="standings">🏆 Standings</button>
      <button class="ptab" data-tab="players">👤 Player Stats</button>
      <button class="ptab" data-tab="schedule">📅 Schedule</button>
    </div></div>

    <div class="pub-content">
      <div id="tab-standings" class="tab-pane">
        <div class="table-scroll"><table class="stats-table">
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
        </table></div>
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
