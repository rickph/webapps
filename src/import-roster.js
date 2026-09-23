/**
 * HoopStats Pilipinas — Bulk Roster Importer (Teams & Players)
 * Supports: .xlsx, .xls, .csv
 */
const XLSX = require('xlsx');

function normalizeKey(k) {
  return String(k).toLowerCase().trim().replace(/[_\s]+/g, ' ');
}

function mapRow(row, aliasMap) {
  const out = {};
  for (const [rawKey, rawVal] of Object.entries(row)) {
    const k = normalizeKey(rawKey);
    for (const [field, aliases] of Object.entries(aliasMap)) {
      if (aliases.includes(k) && !(field in out)) out[field] = rawVal;
    }
  }
  return out;
}

function parseBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

function normalizeHex(v) {
  const s = String(v || '').trim();
  const m = s.match(/^#?([0-9a-f]{6})$/i);
  return m ? ('#' + m[1].toLowerCase()) : null;
}

// ── TEAMS ────────────────────────────────────────────────────────────────────
const TEAM_ALIASES = {
  name:  ['team name','name','team'],
  color: ['color','colour','team color','team colour'],
  bio:   ['bio','description','notes'],
};

async function importTeams(buffer, { leagueId, db, teamColors, colorNames }) {
  const rawRows = parseBuffer(buffer);
  if (!rawRows.length) return { success: false, error: 'Spreadsheet is empty.' };

  const rows = rawRows.map(r => mapRow(r, TEAM_ALIASES));
  if (!rows[0].hasOwnProperty('name')) {
    return {
      success: false,
      error: 'Missing "Team Name" column. Please use the provided template.',
      hint: 'Column headers must include: Team Name, Color (optional), Bio (optional)'
    };
  }

  const nameToHex = {};
  for (const [hex, label] of Object.entries(colorNames)) {
    nameToHex[normalizeKey(label)] = hex;
  }

  const existingTeams = await db.query('SELECT name FROM teams WHERE league_id=$1', [leagueId]);
  const existingNames = new Set(existingTeams.map(t => t.name.toLowerCase().trim()));

  const results = { imported: [], skipped: [], errors: [] };
  let colorIdx = 0;

  for (const row of rows) {
    const teamName = String(row.name || '').trim();
    if (!teamName) continue;

    if (existingNames.has(teamName.toLowerCase())) {
      results.skipped.push(`${teamName} (already exists)`);
      continue;
    }

    let color = normalizeHex(row.color) || nameToHex[normalizeKey(row.color || '')];
    if (!color) {
      color = teamColors[colorIdx % teamColors.length];
      colorIdx++;
    }
    const bio = String(row.bio || '').trim() || null;

    try {
      await db.run(
        'INSERT INTO teams (league_id,name,color,bio) VALUES ($1,$2,$3,$4)',
        [leagueId, teamName, color, bio]
      );
      existingNames.add(teamName.toLowerCase());
      results.imported.push(teamName);
    } catch (err) {
      results.errors.push(`${teamName}: ${err.message}`);
    }
  }

  return { success: true, total: rows.filter(r => String(r.name||'').trim()).length, ...results };
}

function generateTeamsTemplate(existingTeams = []) {
  const headers = ['Team Name', 'Color', 'Bio'];
  const sampleRows = existingTeams.length
    ? []
    : [
        ['Purok 1 Ballers', 'Red', ''],
        ['Sitio Bagong Pag-asa', 'Steel Blue', ''],
      ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
  ws['!cols'] = [{ wch: 26 }, { wch: 16 }, { wch: 40 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, 'Teams');

  const instrRows = [
    ['HoopStats Pilipinas — Teams Import Template'],
    [''],
    ['INSTRUCTIONS:'],
    ['1. Fill in one row per team in the Teams sheet'],
    ['2. Team Name is required; teams that already exist in this league are skipped'],
    ['3. Color is optional — use a color name (e.g. Red, Teal, Navy) or a hex code (e.g. #e63946)'],
    ['   If left blank, a color is assigned automatically'],
    ['4. Bio is optional — a short description shown on the team\'s public page'],
    ['5. Save as .xlsx or .csv and upload on the Teams tab'],
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instrRows);
  wsInstr['!cols'] = [{ wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ── PLAYERS ──────────────────────────────────────────────────────────────────
const PLAYER_ALIASES = {
  name:   ['player name','name','player','full name'],
  team:   ['team name','team'],
  jersey: ['jersey #','jersey','jersey number','#','no','number'],
  pos:    ['position','pos'],
};

const VALID_POSITIONS = ['PG','SG','SF','PF','C'];

async function importPlayers(buffer, { leagueId, db }) {
  const rawRows = parseBuffer(buffer);
  if (!rawRows.length) return { success: false, error: 'Spreadsheet is empty.' };

  const rows = rawRows.map(r => mapRow(r, PLAYER_ALIASES));
  if (!rows[0].hasOwnProperty('name')) {
    return {
      success: false,
      error: 'Missing "Player Name" column. Please use the provided template.',
      hint: 'Column headers must include: Player Name, Team Name, Jersey #, Position'
    };
  }

  const teams = await db.query('SELECT id, name FROM teams WHERE league_id=$1', [leagueId]);
  const teamByName = {};
  teams.forEach(t => { teamByName[t.name.toLowerCase().trim()] = t; });

  const existingPlayers = await db.query('SELECT name FROM players WHERE league_id=$1', [leagueId]);
  const existingNames = new Set(existingPlayers.map(p => p.name.toLowerCase().trim()));

  const results = { imported: [], skipped: [], errors: [] };

  for (const row of rows) {
    const playerName = String(row.name || '').trim();
    if (!playerName) continue;

    if (existingNames.has(playerName.toLowerCase())) {
      results.skipped.push(`${playerName} (already exists)`);
      continue;
    }

    const teamName = String(row.team || '').trim();
    if (!teamName) {
      results.errors.push(`${playerName}: Team Name is required`);
      continue;
    }
    const team = teamByName[teamName.toLowerCase()];
    if (!team) {
      results.errors.push(`${playerName}: team "${teamName}" not found in this league`);
      continue;
    }

    const jersey = parseInt(row.jersey) || 0;
    const posRaw = String(row.pos || '').trim().toUpperCase();
    const pos = VALID_POSITIONS.includes(posRaw) ? posRaw : '';

    try {
      await db.run(
        'INSERT INTO players (league_id,team_id,name,pos,jersey,gp,pts,reb,ast,stl,blk,fg) VALUES ($1,$2,$3,$4,$5,0,0,0,0,0,0,0)',
        [leagueId, team.id, playerName, pos, jersey]
      );
      existingNames.add(playerName.toLowerCase());
      results.imported.push(playerName);
    } catch (err) {
      results.errors.push(`${playerName}: ${err.message}`);
    }
  }

  return { success: true, total: rows.filter(r => String(r.name||'').trim()).length, ...results };
}

function generatePlayersTemplate(teams = []) {
  const headers = ['Player Name', 'Team Name', 'Jersey #', 'Position'];
  const sampleRows = teams.length
    ? []
    : [
        ['Juan dela Cruz', 'Purok 1 Ballers', 7, 'PG'],
        ['Mark Santos', 'Sitio Bagong Pag-asa', 23, 'SF'],
      ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
  ws['!cols'] = [{ wch: 24 }, { wch: 24 }, { wch: 10 }, { wch: 10 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, 'Players');

  const instrRows = [
    ['HoopStats Pilipinas — Players Import Template'],
    [''],
    ['INSTRUCTIONS:'],
    ['1. Fill in one row per player in the Players sheet'],
    ['2. Player Name and Team Name are required; players that already exist in this league are skipped'],
    ['3. Team Name must match an existing team in this league EXACTLY (case doesn\'t matter)'],
    ['   Add the team first (or bulk-import teams) if it doesn\'t exist yet'],
    ['4. Jersey # and Position (PG/SG/SF/PF/C) are optional'],
    ['5. Save as .xlsx or .csv and upload on the Players tab'],
    [''],
    ['TEAMS IN THIS LEAGUE:'],
    ...(teams.length ? teams.map(t => [t.name]) : [['(No teams yet — add teams first, or leave Team Name blank)']]),
  ];
  const wsInstr = XLSX.utils.aoa_to_sheet(instrRows);
  wsInstr['!cols'] = [{ wch: 70 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instructions');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { importTeams, generateTeamsTemplate, importPlayers, generatePlayersTemplate };
