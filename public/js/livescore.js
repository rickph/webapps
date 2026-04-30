/**
 * PH Hoops Live Scoreboard — FIBA Statistics 2024
 * Stats per FIBA Statisticians Manual 2024
 * EFF = PTS + REB + AST + STL + BLK – (FGA–FGM) – (FTA–FTM) – TO
 */

document.addEventListener('DOMContentLoaded', function () {

  // ── STATE ──────────────────────────────────────────────────────────────────
  var currentPid  = null;
  var playerStats = {};
  var homeScore   = parseInt(document.getElementById('sb-home-score').textContent) || 0;
  var awayScore   = parseInt(document.getElementById('sb-away-score').textContent) || 0;
  var quarter     = parseInt(document.getElementById('sb-qtr').textContent) || 1;
  var serverStats = (window.LSC_DATA && window.LSC_DATA.stats) || {};

  // FIBA stat keys tracked per player per game
  var STAT_KEYS = ['fg2m','fg2a','fg3m','fg3a','ftm','fta','oreb','dreb','ast','stl','blk','to','foul'];

  // Init playerStats from DOM data attributes
  document.querySelectorAll('.lsc-player').forEach(function (el) {
    var pid = el.getAttribute('data-pid');
    var sv  = serverStats[pid] || {};
    playerStats[pid] = {
      fg2m:  parseInt(sv.fg2m)  || 0,
      fg2a:  parseInt(sv.fg2a)  || 0,
      fg3m:  parseInt(sv.fg3m)  || 0,
      fg3a:  parseInt(sv.fg3a)  || 0,
      ftm:   parseInt(sv.ftm)   || 0,
      fta:   parseInt(sv.fta)   || 0,
      oreb:  parseInt(sv.oreb)  || 0,
      dreb:  parseInt(sv.dreb)  || 0,
      ast:   parseInt(sv.ast)   || 0,
      stl:   parseInt(sv.stl)   || 0,
      blk:   parseInt(sv.blk)   || 0,
      to:    parseInt(sv.to_val)|| 0,
      foul:  parseInt(sv.foul)  || 0,
    };
  });

  // ── FIBA COMPUTED STATS ────────────────────────────────────────────────────
  function computeFIBA(s) {
    var fgm  = (s.fg2m + s.fg3m);
    var fga  = (s.fg2a + s.fg3a);
    var pts  = (s.fg2m * 2) + (s.fg3m * 3) + s.ftm;
    var reb  = s.oreb + s.dreb;
    // FIBA EFF = PTS + REB + AST + STL + BLK – missed FG – missed FT – TO
    var eff  = pts + reb + s.ast + s.stl + s.blk
               - (fga - fgm) - (s.fta - s.ftm) - s.to;
    var fgp  = fga  > 0 ? ((fgm  / fga)  * 100).toFixed(1) : '—';
    var fg3p = s.fg3a > 0 ? ((s.fg3m / s.fg3a) * 100).toFixed(1) : '—';
    var ftp  = s.fta > 0 ? ((s.ftm  / s.fta)  * 100).toFixed(1) : '—';
    return { pts, reb, fgm, fga, eff, fgp, fg3p, ftp };
  }

  // ── PLAYER SELECTION ───────────────────────────────────────────────────────
  document.querySelectorAll('.lsc-player').forEach(function (el) {
    el.addEventListener('click', function () {
      document.querySelectorAll('.lsc-player').forEach(function (p) {
        p.classList.remove('active');
      });
      el.classList.add('active');
      currentPid = el.getAttribute('data-pid');
      loadPlayerPanel(el);
    });
  });

  function loadPlayerPanel(el) {
    var pid    = el.getAttribute('data-pid');
    var name   = el.getAttribute('data-name');
    var pos    = el.getAttribute('data-pos');
    var jersey = el.getAttribute('data-jersey');
    var s      = playerStats[pid];
    var c      = computeFIBA(s);

    document.getElementById('noPlayerMsg').style.display  = 'none';
    document.getElementById('playerPanel').style.display  = 'block';
    document.getElementById('pp-name').textContent        = name;
    document.getElementById('pp-sub').textContent         = pos + ' · #' + (jersey || '—');
    document.getElementById('pp-recording').textContent   = name.toUpperCase();

    refreshPanel(pid);
  }

  function refreshPanel(pid) {
    if (pid !== currentPid) return;
    var s = playerStats[pid];
    var c = computeFIBA(s);

    // Scoring
    document.getElementById('pp-pts').textContent  = c.pts;
    document.getElementById('pp-eff').textContent  = c.eff;
    document.getElementById('pp-fgp').textContent  = c.fgp;
    document.getElementById('pp-fg3p').textContent = c.fg3p;
    document.getElementById('pp-ftp').textContent  = c.ftp;

    // Box stats
    ['oreb','dreb','ast','stl','blk','to','foul'].forEach(function(k) {
      var el = document.getElementById('pp-'+k);
      if (el) el.textContent = s[k];
    });

    // Shooting line
    document.getElementById('pp-fg-line').textContent =
      s.fg2m+'/'+s.fg2a+' 2PT   '+s.fg3m+'/'+s.fg3a+' 3PT   '+s.ftm+'/'+s.fta+' FT';

    // Update player list pts
    var listEl = document.querySelector('.lsc-player[data-pid="'+pid+'"]');
    if (listEl) listEl.querySelector('.lsc-player-pts').textContent = c.pts;
  }

  // ── TEAM SCORE HELPER ─────────────────────────────────────────────────────
  function addTeamScore(pid, pts) {
    var el = document.querySelector('.lsc-player[data-pid="'+pid+'"]');
    if (!el) return;
    var team = el.getAttribute('data-team');
    if (team === (window.LSC_DATA && window.LSC_DATA.homeTeam)) {
      homeScore = Math.max(0, homeScore + pts);
      document.getElementById('sb-home-score').textContent = homeScore;
    } else {
      awayScore = Math.max(0, awayScore + pts);
      document.getElementById('sb-away-score').textContent = awayScore;
    }
    document.getElementById('f-home-score').value = homeScore;
    document.getElementById('f-away-score').value = awayScore;
  }

  function adj(pid, key, delta) {
    if (!pid || !playerStats[pid]) return;
    playerStats[pid][key] = Math.max(0, (playerStats[pid][key] || 0) + delta);
    refreshPanel(pid);
  }

  // ── SHOT BUTTONS ───────────────────────────────────────────────────────────
  function onBtn(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  // +2PT (FGA + FGM both)
  onBtn('btn-2pt', function() {
    if (!currentPid) return;
    adj(currentPid, 'fg2m', 1); adj(currentPid, 'fg2a', 1);
    addTeamScore(currentPid, 2);
  });
  onBtn('btn-2pt-minus', function() {
    if (!currentPid) return;
    adj(currentPid, 'fg2m', -1); adj(currentPid, 'fg2a', -1);
    addTeamScore(currentPid, -2);
  });

  // Miss 2PT (FGA only — FIBA: missed shot still records FGA)
  onBtn('btn-miss2', function() {
    if (!currentPid) return;
    adj(currentPid, 'fg2a', 1);
  });
  onBtn('btn-miss2-minus', function() {
    if (!currentPid) return;
    adj(currentPid, 'fg2a', -1);
  });

  // +3PT
  onBtn('btn-3pt', function() {
    if (!currentPid) return;
    adj(currentPid, 'fg3m', 1); adj(currentPid, 'fg3a', 1);
    addTeamScore(currentPid, 3);
  });
  onBtn('btn-3pt-minus', function() {
    if (!currentPid) return;
    adj(currentPid, 'fg3m', -1); adj(currentPid, 'fg3a', -1);
    addTeamScore(currentPid, -3);
  });

  // Miss 3PT
  onBtn('btn-miss3', function() {
    if (!currentPid) return;
    adj(currentPid, 'fg3a', 1);
  });
  onBtn('btn-miss3-minus', function() {
    if (!currentPid) return;
    adj(currentPid, 'fg3a', -1);
  });

  // +1 FT (Free throw made)
  onBtn('btn-ft', function() {
    if (!currentPid) return;
    adj(currentPid, 'ftm', 1); adj(currentPid, 'fta', 1);
    addTeamScore(currentPid, 1);
  });
  onBtn('btn-ft-minus', function() {
    if (!currentPid) return;
    adj(currentPid, 'ftm', -1); adj(currentPid, 'fta', -1);
    addTeamScore(currentPid, -1);
  });

  // Miss FT (FTA only — FIBA: missed free throw still records FTA)
  onBtn('btn-missft', function() {
    if (!currentPid) return;
    adj(currentPid, 'fta', 1);
  });
  onBtn('btn-missft-minus', function() {
    if (!currentPid) return;
    adj(currentPid, 'fta', -1);
  });

  // ── STAT COUNTER BUTTONS (+/−) ─────────────────────────────────────────────
  document.querySelectorAll('.lsc-stat-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!currentPid) return;
      var stat = btn.getAttribute('data-stat');
      var dir  = parseInt(btn.getAttribute('data-dir'));
      adj(currentPid, stat, dir);
    });
  });

  // ── QUARTER CONTROLS ───────────────────────────────────────────────────────
  onBtn('qtrMinus', function() {
    quarter = Math.max(1, quarter - 1);
    document.getElementById('sb-qtr').textContent = quarter;
    document.getElementById('f-quarter').value = quarter;
  });
  onBtn('qtrPlus', function() {
    quarter = Math.min(4, quarter + 1);
    document.getElementById('sb-qtr').textContent = quarter;
    document.getElementById('f-quarter').value = quarter;
  });

  // ── FORM SUBMISSION ────────────────────────────────────────────────────────
  function buildAndSubmit(saveType) {
    var fieldsDiv = document.getElementById('f-player-fields');
    fieldsDiv.innerHTML = '';

    Object.keys(playerStats).forEach(function (pid) {
      var s = playerStats[pid];
      // FIBA field names
      var fields = {
        fg2m: s.fg2m, fg2a: s.fg2a,
        fg3m: s.fg3m, fg3a: s.fg3a,
        ftm:  s.ftm,  fta:  s.fta,
        oreb: s.oreb, dreb: s.dreb,
        ast:  s.ast,  stl:  s.stl,
        blk:  s.blk,  to:   s.to,
        foul: s.foul,
      };
      Object.keys(fields).forEach(function (key) {
        var inp  = document.createElement('input');
        inp.type  = 'hidden';
        inp.name  = key + '_' + pid;
        inp.value = fields[key] || 0;
        fieldsDiv.appendChild(inp);
      });
    });

    document.getElementById('f-save-type').value = saveType;
    document.getElementById('f-status').value    = saveType === 'final' ? 'final' : 'ongoing';
    document.getElementById('scoreForm').submit();
  }

  onBtn('saveProgressBtn', function() { buildAndSubmit('save'); });
  onBtn('endGameBtn', function() {
    if (confirm('End this game and mark as FINAL?\nThis will update standings and player season averages.')) {
      buildAndSubmit('final');
    }
  });

});
