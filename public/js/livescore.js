// HoopStats Pilipinas — Live Scorer v3.2 (CSP-safe)

document.addEventListener('DOMContentLoaded', function () {

  // ── READ CONFIG FROM DATA ATTRIBUTES (no inline script needed) ───────────────
  var dataEl    = document.getElementById('lsc-data');
  var homeTeam  = dataEl ? dataEl.getAttribute('data-home-team')  : '';
  var awayTeam  = dataEl ? dataEl.getAttribute('data-away-team')  : '';
  var homeColor = dataEl ? dataEl.getAttribute('data-home-color') : '#e63329';
  var awayColor = dataEl ? dataEl.getAttribute('data-away-color') : '#457b9d';

  // ── STATE ─────────────────────────────────────────────────────────────────────
  var currentPid  = null;
  var playerStats = {};
  var homeScore   = parseInt((document.getElementById('sb-home-score')||{}).textContent) || 0;
  var awayScore   = parseInt((document.getElementById('sb-away-score')||{}).textContent) || 0;
  var quarter     = parseInt((document.getElementById('sb-qtr')||{}).textContent) || 1;
  var pbpLog      = [];
  var undoStack   = [];

  // ── INIT PLAYER STATS FROM DOM ───────────────────────────────────────────────
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
  function $(id) { return document.getElementById(id); }

  function setText(id, val) {
    var el = $(id);
    if (el) el.textContent = val;
  }

  function compute(s) {
    var fgm = (s.fg2m||0)+(s.fg3m||0), fga=(s.fg2a||0)+(s.fg3a||0);
    var pts = (s.fg2m||0)*2+(s.fg3m||0)*3+(s.ftm||0);
    var reb = (s.oreb||0)+(s.dreb||0);
    var eff = pts+reb+(s.ast||0)+(s.stl||0)+(s.blk||0)-(fga-fgm)-((s.fta||0)-(s.ftm||0))-(s.to||0);
    return { pts:pts, reb:reb, eff:eff, fgm:fgm, fga:fga,
             fgp: fga>0 ? (fgm/fga*100).toFixed(1)+'%' : '—' };
  }

  function isHome(pid) {
    var el = document.querySelector('.lsc-player[data-pid="'+pid+'"]');
    return el && el.dataset.team === homeTeam;
  }

  function wire(id, fn) {
    var el = $(id);
    if (el) el.addEventListener('click', fn);
  }

  // ── SCOREBOARD ───────────────────────────────────────────────────────────────
  function refreshScoreboard() {
    setText('sb-home-score', homeScore); setText('mini-home', homeScore);
    setText('sb-away-score', awayScore); setText('mini-away', awayScore);
    var fhs = $('f-home-score'), fas = $('f-away-score');
    if (fhs) fhs.value = homeScore;
    if (fas) fas.value = awayScore;
  }

  function changeScore(pid, delta) {
    if (isHome(pid)) homeScore = Math.max(0, homeScore + delta);
    else             awayScore = Math.max(0, awayScore + delta);
    refreshScoreboard();
  }

  // ── ROW PTS ───────────────────────────────────────────────────────────────────
  function refreshRow(pid) {
    var el = $('row-pts-'+pid);
    if (el && playerStats[pid]) el.textContent = compute(playerStats[pid]).pts;
  }

  // ── CENTER PANEL ──────────────────────────────────────────────────────────────
  function refreshPanel() {
    if (!currentPid || !playerStats[currentPid]) return;
    var s = playerStats[currentPid], c = compute(s);

    setText('pp-pts',  c.pts);  setText('pp-eff',  c.eff);
    setText('pp-fgp',  c.fgp);  setText('pp-oreb', s.oreb);
    setText('pp-dreb', s.dreb); setText('pp-ast',  s.ast);
    setText('pp-stl',  s.stl);  setText('pp-blk',  s.blk);
    setText('pp-to',   s.to);   setText('pp-foul', s.foul);
    setText('pp-fg-line',
      (s.fg2m||0)+'/'+(s.fg2a||0)+' 2PT  ·  '+(s.fg3m||0)+'/'+(s.fg3a||0)+' 3PT  ·  '+(s.ftm||0)+'/'+(s.fta||0)+' FT');

    // Right mini panel
    setText('rp-pts', c.pts); setText('rp-reb', c.reb);
    setText('rp-ast', s.ast); setText('rp-stl', s.stl); setText('rp-blk', s.blk);

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
      var color  = el.dataset.color  || homeColor;

      setText('pp-name', name);
      setText('pp-sub',  (pos?pos+' · ':'')+' #'+jersey);
      var rec = $('pp-recording');
      if (rec) { rec.textContent = name.toUpperCase(); rec.style.color = color; }

      var noMsg = $('noPlayerMsg'), panel = $('playerPanel'), rpp = $('rightPlayerPanel');
      if (noMsg)  noMsg.style.display  = 'none';
      if (panel)  panel.style.display  = 'block';
      if (rpp)    rpp.style.display    = 'block';

      setText('rp-name', name);
      setText('rp-role', (pos?pos+' · ':'')+' #'+jersey);
      refreshPanel();
    });
  });

  // ── CORE ACTION (snapshot BEFORE mutation) ────────────────────────────────────
  function doAction(modFn, scoreDelta, label, badge, badgeClass) {
    if (!currentPid) return;
    var s    = playerStats[currentPid];
    var pid  = currentPid;

    // Snapshot BEFORE
    var snap      = JSON.parse(JSON.stringify(s));
    var snapHome  = homeScore;
    var snapAway  = awayScore;

    // Mutate
    modFn(s);
    if (scoreDelta !== 0) changeScore(pid, scoreDelta);

    // Push undo
    undoStack.push({ pid:pid, snap:snap, home:snapHome, away:snapAway, label:label });

    // Log
    if (label) {
      var el    = document.querySelector('.lsc-player[data-pid="'+pid+'"]');
      var pname = el ? el.dataset.name   : '—';
      var pnum  = el ? el.dataset.jersey : '?';
      var pclr  = el ? el.dataset.color  : '#888';
      pbpLog.unshift({ qtr:quarter, pid:pid, name:pname, num:pnum,
                       action:label, badge:badge, badgeClass:badgeClass||'', color:pclr });
      renderPBP();
    }

    refreshPanel();
  }

  // ── SHOT BUTTONS ─────────────────────────────────────────────────────────────
  wire('btn-2pt',    function(){ doAction(function(s){s.fg2m++;s.fg2a++;},  2,'Made 2PT',   '+2', 'pos'); });
  wire('btn-miss2',  function(){ doAction(function(s){s.fg2a++;},           0,'Miss 2PT',   'Miss','neg'); });
  wire('btn-3pt',    function(){ doAction(function(s){s.fg3m++;s.fg3a++;},  3,'Made 3PT',   '+3', 'pos'); });
  wire('btn-miss3',  function(){ doAction(function(s){s.fg3a++;},           0,'Miss 3PT',   'Miss','neg'); });
  wire('btn-ft',     function(){ doAction(function(s){s.ftm++; s.fta++;},   1,'Free Throw', '+1', 'pos'); });
  wire('btn-missft', function(){ doAction(function(s){s.fta++;},            0,'Miss FT',    'Miss','neg'); });

  // ── COUNTING STAT BUTTONS ────────────────────────────────────────────────────
  var statLabels = {oreb:'Off Rebound',dreb:'Def Rebound',ast:'Assist',
                    stl:'Steal',blk:'Block',to:'Turnover',foul:'Foul'};

  document.querySelectorAll('.ls-cnt-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!currentPid) return;
      var stat = btn.getAttribute('data-stat');
      var dir  = parseInt(btn.getAttribute('data-dir'));
      var s    = playerStats[currentPid];
      if (dir === -1 && (s[stat]||0) <= 0) return;

      if (dir === 1) {
        doAction(function(s){ s[stat] = (s[stat]||0)+1; }, 0, statLabels[stat]||stat, '', '');
      } else {
        s[stat] = Math.max(0, (s[stat]||0)-1);
        refreshPanel();
      }
    });
  });

  // ── RIGHT MINI SHOT BUTTONS ───────────────────────────────────────────────────
  document.querySelectorAll('.ls-rp-shot').forEach(function(btn){
    btn.addEventListener('click', function(){
      var a   = btn.getAttribute('data-action');
      var map = {
        '2pt':   [function(s){s.fg2m++;s.fg2a++;},  2,'Made 2PT',   '+2', 'pos'],
        '3pt':   [function(s){s.fg3m++;s.fg3a++;},  3,'Made 3PT',   '+3', 'pos'],
        'ft':    [function(s){s.ftm++; s.fta++;},   1,'Free Throw', '+1', 'pos'],
        'miss2': [function(s){s.fg2a++;},            0,'Miss 2PT',   'Miss','neg'],
        'miss3': [function(s){s.fg3a++;},            0,'Miss 3PT',   'Miss','neg'],
        'missft':[function(s){s.fta++;},             0,'Miss FT',    'Miss','neg'],
      };
      if (map[a]) doAction.apply(null, map[a]);
    });
  });

  // ── UNDO ─────────────────────────────────────────────────────────────────────
  wire('btn-undo', function () {
    var btn = $('btn-undo');
    if (!undoStack.length) {
      if (btn) { btn.textContent='↩ Nothing to undo'; setTimeout(function(){ btn.textContent='↩ UNDO LAST ACTION'; },1500); }
      return;
    }
    var last = undoStack.pop();
    playerStats[last.pid] = last.snap;   // restore stats
    homeScore = last.home;               // restore scores
    awayScore = last.away;
    refreshScoreboard();
    if (pbpLog.length) pbpLog.shift();   // remove last play log entry
    renderPBP();
    refreshRow(last.pid);
    if (last.pid === currentPid) refreshPanel();
    if (btn) { btn.textContent='↩ Undone: '+last.label; setTimeout(function(){ btn.textContent='↩ UNDO LAST ACTION'; },1500); }
  });

  // ── QUARTER ──────────────────────────────────────────────────────────────────
  wire('qtr-plus',  function(){ quarter=Math.min(8,quarter+1); setText('sb-qtr',quarter); setText('mini-qtr',quarter); var fq=$('f-quarter'); if(fq)fq.value=quarter; });
  wire('qtr-minus', function(){ quarter=Math.max(1,quarter-1); setText('sb-qtr',quarter); setText('mini-qtr',quarter); var fq=$('f-quarter'); if(fq)fq.value=quarter; });

  // ── SCORE CORRECTION ─────────────────────────────────────────────────────────
  wire('home-score-plus',  function(){ homeScore++; refreshScoreboard(); });
  wire('home-score-minus', function(){ homeScore=Math.max(0,homeScore-1); refreshScoreboard(); });
  wire('away-score-plus',  function(){ awayScore++; refreshScoreboard(); });
  wire('away-score-minus', function(){ awayScore=Math.max(0,awayScore-1); refreshScoreboard(); });

  // ── NAV TABS (top bar) ────────────────────────────────────────────────────────
  document.querySelectorAll('.ls-nav-tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      document.querySelectorAll('.ls-nav-tab').forEach(function(t){ t.classList.remove('active'); });
      tab.classList.add('active');
    });
  });

  // ── CENTER TABS ───────────────────────────────────────────────────────────────
  document.querySelectorAll('.ls-tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      document.querySelectorAll('.ls-tab').forEach(function(t){ t.classList.remove('active'); });
      document.querySelectorAll('.ls-tab-content').forEach(function(c){ c.classList.remove('active'); });
      tab.classList.add('active');
      var name = tab.getAttribute('data-ctab');
      var pane = $('ctab-'+name);
      if (pane) pane.classList.add('active');
      if (name==='box')     refreshBoxScore();
      if (name==='leaders') refreshLeaders();
      if (name==='pbp')     renderPBP();
    });
  });

  // ── PLAYER SEARCH (name OR jersey) ───────────────────────────────────────────
  var searchInput = $('playerSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function(){
      var q = this.value.toLowerCase().trim();
      document.querySelectorAll('.lsc-player').forEach(function(el){
        var match = !q
          || (el.dataset.name   ||'').toLowerCase().includes(q)
          || (el.dataset.jersey ||'').toLowerCase().includes(q);
        el.style.display = match ? '' : 'none';
      });
    });
  }

  // ── TEAM TOTALS ───────────────────────────────────────────────────────────────
  function refreshTeamTotals() {
    var hF=0,aF=0,hT=0,aT=0;
    document.querySelectorAll('.lsc-player').forEach(function(el){
      var s = playerStats[el.getAttribute('data-pid')] || {};
      var h = el.dataset.team === homeTeam;
      if(h){hF+=s.foul||0;hT+=s.to||0;}else{aF+=s.foul||0;aT+=s.to||0;}
    });
    setText('home-fouls',hF); setText('away-fouls',aF);
    setText('home-to',hT);   setText('away-to',aT);
  }

  // ── BOX SCORE ────────────────────────────────────────────────────────────────
  function refreshBoxScore() {
    ['home','away'].forEach(function(side){
      var tbody = $('box'+side.charAt(0).toUpperCase()+side.slice(1)+'Tbody');
      if (!tbody) return;
      var rows = Array.from(document.querySelectorAll('.lsc-player[data-side="'+side+'"]'))
        .sort(function(a,b){ return compute(playerStats[b.getAttribute('data-pid')]||{}).pts - compute(playerStats[a.getAttribute('data-pid')]||{}).pts; });
      tbody.innerHTML = rows.map(function(el){
        var s=playerStats[el.getAttribute('data-pid')]||{}, c=compute(s);
        return '<tr>'+
          '<td>#'+el.dataset.jersey+' '+el.dataset.name+'</td>'+
          '<td class="pts-cell">'+c.pts+'</td><td>'+c.reb+'</td>'+
          '<td>'+(s.ast||0)+'</td><td>'+(s.stl||0)+'</td><td>'+(s.blk||0)+'</td>'+
          '<td>'+(s.to||0)+'</td><td>'+(s.fg2m||0)+'/'+(s.fg2a||0)+'</td>'+
          '<td>'+(s.fg3m||0)+'/'+(s.fg3a||0)+'</td><td>'+(s.ftm||0)+'/'+(s.fta||0)+'</td></tr>';
      }).join('') || '<tr><td colspan="10" style="color:rgba(255,255,255,.3);padding:10px;text-align:center">No stats yet</td></tr>';
    });
  }

  // ── GAME LEADERS ─────────────────────────────────────────────────────────────
  function refreshLeaders() {
    var all = Array.from(document.querySelectorAll('.lsc-player'));
    function best(fn) {
      var top=null, topV=-1;
      all.forEach(function(el){ var v=fn(playerStats[el.getAttribute('data-pid')]||{}); if(v>topV){topV=v;top=el;} });
      return top ? {el:top,val:topV} : null;
    }
    var defs=[
      {label:'POINTS',  fn:function(s){return compute(s).pts;},color:'#f97316'},
      {label:'REBOUNDS',fn:function(s){return compute(s).reb;},color:'#00d4aa'},
      {label:'ASSISTS', fn:function(s){return s.ast||0;},      color:'#a78bfa'},
      {label:'STEALS',  fn:function(s){return s.stl||0;},      color:'#f7c948'},
    ];
    var grid = $('leadersGrid');
    if (!grid) return;
    grid.innerHTML = defs.map(function(d){
      var b=best(d.fn); if(!b||b.val===0) return '';
      var nm=b.el.dataset.name;
      var ini=nm.split(' ').map(function(w){return w[0]||'';}).join('').toUpperCase().slice(0,2);
      return '<div class="ls-leader-card">'+
        '<div class="ls-leader-avatar" style="background:'+b.el.dataset.color+'99">'+ini+'</div>'+
        '<div class="ls-leader-info"><div class="ls-leader-name">'+nm+'</div>'+
        '<div class="ls-leader-team">'+b.el.dataset.team+'</div></div>'+
        '<div style="text-align:right"><div class="ls-leader-stat" style="color:'+d.color+'">'+b.val+'</div>'+
        '<div class="ls-leader-stat-lbl">'+d.label+'</div></div></div>';
    }).join('')||'<div style="padding:20px;color:rgba(255,255,255,.25);font-size:13px;text-align:center">No stats yet</div>';
  }

  // ── PLAY BY PLAY ─────────────────────────────────────────────────────────────
  function renderPBP() {
    function row(e, compact) {
      return '<div class="ls-pbp-entry"'+
        (compact?' style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)"':'')+'>'+
        '<div class="ls-pbp-time">Q'+e.qtr+'</div>'+
        '<div class="ls-pbp-num" style="background:'+e.color+'99;'+
          (compact?'width:22px;height:22px;font-size:10px;border-radius:5px':'')+
        '">'+e.num+'</div>'+
        '<div class="ls-pbp-text"'+(compact?' style="font-size:11px"':'')+'>'+
          '<b>'+e.name+'</b> — '+e.action+'</div>'+
        (e.badge?'<div class="ls-pbp-badge '+e.badgeClass+'"'+(compact?' style="font-size:10px"':'')+'>'+e.badge+'</div>':'')+
        '</div>';
    }
    var full = $('pbpLog');
    if (full) full.innerHTML = pbpLog.length
      ? pbpLog.slice(0,50).map(function(e){return row(e,false);}).join('')
      : '<div style="padding:24px;color:rgba(255,255,255,.25);font-size:13px;text-align:center">No plays yet — select a player and start recording stats</div>';
    var mini = $('miniPbpLog');
    if (mini) mini.innerHTML = pbpLog.slice(0,6).map(function(e){return row(e,true);}).join('');
  }

  // ── SAVE & END ────────────────────────────────────────────────────────────────
  function buildAndSubmit(type) {
    var ff = $('f-player-fields');
    if (!ff) return;
    ff.innerHTML = '';
    Object.keys(playerStats).forEach(function(pid){
      var s = playerStats[pid];
      ['fg2m','fg2a','fg3m','fg3a','ftm','fta','oreb','dreb','ast','stl','blk','to','foul'].forEach(function(k){
        var inp = document.createElement('input');
        inp.type='hidden'; inp.name=k+'_'+pid; inp.value=s[k]||0;
        ff.appendChild(inp);
      });
    });
    var fst=$('f-save-type'), fss=$('f-status'), frm=$('scoreForm');
    if(fst) fst.value=type;
    if(fss) fss.value=type==='final'?'final':'ongoing';
    if(frm) frm.submit();
  }

  wire('btn-save', function(){ buildAndSubmit('save'); });
  wire('btn-end',  function(){ if(confirm('End game and mark as Final?')) buildAndSubmit('final'); });

  // ── INITIAL RENDER ────────────────────────────────────────────────────────────
  refreshBoxScore();
  refreshLeaders();
  renderPBP();
  refreshTeamTotals();

}); // DOMContentLoaded
