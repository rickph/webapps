/**
 * HoopStats Pilipinas — Spreadsheet Stats Importer
 * Supports: .xlsx, .xls, .csv
 *
 * EXPECTED COLUMNS (case-insensitive, flexible naming):
 *   name / player / player_name
 *   game / game_id / game_date / game_no      (optional - for per-game import)
 *   fg2m / 2pm / two_pm
 *   fg2a / 2pa / two_pa
 *   fg3m / 3pm / three_pm
 *   fg3a / 3pa / three_pa
 *   ftm  / ft_made / free_throw_made
 *   fta  / ft_att  / free_throw_att
 *   oreb / off_reb / offensive_reb
 *   dreb / def_reb / defensive_reb
 *   ast  / assists
 *   stl  / steals
 *   blk  / blocks
 *   to   / to_val / turnovers
 *   foul / fouls / pf
 */

const XLSX = require('xlsx');

// ── COLUMN ALIASES ────────────────────────────────────────────────────────────
const ALIASES = {
  name:  ['name','player','player_name','playername','full_name'],
  game:  ['game','game_id','game_no','gameno','game_number','date','game_date'],
  fg2m:  ['fg2m','2pm','two_pm','2pt_made','fgm2','made2'],
  fg2a:  ['fg2a','2pa','two_pa','2pt_att','fga2','att2'],
  fg3m:  ['fg3m','3pm','three_pm','3pt_made','fgm3','made3'],
  fg3a:  ['fg3a','3pa','three_pa','3pt_att','fga3','att3'],
  ftm:   ['ftm','ft_made','ftmade','free_throw_made','ft'],
  fta:   ['fta','ft_att','ftatt','free_throw_att'],
  oreb:  ['oreb','off_reb','offensive_reb','o_reb','orb'],
  dreb:  ['dreb','def_reb','defensive_reb','d_reb','drb'],
  ast:   ['ast','assists','assist'],
  stl:   ['stl','steals','steal'],
  blk:   ['blk','blocks','block'],
  to:    ['to','to_val','turnovers','turnover','tov'],
  foul:  ['foul','fouls','pf','personal_foul'],
};

// ── PARSE SPREADSHEET BUFFER ──────────────────────────────────────────────────
function parseSpreadsheet(buffer, mimeType) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet    = workbook.Sheets[workbook.SheetNames[0]];
  const rows     = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  return rows;
}

// ── NORMALIZE COLUMN HEADERS ──────────────────────────────────────────────────
function normalizeHeaders(rows) {
  if (!rows.length) return [];
  return rows.map(row => {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
      const k = key.toLowerCase().trim().replace(/\s+/g, '_');
      for (const [field, aliases] of Object.entries(ALIASES)) {
        if (aliases.includes(k)) { normalized[field] = value; break; }
      }
      // Keep original key too
      normalized[k] = value;
    }
    return normalized;
  });
}

// ── IMPORT STATS FOR A GAME ───────────────────────────────────────────────────
async function importStats(buffer, mimeType, { leagueId, gameId, db }) {
  const rawRows  = parseSpreadsheet(buffer, mimeType);
  const rows     = normalizeHeaders(rawRows);

  if (!rows.length) return { success: false, error: 'Spreadsheet is empty.' };

  // Check required column
  const hasName = rows[0].hasOwnProperty('name');
  if (!hasName) {
    return {
      success: false,
      error: 'Missing required "Name" column. Please check the template format.',
      headers: Object.keys(rows[0]),
    };
  }

  // Get all players in this league
  const leaguePlayers = await db.query(
    'SELECT * FROM players WHERE league_id=$1', [leagueId]
  );

  const results = {
    imported:  [],
    skipped:   [],
    warnings:  [],
    errors:    [],
  };

  for (const row of rows) {
    const playerName = String(row.name || '').trim();
    if (!playerName) continue;

    // Match player by name (case-insensitive)
    const match = leaguePlayers.find(p =>
      p.name.toLowerCase().trim() === playerName.toLowerCase()
    );

    if (!match) {
      results.skipped.push(playerName);
      results.warnings.push(`"${playerName}" not found in league — row skipped.`);
      continue;
    }

    // Build stat values
    const s = {
      fg2m:  parseInt(row.fg2m)  || 0,
      fg2a:  parseInt(row.fg2a)  || 0,
      fg3m:  parseInt(row.fg3m)  || 0,
      fg3a:  parseInt(row.fg3a)  || 0,
      ftm:   parseInt(row.ftm)   || 0,
      fta:   parseInt(row.fta)   || 0,
      oreb:  parseInt(row.oreb)  || 0,
      dreb:  parseInt(row.dreb)  || 0,
      ast:   parseInt(row.ast)   || 0,
      stl:   parseInt(row.stl)   || 0,
      blk:   parseInt(row.blk)   || 0,
      to_val:parseInt(row.to)    || 0,
      foul:  parseInt(row.foul)  || 0,
    };

    try {
      // Upsert game_stats
      await db.run(
        `INSERT INTO game_stats
           (game_id, player_id, league_id, fg2m, fg2a, fg3m, fg3a, ftm, fta,
            oreb, dreb, ast, stl, blk, to_val, foul)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (game_id, player_id)
         DO UPDATE SET
           fg2m=$4, fg2a=$5, fg3m=$6, fg3a=$7, ftm=$8, fta=$9,
           oreb=$10, dreb=$11, ast=$12, stl=$13, blk=$14, to_val=$15, foul=$16`,
        [gameId, match.id, leagueId,
         s.fg2m, s.fg2a, s.fg3m, s.fg3a, s.ftm, s.fta,
         s.oreb, s.dreb, s.ast, s.stl, s.blk, s.to_val, s.foul]
      );
      results.imported.push(playerName);
    } catch (err) {
      results.errors.push(`${playerName}: ${err.message}`);
    }
  }

  return {
    success: results.imported.length > 0 || results.skipped.length > 0,
    ...results,
    total: rows.filter(r => String(r.name||'').trim()).length,
  };
}

// ── GENERATE TEMPLATE ─────────────────────────────────────────────────────────
function generateTemplate(players = []) {
  const headers = ['Name','FG2M','FG2A','FG3M','FG3A','FTM','FTA','OREB','DREB','AST','STL','BLK','TO','Foul'];
  const rows = players.length > 0
    ? players.map(p => [p.name, 0,0,0,0,0,0,0,0,0,0,0,0,0])
    : [['Example Player',4,8,2,5,3,4,1,4,3,1,0,2,2]];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Column widths
  ws['!cols'] = [
    { wch: 22 }, // Name
    ...Array(13).fill({ wch: 7 }),
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Stats');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { importStats, generateTemplate, parseSpreadsheet, normalizeHeaders };
