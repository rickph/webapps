/**
 * PH HOOPS — FIBA Statistics Engine (2024)
 * Based on FIBA Statisticians' Manual 2024 v1.0
 * Reference: assets.fiba.basketball/documents-corporate-fiba-statisticians-manual-2024.pdf
 */

// ─── FIBA STAT DEFINITIONS ────────────────────────────────────────────────────

const FIBA_STATS = {
  // Scoring
  PTS:  { label: 'Points',             desc: 'Total points scored (2PT×2 + 3PT×3 + FTM×1)' },
  FGM:  { label: 'Field Goals Made',   desc: '2PT and 3PT field goals made' },
  FGA:  { label: 'Field Goals Att.',   desc: '2PT and 3PT field goal attempts' },
  FG2M: { label: '2PT Made',           desc: '2-point field goals made' },
  FG2A: { label: '2PT Attempted',      desc: '2-point field goal attempts' },
  FG3M: { label: '3PT Made',           desc: '3-point field goals made' },
  FG3A: { label: '3PT Attempted',      desc: '3-point field goal attempts' },
  FTM:  { label: 'Free Throws Made',   desc: 'Free throws made' },
  FTA:  { label: 'Free Throws Att.',   desc: 'Free throw attempts' },

  // Rebounding (FIBA separates offensive and defensive)
  OREB: { label: 'Off. Rebounds',      desc: 'Offensive rebounds — ball recovered after own missed shot' },
  DREB: { label: 'Def. Rebounds',      desc: 'Defensive rebounds — ball recovered after opponent missed shot' },
  REB:  { label: 'Total Rebounds',     desc: 'OREB + DREB' },

  // Other
  AST:  { label: 'Assists',            desc: 'Pass that directly leads to a field goal by teammate' },
  STL:  { label: 'Steals',             desc: 'Player gains possession via interception or stolen dribble' },
  BLK:  { label: 'Blocks',             desc: 'Player deflects/blocks an opponent FGA' },
  TO:   { label: 'Turnovers',          desc: 'Player loses possession without a shot attempt' },
  FOUL: { label: 'Fouls',              desc: 'Personal fouls committed' },

  // Computed per FIBA
  FGP:  { label: 'FG%',               desc: 'FGM / FGA × 100 (only if FGA > 0)' },
  FG2P: { label: '2PT%',              desc: 'FG2M / FG2A × 100' },
  FG3P: { label: '3PT%',              desc: 'FG3M / FG3A × 100' },
  FTP:  { label: 'FT%',               desc: 'FTM / FTA × 100 (only if FTA > 0)' },
  EFF:  { label: 'Efficiency (EFF)',   desc: 'FIBA: PTS + REB + AST + STL + BLK – (FGA-FGM) – (FTA-FTM) – TO' },
};

// ─── FIBA CALCULATION FUNCTIONS ───────────────────────────────────────────────

/**
 * Calculate all FIBA derived stats from raw game stats
 * @param {Object} s - raw stats object
 * @returns {Object} - computed stats
 */
function computeGameStats(s) {
  const fg2m = s.fg2m || 0;
  const fg2a = s.fg2a || 0;
  const fg3m = s.fg3m || 0;
  const fg3a = s.fg3a || 0;
  const ftm  = s.ftm  || 0;
  const fta  = s.fta  || 0;
  const oreb = s.oreb || 0;
  const dreb = s.dreb || 0;
  const ast  = s.ast  || 0;
  const stl  = s.stl  || 0;
  const blk  = s.blk  || 0;
  const to   = s.to_val || s.to || 0;

  // FIBA: FGM = 2PT made + 3PT made
  const fgm = fg2m + fg3m;
  const fga = fg2a + fg3a;

  // FIBA: PTS = (2PT made × 2) + (3PT made × 3) + FTM
  const pts = (fg2m * 2) + (fg3m * 3) + ftm;

  // FIBA: Total rebounds
  const reb = oreb + dreb;

  // FIBA percentages — undefined if no attempts
  const fgp  = fga  > 0 ? +((fgm  / fga)  * 100).toFixed(1) : 0;
  const fg2p = fg2a > 0 ? +((fg2m / fg2a) * 100).toFixed(1) : 0;
  const fg3p = fg3a > 0 ? +((fg3m / fg3a) * 100).toFixed(1) : 0;
  const ftp  = fta  > 0 ? +((ftm  / fta)  * 100).toFixed(1) : 0;

  // FIBA Efficiency Rating:
  // EFF = PTS + REB + AST + STL + BLK – (FGA–FGM) – (FTA–FTM) – TO
  const missedFG = fga - fgm;
  const missedFT = fta - ftm;
  const eff = pts + reb + ast + stl + blk - missedFG - missedFT - to;

  return {
    fg2m, fg2a, fg3m, fg3a, ftm, fta, oreb, dreb,
    fgm, fga, pts, reb,
    fgp, fg2p, fg3p, ftp,
    ast, stl, blk, to,
    foul: s.foul || 0,
    eff,
  };
}

/**
 * Compute season averages from array of game stat objects (FIBA)
 * @param {Array} games - array of game_stats rows
 * @returns {Object} - season averages and totals
 */
function computeSeasonAverages(games) {
  if (!games || games.length === 0) return null;

  const gp = games.length;
  const totals = games.reduce((acc, g) => {
    const c = computeGameStats(g);
    Object.keys(c).forEach(k => {
      acc[k] = (acc[k] || 0) + c[k];
    });
    return acc;
  }, {});

  // FIBA: Percentages use TOTALS not averages of percentages
  const fgp  = totals.fga  > 0 ? +((totals.fgm  / totals.fga)  * 100).toFixed(1) : 0;
  const fg2p = totals.fg2a > 0 ? +((totals.fg2m / totals.fg2a) * 100).toFixed(1) : 0;
  const fg3p = totals.fg3a > 0 ? +((totals.fg3m / totals.fg3a) * 100).toFixed(1) : 0;
  const ftp  = totals.fta  > 0 ? +((totals.ftm  / totals.fta)  * 100).toFixed(1) : 0;

  // Per-game averages (rounded to 1 decimal per FIBA box score standard)
  const avg = (key) => +(totals[key] / gp).toFixed(1);

  return {
    gp,
    // Totals
    totals: { ...totals, fgp, fg2p, fg3p, ftp },
    // Per-game averages
    averages: {
      pts:  avg('pts'),
      reb:  avg('reb'),
      oreb: avg('oreb'),
      dreb: avg('dreb'),
      ast:  avg('ast'),
      stl:  avg('stl'),
      blk:  avg('blk'),
      to:   avg('to'),
      foul: avg('foul'),
      fgm:  avg('fgm'),
      fga:  avg('fga'),
      fg2m: avg('fg2m'),
      fg2a: avg('fg2a'),
      fg3m: avg('fg3m'),
      fg3a: avg('fg3a'),
      ftm:  avg('ftm'),
      fta:  avg('fta'),
      eff:  avg('eff'),
      // Percentages from totals (FIBA standard)
      fgp, fg2p, fg3p, ftp,
    }
  };
}

module.exports = { FIBA_STATS, computeGameStats, computeSeasonAverages };
