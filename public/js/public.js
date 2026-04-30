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

  function showTab(name) {
    ptabs.forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab-pane').forEach(function (p) {
      p.classList.add('hidden');
    });
    var pane = document.getElementById('tab-' + name);
    if (pane) pane.classList.remove('hidden');
    ptabs.forEach(function (b) {
      if (b.getAttribute('data-tab') === name) b.classList.add('active');
    });
  }

  ptabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      showTab(btn.getAttribute('data-tab'));
    });
  });

  // Auto-open tab from URL ?tab=players (used by server-side sort links)
  var urlParams = new URLSearchParams(window.location.search);
  var activeTab = urlParams.get('tab');
  if (activeTab) {
    showTab(activeTab);
  }

});
