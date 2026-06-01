// HoopStats Pilipinas — Live Scorer v3.1

document.addEventListener('DOMContentLoaded', function () {

  var currentPid  = null;
  var playerStats = {};
  var homeScore   = parseInt(document.getElementById('sb-home-score').textContent) || 0;
  var awayScore   = parseInt(document.getElementById('sb-away-score').textContent) || 0;
  var quarter     = parseInt(document.getElementById('sb-qtr').textContent) || 1;
  var pbpLog      = [];
  var undoStack   = [];

  var homeTeam  = window.LSC_DATA ? window.LSC_DATA.homeTeam  : '';
  var homeColor = window.LSC_DATA ? window.LSC_DATA.homeColor : '#e63329';
  var awayColor = window.LSC_DATA ? window.LSC_DATA.awayColor : '#457b9d';

  // ── INIT ─────────────────────────────────────────────────────────────────────
  document.querySelectorAll('.lsc-player').forEach(function (el) {
    var pid = el.getAttribute('data-pid');
    playerStats[pid] = {
      fg2m:+el.dataset.fg2m||0, fg2a:+el.dataset.fg2a||0,
      fg3m:+el.dataset.fg3m||0, fg3a:+el.dataset.fg3a||0,
      ftm: +el.dataset.ftm ||0, fta: +el.dataset.fta ||0,
      oreb:+el.dataset.oreb||0, dreb:+el.dataset.dreb||0,
      ast: +el.dataset.ast ||0, stl: +el.dataset.stl ||0,
      blk: +el.dataset.blk ||0, to:  +el.dataset.to  ||0,
      foul:+el.dataset.foul||0,
    };
    refreshRow(pid);
  });

  // ── HELPERS ──────────────────────────────────────────────────────────────────
  function compute(s) {
    var fgm = (s.fg2m||0) + (s.fg3m||0);
    var fga = (s.fg2a||0) + (s.fg3a||0);
    var pts = (s.fg2m||0)*2 + (s.fg3m||0)*3 + (s.ftm||0);
    var reb = (s.oreb||0) + (s.dreb||0);
    var eff = pts + reb + (s.ast||0) + (s.stl||0) + (s.blk||0) - (fga-fgm) - ((s.fta||0)-(s.ftm||0)) - (s.to||0);
    var fgp = fga > 0 ? (fgm/fga*100).toFixed(1)+'%' : '—';
    return { pts:pts, reb:reb, eff:eff, fgp:fgp, fgm:fgm, fga:fga };
  }

  function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function isHome(pid) {
    var el = document.querySelector('.lsc-player[data-pid="'+(pid||currentPid)+'"]');
    return el && el.dataset.team === homeTeam;
  }

  // ── ROW REFRESH ──────────────────────────────────────────────────────────────
  function refreshRow(pid) {
    var el  = document.getElementById('row-pts-'+pid);
    var s   = playerStats[pid];
    if (el && s) el.textContent = compute(s).pts;
  }

  // ── SCOREBOARD ───────────────────────────────────────────────────────────────
  function refreshScoreboard() {
    setText('sb-home-score', homeScore);
    setText('sb-away-score', awayScore);
    setText('mini-home', homeScore);
    setText('mini-away', awayScore);
    document.getElementById('f-home-score').value = homeScore;
    document.getElementById('f-away-score').value = awayScore;
  }

  function addScore(pid, n) {
    if (isHome(pid)) homeScore = Math.max(0, homeScore + n);
    else             awayScore = Math.max(0, awayScore + n);
    refreshScoreboard();
  }

  function subScore(pid, n) {
    if (isHome(pid)) homeScore = Math.max(0, homeScore - n);
    else             awayScore = Math.max(0, awayScore - n);
    refreshScoreboard();
  }

  // ── PANEL REFRESH ────────────────────────────────────────────────────────────
  function refreshPanel() {
    if (!currentPid || !playerStats[currentPid]) return;
    var s = playerStats[currentPid];
    var c = compute(s);

    setText('pp-pts',   c.pts);
    setText('pp-eff',   c.eff);
    setText('pp-fgp',   c.fgp);
    setText('pp-oreb',  s.oreb);
    setText('pp-dreb',  s.dreb);
    setText('pp-ast',   s.ast);
    setText('pp-stl',   s.stl);
    setText('pp-blk',   s.blk);
    setText('pp-to',    s.to);
    setText('pp-foul',  s.foul);
    setText('pp-fg-line',
      (s.fg2m||0)+'/'+(s.fg2a||0)+' 2PT  ·  '+(s.fg3m||0)+'/'+(s.fg3a||0)+' 3PT  ·  '+(s.ftm||0)+'/'+(s.fta||0)+' FT');

    // Right mini panel
    setText('rp-pts', c.pts);
    setText('rp-reb', c.reb);
    setText('rp-ast', s.ast);
    setText('rp-stl', s.stl);
    setText('rp-blk', s.blk);

    refreshRow(currentPid);
    refreshBoxScore();
    refreshLeaders();
    refreshTeamTotals();
  }

  // ── SELECT PLAYER ────────────────────────────────────────────────────────────
  document.querySelectorAll('.lsc-player').forEach(function (el) {
    el.addEventListener('click', function () {
      document.querySelectorAll('.lsc-player').forEach(function(p){ p.classList.remove('active'); });
      el.classList.add('active');
      currentPid = el.getAttribute('data-pid');

      var name   = el.dataset.name   || '—';
      var pos    = el.dataset.pos    || '';
      var jersey = el.dataset.jersey || '?';
      var color  = el.dataset.color  || '#e63329';

      setText('pp-name', name);
      setText('pp-sub',  (pos ? pos+' · ' : '') + '#'+jersey);
      var rec = document.getElementById('pp-recording');
      if (rec) { rec.textContent = name.toUpperCase(); rec.style.color = color; }

      document.getElementById('noPlayerMsg').style.display  = 'none';
      document.getElementById('playerPanel').style.display  = 'block';
      var rpp = document.getElementById('rightPlayerPanel');
      if (rpp) rpp.style.display = 'block';

      setText('rp-name', name);
      setText('rp-role', (pos ? pos+' · ' : '') + '#'+jersey);

      refreshPanel();
    });
  });

  // ── CORE ACTION: saves snapshot BEFORE mutation so undo restores correctly ───
  function doAction(modFn, scoreDelta, label, badge, badgeClass) {
    if (!currentPid) return;
    var s = playerStats[currentPid];

    // Snapshot BEFORE mutation
    var snapshot = JSON.parse(JSON.stringify(s));
    var scoreSnapshot = { home: homeScore, away: awayScore };

    // Apply mutation
    modFn(s);

    // Apply score change (use currentPid captured now)
    var pid = currentPid;
    if (scoreDelta > 0) addScore(pid, scoreDelta);
    else if (scoreDelta < 0) subScore(pid, -scoreDelta);

    // Push undo entry (restores to BEFORE state)
    undoStack.push({
      pid: pid,
      snapshot: snapshot,
      homeScore: scoreSnapshot.home,
      awayScore: scoreSnapshot.away,
      label: label
    });

    if (label) logPlay(pid, label, badge, badgeClass);
    refreshPanel();
  }

  // ── PLAY BY PLAY LOG ─────────────────────────────────────────────────────────
  function logPlay(pid, action, badge, badgeClass) {
    var el    = document.querySelector('.lsc-player[data-pid="'+pid+'"]');
    var name  = el ? el.dataset.name   : '—';
    var num   = el ? el.dataset.jersey : '?';
    var color = el ? el.dataset.color  : '#888';
    pbpLog.unshift({ qtr:quarter, pid:pid, name:name, num:num, action:action, badge:badge, badgeClass:badgeClass||'', color:color });
    renderPBP();
  }

  function renderPBP() {
    function makeEntry(e, compact) {
      return '<div class="ls-pbp-entry" style="'+(compact?'padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)':'')+'">' +
        '<div class="ls-pbp-time">Q'+e.qtr+'</div>' +
        '<div class="ls-pbp-num" style="background:'+e.color+'99;'+(compact?'width:22px;height:22px;font-size:10px;border-radius:5px':'')+'">'+e.num+'</div>' +
        '<div class="ls-pbp-text" style="'+(compact?'font-size:11px':'')+'"><b>'+e.name+'</b> — '+e.action+'</div>' +
        (e.badge ? '<div class="ls-pbp-badge '+e.badgeClass+'" style="'+(compact?'font-size:10px':'')+'">'+e.badge+'</div>' : '') +
        '</div>';
    }

    var full = document.getElementById('pbpLog');
    if (full) {
      full.innerHTML = pbpLog.length
        ? pbpLog.slice(0,50).map(function(e){ return makeEntry(e,false); }).join('')
        : '<div style="padding:24px;color:rgba(255,255,255,.25);font-size:13px;text-align:center">No plays recorded yet — select a player and start recording</div>';
    }

    var mini = document.getElementById('miniPbpLog');
    if (mini) {
      mini.innerHTML = pbpLog.slice(0,6).map(function(e){ return makeEntry(e,true); }).join('');
    }
  }

  // ── UNDO ─────────────────────────────────────────────────────────────────────
  var undoBtn = document.getElementById('btn-undo');
  if (undoBtn) {
    undoBtn.addEventListener('click', function () {
      if (!undoStack.length) {
        undoBtn.textContent = '↩ Nothing to undo';
        setTimeout(function(){ undoBtn.textContent = '↩ UNDO LAST ACTION'; }, 1500);
        return;
      }
      var last = undoStack.pop();

      // Restore player stats to pre-action snapshot
      playerStats[last.pid] = last.snapshot;

      // Restore scoreboard
      homeScore = last.homeScore;
      awayScore = last.awayScore;
      refreshScoreboard();

      // Remove last PBP entry
      if (pbpLog.length) pbpLog.shift();
      renderPBP();

      // Visual feedback
      undoBtn.textContent = '↩ Undone: '+last.label;
      setTimeout(function(){ undoBtn.textContent = '↩ UNDO LAST ACTION'; }, 1500);

      refreshRow(last.pid);
      if (last.pid === currentPid) refreshPanel();
    });
  }

  // ── SHOT BUTTONS ─────────────────────────────────────────────────────────────
  function wire(id, fn) { var el=document.getElementById(id); if(el) el.addEventListener('click',fn); }

  wire('btn-2pt',    function(){ doAction(function(s){s.fg2m++;s.fg2a++;},  2, 'Made 2PT',   '+2', 'pos'); });
  wire('btn-miss2',  function(){ doAction(function(s){s.fg2a++;},           0, 'Miss 2PT',   'Miss','neg'); });
  wire('btn-3pt',    function(){ doAction(function(s){s.fg3m++;s.fg3a++;},  3, 'Made 3PT',   '+3', 'pos'); });
  wire('btn-miss3',  function(){ doAction(function(s){s.fg3a++;},           0, 'Miss 3PT',   'Miss','neg'); });
  wire('btn-ft',     function(){ doAction(function(s){s.ftm++; s.fta++;},   1, 'Free Throw', '+1', 'pos'); });
  wire('btn-missft', function(){ doAction(function(s){s.fta++;},            0, 'Miss FT',    'Miss','neg'); });

  // ── COUNTING STAT BUTTONS ─────────────────────────────────────────────────────
  var statLabels = {oreb:'Off Rebound',dreb:'Def Rebound',ast:'Assist',stl:'Steal',blk:'Block',to:'Turnover',foul:'Foul'};

  document.querySelectorAll('.ls-cnt-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!currentPid) return;
      var stat = btn.getAttribute('data-stat');
      var dir  = parseInt(btn.getAttribute('data-dir'));
      var s    = playerStats[currentPid];
      if (dir === -1 && (s[stat]||0) <= 0) return;

      // Snapshot before
      var snapshot    = JSON.parse(JSON.stringify(s));
      var scoreSnap   = { home: homeScore, away: awayScore };
      var pid         = currentPid;

      s[stat] = Math.max(0, (s[stat]||0) + dir);

      if (dir === 1 && statLabels[stat]) {
        undoStack.push({ pid:pid, snapshot:snapshot, homeScore:scoreSnap.home, awayScore:scoreSnap.away, label:statLabels[stat] });
        logPlay(pid, statLabels[stat], '', '');
      }
      refreshPanel();
    });
  });

  // ── RIGHT PANEL MINI SHOTS ────────────────────────────────────────────────────
  document.querySelectorAll('.ls-rp-shot').forEach(function(btn){
    btn.addEventListener('click', function(){
      var a = btn.getAttribute('data-action');
      if (!currentPid) return;
      var map = {
        '2pt':   [function(s){s.fg2m++;s.fg2a++;},  2, 'Made 2PT',  '+2', 'pos'],
        '3pt':   [function(s){s.fg3m++;s.fg3a++;},  3, 'Made 3PT',  '+3', 'pos'],
        'ft':    [function(s){s.ftm++;s.fta++;},     1, 'Free Throw','+1', 'pos'],
        'miss2': [function(s){s.fg2a++;},            0, 'Miss 2PT',  'Miss','neg'],
        'miss3': [function(s){s.fg3a++;},            0, 'Miss 3PT',  'Miss','neg'],
        'missft':[function(s){s.fta++;},             0, 'Miss FT',   'Miss','neg'],
      };
      if (map[a]) doAction.apply(null, map[a]);
    });
  });

  // ── QUARTER ──────────────────────────────────────────────────────────────────
  wire('qtr-plus',  function(){ quarter=Math.min(8,quarter+1); setText('sb-qtr',quarter); setText('mini-qtr',quarter); document.getElementById('f-quarter').value=quarter; });
  wire('qtr-minus', function(){ quarter=Math.max(1,quarter-1); setText('sb-qtr',quarter); setText('mini-qtr',quarter); document.getElementById('f-quarter').value=quarter; });

  // ── SCORE CORRECTION ─────────────────────────────────────────────────────────
  wire('home-score-plus',  function(){ homeScore++; refreshScoreboard(); });
  wire('home-score-minus', function(){ homeScore=Math.max(0,homeScore-1); refreshScoreboard(); });
  wire('away-score-plus',  function(){ awayScore++; refreshScoreboard(); });
  wire('away-score-minus', function(){ awayScore=Math.max(0,awayScore-1); refreshScoreboard(); });

  // ── TEAM TOTALS (fouls + TOs shown in scoreboard) ────────────────────────────
  function refreshTeamTotals() {
    var hF=0,aF=0,hT=0,aT=0;
    document.querySelectorAll('.lsc-player').forEach(function(el){
      var pid  = el.getAttribute('data-pid');
      var s    = playerStats[pid] || {};
      var home = el.dataset.team === homeTeam;
      if(home){ hF+=s.foul||0; hT+=s.to||0; }
      else    { aF+=s.foul||0; aT+=s.to||0; }
    });
    setText('home-fouls',hF); setText('away-fouls',aF);
    setText('home-to',hT);   setText('away-to',aT);
  }

  // ── BOX SCORE ────────────────────────────────────────────────────────────────
  function refreshBoxScore() {
    ['home','away'].forEach(function(side){
      var cap   = side.charAt(0).toUpperCase()+side.slice(1);
      var tbody = document.getElementById('box'+cap+'Tbody');
      if (!tbody) return;
      var rows = Array.from(document.querySelectorAll('.lsc-player[data-side="'+side+'"]'))
        .sort(function(a,b){ return compute(playerStats[b.dataset.pid]||{}).pts - compute(playerStats[a.dataset.pid]||{}).pts; });
      tbody.innerHTML = rows.map(function(el){
        var s = playerStats[el.dataset.pid] || {};
        var c = compute(s);
        return '<tr>'+
          '<td>#'+el.dataset.jersey+' '+el.dataset.name+'</td>'+
          '<td class="pts-cell">'+c.pts+'</td>'+
          '<td>'+c.reb+'</td>'+'<td>'+(s.ast||0)+'</td>'+
          '<td>'+(s.stl||0)+'</td>'+'<td>'+(s.blk||0)+'</td>'+
          '<td>'+(s.to||0)+'</td>'+
          '<td>'+(s.fg2m||0)+'/'+(s.fg2a||0)+'</td>'+
          '<td>'+(s.fg3m||0)+'/'+(s.fg3a||0)+'</td>'+
          '<td>'+(s.ftm||0)+'/'+(s.fta||0)+'</td>'+
          '</tr>';
      }).join('') || '<tr><td colspan="10" style="color:rgba(255,255,255,.3);padding:10px">No stats yet</td></tr>';
    });
  }

  // ── GAME LEADERS ─────────────────────────────────────────────────────────────
  function refreshLeaders() {
    var allPlayers = Array.from(document.querySelectorAll('.lsc-player'));
    function getBest(fn) {
      var best = null, bestVal = -1;
      allPlayers.forEach(function(el){
        var val = fn(playerStats[el.dataset.pid]||{});
        if (val > bestVal) { bestVal=val; best=el; }
      });
      return best ? { el:best, val:bestVal } : null;
    }
    var leaders = [
      {label:'POINTS',  fn:function(s){return compute(s).pts;}, color:'#f97316'},
      {label:'REBOUNDS',fn:function(s){return compute(s).reb;}, color:'#00d4aa'},
      {label:'ASSISTS', fn:function(s){return s.ast||0;},       color:'#a78bfa'},
      {label:'STEALS',  fn:function(s){return s.stl||0;},       color:'#f7c948'},
    ];
    var grid = document.getElementById('leadersGrid');
    if (!grid) return;
    grid.innerHTML = leaders.map(function(l){
      var b = getBest(l.fn);
      if (!b || b.val === 0) return '';
      var name     = b.el.dataset.name;
      var initials = name.split(' ').map(function(w){return w[0]||'';}).join('').toUpperCase().slice(0,2);
      var color    = b.el.dataset.color;
      return '<div class="ls-leader-card">'+
        '<div class="ls-leader-avatar" style="background:'+color+'99">'+initials+'</div>'+
        '<div class="ls-leader-info">'+
          '<div class="ls-leader-name">'+name+'</div>'+
          '<div class="ls-leader-team">'+b.el.dataset.team+'</div>'+
        '</div>'+
        '<div style="text-align:right">'+
          '<div class="ls-leader-stat" style="color:'+l.color+'">'+b.val+'</div>'+
          '<div class="ls-leader-stat-lbl">'+l.label+'</div>'+
        '</div></div>';
    }).join('') || '<div style="padding:20px;color:rgba(255,255,255,.25);font-size:13px;text-align:center">No stats recorded yet</div>';
  }

  // ── PLAYER SEARCH (by name OR jersey number) ──────────────────────────────────
  var searchInput = document.getElementById('playerSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function(){
      var q = this.value.toLowerCase().trim();
      document.querySelectorAll('.lsc-player').forEach(function(el){
        var name   = (el.dataset.name   || '').toLowerCase();
        var jersey = (el.dataset.jersey || '').toLowerCase();
        el.style.display = (!q || name.includes(q) || jersey.includes(q)) ? '' : 'none';
      });
    });
  }

  // ── CENTER TAB SWITCHING (fixed — no reliance on event.target) ───────────────
  document.querySelectorAll('.ls-tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      document.querySelectorAll('.ls-tab').forEach(function(t){ t.classList.remove('active'); });
      document.querySelectorAll('.ls-tab-content').forEach(function(c){ c.classList.remove('active'); });
      tab.classList.add('active');
      var name = tab.getAttribute('data-ctab');
      var pane = document.getElementById('ctab-'+name);
      if (pane) pane.classList.add('active');
      // Refresh relevant tab
      if (name==='box')     refreshBoxScore();
      if (name==='leaders') refreshLeaders();
      if (name==='pbp')     renderPBP();
    });
  });

  // ── FORM SUBMIT ───────────────────────────────────────────────────────────────
  function buildForm(type) {
    var ff = document.getElementById('f-player-fields');
    ff.innerHTML = '';
    Object.keys(playerStats).forEach(function(pid){
      var s = playerStats[pid];
      ['fg2m','fg2a','fg3m','fg3a','ftm','fta','oreb','dreb','ast','stl','blk','to','foul'].forEach(function(k){
        var inp = document.createElement('input');
        inp.type='hidden'; inp.name=k+'_'+pid; inp.value=s[k]||0;
        ff.appendChild(inp);
      });
    });
    document.getElementById('f-save-type').value = type;
    document.getElementById('f-status').value    = type==='final' ? 'final' : 'ongoing';
    document.getElementById('scoreForm').submit();
  }

  wire('btn-save', function(){ buildForm('save'); });
  wire('btn-end',  function(){ if(confirm('End game and mark as Final?')) buildForm('final'); });

  // ── INITIAL RENDER ────────────────────────────────────────────────────────────
  refreshBoxScore();
  refreshLeaders();
  renderPBP();
  refreshTeamTotals();
});
