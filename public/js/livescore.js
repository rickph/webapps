// HoopStats Pilipinas — Live Scorer v3

document.addEventListener('DOMContentLoaded', function () {

  var currentPid  = null;
  var playerStats = {};
  var homeScore   = parseInt(document.getElementById('sb-home-score').textContent) || 0;
  var awayScore   = parseInt(document.getElementById('sb-away-score').textContent) || 0;
  var quarter     = parseInt(document.getElementById('sb-qtr').textContent) || 1;
  var pbpLog      = [];       // {time, pid, name, num, action, badge, color}
  var undoStack   = [];       // last actions for undo

  var homeTeam = window.LSC_DATA ? window.LSC_DATA.homeTeam : '';
  var homeColor = window.LSC_DATA ? window.LSC_DATA.homeColor : '#e63329';
  var awayColor = window.LSC_DATA ? window.LSC_DATA.awayColor : '#457b9d';

  // ── INIT PLAYER STATS ───────────────────────────────────────────────────────
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

  // ── FIBA COMPUTE ─────────────────────────────────────────────────────────────
  function compute(s) {
    var fgm = s.fg2m + s.fg3m, fga = s.fg2a + s.fg3a;
    var pts = s.fg2m*2 + s.fg3m*3 + s.ftm;
    var reb = s.oreb + s.dreb;
    var eff = pts + reb + s.ast + s.stl + s.blk - (fga-fgm) - (s.fta-s.ftm) - s.to;
    var fgp = fga > 0 ? (fgm/fga*100).toFixed(1)+'%' : '—';
    return { pts:pts, reb:reb, eff:eff, fgp:fgp, fgm:fgm, fga:fga };
  }

  // ── REFRESH ROW ──────────────────────────────────────────────────────────────
  function refreshRow(pid) {
    var el = document.getElementById('row-pts-'+pid);
    if (!el || !playerStats[pid]) return;
    el.textContent = compute(playerStats[pid]).pts;
  }

  // ── REFRESH PANEL ────────────────────────────────────────────────────────────
  function refreshPanel() {
    if (!currentPid) return;
    var s = playerStats[currentPid], c = compute(s);
    setText('pp-pts',  c.pts);
    setText('pp-eff',  c.eff);
    setText('pp-fgp',  c.fgp);
    setText('pp-oreb', s.oreb);
    setText('pp-dreb', s.dreb);
    setText('pp-ast',  s.ast);
    setText('pp-stl',  s.stl);
    setText('pp-blk',  s.blk);
    setText('pp-to',   s.to);
    setText('pp-foul', s.foul);
    setText('pp-fg-line', s.fg2m+'/'+s.fg2a+' 2PT  ·  '+s.fg3m+'/'+s.fg3a+' 3PT  ·  '+s.ftm+'/'+s.fta+' FT');
    refreshRow(currentPid);
    refreshRightPanel();
    refreshBoxScore();
    refreshLeaders();
    refreshTeamTotals();
  }

  function setText(id, val) { var el=document.getElementById(id); if(el) el.textContent=val; }

  // ── SELECT PLAYER ────────────────────────────────────────────────────────────
  document.querySelectorAll('.lsc-player').forEach(function (el) {
    el.addEventListener('click', function () {
      document.querySelectorAll('.lsc-player').forEach(function(p){ p.classList.remove('active'); });
      el.classList.add('active');
      currentPid = el.getAttribute('data-pid');
      var name  = el.dataset.name || '—';
      var pos   = el.dataset.pos  || '';
      var jersey= el.dataset.jersey || '';
      var color = el.dataset.color || '#e63329';

      setText('pp-name', name);
      setText('pp-sub', (pos?pos+' · ':'')+'#'+jersey);
      var rec = document.getElementById('pp-recording');
      if(rec){ rec.textContent = name.toUpperCase(); rec.style.color = color; }

      document.getElementById('noPlayerMsg').style.display = 'none';
      document.getElementById('playerPanel').style.display = 'block';
      document.getElementById('rightPlayerPanel').style.display = 'block';
      setText('rp-name', name);
      setText('rp-role', (pos?pos+' · ':'')+'#'+jersey);

      refreshPanel();
    });
  });

  // ── ACTION HELPER ────────────────────────────────────────────────────────────
  function isHome() {
    var el = document.querySelector('.lsc-player[data-pid="'+currentPid+'"]');
    return el && el.dataset.team === homeTeam;
  }

  function addScore(n) {
    if(isHome()) { homeScore = Math.max(0, homeScore+n); }
    else          { awayScore = Math.max(0, awayScore+n); }
    refreshScoreboard();
  }

  function subScore(n) {
    if(isHome()) { homeScore = Math.max(0, homeScore-n); }
    else          { awayScore = Math.max(0, awayScore-n); }
    refreshScoreboard();
  }

  function logPlay(action, badge, badgeClass, scoreDelta) {
    var el = document.querySelector('.lsc-player[data-pid="'+currentPid+'"]');
    var name = el ? el.dataset.name : '—';
    var num  = el ? el.dataset.jersey : '?';
    var color= el ? el.dataset.color : '#888';
    var entry = { qtr:quarter, pid:currentPid, name:name, num:num, action:action, badge:badge, badgeClass:badgeClass, color:color };
    pbpLog.unshift(entry);
    renderPBP();
  }

  function doAction(statMods, scoreDelta, undoFn, actionLabel, badge, badgeClass) {
    if (!currentPid) return;
    var s = playerStats[currentPid];
    statMods(s);
    if (scoreDelta > 0) addScore(scoreDelta);
    else if (scoreDelta < 0) subScore(-scoreDelta);
    undoStack.push({ pid:currentPid, stats: Object.assign({}, s), scoreDelta:-scoreDelta });
    if(actionLabel) logPlay(actionLabel, badge, badgeClass, scoreDelta);
    refreshPanel();
  }

  // ── SHOT BUTTONS ─────────────────────────────────────────────────────────────
  function wireShot(id, fn) {
    var el = document.getElementById(id);
    if(el) el.addEventListener('click', fn);
  }

  wireShot('btn-2pt',    function(){ doAction(function(s){s.fg2m++;s.fg2a++;},  2, null,'Made 2PT','  +2','pos'); });
  wireShot('btn-miss2',  function(){ doAction(function(s){s.fg2a++;},           0, null,'Miss 2PT','Miss','neg'); });
  wireShot('btn-3pt',    function(){ doAction(function(s){s.fg3m++;s.fg3a++;},  3, null,'Made 3PT','  +3','pos'); });
  wireShot('btn-miss3',  function(){ doAction(function(s){s.fg3a++;},           0, null,'Miss 3PT','Miss','neg'); });
  wireShot('btn-ft',     function(){ doAction(function(s){s.ftm++;s.fta++;},    1, null,'Free Throw',' +1','pos'); });
  wireShot('btn-missft', function(){ doAction(function(s){s.fta++;},            0, null,'Miss FT', 'Miss','neg'); });

  // Mini right panel shot buttons
  document.querySelectorAll('.ls-rp-shot').forEach(function(btn){
    btn.addEventListener('click', function(){
      var a = btn.getAttribute('data-action');
      if(!currentPid) return;
      var s = playerStats[currentPid];
      if(a==='2pt')    { s.fg2m++;s.fg2a++; addScore(2);  logPlay('Made 2PT',  '+2','pos'); }
      if(a==='3pt')    { s.fg3m++;s.fg3a++; addScore(3);  logPlay('Made 3PT',  '+3','pos'); }
      if(a==='ft')     { s.ftm++; s.fta++;  addScore(1);  logPlay('Free Throw','+1','pos'); }
      if(a==='miss2')  { s.fg2a++;                        logPlay('Miss 2PT',  'Miss','neg'); }
      if(a==='miss3')  { s.fg3a++;                        logPlay('Miss 3PT',  'Miss','neg'); }
      if(a==='missft') { s.fta++;                         logPlay('Miss FT',   'Miss','neg'); }
      refreshPanel();
    });
  });

  // ── COUNTING STATS ───────────────────────────────────────────────────────────
  document.querySelectorAll('.ls-cnt-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!currentPid) return;
      var stat = btn.getAttribute('data-stat');
      var dir  = parseInt(btn.getAttribute('data-dir'));
      var s    = playerStats[currentPid];
      if(dir===-1 && (s[stat]||0)<=0) return;
      s[stat] = Math.max(0,(s[stat]||0)+dir);
      var labels = {oreb:'Off Rebound',dreb:'Def Rebound',ast:'Assist',stl:'Steal',blk:'Block',to:'Turnover',foul:'Foul'};
      if(dir===1 && labels[stat]) logPlay(labels[stat], stat==='to'?'TO':'','', 0);
      refreshPanel();
    });
  });

  // ── UNDO ─────────────────────────────────────────────────────────────────────
  var undoBtn = document.getElementById('btn-undo');
  if(undoBtn) undoBtn.addEventListener('click', function(){
    if(!undoStack.length) return;
    var last = undoStack.pop();
    playerStats[last.pid] = last.stats;
    if(last.scoreDelta > 0) addScore(last.scoreDelta);
    else if(last.scoreDelta < 0) subScore(-last.scoreDelta);
    pbpLog.shift();
    renderPBP();
    refreshPanel();
  });

  // ── QUARTER ──────────────────────────────────────────────────────────────────
  document.getElementById('qtr-plus').addEventListener('click',  function(){ quarter=Math.min(8,quarter+1); refreshQtr(); });
  document.getElementById('qtr-minus').addEventListener('click', function(){ quarter=Math.max(1,quarter-1); refreshQtr(); });

  function refreshQtr() {
    setText('sb-qtr', quarter);
    setText('mini-qtr', quarter);
    document.getElementById('f-quarter').value = quarter;
  }

  // ── SCORE CORRECTION ─────────────────────────────────────────────────────────
  function wireScoreAdj(plusId, minusId, getVal, setVal) {
    var p = document.getElementById(plusId);
    var m = document.getElementById(minusId);
    if(p) p.addEventListener('click', function(){ setVal(getVal()+1); refreshScoreboard(); });
    if(m) m.addEventListener('click', function(){ setVal(Math.max(0,getVal()-1)); refreshScoreboard(); });
  }

  wireScoreAdj('home-score-plus','home-score-minus', function(){return homeScore;}, function(v){homeScore=v;});
  wireScoreAdj('away-score-plus','away-score-minus', function(){return awayScore;}, function(v){awayScore=v;});

  // ── REFRESH SCOREBOARD ────────────────────────────────────────────────────────
  function refreshScoreboard() {
    setText('sb-home-score', homeScore); setText('mini-home', homeScore);
    setText('sb-away-score', awayScore); setText('mini-away', awayScore);
    document.getElementById('f-home-score').value = homeScore;
    document.getElementById('f-away-score').value = awayScore;
  }

  // ── REFRESH TEAM FOULS / TO TOTALS ───────────────────────────────────────────
  function refreshTeamTotals() {
    var hFouls=0, aFouls=0, hTo=0, aTo=0;
    document.querySelectorAll('.lsc-player').forEach(function(el){
      var pid = el.getAttribute('data-pid');
      var s   = playerStats[pid] || {};
      var home = el.dataset.team === homeTeam;
      if(home){ hFouls+=s.foul||0; hTo+=s.to||0; }
      else    { aFouls+=s.foul||0; aTo+=s.to||0; }
    });
    setText('home-fouls', hFouls); setText('away-fouls', aFouls);
    setText('home-to', hTo);       setText('away-to', aTo);
  }

  // ── RIGHT PANEL REFRESH ────────────────────────────────────────────────────────
  function refreshRightPanel() {
    if (!currentPid || !playerStats[currentPid]) return;
    var s = playerStats[currentPid], c = compute(s);
    setText('rp-pts', c.pts);
    setText('rp-reb', c.reb);
    setText('rp-ast', s.ast);
    setText('rp-stl', s.stl);
    setText('rp-blk', s.blk);
  }

  // ── BOX SCORE REFRESH ─────────────────────────────────────────────────────────
  function refreshBoxScore() {
    ['home','away'].forEach(function(side){
      var tbody = document.getElementById('box'+side.charAt(0).toUpperCase()+side.slice(1)+'Tbody');
      if(!tbody) return;
      var players = Array.from(document.querySelectorAll('.lsc-player[data-side="'+side+'"]'));
      tbody.innerHTML = players.map(function(el){
        var pid = el.getAttribute('data-pid');
        var s   = playerStats[pid]||{};
        var c   = compute(s);
        return '<tr>'+
          '<td>'+el.dataset.name+'</td>'+
          '<td class="pts-cell">'+c.pts+'</td>'+
          '<td>'+c.reb+'</td>'+
          '<td>'+(s.ast||0)+'</td>'+
          '<td>'+(s.stl||0)+'</td>'+
          '<td>'+(s.blk||0)+'</td>'+
          '<td>'+(s.to||0)+'</td>'+
          '<td>'+(s.fg2m||0)+'/'+(s.fg2a||0)+'</td>'+
          '<td>'+(s.fg3m||0)+'/'+(s.fg3a||0)+'</td>'+
          '<td>'+(s.ftm||0)+'/'+(s.fta||0)+'</td>'+
          '</tr>';
      }).join('');
    });
  }

  // ── PLAY BY PLAY RENDER ───────────────────────────────────────────────────────
  function renderPBP() {
    var html = pbpLog.slice(0,30).map(function(e){
      return '<div class="ls-pbp-entry">'+
        '<div class="ls-pbp-time">Q'+e.qtr+'</div>'+
        '<div class="ls-pbp-num" style="background:'+e.color+'99">'+e.num+'</div>'+
        '<div class="ls-pbp-text"><b>'+e.name+'</b> — '+e.action+'</div>'+
        (e.badge ? '<div class="ls-pbp-badge '+(e.badgeClass||'')+'">'+e.badge+'</div>' : '')+
        '</div>';
    }).join('');
    var pbpEl = document.getElementById('pbpLog');
    if(pbpEl) pbpEl.innerHTML = html || '<div style="padding:20px;color:rgba(255,255,255,.25);font-size:13px">No plays recorded yet</div>';
    var miniEl = document.getElementById('miniPbpLog');
    if(miniEl) miniEl.innerHTML = pbpLog.slice(0,5).map(function(e){
      return '<div class="ls-pbp-entry" style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)">'+
        '<div class="ls-pbp-num" style="background:'+e.color+'99;width:22px;height:22px;font-size:10px;border-radius:5px">'+e.num+'</div>'+
        '<div class="ls-pbp-text" style="font-size:11px"><b>'+e.name+'</b> — '+e.action+'</div>'+
        (e.badge ? '<div class="ls-pbp-badge '+(e.badgeClass||'')+'" style="font-size:10px">'+e.badge+'</div>' : '')+
        '</div>';
    }).join('');
  }

  // ── GAME LEADERS REFRESH ─────────────────────────────────────────────────────
  function refreshLeaders() {
    var allPlayers = Array.from(document.querySelectorAll('.lsc-player'));
    function getBest(fn) {
      return allPlayers.reduce(function(best, el){
        var pid = el.getAttribute('data-pid');
        var val = fn(playerStats[pid]||{});
        if(!best || val > best.val) return { el:el, val:val };
        return best;
      }, null);
    }
    var leaders = [
      { label:'POINTS',   fn:function(s){return compute(s).pts;}, color:'#f97316' },
      { label:'REBOUNDS', fn:function(s){return compute(s).reb;}, color:'#00d4aa' },
      { label:'ASSISTS',  fn:function(s){return s.ast||0;},       color:'#a78bfa' },
      { label:'STEALS',   fn:function(s){return s.stl||0;},       color:'#f7c948' },
    ];
    var grid = document.getElementById('leadersGrid');
    if(!grid) return;
    grid.innerHTML = leaders.map(function(l){
      var best = getBest(l.fn);
      if(!best) return '';
      var name = best.el.dataset.name;
      var initials = name.split(' ').map(function(w){return w[0];}).join('').toUpperCase().slice(0,2);
      var color = best.el.dataset.color;
      return '<div class="ls-leader-card">'+
        '<div class="ls-leader-avatar" style="background:'+color+'99">'+initials+'</div>'+
        '<div class="ls-leader-info">'+
          '<div class="ls-leader-name">'+name+'</div>'+
          '<div class="ls-leader-team">'+best.el.dataset.team+'</div>'+
        '</div>'+
        '<div style="text-align:right">'+
          '<div class="ls-leader-stat" style="color:'+l.color+'">'+best.val+'</div>'+
          '<div class="ls-leader-stat-lbl">'+l.label+'</div>'+
        '</div>'+
        '</div>';
    }).join('');
  }

  // ── SAVE & END ────────────────────────────────────────────────────────────────
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
    document.getElementById('f-status').value = type==='final'?'final':'ongoing';
    document.getElementById('scoreForm').submit();
  }

  document.getElementById('btn-save').addEventListener('click', function(){ buildForm('save'); });
  document.getElementById('btn-end').addEventListener('click', function(){
    if(confirm('End this game and mark it as Final?')) buildForm('final');
  });

  // ── INIT ──────────────────────────────────────────────────────────────────────
  refreshBoxScore();
  refreshLeaders();
  renderPBP();
});
