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
      .lp-hero-bg{
        position:absolute;inset:0;
        background:url('data:image/webp;base64,UklGRoK9AABXRUJQVlA4IHa9AABQYgOdASqwBK4CPmEulEekIiIwJFDpWgAMCWNDINSjl5OMx0sugyRMQtq79eu+N50HvH/zfCg9b/1nToYmdAzy384b+v6P/nkT768J7T/J2wZ7Paf6z90/85+6/0L8W+APrj8L/of93/evmm/v+eXu3/C84Xzr92/8X+F/zv70fMD/s+tD9N//X/Qfv/9CH60/sd/mPir/6PYX/wf/T6uf89/5vU3/6v7p/B39z/U+/73Xw+md5r3/u9p/+S/9j0ztTS92/8T1QfK/6X/cf3vvb/df6L/CfuJ/iPotrtcin5n+Gf4v969xXaj84v971CPyT+mf6r7e/oZiJ+TKBPrj+xvsXfh+cv75/qfYD/Wb/r/3/2/8F383/3PYL/pf+g9Y//c85/7H/wPVE/xH7FDE88sZ3QgWvgUsv4AASe5fb442yR3BDayNfxCanwUN97hLPRAj//b/vuMVS5dcdiWByKGeGglRy+ldiP/BYX3qqUO6nCbOhfWvfm9huqBrHyvMs1KUY3btljxWsgPQLfD07ZBMObEUW1mqfaQJi4gNLEnnYPrikDJPTgKYUU0bKTHno39Mu+h6uLv/9c+0d9R83qsngS1f+rGvyU/ugEZxguTfq//2USe3+BoobR3f+Vl9PKkltUZdwE/Ljj6qVL3Mvy1h3x/1hqvvsT58Jf6TkjAh5IILk0sNo5hkyNdWu5ymOeku6IhY3hTivB2bjr/V2Rfh9pV+VnEJNYn3iuaB3on/cBeRZsknhWjVGnZz/+PG/9df+j88f/35H9h0RQf5NN//rySa+9+iydO/oQ3pX6Ob7bDJbYi2LgZof1JahnxmEeEU8UsAyUuHW36qVRDsTCxLt2Jy+Ss1YuJKtPaDAyhiPBENGFF8ON9cA4+pR81aV1RpoPPcx88+c6GJgDbhH/qYdyU2Vbx3+LYTjzQT0b/RtnWUfpB/jWVTR3/wm+79wWrleJUo7qsf2hTcANqPY0OBbMwK9Wa6lqeoZL9t5SFh5nQp4tFilophwSzg9Mpq1Itvncj1Nzlg8EaYVlI8SRXC99Hi15mbCetyDdCDfXYcwqdcovcRuEUrAoxrB3Ss7eSJQ0TIs97PpKx23dfSg+7DkAoaJjFqjpiDUG6lIwuFqdoHNHHYNzZ6DJ5im40JgFMfqXnZJatRuWIsdjwQL6JH6Lo6+9HuBq9Jw2+hplWcuSz7GGf8PQ14RX4T/9e+FFgGWCQ2E+G3cU8e0ijzBCjXQ63uXXlGu6sLMNWzpTHX+wihIOqzc+6ippfrluTVu8UV89n9D8voPAYGIob6OENtRRYDgH2e3WRU6w7kck/HyDD23LH4k0jVZYBNwq8cRG8J8QwVBrV6htISSwadbm9B/aIMPdJv6mPNTkA893SfY4JrW+wNN0S+LMrdLI4oJsf1sfXn+FHu3cw+O+86QfSlVWav4QSo//piUHGLd+kev/5Ue/kMvine5jKJ++8TJrlwwcvO0ZKeXg3nx+zCV/NsKuvFVDYba7XJ9EyXSTMm1u11tA6vvEuOpl4UG7T/8IuushMuoIM7VquG+v1lpqcrxTJceYSWx5x66bZuRUr5++68qswKf6yXOB8l1RfKtA5MvKOlh8xpEoNd+BPSN8XTPM+3LV7Eq2cLc/5OZnLUk4yjscdLL/5jXQV7bbvyd0R/p5q94D8j+ag6MX8syQi4NjUETdyxRQdDXF9rpn2Fr2N2NRHuS9p336i3YD9y0qraIMIOkNnrSoG6znAavDtkQBVvmShoIiZOTiTtDhJ80UdtmBEGaxdHAUNbQhtKa/pTLTrVfSSM+mCYzQVIlcyGlbEPlPTqw30J6N8etAvBzZyO+4GPsrkl2sD/crjvUU3S1gv2kX//I+vT3xnzJsiSZFFC3uM9G/vmRTqID7LPBEF54hw6jI01Z6WJCzM57gzRSZb+atIGsCMde7sS57J2SjTPwe3SeP9e/y0KpRs+cTAbu9z6PH/RWKhZzkiMhhigSRqMGm5KCARBAkXzkd3bs5aE9sZMdRWDwjAHcjNOdYDAo92QuFROT6SSSYUUz/JA/8Q5t/23QmHXuCD+T6yoxpEwiakobspGHoFpsK2GajEPyVsAheAqUYPyrnCF4SjIjl9rFAHDjd9brdCils/rJuv8Msf/84qcmrXLr2Yyg3YzNrIXOQQ/Z1B7ltLy2CUyrZdt5uV8R70VGOCWCybvHuj3aRlRyZLY7T54f/a/29AKtfPmuDvwTQd0AdKsHlgKVIPuk9C+sPBiiX3kRhTxLguSArV2E7OIdeF+JqmWYErle75iv2j6JvvxeMWN1O41Ogpt8xaZB2ADji0gZ/DFm3KoeIIf4DjM7OFz0UUpjwRd15VKlPpliE7KSgPph6rihlTTnnSie0r3A0hcYbEnFr5QQDAtiR0zYMQAwioL02B2KQ88J7xHuK/xSktmnrKwXvfz2Tvc6leZszZ7sgnEDGUy1+F0+2tOTVDUxlwYVtEqflmdOXBsCpBzf0+gma5cPdwyldRK03KoLypYi8Rg+AgRkBJXJGt0pT5JRDsCKHSftsKFA8WC6W9Y3Fj67U7UM+bbUVn3NeJS771JFwxPMJP39aVTHmgnw97t13YIAZEnBI3yd2NTR/wn0evSdb7gT4LuvFjlVCaWneJkVqvxnRkYZpoDL285uGsn7I5QlX4APQtzdnoj2omibNA2+2e2y5FXzxW8rZQKPvEb9FnNM3SgH7r8wsnSqnLyp4QHKbixXUCP6CCPgYChVlasAs0cstkdHSTk/Wbyt/f0fM2qKqFZsj3qfV7HAW5v+cwRb7NAEHG9BKOdcBqzVJybzj1qJB6bKQCmzc/P7XGKMEb/VFLfv3NwAOmSCEaDTG1/miG3Ehif18YtYrkH5d9daWL8hln8jaXfquVn3HQCH8/WiqSu71Sdn26ypzESd5CCRDpX5FTz+jTePPYHed9BEvKrfuG0BF48yyBerYgNllv3BXKZk3CNBRV/QBCZImdYrPInVFjYwgOyzer/+Rp81W4HsUTbSE0SYWhdl9e2mFFZxSA93HltIJHqkEqpU1VlwX9m/BQaxAMMwOJNwc1lN+ESFLC6F5OzpLB+3nji5cLs7ZhVxaNQzUgbiFcSXlgiVCuI55v9DWJqQ5N3BxOenIX96kKJlGapIhmVxqg25t34X0VHQK7h7YQ3CE6dkPQG7OP5uOgEu04b6Usbh20WvdInrj8sIeAg4tzQn2jSHu/CNmxTDhSAz4XgJTTjmSfeSNNRBNMOHKtRvc0bUjDhwHbRNvrRBdHo3vUvfjgkWGJVToBoQZqHhL2HaRDL4nVs4+9pHX+TEzbIwkLPiBe2d7O4qu/260BDz9Z2cYC5deV9Oig0vb/mBG1qTaicX41T5G3eSOv5bH2wtYW0Um3FUaPSoYwbI/9KC1yyom1BxSDYOactWmYtYWmxGaE9NeOVs9mvxdqAyH62OpvjwNL+bn5bovlS52BCoZ/JbRa5H8ipC8dMnOSmIEL4/aw3Z78PEuTuDgmW2YiHBqtKwCYuLrP/JOc5t8qwJAtOrcgyIZBxpbs30BL4U29pYwoIEycZoCuqxMkSsIkTsF/ICCySj06dHWNQ9qJsGcAA/Czk2+6qdYlm2XLOM4YEAZGo5/X0Ja5TNARLWIM2/Ae3Kq+CDDUvX2sF9QO2tUQ45K+Y1JuqBNhC1t09llZ2Bu4t698uByTR/sGlhxVymjIxxwFNeYAtkj65YxuBjERprzpyD7y6uKVC1R/a+gLavoIH0P/SRZJFEY9+aCjPCwcCqn86vOZRqgH02PasmxVvkXRsJvp7pNtmYZqQZ8Gw3am0PZ0ejdf9oMKA1gnPHjDOWFIR8ecOZOTMBOmzZaVab71DnIIP8ISeMEkVOJfTyGk5OOl2ikc1EHd/xPWCRbMC3UsaZ7g1d9u3od01EB7CZ1kaDRCGC+egFHdVx15KcUOp6UC1/wQnB64t6hQ5C1oCOJ/yJcXVAcdBavOyjEQpi3LMYFrRi47UfJCVnRotr0FC0mLdmicX1jW8HCIYBCVy+VhqLdzN6+c8I2SX2tffq9CnNFKnCQCapktDE5U583/xVUS9MpyEPvywzHooNm+g3S3scabFZtiPai6yv+sxYQJhi9YYwhP03SpKLhjkYcyYsqry1WTiz2Pug9wim3a0vglQS9r1RgUf2I5HnPRIKA3xTXAR0sL1nRIRl6f70iKfmjhv6DOfkkoE9KWYE0RhWOJDkEgFLEL4vyE6+UJVUAeljCTPz17HOwcRtybqKRflELIkYEqnQUodpOlxxtTlykWcKbWt7sl750GFS5NXFvkUJoi0uusywYHCGZ6883tRXt1IpFNvNXU2rnpcSHFDH6oSZb+0d7/26kYeq/p+Qz5UM94RUlllfISsRyDokJan8uPtQZIfE4XsaVkZlDygTChOCkh1UPRnex7IJwiWbRw1iJ5N3ga0vCdxnYpZVUy5N/3vU6dzBF8iUQgDMHrGkR0Z9XvkT2J23JyR/Np4h0+k32bfR3AoCgGO05O4+hANTD43KpokVQoBDGUi7wArjSJ/XTL0huZdfo6sO/8ZGhfTC4DoGN4oxaALDM9XVJP8puNZra+HCjKD8A1wsLbIEo2aDCYIPq/IS+Beh9v87E8fdcuqdZ49s/CYv1QHexzgARddMqxGRhKK8SvBLjUmtJ+dUXbwI819rT/2HbCjm8RvA+8Rbo5uNghE4SjDcLORl/plt0Nszl7Mfo2xRroKeCHfqLi+C8p4aUReoQZ1JGidDHmWZeUzTYvDKsy84BFuQX1nStN9LyQrvq9HS0qrLED7YBBqvNfATJYaIfb+jT4Tm6P6FEpfaAkbyS0bS5ZjwfAPgXCq3vYEQ6VSB256p37abAcEWicZPGgu22B+7Ugt9VOxh8Ra5v3WxjfYQ8cpj3e0gpoDIy56PKwR0ai1lSJl/D3RoWGowym02y6XXoJqX3W+tdIlxkdwICFgL6G3eFBJTsc/HTL4zdKHyOGcEcodh/lc5oduwbyrQpoI+fuPCzHzlxlMvDcXBCZ9juK12GeWrBOdRDsm+kfqier1kzsn+1sn9hUAl+oAFBxFRAay8mo1DOqRCbmRoSDzF221BearooPl6NWeFfH+3U8Q0Q9Rf2Pe5/FxnhxsdG1zWihNNgsjDjIeF/prUulXvE4FRI5+T/VikZFlgiElzvTDauHmTc4+KtH7dfOEp/wWd524xn089POzHHR97mYw5KH5Hy4TcT+kOtlSGti+3AYcT2UBxyCSMqXDSyM4p80IzlC77crNhHrFXqmdq0P2ysWOuZ8e31+/AP37GqmfaKwrliVdCS5/xV4YkxRWhAugQQsFEXShT+eBYt68DR3Jgjw3ZWAg4sbJUc1kkKsXwFqgQbstI1VdYdPgcp4MepI+zD0doYGocjd9fSnuvK1dyOP7q0KIir3/kcAKJbw+gGW+dc1741FPyL699Mhii4FEM4zsUE5eGj76rh9ljXzP+shxO4RAVbjI5f1q1ADqWOBr+n4ayU8OUNOqrr9xrhBh9U4tTyFH/w+8f8/W36LiftLfiKUh89r/IZeUrrSqeyASCqsxjk4Ae0MabcygXA1gx62xk1R8Hgk8FCJTLMZl1yHf//7JHWIzsumAOfARd/wmCYsL2aLY868yiGsvsatjQ3NAsAqA8DSNJH9v3/h2HYOw+HulgIZXrb0RfEeS1qP/xwl6imS/i1e9weK8Cbcmk/RvICxzFyYj+DkNRuN1eExCggKn6+czKGfCuOhuNHUMTH1o5WWuulGUqboD0eOsoBQ1sxUV2PGsExA2gju/QSwVNrX25sYVPGDHs/vza/Wftg9PdpdMhQoaH7MXrrBzDjuHhTWlGYo0ZbP8klVSc8buJLwKAbAxbEO8qwakbRfPv28cAbRIcejl5F3Zu2MbGV04VLoF54QaBiwd8V3gFjii0y+SpES3Gqm2josyowmdhnqEDZbsZ+j5IWMSH7eDeuMDXtGSOWYHnUSgFgaXP2BzcreYfJAhQDFB2yLxXwd7MU7WhFAbYvkbO7c5r4546Xv3GfSW3Gj/N13c+Vzi+1mn9ixSZ4GeSv6OejKD5s1purFzZSqiX4GTZL/4f/+vSvzCt+Oq6ORFsR9mnb5xFAelXgA4AYa0rDtbTTx5NMdENWA9Cna9kq+7Necc7FqX58Gld/CDZ2G2PcHBtGoPquwexENOco0uwmrdRiqUooRHDH7+8MxsnkmPscDaK5W33EOBJbYQZ2WHUUI88S1ncUIXCujLNtNzlVAwhr6U6jOMg1YxdCgOZQ2tm/TxQDQ/aEn2+hUh6H+P1IjeG5Ev7oD4HYQYCaDD26dx1TY6HtKTZWF8JcmuaaLxNg7LWiqRiHCECDjYOxv9GI9FxcJ69AYvPzzx6znI3DtbUOgKhAKcL9r/BiuC/eXNiE5kuc9mukduDKNbGgyhLFXqzbj8Ylo4H902MNAWlThMsi59OVdPAKL0sKGawQ5MOlIFanPU7S2cKTaWQpBqxOlkOvk5OvvG3FEAD6+syQqZXLgKkscvmUWBwsuYZwxNoq8mG/uBSr+zJCcGxAYbONOTqgrJ/1WvdT5t+42bpaYbsLrfDWk9Bl9REbEEz17qpCyFAdg3NprI/t6uHDJVOyrRTN/elJ/cxiyvDJTIBQlZm3yeEsfNJvzmU87/a55I9c5qAIxmE6HUmCKkWWpQJj1IseNaI97ir6bCJ12/d9yQ/N8J3MjV8XHJpsw9MVDzjOQzpc0r3x59romYxCTLTf4sHHkSbyBQtZfc9z36aiLaKKHYtkdinEPa0h+jjU6nnzPnaPPuXANKQ29qVKx85IRtNB/zM6wg9PX/A/poiIC4IoVAsCyk6rgkdYTTx9X0tcBzcBxBBM0wLdOQ354LEirowAJeKt5fpZLUX+0FzCW9BYQJ5sSaKpm6cGhn3+rDF290KnVIebOhV4AKbE64nNCKHTgmw0e4aPrwRYFDnB4JE5KL5E4i7rL3O6SQ4h3M1eSK70YUGK8jcIJmS93DGA8p4c9m3v6As2LqzslgAmyFMzDhu1aeQFNpgvW7aUZTOXf3yz5sbjmy8PAF+pIP/28tq0WAZNGMUGBCbJvFSosPZDzLjG0fO6YpGi26u7hjemFGtlJP5BO3+ZJXcgXtGqopcgGuvbGV7WhCMGafN0/aTygBuUJyla+AWC1Dx4UN2gNCjNUrwCGsH3g4f5H/bbyg12J7EkpbexS4ySYH3jLK2q+9zbv1ub56bxFt+rt15utTiH3dl228k4QwvL2F8NVuZ4Hm0PHm6LNJUzlhVCwDmg8Q/TTfpoIL+ZTY9VV28dvgI0rLSWhY6dQrqcApzL+3OAkvD1+9FkjxsTpSDOXLh0eXBeZ1lzoNMDtAOJDNKuNl+Eyfu276/fXoNaZhGsnipxRog+wxBmAK4xlu6C0+8VwVB5JwsjEDyL1JxbXEmSOGzAn09xxJuUxasdyrKqlzfZMiA9VTrClJv9Kqbwxb8lsA6NWaQdUP//W0w5n2ClTxVh2AdxLRoerMiAlMB9MIkKFRsEt+rTWqrqB/B/gkAiiI0CcVBj6IplkoKp8/rQsAor1+iYo0GZn6Gox+Rhkb+smHZo3sB0xg78xo5GUGGCa9WCbzL4SHECmAtwc64VGWDGDtn4bM7w+Ai3qp2n7gMgdsA+TNtohjob+V+MDkrKVMmm5lJRhyGjH1QY3nXdqPN0PHLWNzVaOHZP/0LIaZwrq7Cevvq69j8+rqppszIyYdXlTHFZyZurelhZohBz7tkcIe7JOGIEKmz/YWhgXMoylNcTDxrUT/4xkjbXZ116p91S8OoWY+ilU6aUA4AKU1v+TcAQk9gxWE/LIR2jFekWA6FraDB9JYyAA+mOYHloPLvsfAZCceaaLfAS6+LINztDyPisDxZLniN/Q4ng9sexBxnBg2u1mTFBtATaxOMPoW3442701SHy9H6h/SolrEVMLOvaiFRJDSOLx+Ky602C//ez9I6kS46GvALd4B/zIxzJEtgd5dv+Q+sfoNd1wwf2narByIkr/WrkiIdks8g/GBqx5NjP+CUv/JKeWQjJndDhze6fZHItn+xfsHih46yDJVElisS/MDiwPjn7NaAp+11s6jG5BkpuBzQknT4FT/W2MhF9/frXEeU/EmaEoyWpOOcPc4wlUezUV/j2wamanS5aEHTEcuIFRlXt1QMXY1mivzIqq5yAGusLcRrikQxAB9Wmaiv6Hc1+hmKEh+Io60nIX2yVlv3K5qZULiy1XsVIqehLrDh4pT+sJAAefi4QUJZWWFtN9yYMuET7xOIFrOJfgaJMTudaoanTgqnpHU8pDhUnkXcGT1+R/KQFxzRRJO/T6BU/60K278m5FDEH2QTVPcG1j/zvtWw6ZTmU972XgLG0vy8h97pC2LF1y79p3ZFPWD+8giu9XOEzamHONZ4kwkqZbTG3pkmWnzx1vFPVChrWnumY2sRAuMrA/UypLDzfLQ/wJd6x4UUmoaHuZecL5DWLweaIIRbNv0SCD0vMo4xyxOpTkaSrAvvI2elsEEH5QSQ4p3aUnK5ZvVVUgXPWGjbV7Og6bT17d5qWM8Stvf87GPoXkYaVenwuiKQn/saVZz869ZH2+gGa5JwFDS2TgcdATIbwAm40VTUghE7jMu/qqVtFSbYDkrhyun2U+NhUCm1vm96HImGup5QeGJlC2MbtzRI8DMQzrB0vR1y1zqO9EJboA6JR3ewDuVIPsNv2sMU6V9T8zJ04G0H9b1+egkNAMNqtpYYnhdCrYkVdS+sIxAo7iw0qyG7sgkDDRrI4LeZw1XQiIyntIu1FSCpyw1bk4YG881W0hG9/FyqFKqdMDccmAxOnAZguoILRRR7ZWejTk20f61DEGY5O0Bhy9UqVT6PWcO8AJEpExwHcHqZlHP0z83n3/n3ZegeiBbwZCbIwHNj5dWemuBVIq7SyB+vFiV5RcGtdnFfK8YHmPGxoYLuFqzTu+8r8tkTAZ9Y4dtq9jqtSTi8issqMXAa56AmhDj8+6U8/QEIQoGoCEd1QhQs9A6h1+o0V3BNkkVyZQI1eQkJb/NVNzLfJhTOBHBhB2NcZ0C68UBrU0jj4RsafpNE4HSwmMSm68wgGCvBnlrqTQ6H9ek7LO59TSTssiNGMRKdRs0N4cerglgVCRpHzgmCpnlLZuvlBKffo4txZk2wuJUxt+rYCMd61NEfSo6HK0gk6OlbrL7U8d/90O9QxxbHvlvoQX7Q5jdkMVqbnhIZPevZXwsAtRRSYAA/vZoe9evh3VGuv/0inzwvNpzncQSdZrsd0D4He2VivY6xBC9X6PAiK6yD5jVpZfCOIdzz7abR/9nT/4Cccyibthuse1nHMGza+g9P+v8F7YJ+qN21kUxAzMYwdEXqz5LV/ocQRyn4a7bFmS0cwBsBBGqy9GdTGPkI3BYYQoP/QA7csynMEAHggAJlF4Ovq1QtG08cpPrS+60xLuH+eEMAeFjDyVYuojn1ZIDq5lJacqgqvyZBLKVhcr3/405CBuoLEyP/vZeG98tP3vv6XpYDL/ATSBO588PEBEAb3qnrhnpNaGfONvSLNkev3miSev+L8baZI57WatdMJJ6CV07FaBz3GTFUaIFBooAEvgS5MWpuA1ea/nYJzAkC2CpSMyy4/5ATEkRcBIg7P0I148K+aPoEsxyKyXlaXFyXvfRoWzAXNw8JINwSTHgM93XUA5PctSPnxeoDqfnr7ugD604MHMUB1dZ9j0QpZEJqzT6A5kPA/1XCvkxtHMOeOL0eO0Cfw49vKUyrI44O7oRwT0gy6wX49P2WbI6NNgSjOdweTQx7z+7YWY6vhNbDvw8ybJW24RqFC2YYhjyYgmB/q+7rrajTGOgM9O1YV8369whKId04miubxLO5CqDieV81xT6+zZZynnnVAYp2TDyFAi2iLSHHzo4nUk/8QbGp7280i+/8qTp0yD1VZQmqosoZkkIfLcwOQ0eQt2T3fv9BBQH3eeuoOJ6nYWpFeLFjZSwFgrwdZwF03PcyykZDKIg2+8ro77IRM4rtnE3iauJiwg9AdyV7+RrIshy+uL0LxPynNo+WELAAQddjxA2QACj9HRyZJcl3gJiUew9cir7nwVoYmDIgG/53O5Y0mDkEc3QyKO8mzQ+cWszUCQ9tRZD296XQ9b+oNG13yiOZZ5kIHWCJ01xy3fsdQMSC3Qh1enV76WmtX2K4Hkh5kAttpN3eguc6rwm3NYWjBwAJeFRgSCuE9GxI36QER8X0HTQZhhBvwnoxeWiN7WxKCLh6Z+vO5PI2eYnLv00jW6kjoltIUIR38Eo8RWh3AJHBMp+GaGcqItuN3QeZZ/0lFa4f/wfdGThXqa5QOgo8gZq5Vv1hTFE1M0kZKtC8GUDBaAubhr43wMyEokI88YKORMgYM76X7pDm6HTL+HIpzuV9aXZoazzuTHLrVLXfL+v2i8LQHweZFaErfRXDyeLb4rEoRGKH2BDu3BKsHPIjbNFHlYHzLunzHgnGRcg+sE/wOx16z1qYMAO0nqti2OB5GkQzJHlU4fQuIQ5QAaGYHsuWkaFkMoM+ell+FmFO2VL32S3xMdH2kvZkm4ZMC+iZbTYcTbt7soDyE5TYDzXmFVogPdDmJDsRUGb3gGgPx1pyu/oKY9ZhJalk44q16jt0Meu+ztVvYtLDfJgksU/kWL/9ryk1G0IyyMdATfaWnMXVWpFnjXmcPke0y64yzE1jI0iBFNyOTU9xof9bM0didYlnKxOM4tWg4Cw13ilbCl1fhrvmPC9TyUSrMAby1+B+Q4saTF+oPeejuhQZhwLhrS/ONs+9IqUqGEBRzrgjZ66mdovXWiw9pcp+jCs/metXVxZFjUj7ATQk9PAuLdg3CugGT+OMnIyBU6BJmvofES9omX+rIySzomYtVcVsNTs25SIGaedRNzp7dVEwVa72biv5lNxzkra9S/RKr14v2FP39/h7GcwWnBM7L+hbjEcXMVBOOMzrnXkbLdRBKBz4J7FM23jOvRkZ/m/DDZjblwM4fwYF25W785rHwBr2itJ44YjubPc/DeKHc+uQCwIBnnoM+t6fL8jTpFvJ19rWG8Vu4tZHrc6uqQj1tenEAeJNBjC6YvWpOsQH5va/vYmkERdBPXoPAI+yXbzXFovutaXldNZKyaBVW8WoCDaFpV4Mhmt1aYfqnxpoUSSxF927aUur3r+FkW7ncc3FJCM/5NPogE423avATs+M+l1CGaZthVjKho0huzZSOBHTHdbHX8qFkDKIEDA2gbWTxZZsOgGhAjY4qMJyWr/esTikL4oRIuuGSkwFfXBzhefQ5+7+U89OjUtoALSSnU+utOWLB3tBwgxgugqlfu6sM4gZO7q3RuxfN2Z0IeXvoTCxxJ3Z/NJHqihjFXrZNOHsWGp/bkytXfXA1uo8GKMEiZEEkZdWUn3FTNFN2M75gEnv2fxKxYZaxVEv1RYFbDAJwd9wWmG1q3ZT7vxU85lQh6Zv9e4obJTq5r3OlE5/3MiFgxqsXhaVGNKxibbGi8Ckn2v4tGGOkFjR0zzixM67FyBF6npLcOGe+zVuPcXuSNpC8mK+ABK1lGV2ohCMBpzKnN5y42mbvAMDw0rnFNZGzdnclv24wJvVeq7M3gOFTjTVmyNbpZ4VLRiDoEweXw1RrUD8PYAENqYKSPbu3WylcS5TT9dRuq8uzlfdKhOx7NRGXUJLwBfqJIgmngMrQs/ZUOgT2BjZQxFEaI5iIwUef8wqC8v37g/DhiB3OdtMILjO+P9Z8/9uxnL65qjQ+Toz7/vVkvVWrI83hr3dWUN/WFrKwlOn9wGgOYXL5N77N2qHK5dNZBzUJAfoUdfGeD0iiO1h+CLQC5nxIRA+wDOHsvZp7DI9WKmhboyhVrMvdpT9BFdTh4Z+w8B0KRBK/uEU6chPKuxCmRDxDfdHkO+yhmKbMMbNwM/yh9lPT9mKK9TeMUVy1ZtzuTvH2ahiO0EeSTX9DIjbrd9f+I8XeUaKYmPEfzUqUjUCMYyFrnzxLFSUoC5zIBaOFm2icGTvGh1kLT4T+LMYjrdQB1WdMsfDE6nLoR1CrwRnEOOssIXkOSBPrrrRI2FP51KbxWGX+j9HePio14JaXywcEwazgQnthz9Q8VR2fSy/GI5G240mYDs8Jlq+rJmRUr4PuCKotccGre5snji6Yzlj0+cUHstuAlLCYs8Q7hTgrH7kBvdvKC2YrDhsuVWxxTVIk61c1MS9YUSHeY8bUme0EyV4GCpY/2jga4kqzcndNh7wVPV4Zhz7v9ofBEqieY2fRvOM7EM/NLaN0Yb4rDEUvMW/1fe0mLkSt92wUzHS8MwvcpH9vPQH3VqMufeSgFbuLfs5xg9Trn+wZtiuBW8XC9Jq7mbiYWQPLHcLfAC2Fp2RnwmJZN9Lm8Iry+zQwbBBdDTHEc5IJyQdHjfWNq2e5gdfY6jgEPCgD82culV0Jo1AaawpSGBa/gLZbs6UzPzUIcvOmmpepXHrpXeo2zY72lbP1Xw1hY//ZK9wAOTQhw32SIUqHCMTfAy8+09DWlhk+atfPaAr9RU3VadHo8n6VrEt7gwfHOdgL9hvNx0e9S/wj7xlb9OGZIzDq+jpUC/BVkvCigBVdnCrc+218clPZXPB6SxuAFa+Olq6wy2SAIaToCc/NUcQ2Bq+MnphOwqVg1FQMFj88WD/APKU52C7FaoJGFePy0Z41bUN4KdNUATLheTrq+AXvsHg0cdEeL7HekUz3zjRvXCNMu0Cx6UCflXmx57E91Q8kUzwxHlU3vs2YcRyv9BoqTvX5byfHmFOIlt4fTV3xk8SFbGEz1XHWGktVO/trwwrmw1RsuIADBsrFjAN/zSEplVvSgtNeD8escQ73DbVbWuYfq8Mjqy8n2OpaI31837LzevtZM/E4C9C5Y4WpH5PPHYoPDATXz+rYh2u+q1DDgJKNbHI5A6k1FDv+svU7EOKJkJQLAiD6fLEvxLNHtnWKwPdYZd5oUsxbaT/coYtqVzHkvCIb1Gc8I0irZSxdXkXiZZQDXzgWl3Olrt3kXAHn3+qPc0AJOyzKyY8mcInLoM3hbA55I6VidFBJNBNT2kEoI3GCezjbMntTctEcJ3eHfQVowXgWVPNL57eHd/z8/jANpGYBBBxRSTJBr9qZ/905Po76lBFz/7To25lMkQFg+OmVYyk2WNnki6RwVZiEZUXaYo6h29wNmsleS1XPXuIr5rFp0pv7mDiFry5E3Hyk16KzcwUojVXXm1DMTzve+w4k9gKJlHomuDZXURHSvfGNJ8KGQAxzFAlzbtScHadD1C4++9jaM568KgLwalypkyv5oNvTSyWRmHwp51s5PGWj1nLAxBiVvFROtURtTHn5TIp/GWG4QzzfCxX6dvb5EWO9WZyIxjzSuyEwyR7Ml+KqlWAsM92MLQDc1miId/5jFwdUcpvHs/w+WIi9jjNfsa+hD53rHuc9qX1YryUEjlB993olTvFWoD8M8wNGYLynWUDeq1LsIxvL/oRFX2FtSVmOiqFK6H2yXJcPWfMpqfEZpVwKRYK8RqAlDSNIRFjPYLDcAVvRnk0xY3FtF7v+HGJRr+bNGpRK9VJT4+EFfy6fj63hx76XE1f1iCUVRc3FXpLZM0rY7CVPxI1cSE7t91VYgunamWIhpz4uVUmcxBUCSKMdfUhnNRRGmhC2xU9XzTlI9UBzbsUxIM611nJx7lmckoSnGjUykYs6YIlvrBhNm+W1eIiEx707L3Adl9JGBpGlnjp2sqp814Shsp0uF6+7qjNbgEU7JMFYwNWFHE1F9Uv1bp2UvOsS+Yna+yVMizhxu6veSTy69BktDz9SE9r4v08AAADWc1BUtRglPCdRWMsrqKGq+bda/t+DCHoxYrV2P+ONLJHdw9iHrR29w08Y9GTTvDgsAxF50aNfhvmmJDcye+XlqvutWd4+/OkbR1f3NZfHbUhEusKKyu73hMXQ1l5p1Gjjkwkp/DgdVNW76IkVQz2+128iS/dMzsDoZ4zgC6vHP/jMvfODHl2rUaAH/lLyAxWGmhT8vYm8PmoblNgAcm94Z2txX7q2y+t4qPYNoa3k/hd5Mf41LUvxobYPd1VjlqCGuFD5Y37xbuUI9IsBjMpbq/JeQrW7TrpjJXYrzE/kwb+ME+kpwzrBaJ7771hZBqRS8DFNaPSw3WkOJmHezm6kq71k9WvS3P7C2hHnFxAmp27+h+KAQBBqM7AIZoRiNy7Okc91oX2vSQes+q3qnaDMCSQxvmUawEz+wgUHY6sjXmUPmY7axCPLcLPqL4bJlRGIw99JmewdeU5AaxUbpla3ZFO30d7eUgVchIq1WHVH6LpkXlAPbdBtxBuixs3L1KuxgvIpnQ7v/6DcCV7A8ANqcO2shVPs3TLmtql7Vsv5zp0iWynfAXRi8+6Vr2dbyPcYIkLOKoqvKS7/9Rt4y2yvS1VLOhuaKC6P07BkyBM/fpMpmI03oEIxKzD5101WZlvQOXqCltqqX2oFQhIpztnYSRnji+9wmAkUeHJ33Oux1fgBvY7C0mYmt+shodrLjdykPdz+GSNIaP6oLhIK+9iJ8tk0fXu0DZRToAFTa2V0WVnW89vZVnqZ8Eq6JGl8HVtXB0FcPLKmdQR/HgEUHWuE+CWe7wAmUPQp0cWuIUMfxt2tbJ+iqSLuxmZJg0Ue8IWcb/sjZJK0TeBkXR3eOBBwgfHlSxmchvkfiL317fsLUP6jip+9ZvavlhoPg5b58xqaq5luYKLKE89O++oDDILsRKGEvjU/rRVOuHbKUAa7LNLSoz422ISUVZzTNPhTDlHYXYMg/uL5Qn+dbQHQeARQ1fHj/MXZWH7nRN1EvJJZ+FDGm00M0AAAAmwnEj/10CY5o+3QcpXZ6Vk+8z4KXYRB18qbCyDICsqPvs3/Q/rG+cIXcWyWymxBrhaekBMSqVtZeD0A/udm8wso5rNwhBlbU4VGWOuttnbQsyDHrVbixA5ddMGiFC5tKD9ucLvZdTEvVnZ/DiVf+ECqlny2BSkXTLlSp4cXULJ/lvCXwZ1ZHB8uobJRQL3z1itZBAymBX/Sjhf22A8EY4RO37tto6t9tK+DIteGebxSvieQkguinsSE/W4ZDjVsanYKSl22JeCNRssPx7PXF2/7Stk6MvXGbYwfeBv3icR2adR84wK8h4hLGUb2bN0tpDSdev8TFtXxh4EiZ8EP64mYv/kTf7OTMKqwiXKT7akOSCn2dzRwZhJOHJfIBvAApzIbIcerYywdm1zP/Auvp4SwAjGDMbFJBJxH/YBWMeD/XxApuJvXAKz5FeGra1pMvrQuzCBV73G+S9qCZ9ZI2G3N988fqcYEgf20sB4xQM6X6vR8JttM5YGxkJLawEH/PPD4i3xFNhXPg23RZU6XnJf2aLuiHcZL21/Gzg9yNXLAl5BjFzfBV/BvD4yWi6A41+zxrn8UerAB6f6rupmHi141r1guNNDwCBmlUOipEQ2dM7C5o0vH+EiM1IVT/WZygtIGrwsdG1rUAWT7argKz2EiTc6ZxeKPcSLI/xCkM9kfqOWHvwoIOtgTD9sx38tMRSGvOriwUFvT85zYO0u9s7IbQPfRy/ux+ckenMs7jczA0lebRlnWJ6wTc7AyS6fq7ygRiO2GF7Sejcvu1e59qbhiFDh5LhijUBltT8Whey2g8t7Mm4HSJL3IvrP4fK+8d91ad61bvbnsMitrHLMiEbwm6piROjl7589p8ofwNwEdyRc21E9QMkKFlCJyJAacu1NBQCLMWhmwbE9Wty/+GyUr8BWD5xdso+8+pNAbwWiTD0WaCq0SY1cJ4G0pS5skYx1kzqNxnhPtPDXgjcdjd5cXLFwmuFIEe70jdXdDgvz+sJ/PdfAFMxHEMHmApxfdnHsdH9liSlmKBWYdLZGFTMt20iA9XFLUcOL6f3Fl3hASv32Md3A/Tg8KeKP4OonKJLgKRBQ8OdGXHmTcCgV6lnhacUhb6ohjH5+o72ousFEly4UcR4hHyqYlVYNo4+DEI2eZDRMV2crQWpnX14la4o2voDK5d/3kaQq+elZxh97VLMdgOxtgxrTgoP2gPGx2jYut/EZgmzqVG5Y4g/YbgNEtYUMcDxBhDTeJemtAN1BAub41aMOFK2P8hiAt6Si8cY/S91gxH3QLaDltkD059TtIDmCKVtQRlkqEbkVnQYnZLaByIyArWk/KToIPoehfZspaoZ205lC577rJ1PLjDAxwyyEWcYM3sxGe6p98jv5u/q/evL88T4JT231EU7DHJqXTExbSwemKf7asIMtZKTJGZGt4q03O2LAnWBXdDWcQEvqc6GsGQaPkNzhADyqp+eXUNzgRLcwq1U1+tEkbqFUBRJHsG9leNmI4O69dPsm5RoYpyQMK1loLR63Mqb9QyFPLD3GO366GuVs6eYs/CTM1qwr8eh7O1KW05wpAZtk/Bb/wAJIF9057P5Pu1gIi8Ee04HjIvAdC+VumE2gSWyVoLG6iP2UQLm4PSv+lnAXhtiSDDM8FKXt4kqcheAIIUSZLNo1ZEJh39XK+wbIQmaXZgJzhufg/9G9QxqsYRUfaIeYi5a4WSCS1DA/c1WcNxOVsRmevD96O62/JjmFjJvAMjkstcCT77B6R+02nciAmdqv/8GrTzG30S8LMLm8nyMmyinxf2068mBT3WvXd+mWkuXIJKMt7E0oxl732rFdhM2nl85OvEB5iyEormCyVn+k+e24jRY9/ilNkX7BotBT38YkuRu1/P1hbZZmK7jN/An/+uBh10Z9LMx6MmuKWv2kTxFYhVkuMTrFDEsCw+yBnUPNEJg1f1qSRwj1BHkMK9g54M0kV3L4ucR00u24YYUx0z7DiN1r4IMlkwd84Z7VbCZGHTbt1OAga7YY0JIpAR4wUu1LitOYurRkFlfd9oDs5b6OSz8uOJk+b8s+eLS+WuQ6uOoZJD38VbOIVt2OnZromyb9TSptJgvo80eQdTu37w5A+gkHy0UwEZgvkg2QV3Q03wshBJrhuQF/TWQuwQNn8+OEbrNo29rbGLI1YJAQxJqli++x5giLzzuT1iHfXgIYt3HLPz4TN2q5n7g4nW70/gO+dYHq8IQvNyHDdaOMmhql3ClmBkl4fjT1YjSIl9drX/ubq6tSTixr7uVLjnfwbG3m5ALmqvt7zpnVbdUxcX/kF/x/oVqPay7X4+WqseFFRlk4splgNhiSNGFYyKyvWy5HS2v96jD275FKHGQ5pCydXAfEuuMO7Lf+1puHQfpwiu1gKrtl8+KH7goGJc9FQ9GZqOZt8mBAPCbCLGyekQM1DMu1bxnu0EQUVCuZqVeYyvhdkiA18EORE6J/n6KqG15umxL7eqtz++V+z+2o6d/yPUIuBXcEQ7E8yrQfw2j5/Xp1Pg/4RXa8qk6YiSkWDH8v+msY3VcRITvQAIf/Appg4Bms9zKqRGAF5PjYNKmVJPxg9HSlIdbIjQ95MQl/3CKfSQ9sOfBGtSdpLjGpCVellnmExyzgBr5DPY4TWA491Qn1YvLt/+ey6zB9G/5DKeBH9jeNxxxh7FLJM0qspEuJXWxr94Ku/nbwXAqhTKW9bf8FkUqfyZb7tYkJYXAB6kKENsVhb2cc3847DErnKoD0BsH3t8S74T/+7nN9rZ+GwTfWUVflYDb2+U4QK/mtIVtHV4g6mwGvFTs4+7hcRYExXFBUsH8deCGWp9JWMzlbQsRx+9xH5C50gTBZnSiTc6nIKhd9/htIorvmQfIeYUCXxVgnM11BlhrqZC8peAYSiJD6Rrml1PfN4fSCRFmJaL1ygU6EDebvrUJwEQ5a4DZHZsiGTReEalCcExAPxsl6trKd/HmtgijMkki2D/lUqMdUoGKr8USrDwScjml1qdSOxUlkz7NNcmCtzbZ/93Yu+DR//XJkauwNfmx8MG76o+oWOJF/kuInlNg2e1Nhkameop2nXbneurypwo9HtfWZTja3BepCNP1YOSLkq0PyNdQ6JXInqdLxnKzK1dU5XFE6QkYceDguh+mPOo9K9bWxMX1LoGqX9lZf3LkTwlGI6zwFNiG9eATtDeGqQz0CtbOhfh3Z0FvQ7XbxO+1/xHyDNKWTSbsgFdOzvC4Yq3533jYvCqVxlfO2oVZ0As7v66CjikUuiH5VdkWqQmIbbi9KHwrvM+lSy/zPavBxXU6ro12YmIV428u+jxhVrVLDw/NMJ5MPxmIPD7EMNK0rv/soi2CFtfxF6BzXguKhqXkrEQ3ddT72RjFpVyQq/3LrPYP8faGYyTfVCHxO9xBACeoPvv6vtKyQxmGwGS8MjRjbvJwJetH4LGg5yyIUaJVB/0KhXstk74aL16FapXjlOGTIzrELYyZvelshT6+38mFrf111HuEQPCpT8f3noP5afQTACOTYEL6fqBjRJqAFRTeDBh43Zl7H16U/1OJmHUN5P8BByyhD8YalVeziwYtT2zh4KrKYa0lk8/7sOdI1oKCOQmB8b24dX2yLDTypJbbgTg3GlRtKrzN+OTWMean8N/v7RL85SQwm7Pix5bA76pE5IfKUqE6ekshpvXsfT3ncvJBDHLd0L2vELK3vMTgySn674Ox6QH7R/l3qS0AgkAg7DfLdDDsc5UAl8E5+FGaWkclsiEHtzrxWi9dLMRs9ahNzwR9zXgGvTPMSToPC+zfREoyZLraXb2i6/O/NxuYRZ/0uLecTIqdOmGq+wnVbm1RPn0jcanPnm/9hv0Xu0RR28s8CQP8br2y2F57NZ4r1OE5ZWKs5CJvNdHBePBhyLP3EK1JWjL87JJyzPz69BmX4wUP5/FsGUnIxnHtgPN8vR+8bZUSWlnAGJ6MCrnqvuRQUu8Kk/apAXxQQliOfIXR2XKMrPzd82x+LCGoLFsZxeru6Vqv+sAaacTfS2lnB/sOD67XRdVgu+ZAMmC8U31hP0XHwa51px+ENpl3zLUtsYjZf/11R7y2D980KoXb6GlbF60tOpF2wFr1w0FlHMJzZt9Cj4hkYSe0oBcZoZ/u/g8aZhRY+KGe21cbs7MdBTbGVU9/suaWypdPAhL/DOrymvlpnLg5hsL1XWekT9v6T0vt3gQyf+l+RyDEwUZ5SAVn3l/XwvHD9XXHdKOS7CqNTva0jl5HKcd2/jQFYcJMiIgyfvPLCqCLGqIYOl3QV5K3Y2lE1B+YYt5zLeuXVqDVLhXzfWmc6HC59aN7BlLVVvAGF7WrG/SEl41FDgIpeRAoumtrp3sgb06zZP+gRmups5imrpKP3U2RaZ17K8oeknAXMmXYBYeiLLAUKl7A5zrP8M/FQjJ3KuFN5CyRXV3lutkddZrNFBXgxzceKM8yk4pbmU/SNXEb+L740KEJk9vpxPnNbWQEM3Td9OKxTNjTS9XuvWmb148/MkZchxp5ZSywRm7nkD6fV5JLH7J/kfQ43IKHwru12B9oV37/SrcF3RVTLzApCbSS9j187TVS8JHs6+Xok27oNRGVjiYRzjTTQ1/a2/GftJKgey4v1ixtV2Ed0UcdMkLJQZglDF0Lgko29YywusJVOsf5JtKU4zKX+S/ey4WPOexeSDkNFkG6fbHhlttUuzV9QYxClou9VQvoww3paNP9to7ORGVsBt4YwLFkDISE5a96/vm3LQSu663OSBSHmT5aEMppbT/xCcT6nsckO5CUh1q9l5z6ku/Zvjet/7MvkHH61UN0+sgPqZbyzFwvc1oyZM/jT8bOULW+CWdmal8WU/PJdDiVBi5m1CjT995BFmQXYoDfXBbZVT2Y/XuZgvYPHT0qIG/aAh12GHo7CTNH24M8v9Z2hGea+70ABKbl2uRKsD/wbPs/MVxqkgQC7QkR5Jq3u2H30tYGLM2zP3MOhWG5FaR7+sTKtDrCzYR6r/hNNcYPAw3tvca9uhe/Nle/0eDt/v2HEpO7Z3z+l80K/AuN2Jfc1k10pS96bpotJjgJgRtzZkxO95++x0NuQlBNw7jzMDKdoPMR8WElwZDdz/H1JkVzH1nO9hMXyGub0JSZucnzFLNbCXoaCkklQzTyB38J0M0dkgOMijG0KalSqJbAlWXLdOCou51dohwPGKjPQ8qan2ficdjIk9MWU0LMYa7zGK13HuPfk9Zdj1v2Kgw2pSugTID+E7eMbfUWwTHbvL0UU04IJBXpgQ5yBlh0nYlyp06FIqLxNpfOenXd+vofTsRlcGpmtz+p63J7h+BKuIJCPWGXJaha3gBqCVr8y7bngmQwz+t9Ay4EjFOC/rwS6EfaBesmdSmRTq+5CEUCkAiu8uxF0B11fFuwn0T6rgbg3HxKGWjrHqOHSPKF3ZD+AJ0s22H3StJHKD+OrhnC4IGS+mbpkqP1chJDirJvptbN0Hb5LvlkT01c2DlG4+qOa5sPBwQlZGDyoxAIVuQDzwtUFPx34NBug9TMulFdwAbzlNvL3a504ZM/76dDhlLlQoFAyAMZ5g9fLDxzMSVqdULKAhC8+hNy6AJS8IVCk7+u4dL1JZZhSnD2dt6vo5GdGJFUJ+buKLYtGachhFgRqTgOrtqeFvRaJJgM+eKgVUldlLqJB+ybJXwN8lL829jfw/UYj5M0cR60vThkfrk/1s7Ttn//gy2TPgJCqzvnOzbBQ5GApX4II4Mw6jVXuRPr7ArzBQaFmUxvi5HgTkUkoYsUeIStULLvNu7tKJVRVrgp/eCBN8LqUj6OddX1XUzMriab0YnpRWulGz3gv73RHVcc6x3/X7L3pBKKQH1AmAdTEuXJbxe+CYKcVLa5BMi2nPbuNbvnqh+o18EL9xxSvbRjdNCLVmDvwP6VyHrcmdw+GSeMWOO+MQWnSF8adEqf7r2P2UKVeFspV8JLDguPHE2SghURIt9YjTO17Ay593rT6tl6GIGQBHt1nHBbSR5KmSYCN3gTIt7btS6adBPQ0+ckAwYXbHXxPB6w2wMd26X8Oe88oAR1NvuzQfrVuQp4paMsOZJdmyRos2bj8178E6rxM4hlkwz6D5mr8jHBG/27Otjw0S577iGMZiL7ow/aIRwf3NJQHGIFbQ8fArnkHQYvcjZXhgvAkaSiol1MsYybO9XP52bLI827KCh8dZPz3uMChfKDklQwGGA4il+Gv+Pt1au6KBv8MojkNrywHM1bcyTpmP5+Nn32udAXD+01wc6TwAZsu8CxQuCGbs3eJqgS+M/+s7KHFZg29mXO6WSNmqG270uzDHeresSIfOlWpk/boxxrhedB3VHSFPj2kd9WOztQ01PKh7TCeLVgtzXCM731tJK4U94eiu8qyDsN5b7WjyDKiufm1p7b3ivI9GMRCcNOaRwscb0DxM/D921XhV4iuSE9gpND+XbdaJVsFTbAXqiXmQoZwZobq7ndpOwNcUGWsxzb5S8vFk6enXII2TtYsbSvDFmQPwpn/8z4gg8AV4ikTOlvWASxt0JSn0NcGeabczgUJAbtcuIBQvpaa32ux6hc7WP/Hji+FPszILvwoaaOGNkdqsHw+/hrlwZrnDU7ohJ0eFqKxZ9QfbR53IJfLaVUpdwDYqTID4/pLVRdrJIcdNqIcVTdmh0w9B8TKvbdvuDDhlvIJgi3pxMJU5W4wibyYA8V5Dh6+vgxc3S6dNWH2vlSxNvvFYRtTv/w7nTD85G98w4r9sINXqMrLAD3UI7FY+1YkEHpRHLUpHJah2IMPLkCfLLHZEUpQaogPqTt4eqSdyM9lgyf0sMPyNU/nsoIA9K+gAUPS5xrFr+FDq8NtiyYN3nL82+P97kxguGBO7eWVRgvvDfG0PdfV23CER9qQEHuhg2v4N8um6Ob9hOUKHcewKGiv8K1Lbb8eNJNBG2D9a8hep06vlqr9hKNRM/wTP17b3fdVCzgbCVv0znzQTEVycL1GKfD1vmAOrTdfGDuXDkAFuPiQH1t5JsoLKZOH5UPfRw/Q6LGEVqNmFMTuc5uacZ1gMLO0AU4ltpnFSABvyLhGh/6o05XCdQq1tkFracKR8tx4zn9f6tLsNp5eASIY/3S6+T1eq7wxIofSLsJnEUhxy3kPz89lu8L5xaJBKPkbZAjK3toJJxgPHOiM8/bVwaApZRmZXdMwtotHKi1urTSQH70IW5uBIdUJ6JeSRFJ/YgHpBPc6vIQ4R+8JYcswpzQm0gwdamfxZBmgu/ZOzGYU4qB65XmLKsB90VEinJ7H6x6Y7Pb/4qW0Daf49tPTKCnQTXhkCB+c6KKHGkuqG+J75q6ziJ/hD29KLa2kCNO7OHVgxbs0v+uqle7ytabFzfT7085JC69rkPNUTIp4UqXFQbnAUcvFOVTS9KAD2AYMfhcMQ2nFNlSRZNXPmyaoPpTJe/it+6B2toVV/rg44J0LYEPHTX5/PgpiGkC8KiZ+oFeiiISFDoyvB/5Z9SmvOhlb/si3iHC6ZunpdkNCwLUHk7Jh4Cns8YgkdIBLW1IwLVfOc6JIwuz6fx8c2OpHbeoV3hLgKyfnNA8+7ibArUppLp5aq9LyFgYWpgZRbcKxSDjOp7c4pdwsQN6MZRt9Beu3/S9OmGZE+oK2EevBSAW++EiLiyn+geWCSKipH+dpbPSw8KThMl9s2EmEz/Mj6nZoFkjY9n7o1rBM9j4YCpjQLh9OuTIw7KC61oqJh0ckuUF/EYUYk52cb/J0Urk6T6KfzIuJx/IV92UOBCba3KnPuTWOS/xvnHXJCD+qiVfFFlyud50Uuo3WjGb7UAAShwln6DB6u8BXjai2uIDYDpm7KRwYBYUyIPwhD8/be4l3XVviAwqfWqE+nbAuq5Gs/5U3xjYbTnnNylbDh0B21IJB4A06rH0q9IMgI+Dxq7YnxzrpWkDUAjk1SkLRH+XqRRz0V9eCFvaUJekhIcAobyFAAI+N7lHre9K+KycrR2YzC4AqqADbFgarhD8EA11b3IynDbgfe5CAuRjBoEsFh3pgtM7d7lmDovsNxpz84eWn2IDrbcZUg8X7gbzyysnHLkzluoxbcki30UW14qhcNo+JtaAgSvwD/FN0BxuiywTC3VgDz/2nCaQh4mFLGLe9aFuroiW+e+NUoeKHwzYSCgt0zc7t1ZFje+5S4UkWtUX5MeCDjqdjdPjE/02l0+lOJBHxBtLmWF+dv7SSuW7Syx/esfs6GoKHvH7sdJ+PI+mKvGl/GjfzKkkzTpg+Rg6JEWkrx3pDJRj07gNd+/oMO3Sj25mltXnO+7GsDBj5UtBoH+mvgEg3K0NLGX9caJaEspaRkvfFJHFpO7iBv3melPSqW4G4witG7pMS1ZPVojc5gT2/XgtLqyrdh69vGQyNdu2jrEJLVs22lRlGbN5kKvt6wm0vVh5DBPky88GB0/HVJDTfWPbrP0xHu/Nc+BibwvFLD4vVESVWfB+Nso6PlkE5r1aXRkXh8mdjGlTj4bCexfbjCjxepC8Bkvv8K6i6qA4qeCnoBufTbNUYiOOlVjJXOyCNRNqPvxz70GEhyk4lXzAXnC61YmF/2jH6eqNv5iyUqytX50V40sMWtq+h98u4/Y0mjB5rCHO8o3HxPBjgz15lb8UeAAqzRPCQpMrUsQ32UOJY0WPyzbXerJdQRUr5vlYZJknAWE6v+ZY1DA9FuvCEgt81fp/JP+iZhLagUXKN9dy+76KioNzn/1bB+RV1SbO5lljDXoCjpiehav66D9mRWZ0wkb7X+5QNxfXUaco1ZWYSEK5OfzCSXPAJkzV+MSTGYkZ4kXeLPqtOXePVb8iuKhnBf6ki4Rzlmhu1X8uhCLjI5K1RrtwyzD2JlH4gFihetT1qe2c/3DrQmf0MwE5O4rI86c7F4kp8xzjshZsdyhlvwxyTxCXHgn3j3GxZLYcRsb2IS4C1FI7EO6b2uTTzffL9fNNpZbpErEtgM0DtOLl9VMI1zdGRoIUYNcnPjIL4gku9TugErWK/SPokN/xnJ+tbgfKgoP2AANPKbRNtGnSjJzSVSA7k9N4nvEX368IvZuXuThlsflBdCEGPbvrJo1JJEVNnBUlXESflFosAaQ0ioxjDweUiJtlQ89ZNb6fyMDErJ/NtiCkBjPMeR4EZaROALmxChawJ9JsjR/Lbqg6GCmrCJ1npX4i6TSwlXp9EPkyVIrc0VZpv/bphM8beDkqkn78lOVwb3hMBelhgGKdybOJ2hNf+bAzLqKgRN4igYGsnv+mPP6zgH+JX2emMU3ddkcgt6/6Qo8NiwbHZiPolkx3+o/GwDMCWrjYGTG51NCp/DFR2aFf2/V+fJaZSBErXaZymVwotfdGH4RTXMGf/EEpUfVwzxk5SVIBzYNmyoS2+3AS3Nm26awkd0nmpPpkZi9lsfwk4nkqwiIx0MMwwWe1U/xYJyAgk9mWp7R+/xyvQFXUx5mcKxn6j59kHueQwA9aZgaPUan8YD1WWaN2/SsbWR5o+0f+oT/7MawISYvgeJ0Duu7AH7RF3E26Xrz7xCwOqwvLxy1ErgBoA338AfYuMxyEY9PsCwRreV337y1RydGkvGyHwiGHh8zRekdIQI8sGql19ACG6Su5Y3exeSZa2NIOMMkD/thpJAOBDj2qWck4OJ86TZXF6hu6moeygIMoqrOBaDPBYHhvDs7VRXlMgzmZBk1b1dvCtKasQTJ7joll4xybR13ys4G16ajhtYmQ9un1AjMrIcY0ow0nBxrpPcSd4HNfGOkhuTIvGs+WaDyyx5ATQT8qsHaJ8sjN3nWsL+qN0xhbvMe2VIzIs1Zg3O2ueRaRLxIIEbCEQExUgHmvXbPicb7XzbABMb9tS+A+FmP7PEBTBLVNPMKBt8KcbdmnTIY6JMyPXceV+SuZ5ppz4UJs03dnlR797qvo3Iw9/ZPVm4FgpqthP/wEb04VKAP+IZ9GLxSyvo8A26V9Uv53iQhKUjC0JmocrVyawta1TqR+9TKhNCKuOONQpjQitLDPF++JCCO4b6shZehZCpg+uoekwvsMsdTiPb5+7kVJgmq67G/r1Gs6NnCBIcDV1q3W3LU7x3CYRT2LPjphvp/SM7X8OYlP/QRmTogcNaVVlbRLx6rhyZ2bMrMsuodw8ym8oetxbWuxs416y8payGWne/Xlkf5Nt/mZEilwi5PdMPGQTp6plDha5hKzyOHt8pACsr8mwa4TS6rz/6UT89jkDnTplfKG6tLZlWNNhaovBgSl57vsxIge1PsExaYpQBRfHx8XHa54E1N6JqNv4TTANLbgFtxAwcAFdaip/J9py2yFyMbaynK8y+J934rGG6VTIitCwD+GQ7YiQ6myTqBuU+LWqd29IRWTTYnfWVOLkoCIMULeE2EH6fCO66zuNW/nfyNt/0vdPpNIkAG9IGN4AHSvJ8jA/ZYxATNNCI4ZFCbiE1ABlLqEMCoWREWOSydJ91jnIsY0q6HPxok+mqkXJBwNbPhyXPDq5HkkUxWIjFXRaVzt91tXynMdGyxL/F6ZcdMiP26AHv+50GfkB77EJBPO3DKwy4Mls+tR83IL2+KcuZWgQIwLUsbTYSlAMa5WWwFQO/PhpAcfEPgy0zAbxIpgOwKBb5+CdDUkO4ipC7REZTZLZdAczwNuASKnO3/MPyv3ePPy/ipz2Yw4sxSUduHIt/x84JSnOUIUfr4mhYezjdLkXKGjZFgXsJD5+BaRCmi+V79sH/uUlpWTt3BogAa7ElFk3s7S/EWpq3GHtIVth+Zq4o/l0IWz3dq5CqgiMGEkAtJViASQJMIepk0rQRXVPggODgDFXxs+jFXiA+x23KpmlurtSWxT+u6fE6xM9cw0ubkPTfi29b9VA9/msMFfThLKqEEdjE5S/Cmvno0BYrt9Y9cd4500e2ENDCu1jjQI3dFG9B3owMhhNORXL95N82DACZuNogwE+0OgpQynxv/0CiL9A4OWG6Ysos7qi7DYPEShsc4MN+XsqVk6cWpL4Br0pqGQZwK/psX7HKAwlQgQAcUWViIg/IlFgylUwa2gdsGiO0Pn9XrsPCuZWFTAI5EEvVFB9CE+NJXyzULJ9nTMeGNVwnehPEBV41shHGhAbYe+TQMRFahWUYd2pxVX0OzpFpemMSZn/UepEILHzP37mSmnDYg3gIvcBm9PeA6qX3xSJSVf59fJl4KCHsH8P1TlKcAesIS2GVMzU4xIwNJCixsVxxv/h0FP4DQg3nhZgEAsuN46bBLTSyHOHnYsj9L/MBFn97XMcHTyBtyU/K+QDI91xi3NR3Frjsi6FtSLWVKEWwzihKY8ljlQwLldFDa/i3WXnKlVRNqQ9BNM4X6+4efXv27LeCwd+vuZNvBqdgbFTkhfJcGQG4ohPJT5PuRlEVVJuEqjRrAmd7IVb2FLfC+8Ydy65d1anD+OhT3WN1J72KqnB90gR3kplkUkQB0AYpFkOOuquKTaTGT5pg5+hytBLu/5L52e7NalVJZfEEkoO1o9MleHE3z2bTwikHNrRll6Htfr/BNVkDcHTQ2Ji9ZnMTbMS4r+BMp3X5QwkMCbgMDIFlWAhszfvShngHl+EMU9t9cYDSptm0nIueQOfom4Lb7SSJnt+wk5UO4im4cXKja86dRvW3fZBCO8CVdS6y8bV6Q12d6Xqo1gI0qoCeLwLk/R7vK53IRK74nUw9O/zhzW51grZ2Czw7UXJ9nbfKZzzZdUA4mL8sFWw0xScUSzSgl+AbOV4MBLQ4GMZTyCSYX+K4PBjbkD96gFiflp3Zu4qHtK5lcKPig6qNKHeehDw+1J2/zwKrOhnRZOW/Zb3R413lrUQVytMlsfgiC6/p4Y4B5aTtyxEsUZSc6zpDjDolTMB77rIHk4hQuiuF1XFYh0DkKC5MOgmUBC+3sPkLW/Ks4BZdRAjoggE86kfbavbvMcOm2ZdjLUgQXoIYF+1DAogBdz8gHrouOnFji//81RpMwIlRFCwZ/eszcahqxeC20QzyOU1WpZW/1CchfDeWBZjkWPtkdKsTR3JLgqEog0DT7G8JIT7oDRNi/wev3VJkdo+gWMf1WBe+w00BtYu1OYmZifJUh3xcwYdRO5S3G2TcX5YcaQEqkokDgxMYlrG5K/J0ck8NhRH9FdWqP0sVzraFi04sHLchD8L+C2TxQml0ib1Rgj+fXyy1PMTA6UrjgJUdhXFOymeQ4M7k+TdbFitA5M/51b8SYh+gfcLlTpwcdzwSPGGkq/h308Z4Yf1Do8suh/fynDt5VXwiUMvmxE1ZIYWBTAPxtEBvumo+qlaoXyo+B6gvU+WWngncIC2FpWrz7effgh3yeez+GHvFQVfuUIX7EWlBvsI4VdwHmn651f5DoP0nTgGBPGwjQk3fKzjZ1w2avf5uhr3OUv3Ck/tWmtZPKhNlwhw9HWjtX1ESH7z3FHcB+plZ0q6c7GPQgsbTI/33s7bKR2k8qnAVY2XSePJnuwg2npYuJfgIIl7LhhBXtVdhGzQo3Bs2TLvqph/dFaqiPnMWjGmez5OIqfMemrcoc0o0GrBCeuBRxJftQWhsO3RweXgsjKhzgyye3cwyyILuccP76ReCXwAXa6Hr3AEkRx5/Oqy/vYMJlfYmZUECF5l0h1VnB6Q4dWs4wPbcM4AKHhN5VhuQt7YeO1CXDDOTZw6B3iFEjMZp1F1eOhhtKDQvPzJBTDnIalC6wmTr+cYgoKrhxhwtatX7lQ8WHntyGxR2UzY73nOf2ivEPiev4cOD+r+8VXYceG9RDruml3x5xcCqnnIW6iFdyxAcHCluqholT0NgByqOqkhlrsacx2YFj1heRiwHfeO9lEw4QboakVjEDnUKQk3N54Fi6OADrmGSbZALdb9wViGPXfMzlNuWpYwbZ0rEtZTKHxPFZ9sUFMgFgwdKiLd4deorrMK4IEl4pkbXqk5mMh4r24ZE2lnjYR1iWfDd6flfeF/4M3S2SnOuEQcJ7xUXPAAVfHxyWo6XaXDSDukA7lzsd7/te2Q/R7UeQ8ETCg3CVVHyggXqcqfNOOO8l4Govywq9zf9WnLM0B0Mff4EgfgCkcHl5oQ7YpFUwBgWER9fDdF35NymW0elkswsW5e3eMKviruYsWbUVaSsvt00+UtmwY86CuS3+CIlQFjyHK/SV+6pjfhUYZH7xCQCf4BB2jA8496HQ5LVzV8Byzal9z/zQPchjqD6DLPjwoA7VzIW8Nf7Hm8G1hxW2G40wxzjTONLIlA9Lce/1mREzf7iPUlm7BaZofALjYh9DZafSXjI9bdOHZgUuXYi2UxqKdc/sO5p5MJsK/3i4VKHhQiCDsGLwtYJALzHU29D7XQOr5yxN71R4nLYq2W54sf6azcHjYQdDfK82oPOn9HRxnaRhZ7GiwCdKuy4zPb5v3cy7l7nxbkLAGB4/Gv4mcbVenDo7bjQrxHQk2bxb1kU5o2LbLKnxn5G90vgBw7UWFV3WoLZaB0TJaFCwv8oS8vmcJZVnQds14EreZlHj0FME8b6vbXpU+t94K0NbjIgCpZlB6HE+0/eSLvNHXeH3AMa6x1oN5iX8KM82/mdBFjAI+DiTohLaCfa9ICXnbBkVaeo2Iz4mAxuKCIGtVDi/vUrUua3rKMpGDTvc4zSX+PMlhZdZbYM5abXJtBLu7Hy/kEI+d4zyYjvK6aEp6zU9d7tUmNjPTfpZkNm4nrKjSSFQv6JzV8INxuwFsYk5BumKUQoB5zAXbbL2DGA80rW+aKvSropAXXiOoHfscT14uNb1pOPab+IlaC4bEyPmBWjvXsfDjY3CbznFC7s4kt3ockH9cW/He+zXAoyUMur6yLODUVAvElVe8l1TAhH/4V7ybSub71H5tcMr4tzVs78h7SjLI1WSh8+QWhE2+5NC45OhpAuZ7tXf5NHX6otoOQ/DJSs+kutx2PKn7gLKVc1ryCtsoFSfQg7JmMkhbWD3SuaoSnFsx5JKzDCo/GwUMWT1cUVIRtRl7nLnQA62reec57dnHutodIMCg0Ml9CViRcf9zWZBksVh8dgyh8TFpXrrfVwaZ2PxH6rDdaO2oNOMcj1o2WVPrOIFo6Wjzqjayj98HaW1uqwiYiylMi8UDPI4cevZnmuESVP/8Z3eFzRAh/B/oDoSykiJieVI1gDRI9TSk/DDzbmRJXTFebcLbODdmwI7kEZW1hOdDOqD3gcFf4UgFjAlkLg+NaZjnCWdcWQPibFnf3KrY396Mxqs+1+5NH3rkF6Edj42+rkfApVtXn3BRhl432ev9+pH7SPXj7RKqiZ+ghWqzucaZSqjKDG/RWcdd2hzV8Fi/i7sP42hX7rE/KHU5k+04oB/UaQLTMvsd6wAYdYAJ4bk+lOsNbI1WmNq/Oigu42Lfumzt5ZCYNlJoOtxCt+6vkLXlGJs16Ms+6SSr2vWE0Hgipss90oRvUU48KCYanS10BAPVqAmIqP3AVSosjvHCXiJJyGobNXsRJySpnyvtOt0WVC5mw+j7dAE8ilm+7XyI1Dv02lgamd0SjncEUwHzaVbf7GSO1Mepw8YpGk+B9qUGLPhlObXhJYk7RYnzlI+Jd235ipsZkyllMTaod/wvCdcg0wQS2cOM/jSJqgc7ur/f9lnA9ebJTS4CitKbdvM2QEngbpVOZvyT19ilsYwoOItTn3zFdev771IpF9wD1tK6GI4OcDBR8OIKK2RN9qgbHLv9lSueJnKQoXzQpivvvy8CrsWOmuuvM3d6HOZ7ckAFj7H5qD7cKexsW1Ksd3QE1tdJzxgtuza9WIQA0byqksiFR3AzMGD3pEcf7PGnKT3bBBRG+sAQ9ImduM+oVHoZgNpapMr3GDfTj4JVl6GxVDQf+G7UGZrbTVUpEk7clQcsSl9zvxtxVUn2F2nTHL4IujD2DnhfGowJh+lPKQuHqV/yoB0lJuZKDzNPgqzQCV3TH8uKDZRsh3+OsDB9ae/pfX+hQqWNnC7naUCu4OMgTWDvgM3RmKanRE34wPs90HLmHQFS0aVtNrHTkS6MMEsN59ULGvzXiALZiZvk0Ezsg7rdawGWVYxpG+TGGAtpMPiN5hnT1n5YgTVs9fvGvkGBgR7MGmo3yexA01ulRxnL1dsHFA2OQHurLYm6ZZ+OEfS+lwl3f84dYln0IuIAxrT4Y9rcFUbmc91bHjm7fQqN27j5UTTTKPq+7ULQG2ujCgvY4IJFOaUjXuiGc9MiNrn68LZSdhZgLSA4BjjUHgeTklVZZ7T9PY2FWqGdKnOKR6QrEZDarvxOAlMPIPyCPgBwBVBpjRp+YNGwWbheVK5C7tQP8b6Z+KbqiOEfch2YJwehUe6Crgw4mpnExpPZ1IlsCNzPhOI+cbyld6cNQ4E0p7H6T2DHEUlPRuBM3qWXGonYSn9hggTda4g0n+lnX16ji1Rlq2sKe7YabCTzmZybLxrPSDyrEH4X14f7aAF6Kn0lZNYGrafFWMfXyRd1p6FFGUeo+PIqKyXlWhHKgTqHvkUxuHTLBNyyi9DwRCPpZu3ixlE6sP83PI69rWlqrVU3Kv2Rf0e7Oa3sF+GeXHpXxv5deXA5DYVx9LE9Q1cJCsZ4HqjUKN+IKCGBwwoq3I/0fVh5FtOHfTl4bnIcInCGNN+dlSE9aNJ2qX2SOALOJwHATst2Dd5VNj5DU8W84dO6qmZE6xXt8e5vurtlq2ffy5rnbRJRwihjU8enFUOVmddTLP7l6bkrZm7Z266K7Ms0z8Xm+tGOmChqk5g/hh18hT6HU3QCTCc7SLh0c43awbpYj4qaovRgwaaq6kMRyvROfzi1QzEYw0UXGcnT9Cm5dDt3OjpOrrwPDnRFGz0DphJ2wrc7DLeuCAJdQJocU/LViVAesE15vqisGFRiq9f/EKrz+xY2JKoRdM/rHsQjduZZFcw6+6tOl7YqC67WEIuCY1nyP6tcAfXDFFFai2O5Hx2JuQmrMSCmIYemqT4B/kbfhX9ucfk1Xs+BfwjY0Pza/nR2zPopBqVJGXPaF0Izibyh8gIOCNWvlQ4FiFzKvxmKYTfb4pi3fldzFSEb+z1ryHjkwf6whO7dKitmX8QcsO6/1p3FsaI6XSO4CRngwXS62B6Iyafk4NTyW/mdRW+Dxf4qZrRPO+DEMpgeAxYRQdLHeSKIyrxJePR80WwP1Y1vtLucTIlZpod2wN/rlZ9Ga1CrGF1hhqVxfbucYQ/sWRtlDbEvIoSPFwMFx8kcjfOSBr1H0AlRR8ajXztYg460JEnu8a45SgRL96H38yS6AC6BzNCJDsqZMt1zmZ2BSVFvxhvEcDXj+1ALzDA2ERlc7mjN5/JMzRCn7v8jjoVNRsRXMrlSR3N5QrD88/aNwPPP8DvK2T88rTIH64lyaAQt+b8Jo9cpp8xoaeaQT//1e28QPvfSPRpiZCW/NWxmLuzTvFY+wUxtJrsX/EDFlwZYIVR4I1a2hXt5TMvA1iFPGJeCOnPMV6nEi39HSzbNb6o18+ANMKXivwEK7Qno7pObl3FfQPl06Y2R4CIUQBWWADMlzSGR17Sj2XBMiQPuXbn+UX1QDi9ew/wW+EpbaNDix8ZvHdWUzoCaJKbf2lOg7Oa9ra+IibIaGyHa0buoPgWf3nTrBRAS36Z5iswQXYHR2TWpPLfcf9g9Odk/2fSqSWt31LVJhFi3dlPYkrZL/VK+rTZYI+zL0EIDXJlFEag3GcwT5ePm9NOzHH+pTZI2/hOEA5YXuS+eM0M1qkTZOiEKvcRUynki5wVv1pAbBo9PmFUrRAs8kc7LX64pfE/tYBF2oGFFjfPq2WqjKfdfzHGXvKfyFfZWN/qlHNSmLEwGoa+c/E0evrkrBBilHsasT7OOfcA5yLOLMbO0cd4Xj4QJaUW6SZyNqz90t1l6MQPR4uVRxuHmT2ATuorYPhuqQXlxZoYPipaYZVbkvmgZ3S+KOymGZC1uyA9iJtpDgE0LqwkOY4faPIPKqiWz2pZznsnwTkt9319o6zDywPUDhOO6nf5oDvAKqE5lpSk9/Z/kCxVb0HLl7PcHM9yiK4CpmKePOtrAbQQuQF9piVaYfvkQzr8vw1rgsUNeR2UG4CFvOXIJyufvPwsSkj/RoGgYNPp4SC92GSatkaHGXLP/xlgvoDJRyxK89A5iHsHCJYcuBLuBWdNYFOCQ7PhdyL0xTUGjDY8Z5atx1PJzaNKjZVATcJ5CB6noQs/kU6VSBUpXiY0sEdlGYXToqinIQZADlVTEDW8jkwY8rsKSBZtTdhp85T3QEZViITTwP4bvFkva+oq6BRlGIUzSnfiRCN4pyeFO2oYQGpNlhrsSSZV8ceuHmWpjYaEVmWaVTG0JH3uBQfv1zdmv1yghAUZGZDNeOYEOi4NgFp3dGm4iYoNN+H5j6DNvm8qM04q8FFMBSiJ1juozOkFGG/juznkVVacS4i9YZUEgZwZoRh6Fw+5cD3Qz6PMVXATA5uZxEOy+4XrPSuIkZ9YXJKUejTOxck7bdsSCliLKw4EBrvIEi3pNd+CzcYy5Slyq4Smc28k8SqctktOKqPUi8rMY9hvgODWA0cDlMoaV4baMR/AUXZXdtyD0uBJUUY+obsp7rNKhmMHTqLGmqTxhaeEt2DLfsRqPblLbEqRVsp5bPn1+kM5kz3kQP2x4rRNO/4zXRh+e70S0a1Xox84IXWoa6A+w0xbsLXs1bWBXl20+diQlhfynwCcCkLWsFgvCY6xEOd4EwgGBXouAVlEfX7ijFV3ZnPxfk/Mu5/cF5TrZexm5Y+BB6j4knzb1M/IBTce0RRotX8/2vpMubDXFr+f3FChcyZDeljsiovaTkBrAGyV2H3Zu8574CVus9qYrhfhbaTzpOfPXK6Z3Dwz5xFAScVGDWGN1xE/ym4z66bsq1V3j2ndNfmvFg3pNxFOej5Xxnp9WdjKo1EEsL3IMmAaMc0YTwXI9t6hlKO9+mrl3RXo1QQo0N9CHpjFGJDjtqBbIoVDfPN42BypsZmeo/ZbrsWXCen1Kko0qq6IYAXqlhVYg+qR5HmgPRvayPWrstMJXxYl2hkxA4OzJKtk3sOhrBhPuUtz0CCNqmErK/+fpYACBuPrlmARqeMsbx9jz0QUnX6M5DZALUtHSLkTP94hMBeJHhqmXcbf0hZjr4GQwqDn3YUL2JKE0fAy8Cf1dvjT/AHmE4axo6R5vIo7wOUPhPCx5PXGgB+OQTs5Y1iF4AyEEbSV/IbVBogHvQah8YGzTAOQKNoNnPzJQ0gjUk2yTVAWyYqFJG+kL4rwmxLdBIGpyW084VE8cEit4kSG4mSqzxFkx04Lh3b5sTGdyBmggAAaFI0+JFQ+FL9gq4TvsfTPeE6raGI6YsHJ887lXQic5LYdkHkDYtbjykBJfHtI+rr28LPILn+AoVBKqjjXrSeOVAuztqgSA5ZxWVWk9EbHL+v91VvzGJq4SF0mcvEgHUsXwmRZ6LRjEnT9kWYOe0ZcDJF5M4d24kZ9JQmVFpFgvdUBRGmlMPJedEVHM4yxkWjTW0R8BYYWyx2mOPVneaYe54hQwAlRw68mL/9l+9DNavYgB/tkfHX0VtPWhsAqjLxUb8p6VzXNELdUcghunZD6CtXzTh5ZQ3d+V+/IQLsR9mJefxU0Hq7gSOCBb5LAsaHafTVuqRSOW3ELCs7Pny6It+i4VPpD/RmzPCDmeWqyHAQTGaYKl9id0AAAF8sKbpuvqkTXcvSf3I9FNe65F+dwV6bJZyX59K5CA4IKNzBzcfyMn+Gv2vJCeimtORWiijpvp26PTWG3J214+ahuTZVTy7iWzWOId52BhfCxcfWkYD6jBd6V+XTgJOhR13YZqb73hGYGZrsfBlxiKWfQd+fGKwKh3RaEUZHkR+V0oOPbUlFWpCkrxYhbd1PTKEkMceK/uwiHwGrmxwPTmfpdogih7CLvBiJdb9aubOAzQXMTSJHSzvstoRFJZFzItv0Sg0BZ9cAcQvd5DSyGu1p6eeVl6CeE6b7trDcX0ctFsBfYiuFTpDfze8+PmYP+NdPVYeAFdn38MsaqRtNHwZigSCB9IKJ8sdS9PQjXpq9SISUiHOdej80S32f36EEcfO2fZP4FkRZ4uZLhog+I4McQJJUplQZenRTRkkvK9s0VOe2gEXIvzx7BMytKd//dZ/UXX/0yx6Ojg17b8ranSlvymfY7uO5Cgn2hA6adJi1Kj3CcSoYcAVxB2/Fh5DHtO4btUiUyrN1rZOpMUp5Zfw3nF2Y9GohtiWTCA8Rc6uJG8UnFQJUeK07EzqN58kuHJIVh78hM844M6bUm3SAAP+daTCyaloM8JxZ6t9DmDMXoYtvspZiT3nDd7i1K0AWHPJIT8/LosVdusyqfpTErjuwlfpogep8M9If0LRCskl+A6vBxXeaPWQPRXjwA9bRS5E9ZlHkY5MK2lOLbIJGWuhdZpe0T8cjujBUiSuRIU2FC/1NIidi9Y/j3ALhLaposbpZPV1HHNe7NdyybEr4k4bwBVmlduqvOB9Rv3vYwHRVMyOmDZqbh8mvVj+XwWto5ySjSXVGOOC/UY+ECULnAk5a53jdiXTF0diJcUeTiXr3SfBnnE5fYAiZVhMeYlMgAVvTiGlwiXSxF/3B+rleoMnmSDrkKZYBgQeDbaI+dNb57jv7rCHC2LJbsLewKyJ/HA1zyNcoZpXHCQkTSBj/vx5kQ77fFsBYkTu6r9iX4wILPIqwMVK9kLeKyHsMty+a6lUbVMm7DIgz+c4oRsnI4k3XWWOnLbY65xkJT1n7CFlbtPTHCQ2heG7DEMHlg/IiZfru8zCapiQ0BPIjgMsfFmtsnD/PsHA46s34jS2CGs0ejFgj36K0ZgEIcwgj0OVMLt3OAwWv/wa6gP0BvQXFf560UgaIXaEgmehcyLu71KFXxpnnwClU0LSBx6Q71zZNAvfqnwWKZ7N+Zja5hnYC2BTEcb1gCCAadVeZ0G30LKmlIVcbuXQX4Fbu97sR4YuG2TS8cqDGMTUhxBbamNi+Mz5pPxR6+Vrr70ITwUMEYc/aBXAhpYfJsK6qHRipnhQF4ReuOYCNqpd8xWHnJP9Dv/R8F7vGiLe9729kz4VBdMM7cf6boDrc6wESnXNSQWasSvJ8RV0WOlxAToANNFdQ76BsncdhMd3b7rntDTCNkxahTuVrpwdMAst8uNYpyKqozXdorIsxRxPTaYCXImqpvYcnotSUWkhgjSQdgvX3h1E9pyh3ebjWT71ubB2vnlgF9ORQgAtirN88Dk3nQbnEAu4/5h0XhNtQ6Nr2g/+gkkftQrxEj9y2Iygsn0mbNXD1Xml7qCcNFa6w0SHXLE3rJSqDYEgqBy9GGRq3EMoufaOrug/jWaA/EN+zNkyvreC2TS4IgUkzCkW2mznzaR7PT4/v2+8L0l6NmyekJQqAi99MY7HcwyEmqvkfRyVuwX4dvR7ji8Yd9WaX8+EMYr53tHcVlFuGv0u+6ra9QZXtT7Og1qg06cWO1hgikQikJ+xPCSnJUDPiMAbKG49XAB3QbBOeGMOaayQYOj7mdytPT25T4QQrF5ENNCdmzt9oVHjffA/x7EXQ7Jq395SP6R9a4XyeEKInARyxGFdzUcjldZaLZWGIHsGxwGz9N3dAbDJUadOJmHfggrE5PkcVKMg+OYVxIRs6KUkybddK8mT+PDsm9h0q2+H79y4dc1cgfoHSAcZHPcpjjapoOJJlyOUR5n/UAh3weQfACW5mnlEsv4R8SMPfEwS2tD5eE5TbaLisdUG1fvpWzPuLtMZmzcXNAWJpmod0pxptgPPYAyYPyU1rJzF49k555LCtTpbmTt8QA/j32Noc5qwWJHnWxVxNj5mL+Lca5BLjG46POs9Z4nBmi4v8OwiCVDE3VtCqFIwzOeaTXkQ4+b+jtRo8dWZFDTKfwxAQzjkQqLDIcw7BjMsKUKn+DEu2vCAEi9mq3kXW1hgXD+sP8w7aOP6XiYEW2DxuGHr4jrrVQwxVjN0x8jmer+5mLxqQ6Roc+kPwWfS0ILTxA1aNVqkNbragh/dsdbq9GJaLCQ6VMsm+jXFzU0uNIcJUnTPx8FBAYeHwNJC/5hOfyT6+xIlxVpuLQeNWYDEVPFa4X9GRX5uX1MFYR/tPJnjWMTC2DEvdmiJ4Gah74WzhjeyEwX0uptpxflYTrTxEzg0w0FyIZSAe8wX04FeSl2Tv99AouJ0SaTdQlK5kqvoiFNKfNZ3MMRsjpCs8fHmRX0im9KOpTXFzy8WZnNdIi5mdOgxAgNng0Js8kK46OqLxJ9xCjjLNMskxo0eRCQ/fqttB4EsE1s8Nz5K63m175LRhbpRYCw4yNo9ZVjHPcV069CN6d3cRe+8j3vzUMFNKgPMBdqhPw/eiH25BqXkN0oduYJzx93cRtyMbfdEdILhLksRBVxR9MosRQGytz/3zsCmyHQf5E0L8pvwTCiRRqHRqgMDLYe2dfgYpRBDRMjrqsxQwchox6dLqZ422I4CgWgBhJkguMsOAdKSrZUscJH9nAFNTMnYdSItiTXHiELD8/LqF7jaoxVXACN9GjP1+C48ZOC7EANvj1+rvukV9nMi0YIiMSufWRr1KyJ7WuOGpzTdkbiW6f9PNuoiX6pY1HBlEu9+zSGfInUXqWYY1OQnUlj0AG6MbIwbPZejUV834WP52iW4V3pQ0awUppVxPGcJpxjlyPeNzFYGEP9//fDZr8xYaM4lYx22UWGzmWoSnQbdcLJm9mA8TXHqsukJkwHiuEgvDjJfXS5SamCfSNPhJ8l2vrvMYEcLLWEUzkFFiXPrLd2ekvncfOnM8j+NIsCEKZQfif/ZcHJ8+TAB1/eTQWFekD1g9gZ/oRfNB8Lk1PhgI42bg3Oi9NVUHnTYHs33uaH8vruPN6HEoz1/EehtAbIe1s9vwDS5AW7z5GgML0MdeNksi7nhJw2v9HiioOREAMFyh1iaoa+iNImpKa1abI2GTDvEVEXm+zGnxhTeOTK9T7QbbsJ40hSLT0YXOaD4ikfkdmPWde28WUs0EH3oVXjrgYe3q/FdFH0O7nFu9ix64YEg2FA/u2gagDuQRBYmWIxCTE6qmHTzCE0IR9V6r+IaiHe9ntIOW3VkGbDP0SV7V7J1F2Q0nZ85rC9PNRvSBgMgps0V2eMccS0dFfbLz/OyTA8HQqs7c5yAOXo0B5dcw/j4ommEZR8miImwYHjtQUP6KfrSHwAOjuZKOOJwEKZL/UHn4DJkeAAEmUBKbq8yy/Snayy/SGmjLeJIftnfEYLbI5iU1foA/dPdCAJK6kKsOYigksG3VCtfPxPMr5wNacRXnyjrKy4gYsiFfh5EYAgESQpoHAcMj+VVvIYaGPH6D3+ZLu2mm1rTZv5I9r12PseKEaFK2j6CMMl89Unm9YS3R0p6LwAEzgVjFU9P9X3X96ilQVWwLUMFeh6WhmSpYWXxpoR7WvWaJQbLuXH4xTfz5VJi1SieP4Cn6837D1wGj72U7caC3b/YEQZcB//McyNKGcjlpEQAfrcl6I4YQbR+6kShzjMPmwgNLXL7GoVwY9O9DkX4yBqz0L7tPR+uuddYQBKdA6cn/waC7g5vV0E2r0COvLjIne3rQJosAg1dAusVN5vPLVAwBWpZ1m3+D+ZlIhz6kfLLLAAuuqqLprzfhADD+8BiOnDQlOjslU9XtNGo1ZwzNxGGDOFdL1Bc8ploVWzzIAWN63TnjplHWfHAxc1qX7Ws4tbDdueT6ic9YQL358d4iPIPi9sC94WUkwYhWxApAAJXOihLbx/8B8yUWMjvs0yai7nmKYIlkKiPC3N2Mj6RUN8uI6ZOYRj5FuFdoR6vJvLr565F80PYcET6LrbIaoACyhJ2wtCNa9ULmSPSYecXU6AHS85NKWb6VLSs7H2vp13KcWhK0f3ML7KF3jGX+ex8rNMRQ2/BcntbhoX2l5oHFAovGNnR+MiuiN49VR6UM6TOgfe/dygrtXksq3MPfP/QBPvZLOLT2SMizfZoRn3aHGNxLTiw/X0q2UPU8g1AxUl6Dd62G6sXqCP5RdQFZ8Ua9a/O3uZzvbdFjtEt2xqmgrkmSbNxHZX3XDf1VwmPb8dnNnsk+rH3jyDPtpU16wqhvIGtebMinXYtLDihG3/I0UsApLCddi2TA38ChD0WJFqByT5zy4OkywnxfJyP6BHWSjRjXNa+bPIfXUfEfMDrPrUkagxrgO9oAtH5xr2AhfsUqyA7Si41yB4MT1Voq+yAMqR77Iu4RhheZLWOCJcsTZREeW5qZeffEZ3GEf8UpdcLKpJYeuD+CEbi/YNBKuL4JfLHd71rYJZTJRg3vCBa5Dgg4BKR6Bw8/zcHK23uiJpf2lT8UazxDMvnGu25hLfNJf5Nf/GkdpMBvS8yzOm7k/TIn/FO/Uw+tfHC8fm7VxAUrvm+0hIltuz4p2owKwigsqO6FPTI6snWsstGNgo0fwXQMNxvJ0VXTKQ+53QVUrosH98CXlG3NZntqrEESGdhkGg+LQapnWPhfWVzkx4ptE6QWbhq8TspydDEB7qABbArqHwKvkhK9lIU/vvQRHeEif4DRjfx+8AqU9Zan9mSPsOL6qDBQFgma+g3n4lC1ErmGWCympgxPCOXrvMU+LZMNuW++Y/2AhxYidrG5NALkuz1SA+PhjpWb2uwtbbUNQu17NZXYVDzDUx05AqQNctKLt+GT5c77BYpw6sKWp+QnmDDRj4k8lHFZImqIlD62n6oX3qymbMWat8JcVUKRpx1nhDGnq6TPlarbqeysMrRH2LHChyi4S3HoV1RIpxXOadaEBq20dY4r4O7u1Bk5NuwTnjN4GumSsQa3jF6dtmtmKUI1kqvOaUjcX26xIIEr9eAyLh7beD2wPmNlRRf2Ok2geNtHehaxyzYLE1frSOCFGP8wLa5arOHgieW96Ub7nFAR6IZY+SMjKqwo+xjFNK0dWitlHnrnieTtpYtwoz7l0qXCtlAUfj4fjz6IdnRx1AAbHhYeIyWpGNinBedd6lGu3CZGrTHy7gK61OteBBsOJy26cx/HAYQOASkwXoahBSZP2hHfTLoI4rN7KShgti9KTf8v/lnOPOMPyfyjt7+qbL0XFVskoC4rn9MFrHWLzzlSul7RdCdkm1NzzmDswJXqIYuz4xO8C6KWsHLAz0+isDGAy+DSTqfoXNIVKLefLAO9Wf14aA65PdRf9MZEGIhJWKp/i3woxcOKKVFOvRrYOFEoh68iwEVbky9sG2yKDPjIuqsWh3ZCxoABhJCBqJ0RrV+dFfme0R4NSoCpBbZ+tcRhSzUBDRJFth6wx/jNH/m4bonlqHV056aGYFWrPyKH3DFOWfGgWytXXrzb+BYVoKyzkCMoRbPBLQHRzfvh9zmKwoXjR01aXGPYzF+9+ilieYsB9UDAazORKYBCVC8lJmIWO4jxSgsbR69+DG82vdKecPS0VwJ0FqdGCN0vHTezqPiYVnF/XsVHRnI40DHynAZpcv4vF8lnfWMrEkSM96Zc8JrxK/I9Qr9jrdwhFR2lhBKv45jE0mW5LqM0AT9cUuBFL2OrF1tSvgQxssgojlkQujd5JFgmA4ltHH/4GQXQIit4JDyukmQ65qIvnP5zRBfEtRAdO2tzNrMCyPkx4Ev4nfbsW+/jT+C5qKjtRNmJuWJOqV+mXL0e5BubwlP0buBj9GdjUqkqhseWP1JNCeSBW8RY3xSY66d7tHm3RlGtfm4brIPMQbJTOM0WO97ChU4IF8aDFNRHEI3W5OXSY1OM9cnRnV7ZPCk0I2NrbNlu3vAMPY8g8REgJC0mAxAEt9MWtohFutEuU6F6SOENdy89DelgSejQvOrZWGWXtp9S7WOuBP4eV3i8t4TdVcNFTL+4/dyR3Evfe3UE7NF92gkUn17h19nxa7pR7MGOrqrArrlNJQGulU7Fj3mllkszyvOjGwQyCVTYgWOwEiZyc1WLl/uX5Boq3bPFDI9lIUoiWY36VAJ0lLfQcN657dKjn9YIJBifPSkfMiO65KMQ9jwRXIHmfv190/+7FCiOL+mSLFPqaQHXSQluwD3l3x4V7XHbvs9ZKhNrOEGO4XwUBXEGJ6Ap95kL38nZHWWNzoOTvl2SYCoull3ZIcJf7dMgvoL2r771qVUrrBwCC8MmJLT0ZhfhGaNhf/C+LoUnOo75WJ2HRS8Ez6XtizAmfWguka7TPrexfbClF258Arhiw1N2HyUoej06ELnt/AqojSfm3joo0gYFa+1cxoQq4sY3ptRuxWwTiq6vmuMu7PzPRuos30o0qx153kuqR8xKLn82y5+GmpsVJK2nBWVL15mllwTtrKzxq63vAA1/vXg7vsQpreLvwPyYFQm1eq3LrUsyep3W2VP0DJfI0cEw91KduLJA27zXQaroIgbGPxBIvmTKoaKUgXilV8c1mHv4wjE7K1zgY81o3fAA54RwNgn6Sg6gewesIN+Eor3sWjZinhndXnIeeII+CDTqy6VRa0KGvD43Hq4I1mxt0rXTtT2/locplfPOuShHM80YRlatvo9uwoId4O0Cw/07j9VMtDJvKMnujnrS724Cl5dfbPGapnw5XMrPtycz78jmfr70p5Moy7Ieh7LVEB5JlZ2rDssLL1hKRFSwn9cryb4BZgVY6EGcJQFSCMVXJsO8I3r5IHVbmQOeR5aHHi3Ao9/bKWDhUL74AuacEp3ud9kJVIYYSLETMdlLDcO8Fed8Dz1GTLYFu2GInIfMxqB5zRe/edg8cGA2l/6em2GystnXT1N1nLyrFnJbbKhTlBz6pK6K7aJr+jiMlXOINTv2sQa8MndJAY1mypZrxtCtTxbvPMCDYW+8cDcO8W2W0WofcQewJqHg3O53ABkNG1NR/UztlVXf7137L+7lMfwl2/8gCwn8hrj8fY9vB8RxA9/AqNO8RgAuto4sVqpbganbI8cmjgE4sxyzz5R4g/OpvPTAOYUCgbLaH/XywfIRK53J4mlOIcJpJ6+GQVUAuxCeifnDnEuyc1iqY2Poro0Gwe3YWNDbRPSZkDEkaZIUy+AuMQMg9+tQ7jAuwCjOKu/30XH4X2vYne0CCYwdV6B0crvP+TaKcdi0nUGbqTLbj2aC1/AxE3KoWPEt5bdT0QKYUcGtlZOKVmgrLfuX8iXfHVfQte/GqeIGX3xM9y4S8HRL2UCva8ob8fshGVaX7gsckAIS0N20Yy74uvaYPAM0xw1GvEn61OaDWeFf9hiygNCnTElJi12ztvs6lFAvCOr2kIfiCK2Bt6QlIZqHK7BtApHgJIZmcYVYYsgBa0DhX63fVyLd+S+MQzITSWEMQV/lrH7PnpCe+Mw1uQecjex8AChZPq8vhccGh67Cw986gs0IA3QoAWi0AeB3+fkSSBadlUql6F/nzvpDWEr3IqlN+0YN89/Ghmtz6kjUtcjW7T+GktYETKSmvDVRO/4d64nTGVo4kI1x0LoX4vteickTge7EjzchlXzkuwDNHFcpRx8CKArAumTcmbPNxYv3MF6iobflHivP42o5YX77t/yGuG4CQ/nJOc+2rMcn0JooXLgNQ5Cy+FnkSEYov8mPAxmK3lTwuqyCJ6UIwjNtvgQkVopPwOjO8/45qf1IqCeMknor1iZDukssQb9wwfjQqnQ85VM7lxz9YFeWryomLGwtL0jnqiHaTr7P9N124vKo21XihGL/CyW/ACLSKPetpv1TXOLS0LI8SyeFmv2zDLsWkq/PwcX8LKUaArfmet79wI4Fkgq5o8OzyMPkYi76ixAbnAqDDUTBYBvHKVjlc+hq29k4cGiM2MB07iG12aLf4j3QOpbWjdfaQxydDN6tHajQucOTNjJ+5cL7Ezpy+4yOkVVkuUBhPW+bW64baOcHuD+sOVvGRP0yNmNtCYkwvxZz23KA11tRMwFqHk6m401AAEgQ64fzRzeOtWPbkpptUyf/9AjBUzRZbP+y/E3PUQtOTkuD+EL/UUZkirr5D7Nnlu3lR/q29a9edPnvA/55ERWtyGn2b9d3BUqxpzCbn/a4EYYTJsYrcBMhcn5xxiuywc0sEsZUO5lFAXCBNBc2l9j9h65ta0AAxSLk/yt2AWgm48l2yA7i9BsKxgPDYzfmG0KdyXgsjChdD4yZo9AWntwRkm/k3bR8hQAvIUOJRU8O2gAQg5dBQwSgPDykDLMzE0IXDxvOC6eFyh45BEfVIGbAzG7pMSb+ZeowvMgfBtU64f8acMt7p/ME0LwU4nDhnR9oGbuj9N3UGCTMQStEbFxZrevYQS0GZrtAbtCNp5Sf27OQ/okz+Ma+AAFQFC19yQhR3fQYKQBKWxI0Ba7RdQZ6+B1ye6ypRa+6SNLGLJSmCowBWtm/Ee2VCLCaR5F2X3DeRNdTYF+o8ebDYjpx0/jmC2yAF0I9gMbWCKjWqbXDwjXHxsqXybuCTN0kBldGSrqeZThc2amVX8aNmpX6Rr8fD/8rdcFaljBd4jP253Qg3jqAsL+PQaqE1Kk130Nmya46FIGaAlF6rq7tKln0vhfHP6Qc4Y5OWWJ3kEtcusawDOGbQHkFhs1WrwVSSARLBQey4Disljfz9NG68OCrMEclqFYY71Ux56+wuCaDsW9m80oVQZ7InEY/Fw+iKt5pQWqBf2vTEXoNILd0Q/OfH0UTwBfmTddZTQaEUO4wNrNCU3j4PIF1QwuZ3ai1RhwG38Svb5Pg4S0QbUqSrmW9Tk5tvKkWNtf7ol25GU1o+RbSBFV0Hwqt9Z0BHXPvgo9l3IQNmj3Zz34sLdnfxSS//9C+L6MQVUMn3Oyi683z3CsfsEcw9yPnCcp/ZXyoBEHGVDRHZFTw9Utx3ZEMHqtIxX+UYmSivfrOFV8gkyIzHYfcAqx9aecsVslLl7bnetfhgePecdw6ox0BeSuUREh8bbJZgM84FJgGzNIfn0L9PgTJo+5eVdThscyJSdDGNk/b2aET0lRvMGl195wcPp69rRKQxljLDpUPv5fy4AlhV6or9+xD3wX/iLkAO4AQ/ClSrIf2fwg6cfxtfE1LPtVg2zNjSoWCSVdaApKgG44xVTkbaaeNawUOHO9hpsNfP89F84ga4rdF1zF9tQ29QaxdwwX61hnLuYW7z3Pa3eE+uYMV6lStiCv9tIwvfCY3cqUD+sZHCdI8G32Ag55AqUVQuQLHv+Xd17wDRLrOAp3YK4caoYoAABmtr+9u8k/Tsjmr9VujFpkH9f/1b67nDAcV1o8P44M8ZLbFtlpKNIRniZMxo2iulNmCw03d2WbhwMYP/O8anrTDMuE4kiKOfHE+SY/xFXFnSFmsZKU/+eWbiFKCclRpisnRFP1/2XfbCNmV0SvkE4BLNrllra7K3+cxCL9LsDjfyUGU31/wp+0wiqub0FDmKjJ55oIB2kR0FosLJa+F/O4H8/+FAlr7EG7bIHu8F3Er0BLs3031oS4VKkR4POeQmfn7+PTPYnidlolT/UjUqol/gAZC0Ea9UHD4dPxCk0I2wBEaU8bllACp/Cdhx8/7vHSvw8pdaXeifFlga75yvb46xDz7PPGa08aFWQK14UTSmJIj4viPHW1nsj9325likBm8PysXjL0nZWxlEmaOljoaniVVRcpzF3n+EdSOQEBqyuBe0CEDiqvcgeCC/Ns/ifDdITkMSt0ItqcXLo3GlDOKftsLVQnYw7PTTDt+Vvyrz19ztgn9iP0hpS3cFrz/21FXJcWd2Fpp9cUxTgEJMph1jlChNQ6jiZmiHlpKK2BeYqb88usP+cqhPK7voC2F5EAyv2zJgot5ifGKNZRH1+N6+CtTdofyBCF1h/Hjn8UGbuW2e/UH/7vE/gKAijsSp1pLXrJW/Pr2MpYF5DH8uDYYy/wGQUzmru2NkOilI2apA0jUyEAS85Wgw9Z5x8YZ2JPWFOHkLh1pG12V20REOrmba21XHV5w8He0AwGWTzA6kcx94kR8Vx63XeHDrrqYtpRGNng21qhiCazENiOn8E9+qkeshY7tjnQ1KU/cVB39+pFLwmilBROP7nvcA6XS/jqtZPBjRhN0uFC/RPvFeiDIINbYlzGqHqXTMxe+yus6jja9MPatp5Ha04gagSwmg/vRiE/CPovkJANJRKBkS94dMwTThBVV9tXWb5MutNaKQ5CHOuXPuh4KOu1RSUYIYiijP7CP+NcLfCLWl+8UIGKF3QmBTYr6OZO840QdRsbqS7lj+Hq2Jpr1LAqvkxZ5l1sDDqBBfcNzdq2wpasB46w1Hhu/D2Z48e7h4G0O3Nq7js1hDi/t/aOSl9GFJajX5ruzD8WqyaTwESuZ9qbhd7x3fJDLu/RPQIE2hrzkML9xLmRq4wUx4UjiQxWtcVKRlnqplI+29n85dlDfXrdFBEc8j5jIKwgusdorUAiGgMfgAN0jzWEiY6yUAOOXDEwQhOwcoYZ/ngcwiTQ0rw02nG4r4bJucxqOUPPVAK05Q97Xrygi6Wf/dp3RQyJ3PkNuU9L2+0Wcba8g8h90jdDCi4eiVixqd2x+9C8VDXTlq+lt4YGDvsT3bEtoXkAAIirkiJ309aWtcUxg81tnK+j0NMXE8NYef7zMvFsW+LxzvOoRrZVCux3yzgyUqobcGkXpJ8EEzkgOleA08W+K/CmZO5WAiOlWltl/D+JeIVqQqBncMtTPDGYklnHYayboOMENEQDdQ7tymIdE9TK441Qa3OqsHGn9cdTKGSjXG01eJDMMMWXq7wkTA9wFnYjH1HoKvzQoMxVD9PVE0cpE/MhpifYBpV17+0ZPrMmTqRksUcfyUgC744EGh+FgfHydxOHSWwEiGUA3dOnzEMM0KZK35kBkhJ6fjhg+09bNbZLcYFWqSdhCZtf+daPiCH2LLL8VvU6/aU22uilX0AAAIrknDHolxVhFhYdCTJNU2a7PYipdDaS9+1S00qxNi24OOgIEVxlfrQ/7Q8Pm/GUHGrCcnCH0KfAEDIUVCc/xJTeY3sAAJ/EGkt0weJGtrcWAeWtFbDjCycaKi1k6EcKx90i07xA1TUS6pthRWyIARxZXO+BFJw0QZob69n1SSAUMirzazwExmr8pIJtRM7WuVPSE3qQc9K35m4unGWfsWojtv0m8Ah29LW2oY1/mnq9yA6WExQuTUu7qzyVOQlt1ULZcwU5F1FhOuVEGuIG6HxuxwR8ROFsLuj97yOa4XZxNCYHUrdm2v2JmhAAJZ0DJ6pbgEXROblHaDX7z4yc6Av1L7inFaDOE/MVacZdMr5hLqSzEURifJhxqfyVBUIoxXDHIz2eSmMLed+/SrFOAch4Lz7FKWlxGA+mhmJolPFxAPjzdvW0bb8qq8n1Dn85ha4hFjI1DT4L/iniUju+kWygl59iTz4Bd86bTMfWQgNyUmd10/Ga1/V11uMt22SR7qFp+s1eB8ded1VYbq479j71LwWU4uiy71YEVjLnuMYMF7Z+iGxg0VbLIvkstrpcBsTnimzqATEXjtOvnh5ZeDcQj7h0IV7xzIXreM0gWqVp+kKP6vQDklRNeh78/nxhJi3j6YWyUIIWHhlpgpcwQWMvCu5Uq63nAz02RyXz1VNSJJoiidj7TNOdEPajEM1MRllkGV0S02fHIYnQw7X6xUeJvMnPbU5qVUpS6yIIDqmk7KW9zogoMB4Z3NMoImStU4/x10A7CxA0/NI0/AK77ar3nDvkoS4Jd+FAOC+vAqJddmsPATvilnfFwVQa9V0kPjxH7xAmZqaEE0rxPmW81B5jYk9InA1IIPCJLYAqMMHTdn67MsymoNOWk5fed6EwSz6+xHS948nM/mJ+Cze+vLzqFODaAxkKucsjj8S4nSiGFtTARM2i6LMoUkYSmNlHvhNpfilhSnuZeBAwd40WLO2dfQ6ANgBgcqDBEZGVEkD9kuYpxqrxH1JzTGS3iNPC8EXaBopAZ3SE7Dj2/yVmoQsw9r2rXI1YitU/4qyUY4DQiXO1kUaTkolIatM6zO4DIoQelRjQhf0OTBj878/CAAhDv27LhNld8KgpnYqXWDTbOkiHxsu6PK07IbjNhzF+IjysxUw1lgtUZk1CSf2t8t1xf50ylleFhDPntHH55FsCPIaJBhyyq6DFIknxiddc83G4VdNXnwwHjQOMsp4Or1wABsJKTvGLkHUAeyPJBGMHZ5CKMwCJD4+zRtxmv5f3lbu6ZyuXv2QNoIPuj63ARsGL/3G1BvQpELtBcJvqFRrcDDxZopyfeKCzugXt9SxWuUExf59Gb2a1v4lL1JMwkG07UnBk93g09MsnSbh07cfUhGuFJO0Po2q5158KyPC6tgJz7+ulZlrBgCzBgMgVnbx4tiRuMFOXuPrbb1thU5shx4NibJAbx83Qk4xJEp50DjNvEjPjpdiKXI9uh7/lkew+s6Y8akZD9gBb0h0T5O0e4Md43NpsFcu7NGCvkrcoXyiWNtU7uo25asLPMN3dLwSGLwSSOBu5d2Wb+lCJcaRnqDvnJvm5tBKKzoet3BnmsTlsrRD+YEZNUecOjyfbtNMRS+Tb1jOAGlRzOElWnya3KtMjXPNGFWEox5Zs9ntiqVTYNmTiK9CtOFBN4BASEi2he0zHI9HZhPHU3ojy83nNRYr8gLBw+dEtc7s/xKynbDW/lx25waLPqBAMHF/DoT/YzrcqborViYfw2uImv+24hgJDCRY/uqywvBSYsLxl3u//l1aBb3G2g7uVe4P0qpRSmXAe1zMilqQ62NDoNQO6lw8MzjcO1enwLqZcIP2LtG5+Z2drnKcvwFDuGQgqpCybuPe4C/lvq644KKYL4fqfIztyMy6UjknayfOyDXPxTlZ2bAHUBZiHUggP2BBZZo4qrgSbJMBEdHI1dUy09BCK+bt1doRnQsSE3LkBViurKZms7udtHc5J1XDX6SVYSXPaHQfaX32dUFuTyFmsEQZ0eHDZfWvc/AF6XhilLkn9xxU+wMB17f0y7S5XX1X4xtdaBx1WdzY0Uto/lgiEyDKU806j2t9mmgey5qzkEcl/8wJFTDcaMO4RPoB+IZeIeT2Mzop/ESDro8fu7jIYK86uMg64m71XwmAvAskgJi3iXAlLqJIfG7TYC59GDyBrX7M188oUYH9HQ1kEEoetpPsQXiZ2KW9eJXgNOizs8UpoVif/GRdrSzZniWG5zfHhqhD3W0aSMG6eciQ3L7GhTrzP6km3KJNmOASNmh64vF/CB8MKeD1EdfO43Dvc+iPa41iut0UklMPnVzyzu9y8Lga2dgRtva1/HvcekMBP6CkzaqWA/ksDSKqAE0+gtem0PXf3RwKuaALqtXIh+ErKgFxm8s9nJ3or2ky3UMRWHnkjoOR7L2Va4k98uMo5SiifVfWyjs2cSRCIC/AbfVNDQqEO96S1olbJ0rFYwx63ZvOTYyuWol9cPlpqm0xX5wV2SJiQWkYv3a0KMC9My8aq6bWsN1DWQbcE858IDzJDNawiMrXZpfBNSVL9PZ7ubVwN4JyOu5VvdpfCSrHPOKY3R0XTTipEgILfnNtBh117wBV4xE1tHALUmUVyMcPWumRC76VK+ssap6ZnS2EObdWYrUU9P1zljKk5LDpgOH3NXyIz6bvhjBml7PJnMSQtGOqVpX69nw82lwoi8UIJKqmrdtBBwuKI96EM6PoCoVEM/4ppwz6HySoZgnD+zR60MR1iOoq/rEUUjHtcXcjXeC65hOfC3mFbB4WXQorCmppcxal90ZJVYwqLef1HcXZVyejbFln3z5hl9HTd0H2AIv8/+QAEjxIkgOHnMBumkyOHNSifGYJSQY/a+hm01d9F79Q2FzD1YNREarRc/kVv1iOBAff5gZfpWW0foatQ0SB1uR07wlWOGemWQaG+cPlrThNxqNVNCdGewaZEm9YdzTDHX/AxDdsiA0WVkUyRl2qqZVklrBKk9beoOzOqDsZYeShEX3szq5YpqStzLXVOORdT4TidM1fQL/0y+KO1JwJhDYi8bZBdwMe5PRfUGALYtjJO22XbMNMNv5uqM7vBN5UhvOPwRd3GSzrxu9kd+CRsTd0DTz9PlO20oEFKNjUBLhLsYXvhgOoGHkCvRPmyHleknwYYpgq1lEmpmWqn1VbrNxSPMcYzSQoeaWUKdDDezRgR1CiiHZO0JMGjNni89Lvrhv4+SJWLZhmozwPRm+Nt9ZtXsPCkabbS5Y3iTjLTVjnVYLT2sadRCSKXcnKunXsiyog4x6bcR4QT36oKqcw1uD3z/3pDOzbi9HFJ8kCmDQw/xslURBA0nmCsuVs+xAzcAF8sQWfSnZZAo6VD+E5Bwus2PIkEdlEjTVFhEoGzBx36Qw2+bb2fJo6Ij+3GKM9B0718L+mBRV5jv7ZIB+LYmcWr6PoDCHB+QjKRbjxSViWwKp7UjViaAyjLKNjps4sOkAS0cVn1HjBcfAy8+rpW2sqrN5m0uhVNdkqqwygc27no8fMtrWj/WpR2DUaOLjI/KN7R0i+ylBqkQwsuGGl96egAY0cpOPfQus21pStYzIV6XvHYHR4H17ap9vQS438ZBSAGzSQkII2iXjbLdYud795tIXdVQBSD5vvr+ovhoZgcHey7BwP4lBM8CtQ+R7WTIX8Rd/O+KQ7irTThRroy3BqfYt/QBv3felcz6UbZJyBXqEcERUHovrI7yMFw9RBcNG9mCbB8EyP1dURdzfl9Z22nneSpwGaeXnxmFdEIxazQWEh2iVk7b3P3QKdqnOm0WHNNm1EvuT0v8hQ/0U65x9Mx0gtnkR6zzOL+V4LelKomz1PmsS4V65Wuv9XEer0KYGG6Kh5RL53moeH93O4YhKi2+88yEGgNENMF94YUU+NMtNNGSV8y/tvXsdByCNJbmQyOsvFFLR5ybS2DutSzJgumro3gtjvUhm52nSPdV4uIpw09QzYtu7kfw2iuvVrQFdyu2P/GKHcALi4UsoLja4vivMOzt7riXdaC3z9+PYLMN/CgAwaq28M1kmXk8ZgaVFgNDeQncGjh+KPaQPuAr2Rb5hnmWlhBiGcfYQud7v96NFzjc55zGUrkD9LK+/95ugZPZU0YvV0+/ltu2q688NiLoz6Kg9Pk0cfQaMY0fDCU5roS08yUVbV6zDs63kUC76USkI8kw3aOJ/QsL3AZ/KSs5wp9EO3BvwohoqFDLcSBbDsGxEMN4uZqhOZDzTRtbhSDDcLU6xgjROu4Mtnl0zNGHOnn2B9XFGG++dWlVzTr6fikzABDEwvv4C4BujDgX3rFtoZdbd+bzMtndlOdnVEXOdsk1qONKbeAtYp764xzg76cQIsV1kB1+YS/CRzaFR4ZZN0G+UTDcYKiD2mdIKNWgqCC8xFsdyYg4mklcWGBpVYa5t6YDLO/i59OiY4/CJuDqON36F3JDoweXr2szeEeJcAhvmcdRPe2pT92sr09qQXh5NTcQZDtzMZTt7E7IinwjL0u9OIlo36XnMWGntwchKOqb6FFcaiYxglSKzHdTqTMv+AM5P6uRffYgZWrYsYD3yJoS1/LBn2XngMUQmKuO7M+pHRHWe3U6Rlj0yUHiYkUNowRXGTrxDZC9gss/a5s2dKYEhL2spWpwxBXlNwSekv5YY/OSQwZpkqzGE5EJ5DpsSB0907h2T3fQCF2kg07ehe++xfzmzyvpaaT1Ez8zko9VRM0pTwX7fBTHKfOYQUUE74akIovRVXkQvlZ+ABP57z8EQa5Cka6/Bh2Ae3pveoXkSU68Qdr8GzMFuVxZcxsB6WP26E/QM9JNbiqTAhiTtS1H8b71FCezJ1xtMey913Ez1YtIAmaWZdTbf2SczRab+lDPJ+02MMHUgqAFmeopYU8K9DpIyACWin20rQdTg/Xf3q7QvMBy3rFflShyYugFjtRwMW6CtZEHzxUZeprFBqS0VaMBzJoy8iDQdzBSGP1hUGOihG5onmw0KCU6SVGSKC2jWEOVLT6DEwhyI1NEwGC0+vcrDmFtYaUH/bFAAGpflB425VwswxTV676eT3BdpKUp4JeYbWPv8iBuEfBGsl15CaVcsp8xrM6vnjTpkXJKEHEa/sflrtKGueAzK0EsPY/oW8PuN1otA+F31aFIsOy+wdQXg5mdIXukIn7CbtPPgQyExH80iqEp/XnK4yPSjt7KAfYqhrCqiAk5spXZtNendonmj4s5b1Giz1+eW566FIdfWQgYuW3DYcRJh/XS8JXB+/xZpe0k7JbwLZVjfPHmIXzSaSpmG/Ih6QxT3ubpQNpskhu7xVhqNU+7HvjWtVnq324cRNQd6tndVhJlI5DLXt6j4IU9Fd3Af3I4rSJ4qlPqutvy0QGUC+/v7Mbel1xcjysCdF5+ozwMRx1ci/aBwVYH/P1zY4LFP3A0Rf6s/2JTRnOacfDheHpOr3mAr4Px/4hndhxOz5U2aT7RjyS8KC95cbqlOW80ck38p38nkELRdVWI5VQSJEKVFQI2YzEkAyXf+OfbUbropdA7oq2mjhjZ5/+RnH9FPBPr1NcYcAP9eb8KaOTily5UzUbbxKIEihn+lXt4bPhsDpxtQqA0ssXfiKjxv+RkVHE+AAL/1C2bXzSMboE5vHXjqwJS+fbiNqMH9j13qUqaMD+G7ASsVJt9j7Dc1YiyHqWuuow2+IYQr9TC0OVKz5LzBuf31VmfXx+Miz5y+XQ6A/cm8+wEAOCf4aQCOP9FBrRGaD4kkNwvqiwNOz5yF487P5EoEjoungWWMSRemc7JCACSrvEP7YAMcJ+wo8BKskNU1udbkHvHuvsxXzlj5szYVHBOLR1XiCUjSiKcxwGClQZ1ZBtGtR12lN05JEl1NpRgXyh2jCPDQa3jpqOpT/YcMou/DbjYqX41idThshjT6CQDKnkG8lwzgMx/cAtfiLsDueeXPXfQm79hLnFLlxP+gzDixKaEyZ4/FW3jdDpsmCxRZQ4lGNXWdmC0Y1/bfeUx1QAZJtiyXnIslbjbki+YXimlzMyP4MWkgEkiUp/81Op/oEbVbhTw3SShVzEwp4BjjSAPWhcCN+GV7lCAsNvQB6IopYmg9dblio33xYBns0mAAFmIX0pueifS15ItgQXenx0T4zGiwIEjmhNdCaOMQpbsr0IUNv1Bh1RDI5syTVhRXpyXdwiEV5lakBedtnkiNY13U0YG4nP6Du2h4JvhquebRBdM9S9NjtvIHrASv7vqwC0XPhudXgCQsLJWzDwSz3IErSk9wCStuzlKtaPQ+THvRwsYo0FpUHX13rg8r+bXTI9fd1NhHc7meVr4yF3ltyZAgRTairJ9GCOV0u92zubmjfaVejcq6ACFuAHkcenvrmTl/Ic5zM8yd7Z06YbUMbSMk+CCwpWIfNk0XKQ+cSFOG/albWwrh2YIr93TyJ/z8h+D99AmOMZexSwyRLsuK2PYvkB1y0VdHgStklbYK3gwnpuF7ZOq8uWMSCC5c436zx239fKJTvGza6286cL5ItJ5OBxP8VSVC+JZDG8J74rT8AEpyKMwiqHewXPHFpAG5Hkxor8sIpNA2wGRiEtKPn6aFAJbSRgc1R7WRzkmf4YMftpGr1m1QUTLE845UvYJt+9/P9lsi6i7ufbnyt+HwfQGrTgXlDnb9382kJieV7AboB3rlaLvCxETPRfe/EQ9uPAm3a0060rpFZT+NoKU53kTn4x4K/JLli5JIq3DzfPbi8qp5N3W0qF2aUC6E9C2E5d/xOCfpcLuJCXt19Ej72j51ks38iWre2svFgiXQ1P5DkgqnFE8cp9B1L/bf9nkNOCCL3XKhI0ddkVErtgBRbtTGv/eCpxmdUZcqsqR5/cHOiDcEsl8owaIZn1Y6T0op8eQGpy75Pw1ZvfcGwbu3Dppm3j3w6p39LebKHbHTacV3Yr1zGQLUedj7oyY/IcAAJccAJud4qKPGtEvcQyio7oIz6Qte8kaA3GsPpjNtBAZL627Lax+4q03HD8Rj/mgiK3aQEYSByIZdOePOO8P+TYGoIgEHHUXcnqwwPWOAkiLBFKXl/99Oj1GVFwW4Mys68BwYPFxP13bVy7jT9tNKD39FyjkSfc+59jWyvAk3jhvhdkcUat5XItn091tut1JZkO/gR25IHUDp9AZMvVRBnWa9ZSnMSU0qvz0XfoiUn755jD6k0za1DM3LVSCC32PBryhORoj6WlRp+hxiKi5Rfik2mhpF7JHf2P7IZMqW82/jw1iR7cuDzqblr6Okk32+tkL0V2LhAftFpc3bk0b2NjxsyeZ5lSo+WW41+QWRR35l25wUq+Cs1zL3cVf9RWsik9dgxzBkP94AVlCm9jvxZWjJnhEu3KhNSw0G4OOcGJV0T+1MN4QJfiRYxVQArT1M5chTGZEEm8jRJIqkkBr7zpYfRnS7SEpvh5uI3tNDPdLdZMKuCk2lC7Zv27LawdiaO7T0yYhoQuGTZ6xoXQ+z9kKbhTLZT4+E1suEtJC8ITG66b6zjJvq5PqACHNfmHSBtJV3z3Tly6wFKiKWGCAXfnCwAEO52HlvdEwPCoA5EvVdCGWsf2Dox8qmxqOAR8F0C3plqJ93T5mQidJ34zaHmKIHFDcVNpqa+1FWRClZAPKR8v+L/hxaINan8hHf9By+pZlqo05f1OC/fAotIEPpM9npMgoju1MgPqkytpzRgKwJCAX2Nz2KfFviSfWRreJkqYr+V261zBv6SaM0OP98XkzwCKnPWzi4jKFeN48wNMBeqkeUdjhHLTAWjx5IJ9pTP5U5qy0lRx6hTwpox77il2NSSam6G6Uet5fapLxNAgLbYp+lKR+FHjBDX4KLUqLqUyLjjitEkc/z/IbwTE5PabK2/BV9UDoX8LRwe+3gFdJ0trX50l5kb0mWxCV4TISfzlMq95Nt7JHbbnbIzWfbovd4kHSC3tC63nwX0yER2/0FOlqR3gHdA0heAs9ki2/de5+qh9cFqm9FfWoXf5atSZEAMP/j83f+r5HV9WSnh1a4QZDf+eyaSnypAOXN6aNdAAGdp5vzS8jRPwB2z06GKUeB9PwY0GcdepJPr7PcA+5yLNimAVVhlg9qEqN/310kEFQVqnwy2u6u6TBigor2lG7aJTfpfzx1E1JoJhArnDGQnuK6IZexEMY46Cq6d/oArPKcexzAt7t0d1PziPBNmsau0frv0Y+7C+K5PQric4aN9vYn/Cni5oQiNpz9QWZYxz/EBUZbd4ft20VCdfadA0nk2BXQ1zorrutLfXRrfi3PPf/8SaqQ2hwXECgrzerFDLWVgADtrBuFZkH+21mBUnfuxxPwuT8xoS3asMOKCy+zIIX3FNQz+U+i8e7oZpfSPZGKnjjh3dPQE2AUTnTfQVIga/+5orw2i0NUXjYyjt9yzXld8X0kXq3U8ngHz5qlGRgftWfMTMXOCgNbsAtaBgM2mo85sxBsPIA1lDAq0TjKINUlZtNpTdE2/ce27au2o2Op7KIucwfDRxI317c+ZyfG/Ie0cZMp+4DkENjh9Y/e2thvkKgWk0Qt1N1QbfV7cB7InxoVp7VdYH29/V7BdqiG8Wud/fc90HePPpJqsq7gPu2MqOElYQhB0B4MelS4O08wjdORol+q7r7zbo5RC5DHjHa17feOzS9vCLklVaMxWrSO1GDUpeCNqfRlOOdYrLv6cojWNmtA5AVd5y3bGx2WLZnhwUvhXaqZ37hFZkuMI174XgGXuPZWdk6QJo89NOuluuRubLHADlyCyii+F7ZiSMY1Ak42zfzowtp68/leoFglj402pzRJ0p4+VZkrV1aQy9x9ikbp2TPSOGrCZQXy/rIUEN0S8CgJWgzKYZlB/dLY0ZcMtPa/7JCFt4QtaWtyimpsKhDnS52XJJDcNxg7OHvqlGvYEqb1DurqKwCzusWAMTE2T96K6Y7J6wdDddqH1q3SUPtgn5n+SuiAO1u4jIOp7OG56szs1OzjNJyczSor0g3vbgcO1all3Lnr9M6VBDxtSOJvXD1d7xG/0p1McjPmKR9bm8xKhwh85u2lyxo1fr17efCVZcesZ+nPpneqzmH0PjnEr1nlYHvsiPq/3OCsVc0IabFxSUT0OYjyqjQv+1wbMbKXQ83wvd2UnC/n3SrM7X0+Zku8qt1/Fj/5IVjD3AC9xX0Oe85JJ+GO3ul+en0wVMcOC0A/96rVhi+hrOFpyIFe+dkE0oB3MCNUBVyN2M3JF1ITjiHxmCk0QCtYDVBbgp3kEHv2EQTdvHZEAuBQ2jhMSDlRXdNVYYRyEDh2N3ikK2akT94e3E/ZBbsMkSoSgcQlAd6koO8nlstiyh3ml0rRCojud6l7ddh6OT2MeIO4sKH99RoBYu87I2Z7WXDk26TwLmSaShBkn7SMyYgVOkalOAvmZBOFpeuhnaHIUgD1DC9a3GIRXH/jKj/Xpqj1TgfLhzHisUhBHaYihzZO7vGqy3u9i2tGS2izxgxfaTGKPf9g+xeTgATMWe3/jjye0tk8JPuuY/oholhM3Lj1Athw2zyu75NH5gJP1EbcBULx4QPQfGqqR0z5M9VZXM1e/h6th/nVBTIE7pxA8wejhM6kCGbmR6ak0swQ5UVfPDoIJ9k/WYedOVltbHSM65NX7NmyQe+bz8p4e84A3gY5fr4XjCWsRtHl6DszOMudjSO8ulN4NOAm1oJfbFTFFlgqTGyniPqEZi+4qcvcc210EQkXfV9Jjctq+6mesGWyLeFsONRGpmmHfFHR/+isCNOeYXtYj9BJuHlXgMc0h1scIBWYDy5Z7lOg8nYaVLD9tQicyAT9hgdjxUmAsYSVqqW8CLhaJORuJOdbWptJzF00Pe7chVbNEFwWpo3bYh7nwsuqr+MbD66GtHgdf7AnNsjqVR80JCXQjMbDDxKaoEd3elh8q/6/Uka/90zxqMD6cuwYCxl+b80k/7IiHbhuiQQBIi+D7z0Ga3Z2xfphPNRqF+ORhSXVRN3OPSQxGD17cDEUy5YQskbDbsNl7cgNXXHVD9zIm3Fh3rHEjEBF9Ndg/AJGUmPWpAg0LxpneqU5KgeshUFX5EpsmPk9UI0dAS3vVUvZe73oalLtCmskREpGx+NHSMpFEkl5w1HvFWnXq/mIYDg74TdCfbubdSheJBP6uwedqkB10R6jvTWZu/BDKc13GfpxIoX/mRJ3dmrmpvf2tPyfqVHdtJuqCE29IVQEYVSmCmo3piqhY2XcVtkx+xfn+K2ovdD+aj55kmjoe/0FZBu1pq4Kn9DEIt71MWngGYy+Nt/GFwknZxnd1z6ew8NWrYrudMHiUE5s7t2oKRIYSLE63q+oZcHxUem9QFFX9uN43CUMFYxAd7s+YfWun55QYcGaskE1/j2n7QUh2udKOukgmXRiKzOc4NkAtWeg9BpINsjQRCyy4PaiWemxQMZyWw759mSM1LfQlZ8O73ochiTaBbtfmcIUTpdyw5kXvKY/cNW4ojSjtozqlUmn1Qf0VaS8I84EslppQExzLShtV9D26byTOqwSAojIHqujPl8txy2iY2YeCY8IlCZRTDinDjBUJl9/5p2sDs5ZzgpWYy/WLAY5coMGCBfbrDbqk50tgwqt8LFRtIcx1Cg9QwLcRKo3AYo7ytmW36yO6wf4VGGI9E704j4RAujVXPjoovdvVtjmgnMOdsTMXJ/lzIIsLCRKV9Dw5ak/hQtAj6571JsdReuj6qDeiqA1QkJnHwbcJ7tQnBLLVDf59JMy1nR1BYhahFnbNkd8xpBwqDtgYaanSpkmWvTir+R3n2mI9tWJDVVWEwwwrQ7NAmzztjZSx6ShLlkQdMYIT+utjBZEzQ2KlqszxfgN0eZiGYx5xV4S3vqolir3bQDla1qpfOhPIg1Omhxj+0/0eOpY5msXT+Dk3fVkq0dPM7bpaMZhTRMhod+pPr815PkN1z3JQ17+WqUyb7DgBWs94dnPcoZc284HwvWZAD2MuCc//8nNGABIjMnwJBaGnAOLN/UnMFaKOU+iac0a/sW3npSia/OfmKP2gwFu8dhSyaeuEXacCJczvlVzVWVA7aacjqmH3wqPPOhl0te/n+5EI9rtNG3xl4cI8JXp5KrpMdawmrcwXCkkorzPYh4wNm98FMLrW6Tb3wamlz1vuY2bJ2J5XxbcxFcWRxesWiXMcdhMkCjbQIBVyausqlfORRGI2H7kV4qG/swNeZ9qgkCTLDuSwWTJWrObVpq6ayP9d1Q3JTORKKWKhzlKqZm18Lj7QvFftok0AcZYkc2LM0IVwRISXtqK0niDs4GnRW6/EqDuezz9cEG9SP3JyUQzqhBxbj79H+pzL+vY3qVg9Ab4OGviURLqmX83qWC0veAQNtN4WYBoZUMG2FmAZTo6yZNzNbCVoCHf/JtR+3ip5HvPfNkwol4w5w+yQRkF0QeQU/T4mYOUb23b+hf1udLOKDoQMPSsxlLxvgzk1LwIjsHCgUyZ1tgTocNZkMNiDae5D13T/WpcP47ryc1qy5/BZx8hhyHJQUnV5+sQQPKMjyKuDAgS9J4VO1uHQmmjft8X7njlE/a9euw6eard3QLn+EBGggIYz/AhR7njU94E7G/6xbMPI3/ZcP4GMCn0LDPNkBkd7c2lCYcK/nYjhrLm6JswHONIOkxMimdrdimP8OdUIBJeHYrieSrIgePMg/F2KxY8FwLs/Cgn1LWvuW7UMKSnhZi28RCcCtMpzUxSyX5komYWfNfYJNno4aBwh1EChs+pJHPnJ5GVWIb7PYYosquSiBrWFDJo01RCwpjhW640rdo3YITdgSCtD5kp5hJSsfyuqE3Fj7rpqf0Enn8HMizdDs+pgm8mRzXlZSSJxpz0DTPcWrLqD5RcNSc/pU8CXrEu7Z0Qo5Tmr4mwYatDCRZOo3q6er5UVvR4hIx6FXChE2c76kwh91ljvK7L3DnAe+dr3CXvfFaUpoJYuVBSQ0ItYPHCK/dw7EE+DSqGS/1k5lEpUf+dzkG6vzZlvhiBXLgnnju4vwprcyI2j7FcQ8IDHT0whODmQj+kHHlqM/NsbnjkEGbdfZI4BMm3HYynHiFgipRvhNEki6IayKRHCwfXfbgojXCs6WxVLct7/9QoswPqUl5imIU81+sHr9uNxz0tiYEQA0AU61ByjHeIZzj2p3ukNIi+SnXYjwrUeeKocloQ2pyDvYS6p9RTp+eSuMcI7ibLYBNDC3HcBxCffA3h/4F0knyfzdiO1Cxr1AHtQPMPV1JQcjKtf+8YWoY0wVCQZ1/QIFykmMsfNTBr63uvbTU3jgC2Avg+YdHc4JskuZCEvGqhNuvJLfqgTyDbi7tuGvD7dWTlr7F72JzsP0ITEyDUWMt2800N4XhMi9MMzcQ48XRmk3ROMHWpJodoh4zLrKyd2x5KrM94CC1nE8E/kzfFCuZH3cKyKEvESooq6vFysHFT6db2UthmnCIrCu7wwdgqbEE6HJsqbphMKJrItEayJSBh1Ai6vTbkwBXec/3+jaizppJoNHRHXrMVFM1agvegYfkoE9VGAlZ04D4Ok3AxE/4qj1iu6zFRMXbq3RlGPq3JOFvtYfm6I190YZUlBe4SiXOjmMikjudKXfP9AEuOn/DzdVCtEuF47C5naqn6/I4Pt0oFLSPXmUu26IKmOhIHcAD8j/j4ZPusGjq6/a+ONHrU/Ax20Rt6eYzdTXKrwJ+zOMGIPXqZDQpFaDhiCcaNnzyQAU7vDUemHdFidov1bvYwQUjNtujvqwGaWpPrk2S+PJMURf4YxPUz0t9aomg1C11a5YFd3tqbZLWBWeHWiGbFb5Kg/bMNEjLCdyrIIl0gAKyV3A3dpDP6W2oDNYoJtk2bPQHtB2Ba2Opw7Ev6dLkB9F5C+3DjOGHtCItWknAVw0kfmU+xF78mVBZGIjbe8Ol8tw6fBrer94sNTmPxSJGuJEKXJfQrv6+3rjnB7fZLLbgTypDxe1AmnFS9rWNkFFK8l5g67coH7CuqCWiGwprqroxkpoW/dG4eJjgROyT8NCgykrpTbR6qyQ9/kP18Wrkf0eOjmV4KqFdmJc+InW+aer7jgx9FfZkLmcifIAAYJMzudSE8a9ulqN34owRbtNJhLxrjBmlvXeEQbe+2Uxf4JYhfvvBNP+g0GwJgcp2UURAzQ3tzOKs6FrCBWsF9KPuliFQJ/rqcF16nhQ+5hcvVzsgG2JE+SEfYvB4j1foPunIBMXB2FbGFqrjtRkjwZg0igzw4dibo9MlhFcnYu9yomRqRuJzR6GANdmv2bWDPY1Ym4j5B51y0pzwt9TP+xgU0HoMRF6BPHuX/I2iyp+ozJst0CbaQX7q6YdJLJxlJCQPmW/AX+2unpRgWS7jTdpuS3ZKVmMc/0JAI4ZTuq2WSVcS3LypgsFObpC1a1hxc2jGA1Yf+LLqy2DWaYgXrkFHQJQW6erg54/mFQqlqFyVxFNNgtG5RsyVMtKlimVSVeKeD3jB7cqTai3IiyRy2SwuHVpk15gPr+UNZfgj6423gLbROdIVVsBag+7UUBNg8dlOqB+EvVmD3lyuh7pMEykXK182oAEozK8S7DYgJpzXKH9owe12k1st71A8ktWaLMtLphPj+VnRdZJg2LLbNxh517kUH0xDF31aBJgnq3WvIDaL7UrzSPpL9Xzv6CCIV6McOypn096r+DuRfd21djeCsFTYx5jNbrpiGOp393fNz6uON/eNaRwJx3z9VtUFCEjXfPbAlWGjNog3XWTsCqTIH5yk6qWjSUAbVGhOvimsaRoAoHq1Eu6JxX+Czlp0H96L/o//9Izkpr255KUXLJRib8Wf7FXeSU+8JovMZ4kbKdJOlkJ1TWJv3eWEgsmNVgzTMgXGh00mx6fTfXTmUH0bQuQXWJzNJ7qWVzI1IvllbrmIvEGK0lSfxizW1njRMUQbIwIBnc1mM+rZO0tGIGdJeR6ew/jAJvV50Y6X97Em4j1fUP4dN+V48Ms2Ht4kIvZrcq8Ahi8mw/F9Bto2J6O2ulTRQs7FB9ViQkoTXjI9KvGMOV6xaeAztYNjQUYMKQ/AsXqqdN2RYd8TAOMdkM41yuvpQcsKLCN748fVci4c1nabA1Hi4OCjlQ4Jn3r1mR/XKzk9ahLpAxM0LIEWyzTyJRrbTDH7Yh49AtURk761Cf+2Ofsdkms/td4qHN24HIXGeLKyqrrYjbHaJpiaTUdyd/sIBtvof5iI0Nu6n1afjU3Udv/CgRUB3DnFTGNlwjFb05TUAEdM4ERQUbEPeL5REikH1VdeqyyGB5hMmBhOXh/N7DWcZt2Qgu7CT0vp5RTjRB9ncRcWTnvheMEuf5VnnJs15hztCZzmWh5xoAW7LtI81RDMvjr4oDKTExm0tLHqpHlmOeroIxUkTvGIL8rxBCD2pyn1ql7oEFUiTDOn6IQUkvOsJoqLcMQ1mpZ8fGIALVBCYQdr/J9vwZquvoEXXb1iGNYMNRh77QGyJLiboBXYA+5jRgCiYyv/F+gFYsWdnrGt/sGwvvKEJLN0FAYIRWlEEbUYbtf8WH29H+ATBDiioyGCe5P6W5PH89eJQ571/ixv7wxTH+7PemJ/s1P3urOuBxmcQFqkwrT1QDqU8hIxBUbrVisB/GoYlEHZz15iZYGImWgzTeBJjvhKaNiRBkUr9+bmyrvUiCPtBrtevGry4NO2jpylf5A3+dcI1IsxEEIIR5rxbjE6o+8ZYRNguVBStf1nJxWjVsGdhL9f29sAmvLy6u8f9k5itW14DgF16v+W2AhWcgjZOHBLQ0facpQa5Nz99XDNMuKkEudrpOqVSEvHXK8ogb2pgOsivdfNNyUB8u6CUl1Y927pZby/DkcL4OSaRxyO2sc2CyvBXTrqpGgFYfly6BPMEelhUpAVesmCXS0jN0QdinNOqgTNqZBVR+UuuO+r5/+y7W3i43aS9+J0rK9pA9V6gCfcIZUcDhKt+IBs23CRTl+rfSUG1sGOtg65wscpz6kE9V6G760U2pn+ZDZC1F23nITBImeWmS0bT3vuuAOVm4N7XNvna8Ii+RUZYrg4wkv9jBCVsP9XjIiB2t9rgDK0wtJWqJfBDESb90eF0gH4teV6LJaZj+JcpkIkj27qkCGlBrz2qYgW2uG+FCRMmFk3xfKx7Hprvm6VYx/t4PpKNfAJ28JsK71+4iiplXCId8w/GFesLZZNghtrRLz4BuhRod1gwC74ozpTy5eXS6KtF2+xjASrAuCUbTj11gW/v2rxQCoSv6b8czMV5vXgZlKUk9h+G5umr3ZdB0CXSWchvKU9nr2/oG8GeAhXOsbxCF9gbGqfv/g1RIerGoedmPOuDIgl0TvNvNlsOAWtM8znsSSsCdrhiJS9gITJPzKe7/KBK2xTlpI2TkRd7YW/aJGYbJVI3nYOP5tPnkgjkj8bOHsnq9ax5JdyfGnquKKXoVNiyUsnZ341RclNnzvqT2GyUKgmILpELRhMjWKI1cb72ZHrre6Kniq+8EiyH0W+gH8mkEJXwoDGYlhW2Zo170/9X9CZayl2mUY5X5zDfoknTgn4Dx8UhHBzE8EdN1XFLSesPf/7Kzy7UcHTtgdOPfvcj4O2re/VqbXf/sH1oPGXVLWF9j57o4yxUsXyfj1d5j5DyVe4SJMz9mPk4txvCFQQmG7hnuiUF3R5zCUrLUMJKoYrAmgKFu+DziGyqWtlmkUMVmbjSwYuopDeAacLgcF+7FwL/2nDdDhuHbtzFQ5BkieJbmtTRvXP2AO6BxCm6eyyqe4j9IoIwM6n1oKa2cVDnhMt4Fm14pFHFFtvyEdwnX7Vh4bD7KV9qfgJmMviZ17i+XFUGPoDz1JIBM2JfnQKyHYWq5q2EotUe0vlT+BZ9zDRITR32t9P6cXsrA4BlJPDNWiLokMt0shrYowQOXPDZXqYcX3jwZghrUC5JKZSxsE3z/VkJnjGVDAiY6jLGSmYT9FCOjj+VC103XXSSHDS2DGjZWKhrIO1a7dmxfjvd3KcnO8X2+FFNHqlAAAWkUFMYAACANhIhDVGA5sh2m1IVwT+00ZmVu823+hxf1daj5PmWm52h0EY0TgCQUULBrxDuApRqwkjSEjLTRHZNMikYAJQPwl4Nzbo9IKPjisDXkAErlq333fSJol+J+PFhso0d5WsRoLaWXQ44TpCHqChVmuV7Je/HFYREaO93CWkLU2W7FtwF6+oyf07kVBDouSf8HhN430rYRJogjXQCVITxvmbNqGZrmmLW5qypVIuKsFLg/8YjjmtvrVwnifBCnmpJH4D6Jm8SUGTWwRualxn0gtJi2IZY4VQ+eFwsX3qEGNOHkhu4azemwM2oBAvDg3FxtrCAWYrS/kZGnEqCbCrNlEC19mWrcAZ/9fJvDpvZLx7i9tIBkWMdJXsZP6vQ+Yl0StRyYVp3/A7STZh/bDc9nou7Njzkv5eAp0Wjgd8bRKNHK40F8UpwAz8fbjJ4Etlrd1YGFMKFVIPDs8ttq6nDBD3n1m13D2D7/pPxMeRoJkT8vyjGyHsJEZHUGaq0X13Tfei4yh7kimZx074DLJPPvRjfUl7Kz3CXz0ZxYPOlTVgp/fk7lhPnN5uNmfQDnHxl8rZGwRamNVhD5qmG/Q1Xi28MGS15t/B2trnnLjMmEH2mYPkj2fl5fEmtAoZFVQEsjno8lHl5CWYaFlylzwDMf4gRk3I5BPeusxJCKYS/0H9r7bZqblhEbtyBafKhefkSYdjJiA/HrI+xn3Ppz0Qyhztcm3CaXGlUDjMf9BQ86uxpE8oueilGVYRyLNea/pQVMla/ogMQhq+RlJ3FZPaQPg45OGIJupFnK2MXlpCFupYxnnfHw6/ZnlAjgQKOgvhEx4/ZeKmLAvnlW0BxVLmXnWJfrPh8DdH9WK8/EMn3cymG/HO27xQc00pCLwJNQBrAKEKIphf8VB96PxdND4M8nEXVJGdCscZ0z7Ey2uJWXOcKrZPUmzKn8el5oC03Gee3NgT3FfWSulYlJemkClBWebwVPPAOTsHbb0TAN44CWWElos4Qu6oHIK4rsWm81kJwUrTOcPPgSI76fWa70htkUrob5Mh1ymKjDuxPXHxPqu9ec9+agwD8UNQV36fRNq0hKbDepYHx1o1rDwfJzzeq8hsDseJflV7NW/OK0j60KkHHZimwHy2/nRQvZHVU81+0ZYj+BKgREA80KlNecNpQShYIiceX/XH1dMHDOCDEKhyMl2vH67Ew01lK41yztWOiheyTuTd6KQ5Fx1SUbfwaIxto4B0ngfUemGsMd//bxL1n0m/a1zNTiM7QbBiVKTHFBvEn2BqHDb4Imy7buF3kVfY0x/+/HUTuBqPwQJH59aBeBRYSYoEgChCVO5PvCayuR9iZhJVrV/XzsoYLPU6K9kQd5smz+YqubO2cPSZd4PrUZKy2ETgtBE9JSnaGVjv9o7SuN8wwEEbM3o6drXlySIXvuogBN6r3xCZSSLrpLgJ/YTdM72XKAG553n6ZioTIa3nB0wtsYhKjTGoaxUejhPVx40GE8RhNx/x2Rtd9OGo4HEbDhmnn/ZK1kD0dQC0RD7UZmy2VknDR8RDIqg7CewzUGFx0GP6zdhzYD4Z3Aq6gFFFBfEH5UdnvTMleinJiS15yhJ/mWx3+WOQUc6qtk7tcG99g8to5LjbPYhK0HmJbMAUj+yKuv6qntQ82nKwFNX8fTAfUsmpevz4J5xNv9uwk0OfH5NLKbiXXfej+M6UWyhCrLgbNfyERzE2wyftJCcUjYvy9BlmSaa7wBwvRCxePYGf2eAXDiAEHb0D9Z5xlKwMzIZSwrSw43U3vEWadYMLhsepCEXbJxlCMkfdeYRnm+nzAn7lEhDoAMjp1UR1JBX/hfrtuJ7b/yMJcSKsMlbbUkD0nrHeLZsvKyDO8HnPam8Y6Bbxwrf86P8FHr4W3IYU2/8eRjzDGnJg9+I8nORgTdKXUVYQW+duMmuRJCYFAtnKYe1a9MpVxFI7EjG2TCkkdhwhtmdFoPpYkS5lvpCKSCQbqZGLwrG79l1VFNye7/UDc97/zZkveceF+OOJ5ppDR8bV4Ga6iiHB7eCaaE19h4yi6eauCfPU4mqSCepSr/OjmLYqJ+WSolBdsv+M05mJRGs1k+AZXbn3KXsQTALc0cBkTXMhw1/8OzovO3D7LUfCFE6/XUw/GShW8QEYQXEP7Wv2TGyhgoUOpd3IxyUxtmurMLAAAABJKzFe/yirVP4DoE+gjoAAAAAABvQrweA/Oz5uqrJZLDQl1YZI/FrSiJRdAsC69If4GKXeICby0dPQRIj09b/ViTOjs9zXLN277tBuAeiSqP2mkruLP956jX+D5TvVcKyIsXz8WVZINHXk7rKtNHRFUgUGc1+F5FCtJb0LePnFiOHC0kjqSu/EC4U72VKPy+0wVPQKTyIUv0C9aG+pBrertKd0mn5MImENoUycYjc6FrsAR04Pc8t3wx4SxRyF+NGu3etoBEs74Z5dcGPQwnfYR7yNdqQLZtdwEROwjvm3Z/31IfSIgilGg6ViIrwgj00EitR5XsE0VMcbYKqBd6Lz7ORQjeMIlfPYzzYUrjvfMyqFRPzNLvOvgnz7bnNsZz8KEjFej0BvJFtBbvk4m9g7ENjVOF3raCPL5dxOpGqwUvw9Qwz93ZjmoZ/lOSYTQyHoJuoeEFwC0WXaBx1xx9ss0IF3YYO9+T3rC9EOHieDqEk/Mt3SNh2bTAnADqc8jAVqoD66fvYTc07lv6s3QK0MnppwVz2EW7XpK/hOibw7sLs3Y/Pj/5+9N2DlQ74JYA3ZZLeItcc60X4aa2UfO+ct8IP+PyKBIYyw3xcbt1wUylZoqKWPv7gLlbjFsm3cs0s3DRtEb6VBLDJOSMYs2/0uS2QtTIwLLTLZ0C8WYIdiWhYkBPkqgdl659ry9x/JuecKsePNdSzRIRhaqSjKAEYHx5rE7elhaRjIsa0wiK9CFLLG/ShvyaMZokCw066JsMN+C+kG3y9CRVtlKRpdY9r38OwEuZAsnsTbhfujvSs92SOwG3Ohcpe6cCNoSWzWnJcX9v1+KCaXssOF+S2aAuKweGsKe7Ms9JdVsoNiuBSSOPPy/kj2xgpj+z12bDF4nXnalUr3Tn7dgFHQvgjdh8UAQKFNd0naKwE6fStjjQk/oC/v4vjxJAuEMt1Jcp2lz6iTzv4MfwIYdFc1nCxuYW0pXuZz2o68gMH0GY7ZHXJ78TgXRAR9rYsmah5RDPaoK1b0qJ+TGbNAb7SPgcz325RxFYuIl2gWI3gYZaxiW4HGqLxVeF5jirsGv8Y1YBuP9rYiZTyZjTAEEd2Wm5Xc5HHrXZJwK7Tsni8/P8yB9xQsZwYJ1btdrUWn0cr+kPCxWyRd170ukCJ/8Tar9MyccNMe1VkwxuJL8eLJm+iiMQ3Xuq9U4J1O61Jcyjzht0By8hFp8tEUYVllUVeFgCE677zljedJCIstxVMfh0ya6WVT9S0GCSPhXOatxLvC1ENcJHOBjlxCO/bqDrpLWOVjfuZorAlCBD++MjCMm5/7OKp71RwHB2bS4jrq/9acYB0WNa6Gu9dgsH30uZSXdZbFGp4rY4cjRud6H98vUJLjQqhfz7vtFfHjwctJbs5E0GBgiUPrh4rzoul+LWFfjGIVlC0rr15mrnTsuPz/eyDs4hS9Hr7QhMci+tOqufZiAsPSi/abAgrFP9ARsTl24/e6LQrpgV6+OzkEH8mY6/fn++JfUCyLrAnf2cC8tp7TBNZlHbh6WDrP4mzsLDhKCBlhdFhKcXyMg9wwiMSSVwfpFbKRf/upKWKXS0Fx01cLqD/EcedS9VyL+/Hc/vsPlgxM65SNFTbAUQd0Bd4BBGxMEDOLOYKEdaqnfYrqMzFz+oy3s1T9Ku+/Mv/cTHsJx2PfXZr73zC1pKGWd5rV68P5JvXJiq8q3PKuvjNLy+58fn1VuIR5XAkA6OHs+sRv3aSOUgX2/2R9+377jGv5BP3LE6qM+OJ/VFgTgowM3dRGKtlymE0ERno5fp0BsedN0MDBhhGxc980nvCHJzkdJ36xOy00Bb3C6+z1pPO5BY1FcuWCUECuuG2cid9kAA') center center/cover no-repeat;
        filter:brightness(.75) saturate(1.1);
      }
      .lp-hero-bg::before{
        content:'';position:absolute;inset:0;z-index:1;
        background:
          linear-gradient(to right,
            rgba(8,6,4,.97)  0%,
            rgba(8,6,4,.92)  25%,
            rgba(8,6,4,.65)  45%,
            rgba(8,6,4,.15)  68%,
            rgba(8,6,4,.0)   85%
          ),
          linear-gradient(to bottom,
            rgba(8,6,4,.55) 0%,
            transparent 18%,
            transparent 72%,
            rgba(8,6,4,.8)  100%
          );
      }
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
      .lp-ht{font-family:Barlow Condensed,sans-serif;font-size:22px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
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
      .lname{font-family:Barlow Condensed,sans-serif;font-size:18px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#fff;margin-bottom:7px}
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
      .lp-fbname{font-family:Barlow Condensed,sans-serif;font-size:22px;font-weight:900;letter-spacing:1px;background:linear-gradient(135deg,#f97316,#fb923c);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:10px}
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
      /* Hamburger button */
      .lp-hamburger{display:none;flex-direction:column;justify-content:center;gap:5px;width:40px;height:40px;padding:8px;cursor:pointer;background:transparent;border:none;margin-left:12px;flex-shrink:0}
      .lp-hamburger span{display:block;height:2px;background:#fff;border-radius:2px;transition:all .25s}
      .lp-hamburger.open span:nth-child(1){transform:translateY(7px) rotate(45deg)}
      .lp-hamburger.open span:nth-child(2){opacity:0;transform:scaleX(0)}
      .lp-hamburger.open span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}
      /* Mobile dropdown */
      .lp-mobile-menu{display:none;position:fixed;top:62px;left:0;right:0;z-index:199;background:rgba(10,10,10,.98);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,.1);padding:16px 0;box-shadow:0 8px 32px rgba(0,0,0,.6)}
      .lp-mobile-menu.open{display:block}
      .lp-mobile-menu a{display:block;padding:14px 24px;font-size:13px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.55);text-decoration:none;transition:all .15s;border-left:3px solid transparent}
      .lp-mobile-menu a:hover,.lp-mobile-menu a:active{color:#fff;background:rgba(255,255,255,.05);border-left-color:#f97316}
      .lp-mobile-menu .lp-mobile-divider{height:1px;background:rgba(255,255,255,.08);margin:8px 24px}
      .lp-mobile-menu .lp-mobile-signin{color:#f97316!important;font-weight:900!important}
      @media(max-width:960px){
        .lp-nav-inner{padding:0 28px}
        .lp-nav-links{display:none}
        .lp-hamburger{display:flex}
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
            ? `<a href="/admin" class="lp-btn-signin">My Dashboard</a>`
            : `<a href="/login" class="lp-btn-signin">Sign In</a>`}
          <button class="lp-hamburger" id="lpHamburger" aria-label="Menu" onclick="toggleMobileMenu()">
            <span></span><span></span><span></span>
          </button>
        </div>
      </div>
    </nav>
    <!-- MOBILE DROPDOWN MENU -->
    <div class="lp-mobile-menu" id="lpMobileMenu">
      <a href="#features" onclick="closeMobileMenu()">Features</a>
      <a href="#how" onclick="closeMobileMenu()">How It Works</a>
      <a href="#leagues" onclick="closeMobileMenu()">Leagues</a>
      <a href="/install" onclick="closeMobileMenu()">Install App</a>
      <div class="lp-mobile-divider"></div>
      ${user
        ? `<a href="/admin" class="lp-mobile-signin">My Dashboard →</a>`
        : `<a href="/login" class="lp-mobile-signin">Sign In →</a><a href="/register" style="color:rgba(255,255,255,.55);padding:14px 24px;display:block;font-size:13px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;text-decoration:none">Create Account</a>`}
    </div>

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
          <div class="lp-fcol"><div class="lp-fcolt">Legal</div><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Use</a><a href="mailto:hoopstatspilipinas@gmail.com">Contact</a></div>
        </div>
        <div class="lp-fbot">
          <div class="lp-fcopy">&copy; ${new Date().getFullYear()} HoopStats Pilipinas. All rights reserved.</div>
          <div class="lp-fbadge">&#x1F3C0; FIBA 2024 STATS ENGINE</div>
          <div class="lp-fcopy">Built with &#x2764;&#xFE0F; for Philippine Basketball</div>
        </div>
      </div>
    </footer>

    <script src="/js/public.js?v33"></script>
    <script>
      // Mobile hamburger
      function toggleMobileMenu(){var m=document.getElementById('lpMobileMenu'),b=document.getElementById('lpHamburger');if(!m||!b)return;var o=m.classList.toggle('open');b.classList.toggle('open',o);document.body.style.overflow=o?'hidden':'';}
      function closeMobileMenu(){var m=document.getElementById('lpMobileMenu'),b=document.getElementById('lpHamburger');if(m)m.classList.remove('open');if(b)b.classList.remove('open');document.body.style.overflow='';}
      document.addEventListener('click',function(e){var m=document.getElementById('lpMobileMenu'),b=document.getElementById('lpHamburger');if(m&&m.classList.contains('open')&&!m.contains(e.target)&&b&&!b.contains(e.target)){closeMobileMenu();}});
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

    <div class="pub-leaders">
      ${[
        {label:'PTS', key:'pts', val:ptsLeader?.pts, name:ptsLeader?.name, id:ptsLeader?.id, c:'var(--orange)'},
        {label:'REB', key:'reb', val:rebLeader?.reb, name:rebLeader?.name, id:rebLeader?.id, c:'#00d4aa'},
        {label:'AST', key:'ast', val:astLeader?.ast, name:astLeader?.name, id:astLeader?.id, c:'#a78bfa'},
        {label:'STL', key:'stl', val:stlLeader?.stl, name:stlLeader?.name, id:stlLeader?.id, c:'#f7c948'},
        {label:'BLK', key:'blk', val:blkLeader?.blk, name:blkLeader?.name, id:blkLeader?.id, c:'#60a5fa'},
        {label:'FG%', key:'fg',  val:fgLeader?.fg != null ? fgLeader.fg+'%' : null, name:fgLeader?.name, id:fgLeader?.id, c:'#34d399'},
      ].map(s=>`
        ${s.id
          ? `<a href="/league/${league.id}/player/${s.id}" class="leader-card leader-card-link">`
          : `<div class="leader-card">`}
          <div class="leader-label">${s.label} LEADER</div>
          <div class="leader-val" style="color:${s.c}">${s.val ?? '—'}</div>
          <div class="leader-name">${esc(s.name ?? 'N/A')}</div>
        ${s.id ? `</a>` : `</div>`}`).join('')}
    </div>

    <div class="pub-tabs"><div class="tabs-inner">
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
            var hasData = cat.rows.some(function(p){return (p[Object.keys(p).find(function(k){return cat.fn({[k]:1})==='1.0';})]);});
            var rows = cat.rows.length
              ? cat.rows.map(function(p,i){
                  var val; try{val=cat.fn(p);}catch(e){val='0.0';}
                  return '<tr class="lb-row'+(i===0?' lb-first':'')+'">'+
                    '<td class="lb-rank">'+(i+1)+'.</td>'+
                    '<td class="lb-name">'+esc(p.name)+'</td>'+
                    '<td class="lb-team">'+esc(abbr(p.team_name))+'</td>'+
                    '<td class="lb-val">'+val+'</td>'+
                  '</tr>';
                }).join('')
              : '<tr><td colspan="4" class="lb-empty">No stats yet</td></tr>';
            return '<div class="lb-cat">'+
              '<div class="lb-cat-title">'+cat.title+'</div>'+
              '<table class="lb-table">'+rows+'</table>'+
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

          return mvpSection + '<div class="lb-wrap"><div class="lb-grid">'+cats.map(renderCat).join('')+'</div></div>';
        })()}
      </div>
      <div id="tab-standings" class="tab-pane">
        ${(()=>{
          // Detect if any teams are tied on WIN% — show tiebreaker columns
          const hasTies = teams.some((t,i,arr) => i > 0 && arr[i-1].wins === t.wins && arr[i-1].losses === t.losses);
          const showTb  = hasTies && teams.some(t => (t.pts_for||0) > 0);
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
                  + (showTb ? '<td style="color:rgba(255,255,255,.5)">'+  (t.pts_for||0)     +'</td>'
                            + '<td style="color:rgba(255,255,255,.5)">'+  (t.pts_against||0) +'</td>'
                            + '<td style="color:'+(diff>=0?'#00d4aa':'#f87171')+';font-weight:700">'+(diff>0?'+':'')+diff+'</td>' : '')
                  + '</tr>';
              }).join('') || '<tr><td colspan="8" class="empty">No teams yet.</td></tr>')
            + '</tbody></table>'
            + (showTb ? '<div style="font-size:11px;color:rgba(255,255,255,.3);padding:8px 4px;display:flex;align-items:center;gap:6px"><span style="color:#f7c948;font-weight:800">T</span> = Tied on WIN% — ranked by Head-to-Head → Point Differential → Points Scored</div>' : '')
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
      // Shrink font for long values like "100.0%"
      const valStr = String(value);
      const fontSize = valStr.length >= 6 ? '20px' : valStr.length >= 5 ? '22px' : '28px';
      return `<div class="ps-stat-box">
        <div class="ps-stat-lbl">${label}</div>
        <div class="ps-stat-val" style="color:${color};font-size:${fontSize}">${value}</div>
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
        <div class="ps-stats-grid">
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
