/**
 * HoopStats Pilipinas — Spreadsheet Stats Importer
 * Supports: .xlsx, .xls, .csv
 */
const XLSX = require('xlsx');

// Column name aliases (case-insensitive)
const ALIASES = {
  name:  ['name','player','player name','playername','full name','fullname'],
  fg2m:  ['fg2m','2pm','2pt made','made 2','fg2 made','two pt made'],
  fg2a:  ['fg2a','2pa','2pt att','att 2','fg2 att','two pt att','2pt attempts'],
  fg3m:  ['fg3m','3pm','3pt made','made 3','fg3 made','three pt made'],
  fg3a:  ['fg3a','3pa','3pt att','att 3','fg3 att','three pt att','3pt attempts'],
  ftm:   ['ftm','ft made','free throw made','ft','free throws made'],
  fta:   ['fta','ft att','free throw att','free throw attempts','ft attempts'],
  oreb:  ['oreb','off reb','offensive reb','orb','off rebound','offensive rebound'],
  dreb:  ['dreb','def reb','defensive reb','drb','def rebound','defensive rebound'],
  ast:   ['ast','assists','assist'],
  stl:   ['stl','steals','steal'],
  blk:   ['blk','blocks','block'],
  to:    ['to','to_val','turnovers','turnover','tov','turn overs'],
  foul:  ['foul','fouls','pf','personal foul','personal fouls'],
};

function normalizeKey(k) {
  return String(k).toLowerCase().trim().replace(/[_\s]+/g, ' ');
}

function mapRow(row) {
  const out = {};
  for (const [rawKey, rawVal] of Object.entries(row)) {
    const k = normalizeKey(rawKey);
    for (const [field, aliases] of Object.entries(ALIASES)) {
      if (aliases.includes(k) && !(field in out)) {
        out[field] = rawVal;
      }
    }
  }
  return out;
}

function parseBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

async function importGameStats(buffer, { leagueId, gameId, db }) {
  const rawRows = parseBuffer(buffer);
  if (!rawRows.length) return { success: false, error: 'Spreadsheet is empty.' };

  const rows = rawRows.map(mapRow);

  // Validate at least name column present
  if (!rows[0].hasOwnProperty('name')) {
    return {
      success: false,
      error: 'Missing "Name" column. Please use the provided template.',
      hint: 'Column headers must include: Name, FG2M, FG2A, FG3M, FG3A, FTM, FTA, OREB, DREB, AST, STL, BLK, TO, Foul'
    };
  }

  const leaguePlayers = await db.query(
    'SELECT * FROM players WHERE league_id=$1', [leagueId]
  );

  const results = { imported: [], skipped: [], errors: [] };

  for (const row of rows) {
    const playerName = String(row.name || '').trim();
    if (!playerName) continue;

    const match = leaguePlayers.find(p =>
      p.name.toLowerCase().trim() === playerName.toLowerCase()
    );

    if (!match) {
      results.skipped.push(playerName);
      continue;
    }

    const s = {
      fg2m:   Math.max(0, parseInt(row.fg2m)  || 0),
      fg2a:   Math.max(0, parseInt(row.fg2a)  || 0),
      fg3m:   Math.max(0, parseInt(row.fg3m)  || 0),
      fg3a:   Math.max(0, parseInt(row.fg3a)  || 0),
      ftm:    Math.max(0, parseInt(row.ftm)   || 0),
      fta:    Math.max(0, parseInt(row.fta)   || 0),
      oreb:   Math.max(0, parseInt(row.oreb)  || 0),
      dreb:   Math.max(0, parseInt(row.dreb)  || 0),
      ast:    Math.max(0, parseInt(row.ast)   || 0),
      stl:    Math.max(0, parseInt(row.stl)   || 0),
      blk:    Math.max(0, parseInt(row.blk)   || 0),
      to_val: Math.max(0, parseInt(row.to)    || 0),
      foul:   Math.max(0, parseInt(row.foul)  || 0),
    };

    // Sanity: made can't exceed attempts
    s.fg2m = Math.min(s.fg2m, s.fg2a || s.fg2m);
    s.fg3m = Math.min(s.fg3m, s.fg3a || s.fg3m);
    s.ftm  = Math.min(s.ftm,  s.fta  || s.ftm);

    try {
      await db.run(
        `INSERT INTO game_stats
           (game_id,player_id,league_id,fg2m,fg2a,fg3m,fg3a,ftm,fta,oreb,dreb,ast,stl,blk,to_val,foul)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         ON CONFLICT (game_id,player_id) DO UPDATE SET
           fg2m=$4,fg2a=$5,fg3m=$6,fg3a=$7,ftm=$8,fta=$9,
           oreb=$10,dreb=$11,ast=$12,stl=$13,blk=$14,to_val=$15,foul=$16`,
        [gameId, match.id, leagueId,
         s.fg2m,s.fg2a,s.fg3m,s.fg3a,s.ftm,s.fta,
         s.oreb,s.dreb,s.ast,s.stl,s.blk,s.to_val,s.foul]
      );
      results.imported.push(playerName);
    } catch(err) {
      results.errors.push(`${playerName}: ${err.message}`);
    }
  }

  return {
    success: true,
    total: rows.filter(r => String(r.name||'').trim()).length,
    ...results
  };
}

function generateTemplate(players = []) {
  const headers = [
    'Name','FG2M','FG2A','FG3M','FG3A','FTM','FTA','OREB','DREB','AST','STL','BLK','TO','Foul'
  ];

  const sampleRow  = ['Example Player',4,8,1,3,2,4,1,4,3,1,0,2,1];
  const playerRows = players.length
    ? players.map(p => [p.name,0,0,0,0,0,0,0,0,0,0,0,0,0])
    : [sampleRow];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...playerRows]);

  // Style: column widths
  ws['!cols'] = [
    { wch: 24 }, // Name
    ...Array(13).fill({ wch: 7 }),
  ];

  // Freeze top row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  XLSX.utils.book_append_sheet(wb, ws, 'Stats');

  // Instructions sheet
  const instrRows = [
    ['HoopStats Pilipinas — Stats Import Template'],
    [''],
    ['INSTRUCTIONS:'],
    ['1. Fill in the Stats sheet with player stats for this game'],
    ['2. Player names must match EXACTLY (spelling, but not case)'],
    ['3. Leave stats as 0 if player did not record that stat'],
    ['4. Made shots cannot exceed attempts (FG2M ≤ FG2A, etc.)'],
    ['5. Save as .xlsx or .csv and upload in the Import Stats page'],
    [''],
    ['COLUMN GUIDE:'],
    ['Name  — Player full name (must match roster)'],
    ['FG2M  — 2-Point Field Goals Made'],
    ['FG2A  — 2-Point Field Goals Attempted'],
    ['FG3M  — 3-Point Field Goals Made'],
    ['FG3A  — 3-Point Field Goals Attempted'],
    ['FTM   — Free Throws Made'],
    ['FTA   — Free Throws Attempted'],
    ['OREB  — Offensive Rebounds'],
    ['DREB  — Defensive Rebounds'],
    ['AST   — Assists'],
    ['STL   — Steals'],
    ['BLK   — Blocks'],
    ['TO    — Turnovers'],
    ['Foul  — Personal Fouls'],
  ];

  const wsInstr = XLSX.utils.aoa_to_sheet(instrRows);
  wsInstr['!cols'] = [{ wch: 60 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { importGameStats, generateTemplate };
