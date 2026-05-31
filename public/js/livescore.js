// HoopStats Pilipinas — Live Scorer JS

document.addEventListener('DOMContentLoaded', function () {

  var currentPid  = null;
  var playerStats = {};
  var homeScore   = parseInt(document.getElementById('sb-home-score').textContent) || 0;
  var awayScore   = parseInt(document.getElementById('sb-away-score').textContent) || 0;
  var quarter     = parseInt(document.getElementById('sb-qtr').textContent) || 1;

  // ── INIT: load existing stats ───────────────────────────────────────────────
  document.querySelectorAll('.lsc-player').forEach(function (el) {
    var pid = el.getAttribute('data-pid');
    playerStats[pid] = {
      fg2m: +el.dataset.fg2m || 0, fg2a: +el.dataset.fg2a || 0,
      fg3m: +el.dataset.fg3m || 0, fg3a: +el.dataset.fg3a || 0,
      ftm:  +el.dataset.ftm  || 0, fta:  +el.dataset.fta  || 0,
      oreb: +el.dataset.oreb || 0, dreb: +el.dataset.dreb || 0,
      ast:  +el.dataset.ast  || 0, stl:  +el.dataset.stl  || 0,
      blk:  +el.dataset.blk  || 0, to:   +el.dataset.to   || 0,
      foul: +el.dataset.foul || 0,
    };
    refreshPlayerRow(pid);
  });

  // ── FIBA COMPUTE ─────────────────────────────────────────────────────────────
  function compute(s) {
    var fgm = s.fg2m + s.fg3m;
    var fga = s.fg2a + s.fg3a;
    var pts = s.fg2m * 2 + s.fg3m * 3 + s.ftm;
    var reb = s.oreb + s.dreb;
    var eff = pts + reb + s.ast + s.stl + s.blk - (fga - fgm) - (s.fta - s.ftm) - s.to;
    var fgp = fga > 0 ? (fgm / fga * 100).toFixed(1) + '%' : '—';
    return { pts: pts, reb: reb, eff: eff, fgp: fgp, fgm: fgm, fga: fga };
  }

  // ── REFRESH PLAYER ROW PTS ───────────────────────────────────────────────────
  function refreshPlayerRow(pid) {
    var el = document.querySelector('.lsc-player[data-pid="' + pid + '"]');
    if (!el || !playerStats[pid]) return;
    var c = compute(playerStats[pid]);
    var pts = el.querySelector('.lsc-player-pts');
    if (pts) pts.textContent = c.pts;
  }

  // ── REFRESH STAT PANEL ───────────────────────────────────────────────────────
  function refreshPanel() {
    if (!currentPid || !playerStats[currentPid]) return;
    var s = playerStats[currentPid];
    var c = compute(s);

    document.getElementById('pp-pts').textContent  = c.pts;
    document.getElementById('pp-eff').textContent  = c.eff;
    document.getElementById('pp-fgp').textContent  = c.fgp;
    document.getElementById('pp-oreb').textContent = s.oreb;
    document.getElementById('pp-dreb').textContent = s.dreb;
    document.getElementById('pp-ast').textContent  = s.ast;
    document.getElementById('pp-stl').textContent  = s.stl;
    document.getElementById('pp-blk').textContent  = s.blk;
    document.getElementById('pp-to').textContent   = s.to;
    document.getElementById('pp-foul').textContent = s.foul;
    document.getElementById('pp-fg-line').textContent =
      s.fg2m + '/' + s.fg2a + ' 2PT  ·  ' +
      s.fg3m + '/' + s.fg3a + ' 3PT  ·  ' +
      s.ftm  + '/' + s.fta  + ' FT';
    refreshPlayerRow(currentPid);
  }

  // ── SELECT PLAYER ────────────────────────────────────────────────────────────
  document.querySelectorAll('.lsc-player').forEach(function (el) {
    el.addEventListener('click', function () {
      document.querySelectorAll('.lsc-player').forEach(function (p) { p.classList.remove('active'); });
      el.classList.add('active');

      currentPid = el.getAttribute('data-pid');
      var name   = el.dataset.name || '—';
      var pos    = el.dataset.pos  || '';
      var jersey = el.dataset.jersey || '';
      var team   = el.dataset.team || '';
      var color  = el.dataset.color || '#e63329';

      document.getElementById('pp-name').textContent = name;
      document.getElementById('pp-sub').textContent  = (pos ? pos + ' · ' : '') + (jersey ? '#' + jersey : '');
      document.getElementById('pp-recording').textContent = name.toUpperCase();
      document.getElementById('pp-recording').style.color = color;

      document.getElementById('noPlayerMsg').style.display  = 'none';
      document.getElementById('playerPanel').style.display  = 'block';

      refreshPanel();
    });
  });

  // ── SHOT BUTTONS ─────────────────────────────────────────────────────────────
  function shotBtn(id, action) {
    var btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!currentPid) return;
      var s = playerStats[currentPid];
      action(s);
      refreshPanel();
      refreshScoreboard();
    });
  }

  function isHome(pid) {
    var el = document.querySelector('.lsc-player[data-pid="' + pid + '"]');
    if (!el) return false;
    var team = el.dataset.team || '';
    var homeTeam = (window.LSC_DATA && window.LSC_DATA.homeTeam) || '';
    return team === homeTeam;
  }

  function addScore(pts) {
    if (!currentPid) return;
    if (isHome(currentPid)) { homeScore = Math.max(0, homeScore + pts); }
    else { awayScore = Math.max(0, awayScore + pts); }
    refreshScoreboard();
  }

  function subScore(pts) {
    if (!currentPid) return;
    if (isHome(currentPid)) { homeScore = Math.max(0, homeScore - pts); }
    else { awayScore = Math.max(0, awayScore - pts); }
    refreshScoreboard();
  }

  shotBtn('btn-2pt',        function(s){ s.fg2m++; s.fg2a++; addScore(2); });
  shotBtn('btn-2pt-minus',  function(s){ if(s.fg2m>0){s.fg2m--;s.fg2a--;subScore(2);} else if(s.fg2a>0){s.fg2a--;} });
  shotBtn('btn-miss2',      function(s){ s.fg2a++; });
  shotBtn('btn-miss2-minus',function(s){ if(s.fg2a>s.fg2m) s.fg2a--; });
  shotBtn('btn-3pt',        function(s){ s.fg3m++; s.fg3a++; addScore(3); });
  shotBtn('btn-3pt-minus',  function(s){ if(s.fg3m>0){s.fg3m--;s.fg3a--;subScore(3);} else if(s.fg3a>0){s.fg3a--;} });
  shotBtn('btn-miss3',      function(s){ s.fg3a++; });
  shotBtn('btn-miss3-minus',function(s){ if(s.fg3a>s.fg3m) s.fg3a--; });
  shotBtn('btn-ft',         function(s){ s.ftm++;  s.fta++;  addScore(1); });
  shotBtn('btn-ft-minus',   function(s){ if(s.ftm>0){s.ftm--;s.fta--;subScore(1);} else if(s.fta>0){s.fta--;} });
  shotBtn('btn-missft',     function(s){ s.fta++; });
  shotBtn('btn-missft-minus',function(s){ if(s.fta>s.ftm) s.fta--; });

  // ── COUNTING STAT BUTTONS ─────────────────────────────────────────────────────
  document.querySelectorAll('.lsc-cnt-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!currentPid) return;
      var stat = btn.getAttribute('data-stat');
      var dir  = parseInt(btn.getAttribute('data-dir'));
      var s    = playerStats[currentPid];
      if (dir === -1 && s[stat] <= 0) return;
      s[stat] = Math.max(0, (s[stat] || 0) + dir);
      refreshPanel();
    });
  });

  // ── QUARTER BUTTONS ──────────────────────────────────────────────────────────
  document.getElementById('qtr-plus').addEventListener('click', function () {
    quarter = Math.min(8, quarter + 1);
    document.getElementById('sb-qtr').textContent = quarter;
    document.getElementById('f-quarter').value = quarter;
  });
  document.getElementById('qtr-minus').addEventListener('click', function () {
    quarter = Math.max(1, quarter - 1);
    document.getElementById('sb-qtr').textContent = quarter;
    document.getElementById('f-quarter').value = quarter;
  });

  // ── REFRESH SCOREBOARD ────────────────────────────────────────────────────────
  function refreshScoreboard() {
    document.getElementById('sb-home-score').textContent = homeScore;
    document.getElementById('sb-away-score').textContent = awayScore;
    document.getElementById('f-home-score').value = homeScore;
    document.getElementById('f-away-score').value = awayScore;
  }

  // ── BUILD FORM & SUBMIT ───────────────────────────────────────────────────────
  function buildAndSubmit(saveType) {
    var fFields = document.getElementById('f-player-fields');
    fFields.innerHTML = '';
    Object.keys(playerStats).forEach(function (pid) {
      var s = playerStats[pid];
      var fields = ['fg2m','fg2a','fg3m','fg3a','ftm','fta','oreb','dreb','ast','stl','blk','to','foul'];
      fields.forEach(function (k) {
        var inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = k + '_' + pid;
        inp.value = s[k] || 0;
        fFields.appendChild(inp);
      });
    });
    document.getElementById('f-save-type').value = saveType;
    document.getElementById('f-status').value = saveType === 'final' ? 'final' : 'ongoing';
    document.getElementById('scoreForm').submit();
  }

  document.getElementById('btn-save').addEventListener('click', function () {
    buildAndSubmit('save');
  });

  document.getElementById('btn-end').addEventListener('click', function () {
    if (confirm('End this game and mark it as Final?')) {
      buildAndSubmit('final');
    }
  });

}); // end DOMContentLoaded

// ── JERSEY SEARCH ─────────────────────────────────────────────────────────────
(function () {
  var searchInput = document.getElementById('playerSearch');
  if (!searchInput) return;

  searchInput.addEventListener('input', function () {
    var q = searchInput.value.trim().toLowerCase();
    var players = document.querySelectorAll('.lsc-player');
    var firstMatch = null;

    players.forEach(function (el) {
      var jersey = (el.dataset.jersey || '').toLowerCase();
      var name   = (el.dataset.name   || '').toLowerCase();

      // Match if jersey starts with query OR name contains query
      var matches = !q || jersey.startsWith(q) || name.includes(q);
      el.classList.toggle('hidden-search', !matches);
      if (matches && !firstMatch) firstMatch = el;
    });

    // Auto-select if exactly one player matches jersey number
    if (q && firstMatch) {
      var visiblePlayers = Array.from(players).filter(function (el) {
        return !el.classList.contains('hidden-search');
      });
      if (visiblePlayers.length === 1) {
        visiblePlayers[0].click();
      }
    }
  });

  // Clear search and re-show all when a player is clicked
  document.querySelectorAll('.lsc-player').forEach(function (el) {
    el.addEventListener('click', function () {
      // Don't clear — let user keep searching if they want
      // Just highlight matched state
    });
  });

  // Press Escape to clear search
  searchInput.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      searchInput.value = '';
      document.querySelectorAll('.lsc-player').forEach(function (el) {
        el.classList.remove('hidden-search');
      });
    }
  });
})();
