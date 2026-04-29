const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { requireAuth, FREE_LIMITS } = require('../middleware/auth');
const { esc, levelBadge, statusBadge, levelColor, page } = require('./public');
const jwt = require('jsonwebtoken');

router.use(requireAuth);

// ── HELPERS ───────────────────────────────────────────────────────────────────
const isPro = (req) => req.user.plan === 'pro';

async function ownsLeague(leagueId, userId) {
  const l = await db.queryOne('SELECT user_id FROM leagues WHERE id = $1', [leagueId]);
  return l && Number(l.user_id) === Number(userId);
}

const LEVEL_OPTIONS = ['Barangay','City/Municipal','Provincial','Regional'];
const TEAM_COLORS   = ['#e63946','#457b9d','#2a9d8f','#e9c46a','#f4a261','#264653','#e76f51','#6a4c93','#1982c4','#8ac926'];
const POSITIONS     = ['PG','SG','SF','PF','C'];

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const leagues = await db.query(`
      SELECT l.*,
        (SELECT COUNT(*) FROM teams  WHERE league_id=l.id) as team_count,
        (SELECT COUNT(*) FROM players WHERE league_id=l.id) as player_count,
        (SELECT COUNT(*) FROM games  WHERE league_id=l.id AND status='final') as game_count
      FROM leagues l WHERE l.user_id=$1 ORDER BY l.created_at DESC`, [req.user.id]);

    const [totals] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM teams   WHERE league_id IN (SELECT id FROM leagues WHERE user_id=$1)) as teams,
        (SELECT COUNT(*) FROM players WHERE league_id IN (SELECT id FROM leagues WHERE user_id=$1)) as players,
        (SELECT COUNT(*) FROM games   WHERE league_id IN (SELECT id FROM leagues WHERE user_id=$1) AND status='final') as games
    `, [req.user.id]);

    const pro = isPro(req);

    const leagueCards = leagues.map(l => `
      <div class="admin-league-card">
        <div class="alc-top">${levelBadge(l.level)} ${statusBadge(l.status)}</div>
        <div class="alc-name">${esc(l.name)}</div>
        <div class="alc-loc">📍 ${esc(l.location)} · ${esc(l.season)}</div>
        <div class="alc-meta">Admin Code: <code>${esc(l.admin_code)}</code></div>
        <div class="alc-stats">
          <span class="acs"><b style="color:#ff6b35">${l.team_count}</b> Teams</span>
          <span class="acs"><b style="color:#00d4aa">${l.player_count}</b> Players</span>
          <span class="acs"><b style="color:#f7c948">${l.game_count}</b> Games</span>
        </div>
        <div class="alc-actions">
          <a href="/admin/league/${l.id}" class="btn-primary-sm">Manage →</a>
          <a href="/league/${l.id}" class="btn-ghost-sm" target="_blank">Public View</a>
          <button onclick="deleteLeague(${l.id})" class="btn-danger-sm">Delete</button>
        </div>
      </div>`).join('');

    res.send(adminPage('Dashboard', req.user, `
      <div class="admin-header">
        <div>
          <h1>Welcome, ${esc(req.user.name)} 👋</h1>
          <p>Manage your basketball leagues</p>
        </div>
        <div class="ah-right">
          ${pro ? '<span class="pro-badge">⚡ PRO</span>' : '<a href="/upgrade" class="btn-upgrade">⚡ Upgrade to Pro — ₱199/mo</a>'}
          <button onclick="openModal('addLeague')" class="btn-primary">+ New League</button>
        </div>
      </div>
      <div class="dash-stats">
        <div class="ds"><span style="color:#ff6b35">${leagues.length}</span><small>My Leagues</small></div>
        <div class="ds"><span style="color:#00d4aa">${totals.teams}</span><small>Teams</small></div>
        <div class="ds"><span style="color:#a78bfa">${totals.players}</span><small>Players</small></div>
        <div class="ds"><span style="color:#f7c948">${totals.games}</span><small>Games Played</small></div>
      </div>
      ${!pro ? `<div class="free-limit-bar">Free Plan: ${leagues.length}/${FREE_LIMITS.leagues} league used. <a href="/upgrade">Upgrade for unlimited →</a></div>` : ''}
      <div class="league-grid-admin">
        ${leagueCards || '<div class="empty-state"><div class="es-icon">🏆</div><div>No leagues yet. Create your first one!</div></div>'}
      </div>
      ${addLeagueModal(pro)}
      <script>
        async function deleteLeague(id) {
          if (!confirm('Delete this league and ALL its data? This cannot be undone.')) return;
          const r = await fetch('/admin/api/league/'+id,{method:'DELETE'});
          if (r.ok) location.reload(); else alert('Error deleting league');
        }
      </script>
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

// ── LEAGUE MANAGEMENT PAGE ────────────────────────────────────────────────────
router.get('/league/:id', async (req, res) => {
  try {
    const lid = req.params.id;
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [lid]);
    if (!league || !await ownsLeague(lid, req.user.id)) return res.redirect('/admin');

    const [teams, players, games] = await Promise.all([
      db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC, losses ASC', [lid]),
      db.query(`SELECT p.*,t.name as team_name FROM players p
                LEFT JOIN teams t ON p.team_id=t.id
                WHERE p.league_id=$1 ORDER BY p.pts DESC`, [lid]),
      db.query(`SELECT g.*,ht.name as home_name,at.name as away_name FROM games g
                LEFT JOIN teams ht ON g.home_team_id=ht.id
                LEFT JOIN teams at ON g.away_team_id=at.id
                WHERE g.league_id=$1 ORDER BY g.id DESC`, [lid]),
    ]);

    const pro   = isPro(req);
    const lc    = levelColor(league.level);
    const topts = teams.map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

    res.send(adminPage(esc(league.name), req.user, `
      <div class="admin-header">
        <div>
          <a href="/admin" class="back-link">← My Leagues</a>
          <h1>${esc(league.name)}</h1>
          <div class="lh-meta" style="margin-top:4px">
            ${levelBadge(league.level)} ${statusBadge(league.status)}
            <span style="color:#666;font-size:13px;margin-left:8px">📍 ${esc(league.location)} · ${esc(league.season)}</span>
          </div>
        </div>
        <div class="ah-right">
          <a href="/league/${league.id}" class="btn-ghost-sm" target="_blank">🌐 Public View</a>
          ${pro ? `<a href="/admin/league/${league.id}/pdf" class="btn-ghost-sm">📄 PDF Report</a>` : ''}
          ${pro ? `<a href="/admin/league/${league.id}/bracket" class="btn-ghost-sm">🏆 Bracket</a>` : ''}
        </div>
      </div>

      <div class="admin-tabs">
        <button class="atab active" onclick="showATab('dashboard',this)">📊 Dashboard</button>
        <button class="atab" onclick="showATab('teams',this)">👕 Teams</button>
        <button class="atab" onclick="showATab('players',this)">👤 Players</button>
        <button class="atab" onclick="showATab('games',this)">🏀 Games</button>
        <button class="atab" onclick="showATab('livescore',this)">🔴 Live Score</button>
      </div>

      <!-- DASHBOARD -->
      <div id="atab-dashboard" class="atab-pane">
        <div class="mini-stats">
          ${[{v:teams.length,l:'Teams',c:'#ff6b35'},{v:players.length,l:'Players',c:'#00d4aa'},
             {v:games.filter(g=>g.status==='final').length,l:'Games Played',c:'#a78bfa'},
             {v:games.filter(g=>g.status==='upcoming').length,l:'Upcoming',c:'#f7c948'}]
            .map(s=>`<div class="ms"><div style="font-size:36px;font-weight:800;color:${s.c}">${s.v}</div><div class="ms-label">${s.l}</div></div>`).join('')}
        </div>
        <h3 style="margin-bottom:12px">Top Performers</h3>
        <table class="stats-table">
          <thead><tr><th>#</th><th>Player</th><th>Team</th><th>PTS</th><th>REB</th><th>AST</th><th>FG%</th></tr></thead>
          <tbody>
            ${players.slice(0,8).map((p,i)=>`
              <tr><td class="rank ${i===0?'rank-top':''}">${i+1}</td>
              <td style="font-weight:600">${esc(p.name)}</td>
              <td class="sub-text">${esc(p.team_name||'')}</td>
              <td class="orange">${p.pts}</td><td>${p.reb}</td><td>${p.ast}</td>
              <td class="teal">${p.fg}%</td></tr>`).join('')
              || '<tr><td colspan="7" class="empty">No players yet.</td></tr>'}
          </tbody>
        </table>
      </div>

      <!-- TEAMS -->
      <div id="atab-teams" class="atab-pane hidden">
        <div class="tab-action-bar">
          <h3>Teams (${teams.length})</h3>
          <button onclick="openModal('addTeam')" class="btn-primary">+ Add Team</button>
        </div>
        <div class="teams-list">
          ${teams.map(t => `
            <div class="team-row">
              <div class="team-color-bar" style="background:${t.color}"></div>
              <div class="team-info">
                <div style="font-weight:700">${esc(t.name)}</div>
                <div class="sub-text">${players.filter(p=>p.team_id==t.id).length} players</div>
              </div>
              <div class="team-record"><span class="green">${t.wins}W</span> <span class="red">${t.losses}L</span></div>
              <div class="row-actions">
                <button onclick="openEditTeam(${t.id},'${esc(t.name).replace(/'/g,"\\'")}','${t.color}')" class="btn-ghost-sm">✏ Edit</button>
                <button onclick="apiDelete('team',${t.id})" class="btn-danger-sm">🗑</button>
              </div>
            </div>`).join('') || '<div class="empty-state">No teams yet.</div>'}
        </div>
      </div>

      <!-- PLAYERS -->
      <div id="atab-players" class="atab-pane hidden">
        <div class="tab-action-bar">
          <h3>Players (${players.length})</h3>
          <button onclick="openModal('addPlayer')" class="btn-primary">+ Add Player</button>
        </div>
        <div style="overflow-x:auto">
        <table class="stats-table">
          <thead><tr><th>#</th><th>Name</th><th>Team</th><th>POS</th><th>PTS</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>FG%</th><th></th></tr></thead>
          <tbody>
            ${players.map((p,i)=>`
              <tr>
                <td class="rank">${i+1}</td>
                <td><div style="font-weight:600">${esc(p.name)}</div><div class="sub-text">#${p.jersey}</div></td>
                <td class="sub-text">${esc(p.team_name||'')}</td>
                <td><span class="pos-badge">${p.pos}</span></td>
                <td class="orange">${p.pts}</td><td>${p.reb}</td><td>${p.ast}</td>
                <td>${p.stl}</td><td>${p.blk}</td><td class="teal">${p.fg}%</td>
                <td>
                  <button onclick='openEditPlayer(${JSON.stringify({id:p.id,team_id:p.team_id,name:p.name,pos:p.pos,jersey:p.jersey,gp:p.gp,pts:p.pts,reb:p.reb,ast:p.ast,stl:p.stl,blk:p.blk,fg:p.fg})})' class="btn-ghost-sm">✏</button>
                  <button onclick="apiDelete('player',${p.id})" class="btn-danger-sm">🗑</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="11" class="empty">No players yet.</td></tr>'}
          </tbody>
        </table>
        </div>
      </div>

      <!-- GAMES -->
      <div id="atab-games" class="atab-pane hidden">
        <div class="tab-action-bar">
          <h3>Games (${games.length})</h3>
          <button onclick="openModal('addGame')" class="btn-primary">+ Schedule Game</button>
        </div>
        <div class="games-list">
          ${games.map(g=>`
            <div class="game-row">
              <div class="game-meta"><div class="game-date">${esc(g.date||'TBD')}</div><div class="game-venue">📍 ${esc(g.venue||'TBD')}</div></div>
              <div class="game-matchup">
                <span class="game-team">${esc(g.home_name||'TBD')}</span>
                ${g.status==='final'
                  ? `<div class="score-final"><span class="${g.home_score>=g.away_score?'score-win':'score-lose'}">${g.home_score}</span><span class="score-vs">FINAL</span><span class="${g.away_score>g.home_score?'score-win':'score-lose'}">${g.away_score}</span></div>`
                  : '<span class="vs-badge">VS</span>'}
                <span class="game-team">${esc(g.away_name||'TBD')}</span>
              </div>
              <div class="row-actions">
                ${statusBadge(g.status)}
                ${g.status!=='final'?`<button onclick="goLive(${g.id})" class="btn-teal-sm">🔴 Score</button>`:''}
                <button onclick="apiDelete('game',${g.id})" class="btn-danger-sm">🗑</button>
              </div>
            </div>`).join('') || '<div class="empty-state">No games scheduled.</div>'}
        </div>
      </div>

      <!-- LIVE SCORE -->
      <div id="atab-livescore" class="atab-pane hidden">
        <div id="live-select">
          <h3 style="margin-bottom:16px">Select Game to Score</h3>
          <div class="games-list">
            ${games.filter(g=>g.status!=='final').map(g=>`
              <div class="game-row">
                <div class="game-matchup">
                  <span class="game-team">${esc(g.home_name||'?')}</span>
                  <span class="vs-badge">VS</span>
                  <span class="game-team">${esc(g.away_name||'?')}</span>
                </div>
                <div class="game-meta"><div class="game-date">${esc(g.date||'TBD')}</div></div>
                <button onclick="startLive(${g.id})" class="btn-teal-sm">🔴 Start Scoring</button>
              </div>`).join('') || '<div class="empty-state">No upcoming games. Schedule a game first.</div>'}
          </div>
        </div>
        <div id="live-board" style="display:none">
          <div class="live-header"><div class="live-dot"></div> LIVE SCORING</div>
          <div class="live-scoreboard">
            <div class="live-team">
              <div id="lv-home-name" class="live-team-name"></div>
              <div id="lv-home-score" class="live-score">0</div>
              <div class="score-btns">
                <button onclick="adj('home',-1)" class="btn-ghost">−1</button>
                <button onclick="adj('home',1)"  class="btn-teal-sm">+1</button>
                <button onclick="adj('home',2)"  class="btn-primary">+2</button>
                <button onclick="adj('home',3)"  class="btn-purple">+3</button>
              </div>
            </div>
            <div class="live-center">
              <div style="font-size:11px;color:#666;font-weight:700;letter-spacing:2px;margin-bottom:6px">QTR</div>
              <div id="lv-qtr" style="font-size:40px;font-weight:800;color:#f7c948">1</div>
              <div style="display:flex;gap:6px;margin-top:8px">
                <button onclick="adjQtr(-1)" class="btn-ghost">−</button>
                <button onclick="adjQtr(1)"  class="btn-ghost">+</button>
              </div>
            </div>
            <div class="live-team">
              <div id="lv-away-name" class="live-team-name"></div>
              <div id="lv-away-score" class="live-score" style="color:#ff6b35">0</div>
              <div class="score-btns">
                <button onclick="adj('away',-1)" class="btn-ghost">−1</button>
                <button onclick="adj('away',1)"  class="btn-teal-sm">+1</button>
                <button onclick="adj('away',2)"  class="btn-primary">+2</button>
                <button onclick="adj('away',3)"  class="btn-purple">+3</button>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:24px">
            <button onclick="cancelLive()" class="btn-ghost">Cancel</button>
            <button onclick="saveLive()" class="btn-primary">✅ Save Final Score &amp; Update Standings</button>
          </div>
        </div>
      </div>

      <!-- MODALS -->
      <!-- Team modal -->
      <div id="modal-addTeam" class="modal-back hidden">
        <div class="modal">
          <div class="modal-head"><h3>Add / Edit Team</h3><button onclick="closeModal('addTeam')" class="modal-close">✕</button></div>
          <input type="hidden" id="team-edit-id">
          <div class="field-group"><label>Team Name</label><input id="team-name" class="input" placeholder="e.g. Purok 1 Ballers" /></div>
          <div class="field-group"><label>Color</label>
            <div class="color-picker">
              ${TEAM_COLORS.map(c=>`<div class="cp-dot" style="background:${c}" data-color="${c}" onclick="pickColor('${c}',this)"></div>`).join('')}
            </div>
            <input type="hidden" id="team-color" value="${TEAM_COLORS[0]}">
          </div>
          <div class="modal-actions">
            <button onclick="closeModal('addTeam')" class="btn-ghost">Cancel</button>
            <button onclick="saveTeam(${league.id})" class="btn-primary">Save Team</button>
          </div>
        </div>
      </div>

      <!-- Player modal -->
      <div id="modal-addPlayer" class="modal-back hidden">
        <div class="modal" style="max-width:600px">
          <div class="modal-head"><h3 id="player-modal-title">Add Player</h3><button onclick="closeModal('addPlayer')" class="modal-close">✕</button></div>
          <input type="hidden" id="p-edit-id">
          <div class="modal-grid">
            <div class="field-group"><label>Full Name</label><input id="p-name" class="input" placeholder="Player name" /></div>
            <div class="field-group"><label>Jersey #</label><input id="p-jersey" class="input" type="number" placeholder="0" /></div>
            <div class="field-group"><label>Team</label>
              <select id="p-team" class="input"><option value="">Select team</option>${topts}</select></div>
            <div class="field-group"><label>Position</label>
              <select id="p-pos" class="input"><option value="">Select</option>${POSITIONS.map(p=>`<option>${p}</option>`).join('')}</select></div>
            <div class="field-group"><label>Games Played</label><input id="p-gp"  class="input" type="number" placeholder="0" /></div>
            <div class="field-group"><label>Points/Game</label><input id="p-pts" class="input" type="number" step="0.1" placeholder="0.0" /></div>
            <div class="field-group"><label>Rebounds/Game</label><input id="p-reb" class="input" type="number" step="0.1" placeholder="0.0" /></div>
            <div class="field-group"><label>Assists/Game</label><input id="p-ast" class="input" type="number" step="0.1" placeholder="0.0" /></div>
            <div class="field-group"><label>Steals/Game</label><input id="p-stl" class="input" type="number" step="0.1" placeholder="0.0" /></div>
            <div class="field-group"><label>Blocks/Game</label><input id="p-blk" class="input" type="number" step="0.1" placeholder="0.0" /></div>
            <div class="field-group"><label>FG%</label><input id="p-fg" class="input" type="number" step="0.1" placeholder="0.0" /></div>
          </div>
          <div class="modal-actions">
            <button onclick="closeModal('addPlayer')" class="btn-ghost">Cancel</button>
            <button onclick="savePlayer(${league.id})" class="btn-primary">Save Player</button>
          </div>
        </div>
      </div>

      <!-- Game modal -->
      <div id="modal-addGame" class="modal-back hidden">
        <div class="modal">
          <div class="modal-head"><h3>Schedule Game</h3><button onclick="closeModal('addGame')" class="modal-close">✕</button></div>
          <div class="modal-grid">
            <div class="field-group"><label>Home Team</label><select id="g-home" class="input"><option value="">Select</option>${topts}</select></div>
            <div class="field-group"><label>Away Team</label><select id="g-away" class="input"><option value="">Select</option>${topts}</select></div>
            <div class="field-group"><label>Date</label><input id="g-date" class="input" placeholder="Apr 27, 2025" /></div>
            <div class="field-group"><label>Venue / Court</label><input id="g-venue" class="input" placeholder="Brgy. Court Name" /></div>
            <div class="field-group"><label>Status</label>
              <select id="g-status" class="input" onchange="toggleScoreFields()">
                <option value="upcoming">Upcoming</option>
                <option value="ongoing">Ongoing</option>
                <option value="final">Final (enter score)</option>
              </select>
            </div>
          </div>
          <div id="score-fields" class="modal-grid" style="display:none">
            <div class="field-group"><label>Home Score</label><input id="g-hs" class="input" type="number" placeholder="0" /></div>
            <div class="field-group"><label>Away Score</label><input id="g-as" class="input" type="number" placeholder="0" /></div>
          </div>
          <div class="modal-actions">
            <button onclick="closeModal('addGame')" class="btn-ghost">Cancel</button>
            <button onclick="saveGame(${league.id})" class="btn-primary">Save Game</button>
          </div>
        </div>
      </div>

      <script>
        // ── Tab switching ──
        function showATab(name,btn){
          document.querySelectorAll('.atab-pane').forEach(p=>p.classList.add('hidden'));
          document.querySelectorAll('.atab').forEach(b=>b.classList.remove('active'));
          document.getElementById('atab-'+name).classList.remove('hidden');
          if(btn)btn.classList.add('active');
        }
        function goLive(id){showATab('livescore',document.querySelectorAll('.atab')[4]);startLive(id);}

        // ── Modal helpers ──
        function openModal(id){document.getElementById('modal-'+id).classList.remove('hidden');}
        function closeModal(id){document.getElementById('modal-'+id).classList.add('hidden');}

        // ── Color picker ──
        function pickColor(c,el){
          document.querySelectorAll('.cp-dot').forEach(d=>d.classList.remove('selected'));
          el.classList.add('selected');
          document.getElementById('team-color').value=c;
        }
        document.querySelector('.cp-dot')?.classList.add('selected');

        // ── Team CRUD ──
        function openEditTeam(id,name,color){
          document.getElementById('team-edit-id').value=id;
          document.getElementById('team-name').value=name;
          document.getElementById('team-color').value=color;
          document.querySelectorAll('.cp-dot').forEach(d=>d.classList.toggle('selected',d.dataset.color===color));
          openModal('addTeam');
        }
        async function saveTeam(leagueId){
          const id=document.getElementById('team-edit-id').value;
          const body={name:document.getElementById('team-name').value,color:document.getElementById('team-color').value,league_id:leagueId};
          const r=await fetch(id?'/admin/api/team/'+id:'/admin/api/team',{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
          if(r.ok)location.reload();else{const e=await r.json();alert(e.error||'Error saving team');}
        }

        // ── Player CRUD ──
        function openEditPlayer(p){
          document.getElementById('player-modal-title').textContent='Edit Player';
          document.getElementById('p-edit-id').value=p.id;
          document.getElementById('p-name').value=p.name;
          document.getElementById('p-jersey').value=p.jersey;
          document.getElementById('p-team').value=p.team_id;
          document.getElementById('p-pos').value=p.pos;
          ['gp','pts','reb','ast','stl','blk','fg'].forEach(k=>document.getElementById('p-'+k).value=p[k]);
          openModal('addPlayer');
        }
        async function savePlayer(leagueId){
          const id=document.getElementById('p-edit-id').value;
          const body={
            league_id:leagueId,
            team_id:document.getElementById('p-team').value,
            name:document.getElementById('p-name').value,
            pos:document.getElementById('p-pos').value,
            jersey:document.getElementById('p-jersey').value||0,
            ...(Object.fromEntries(['gp','pts','reb','ast','stl','blk','fg'].map(k=>[k,document.getElementById('p-'+k).value||0])))
          };
          const r=await fetch(id?'/admin/api/player/'+id:'/admin/api/player',{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
          if(r.ok)location.reload();else{const e=await r.json();alert(e.error||'Error saving player');}
        }

        // ── Game CRUD ──
        function toggleScoreFields(){
          document.getElementById('score-fields').style.display=document.getElementById('g-status').value==='final'?'grid':'none';
        }
        async function saveGame(leagueId){
          const body={
            league_id:leagueId,
            home_team_id:document.getElementById('g-home').value||null,
            away_team_id:document.getElementById('g-away').value||null,
            date:document.getElementById('g-date').value||'TBD',
            venue:document.getElementById('g-venue').value||'TBD',
            status:document.getElementById('g-status').value,
            home_score:document.getElementById('g-hs').value||0,
            away_score:document.getElementById('g-as').value||0,
          };
          const r=await fetch('/admin/api/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
          if(r.ok)location.reload();else alert('Error saving game');
        }

        // ── Delete ──
        async function apiDelete(type,id){
          if(!confirm('Delete this '+type+'? This cannot be undone.'))return;
          const r=await fetch('/admin/api/'+type+'/'+id,{method:'DELETE'});
          if(r.ok)location.reload();else alert('Error deleting '+type);
        }

        // ── Live score ──
        const GAMES=${JSON.stringify(games)};
        let liveId=null,liveH=0,liveA=0,liveQ=1;

        function startLive(gameId){
          const g=GAMES.find(x=>x.id==gameId);
          if(!g)return;
          liveId=gameId; liveH=g.home_score||0; liveA=g.away_score||0; liveQ=1;
          document.getElementById('lv-home-name').textContent=g.home_name||'Home';
          document.getElementById('lv-away-name').textContent=g.away_name||'Away';
          document.getElementById('lv-home-score').textContent=liveH;
          document.getElementById('lv-away-score').textContent=liveA;
          document.getElementById('lv-qtr').textContent=liveQ;
          document.getElementById('live-select').style.display='none';
          document.getElementById('live-board').style.display='block';
        }
        function adj(side,val){
          if(side==='home'){liveH=Math.max(0,liveH+val);document.getElementById('lv-home-score').textContent=liveH;}
          else{liveA=Math.max(0,liveA+val);document.getElementById('lv-away-score').textContent=liveA;}
        }
        function adjQtr(v){liveQ=Math.max(1,Math.min(4,liveQ+v));document.getElementById('lv-qtr').textContent=liveQ;}
        function cancelLive(){
          document.getElementById('live-select').style.display='block';
          document.getElementById('live-board').style.display='none';
          liveId=null;
        }
        async function saveLive(){
          if(!liveId)return;
          const r=await fetch('/admin/api/game/'+liveId+'/score',{
            method:'PUT',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({home_score:liveH,away_score:liveA,status:'final'})
          });
          if(r.ok)location.reload();else alert('Error saving score');
        }
      </script>
    `));
  } catch (err) { console.error(err); res.status(500).send('Server error'); }
});

// ── PDF REPORT ────────────────────────────────────────────────────────────────
router.get('/league/:id/pdf', async (req, res) => {
  if (!isPro(req)) return res.redirect('/upgrade');
  try {
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
    if (!league || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');

    const [teams, players] = await Promise.all([
      db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC', [league.id]),
      db.query(`SELECT p.*,t.name as team_name FROM players p LEFT JOIN teams t ON p.team_id=t.id WHERE p.league_id=$1 ORDER BY p.pts DESC`, [league.id]),
    ]);

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${league.name.replace(/[^a-z0-9]/gi,'_')}_stats.pdf"`);
    doc.pipe(res);

    // Header block
    doc.rect(0,0,595,80).fill('#0f0f1a');
    doc.fillColor('#ff6b35').fontSize(22).font('Helvetica-Bold').text('PH HOOPS', 40, 18);
    doc.fillColor('#ffffff').fontSize(14).text(league.name, 40, 44);
    doc.fillColor('#888888').fontSize(10).text(`${league.location} · ${league.season} · ${league.level}`, 40, 62);

    // Standings
    let y = 100;
    doc.fillColor('#ff6b35').fontSize(13).font('Helvetica-Bold').text('TEAM STANDINGS', 40, y);
    doc.moveTo(40,y+16).lineTo(555,y+16).strokeColor('#ff6b35').lineWidth(1).stroke();
    y += 26;
    doc.fillColor('#888').fontSize(9).font('Helvetica-Bold')
      .text('#',40,y).text('TEAM',65,y).text('W',340,y).text('L',380,y).text('WIN%',415,y);
    y += 14;
    for (const [i,t] of teams.entries()) {
      if (i%2===0) doc.rect(40,y-2,515,17).fill('#0a0a12');
      const pct = ((t.wins/(t.wins+t.losses||1))*100).toFixed(1);
      doc.fillColor(i<2?'#ff6b35':'#ccc').fontSize(9).font('Helvetica-Bold').text(`${i+1}`,42,y);
      doc.fillColor('#fff').font('Helvetica').text(t.name,65,y,{width:260});
      doc.fillColor('#00d4aa').text(`${t.wins}`,340,y);
      doc.fillColor('#ff4757').text(`${t.losses}`,380,y);
      doc.fillColor('#aaa').text(`${pct}%`,415,y);
      y += 17;
    }

    // Player stats
    y += 18;
    if (y > 720) { doc.addPage(); y = 40; }
    doc.fillColor('#ff6b35').fontSize(13).font('Helvetica-Bold').text('PLAYER STATISTICS', 40, y);
    doc.moveTo(40,y+16).lineTo(555,y+16).strokeColor('#ff6b35').lineWidth(1).stroke();
    y += 26;
    doc.fillColor('#888').fontSize(8).font('Helvetica-Bold')
      .text('#',40,y).text('PLAYER',58,y).text('TEAM',195,y).text('POS',295,y)
      .text('PTS',330,y).text('REB',360,y).text('AST',390,y).text('STL',420,y).text('BLK',450,y).text('FG%',480,y);
    y += 14;
    for (const [i,p] of players.entries()) {
      if (y > 760) { doc.addPage(); y = 40; }
      if (i%2===0) doc.rect(40,y-2,515,16).fill('#0a0a12');
      doc.fillColor(i===0?'#ff6b35':'#888').fontSize(8).font('Helvetica-Bold').text(`${i+1}`,42,y);
      doc.fillColor('#fff').font('Helvetica').text(p.name,58,y,{width:130});
      doc.fillColor('#aaa').text((p.team_name||'').slice(0,20),195,y);
      doc.text(p.pos,295,y);
      doc.fillColor('#ff6b35').text(`${p.pts}`,330,y);
      doc.fillColor('#fff').text(`${p.reb}`,360,y).text(`${p.ast}`,390,y).text(`${p.stl}`,420,y).text(`${p.blk}`,450,y);
      doc.fillColor('#00d4aa').text(`${p.fg}%`,480,y);
      y += 16;
    }

    doc.fillColor('#444').fontSize(8).text(`Generated by PH Hoops · ${new Date().toLocaleDateString('en-PH')}`,40,800);
    doc.end();
  } catch (err) { console.error(err); res.status(500).send('Error generating PDF'); }
});

// ── BRACKET ───────────────────────────────────────────────────────────────────
router.get('/league/:id/bracket', async (req, res) => {
  if (!isPro(req)) return res.redirect('/upgrade');
  try {
    const league = await db.queryOne('SELECT * FROM leagues WHERE id=$1', [req.params.id]);
    if (!league || !await ownsLeague(req.params.id, req.user.id)) return res.redirect('/admin');
    const teams = await db.query('SELECT * FROM teams WHERE league_id=$1 ORDER BY wins DESC', [league.id]);

    res.send(adminPage(`Bracket — ${esc(league.name)}`, req.user, `
      <div class="admin-header">
        <div>
          <a href="/admin/league/${league.id}" class="back-link">← Back to League</a>
          <h1>🏆 Playoff Bracket</h1>
          <p>${esc(league.name)}</p>
        </div>
        <div class="ah-right">
          <button onclick="window.print()" class="btn-ghost-sm">🖨 Print</button>
        </div>
      </div>
      <div class="bracket-container">
        <div class="bracket-info">Single-elimination bracket for top ${Math.min(teams.length,8)} teams by standings.</div>
        <div id="bracket"></div>
      </div>
      <script>
        const teams=${JSON.stringify(teams.slice(0,8))};
        function buildBracket(ts){
          const n=Math.pow(2,Math.ceil(Math.log2(ts.length)));
          const seeded=[...ts];
          while(seeded.length<n)seeded.push(null);
          const rounds=Math.log2(n);
          const rnames=['Quarterfinals','Semifinals','Finals','Champion'];
          let matchups=[];
          for(let i=0;i<n/2;i++)matchups.push([seeded[i*2],seeded[i*2+1]]);
          const wrap=document.createElement('div');
          wrap.className='bracket-rounds';
          for(let r=0;r<rounds;r++){
            const rd=document.createElement('div');
            rd.className='bracket-round';
            rd.innerHTML='<div class="round-name">'+(rnames[r]||'Round '+(r+1))+'</div>';
            matchups.forEach(m=>{
              rd.innerHTML+='<div class="bracket-match">'
                +'<div class="bm-team'+(m[0]?'':' bye')+'">'+(m[0]?.name||'BYE')+'</div>'
                +'<div class="bm-vs">vs</div>'
                +'<div class="bm-team'+(m[1]?'':' bye')+'">'+(m[1]?.name||'BYE')+'</div>'
                +'</div>';
            });
            wrap.appendChild(rd);
            const next=[];
            for(let i=0;i<matchups.length;i+=2)next.push([null,null]);
            matchups=next.length?next:[[null,null]];
          }
          document.getElementById('bracket').appendChild(wrap);
        }
        teams.length>=2?buildBracket(teams):document.getElementById('bracket').innerHTML='<div class="empty-state">Need at least 2 teams.</div>';
      </script>
    `));
  } catch (err) { console.error(err); res.status(500).send('Error'); }
});

// ── REST API ──────────────────────────────────────────────────────────────────

// Teams
router.post('/api/team', async (req, res) => {
  try {
    const { name, color, league_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Team name required' });
    if (!await ownsLeague(league_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('INSERT INTO teams (league_id,name,color) VALUES ($1,$2,$3)', [league_id, name.trim(), color||'#e63946']);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/api/team/:id', async (req, res) => {
  try {
    const team = await db.queryOne('SELECT * FROM teams WHERE id=$1', [req.params.id]);
    if (!team || !await ownsLeague(team.league_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('UPDATE teams SET name=$1,color=$2 WHERE id=$3', [req.body.name, req.body.color, req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/api/team/:id', async (req, res) => {
  try {
    const team = await db.queryOne('SELECT * FROM teams WHERE id=$1', [req.params.id]);
    if (!team || !await ownsLeague(team.league_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM teams WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Players
router.post('/api/player', async (req, res) => {
  try {
    const { league_id, team_id, name, pos, jersey, gp, pts, reb, ast, stl, blk, fg } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Player name required' });
    if (!await ownsLeague(league_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    await db.run(
      'INSERT INTO players (league_id,team_id,name,pos,jersey,gp,pts,reb,ast,stl,blk,fg) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
      [league_id, team_id, name.trim(), pos, jersey||0, gp||0, pts||0, reb||0, ast||0, stl||0, blk||0, fg||0]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/api/player/:id', async (req, res) => {
  try {
    const player = await db.queryOne('SELECT * FROM players WHERE id=$1', [req.params.id]);
    if (!player || !await ownsLeague(player.league_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const { team_id, name, pos, jersey, gp, pts, reb, ast, stl, blk, fg } = req.body;
    await db.run(
      'UPDATE players SET team_id=$1,name=$2,pos=$3,jersey=$4,gp=$5,pts=$6,reb=$7,ast=$8,stl=$9,blk=$10,fg=$11 WHERE id=$12',
      [team_id, name, pos, jersey||0, gp||0, pts||0, reb||0, ast||0, stl||0, blk||0, fg||0, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/api/player/:id', async (req, res) => {
  try {
    const player = await db.queryOne('SELECT * FROM players WHERE id=$1', [req.params.id]);
    if (!player || !await ownsLeague(player.league_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM players WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Games
router.post('/api/game', async (req, res) => {
  try {
    const { league_id, home_team_id, away_team_id, home_score, away_score, date, venue, status } = req.body;
    if (!await ownsLeague(league_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    await db.run(
      'INSERT INTO games (league_id,home_team_id,away_team_id,home_score,away_score,date,venue,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [league_id, home_team_id||null, away_team_id||null, home_score||0, away_score||0, date||'TBD', venue||'TBD', status||'upcoming']
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.put('/api/game/:id/score', async (req, res) => {
  try {
    const game = await db.queryOne('SELECT * FROM games WHERE id=$1', [req.params.id]);
    if (!game || !await ownsLeague(game.league_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    const { home_score, away_score, status } = req.body;
    await db.run('UPDATE games SET home_score=$1,away_score=$2,status=$3 WHERE id=$4',
      [home_score, away_score, status, req.params.id]);
    if (status === 'final') {
      if (home_score > away_score) {
        if (game.home_team_id) await db.run('UPDATE teams SET wins=wins+1 WHERE id=$1', [game.home_team_id]);
        if (game.away_team_id) await db.run('UPDATE teams SET losses=losses+1 WHERE id=$1', [game.away_team_id]);
      } else {
        if (game.away_team_id) await db.run('UPDATE teams SET wins=wins+1 WHERE id=$1', [game.away_team_id]);
        if (game.home_team_id) await db.run('UPDATE teams SET losses=losses+1 WHERE id=$1', [game.home_team_id]);
      }
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/api/game/:id', async (req, res) => {
  try {
    const game = await db.queryOne('SELECT * FROM games WHERE id=$1', [req.params.id]);
    if (!game || !await ownsLeague(game.league_id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    await db.run('DELETE FROM games WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Leagues
router.post('/api/league', async (req, res) => {
  try {
    if (req.user.plan !== 'pro') {
      const count = (await db.queryOne('SELECT COUNT(*) as c FROM leagues WHERE user_id=$1', [req.user.id])).c;
      if (Number(count) >= FREE_LIMITS.leagues)
        return res.status(403).json({ error: `Free plan allows ${FREE_LIMITS.leagues} league. Upgrade to Pro.`, upgrade: true });
    }
    const { name, level, location, season, status, admin_code } = req.body;
    if (!name?.trim() || !admin_code?.trim()) return res.status(400).json({ error: 'Name and admin code required' });
    await db.run(
      'INSERT INTO leagues (user_id,name,level,location,season,status,admin_code,is_public) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [req.user.id, name.trim(), level||'Barangay', location||'', season||'', status||'upcoming', admin_code.trim(), true]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

router.delete('/api/league/:id', async (req, res) => {
  try {
    if (!await ownsLeague(req.params.id, req.user.id)) return res.status(403).json({ error: 'Forbidden' });
    // Cascade via FK, just delete the league
    await db.run('DELETE FROM leagues WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// ── SHARED HELPERS ────────────────────────────────────────────────────────────
function addLeagueModal(pro) {
  return `
  <div id="modal-addLeague" class="modal-back hidden">
    <div class="modal">
      <div class="modal-head"><h3>Create New League</h3><button onclick="closeModal('addLeague')" class="modal-close">✕</button></div>
      <div class="field-group"><label>League Name</label><input id="ln-name" class="input" placeholder="e.g. Brgy. Poblacion Summer Cup" /></div>
      <div class="field-group"><label>Level</label>
        <select id="ln-level" class="input">${LEVEL_OPTIONS.map(l=>`<option>${l}</option>`).join('')}</select>
      </div>
      <div class="field-group"><label>Location</label><input id="ln-loc" class="input" placeholder="e.g. Barangay Poblacion, Makati City" /></div>
      <div class="field-group"><label>Season / Tournament</label><input id="ln-season" class="input" placeholder="e.g. Summer 2025" /></div>
      <div class="field-group"><label>Status</label>
        <select id="ln-status" class="input"><option value="upcoming">Upcoming</option><option value="ongoing">Ongoing</option></select>
      </div>
      <div class="field-group"><label>Admin Code <span style="color:#555;font-size:11px">(share with scorers to give them access)</span></label>
        <input id="ln-code" class="input" placeholder="e.g. BRGY2025" />
      </div>
      ${!pro ? '<div class="alert-info">⚡ Free plan: 1 league max. <a href="/upgrade">Upgrade for unlimited →</a></div>' : ''}
      <div class="modal-actions">
        <button onclick="closeModal('addLeague')" class="btn-ghost">Cancel</button>
        <button onclick="saveLeague()" class="btn-primary">Create League</button>
      </div>
    </div>
  </div>
  <script>
    function openModal(id){document.getElementById('modal-'+id).classList.remove('hidden');}
    function closeModal(id){document.getElementById('modal-'+id).classList.add('hidden');}
    async function saveLeague(){
      const body={
        name:document.getElementById('ln-name').value,
        level:document.getElementById('ln-level').value,
        location:document.getElementById('ln-loc').value,
        season:document.getElementById('ln-season').value,
        status:document.getElementById('ln-status').value,
        admin_code:document.getElementById('ln-code').value,
      };
      const r=await fetch('/admin/api/league',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await r.json();
      if(data.upgrade){alert('Free plan limit reached. Upgrade to Pro for unlimited leagues.');return;}
      if(r.ok)location.reload();else alert(data.error||'Error creating league');
    }
  </script>`;
}

function adminPage(title, user, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | PH Hoops Admin</title>
<link rel="stylesheet" href="/css/main.css">
</head>
<body class="dark-bg">
<nav class="topnav">
  <div class="nav-brand"><a href="/" style="color:inherit;text-decoration:none">🏀 <span class="brand-text">PH HOOPS</span></a></div>
  <div class="nav-center" style="font-size:11px;color:#555;letter-spacing:2px;font-weight:700">ADMIN</div>
  <div class="nav-actions">
    <span style="font-size:13px;color:#888">${esc(user.name)}</span>
    ${user.plan==='pro'?'<span class="pro-badge">⚡ PRO</span>':'<a href="/upgrade" class="btn-upgrade-sm">Upgrade</a>'}
    <a href="/logout" class="btn-ghost-sm">Logout</a>
  </div>
</nav>
<div class="admin-wrap">${content}</div>
</body>
</html>`;
}

module.exports = router;
