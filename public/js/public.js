// PH Hoops Public Pages — external JS

document.addEventListener('DOMContentLoaded', function () {

  // ── LEVEL FILTERS (landing page) ───────────────────────────────────────────
  var filters = document.querySelectorAll('.level-filter');
  if (filters.length) {
    filters[0].classList.add('active');
    filters.forEach(function (btn) {
      btn.addEventListener('click', function () {
        filters.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var level = btn.getAttribute('data-level');
        document.querySelectorAll('.league-card').forEach(function (c) {
          c.style.display = (level === 'All' || c.innerHTML.includes(level)) ? '' : 'none';
        });
      });
    });
  }

  // ── PUBLIC TABS (league page) ───────────────────────────────────────────────
  var ptabs = document.querySelectorAll('.ptab');
  ptabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      ptabs.forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-pane').forEach(function (p) {
        p.classList.add('hidden');
      });
      btn.classList.add('active');
      var tabName = btn.getAttribute('data-tab');
      var pane = document.getElementById('tab-' + tabName);
      if (pane) pane.classList.remove('hidden');
    });
  });

});
