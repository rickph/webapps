// Hoopstats Pilipinas — Public Pages JS

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

  // Auto-open tab from URL ?tab=players
  var urlParams = new URLSearchParams(window.location.search);
  var activeTab = urlParams.get('tab');
  if (activeTab) showTab(activeTab);

  // ── TEAM ROSTER TOGGLE ──────────────────────────────────────────────────────
  // Use event delegation on the TABLE BODY so it works even when tab is hidden
  var standingsTable = document.getElementById('standingsTable');
  if (standingsTable) {
    standingsTable.addEventListener('click', function (e) {
      // Find the clicked standing row (not a roster row)
      var row = e.target.closest('.team-standing-row');
      if (!row) return;

      var teamId = row.getAttribute('data-team');
      var roster = document.getElementById('roster-' + teamId);
      if (!roster) return;

      var isOpen = !roster.classList.contains('hidden');

      // Close ALL open rosters
      document.querySelectorAll('.team-roster-row').forEach(function (r) {
        r.classList.add('hidden');
      });
      // Reset all arrow indicators
      document.querySelectorAll('.team-standing-row').forEach(function (r) {
        r.classList.remove('roster-open');
        var arrow = r.querySelector('.roster-arrow');
        if (arrow) arrow.textContent = '▾';
      });

      // If it was closed — open it
      if (!isOpen) {
        roster.classList.remove('hidden');
        row.classList.add('roster-open');
        var arrow = row.querySelector('.roster-arrow');
        if (arrow) arrow.textContent = '▴';
      }
    });
  }

  // ── SORTABLE PLAYER STATS TABLE ─────────────────────────────────────────────
  var sortState = { col: 4, dir: -1 };

  function initSort() {
    var table = document.getElementById('playerStatsTable');
    if (!table) return;
    table.querySelectorAll('.sort-col').forEach(function (th) {
      th.addEventListener('click', function () {
        sortTable(parseInt(th.getAttribute('data-col')));
      });
    });
    sortTable(4);
  }

  function sortTable(colIndex) {
    var table = document.getElementById('playerStatsTable');
    var tbody = document.getElementById('playerTableBody');
    if (!table || !tbody) return;
    var rows = Array.from(tbody.querySelectorAll('tr'));
    if (!rows.length) return;

    if (sortState.col === colIndex) {
      sortState.dir *= -1;
    } else {
      sortState.col = colIndex;
      sortState.dir = -1;
    }

    rows.sort(function (a, b) {
      var aCell = a.querySelectorAll('td')[colIndex];
      var bCell = b.querySelectorAll('td')[colIndex];
      if (!aCell || !bCell) return 0;
      var aVal = parseFloat(aCell.getAttribute('data-val'));
      var bVal = parseFloat(bCell.getAttribute('data-val'));
      if (!isNaN(aVal) && !isNaN(bVal)) return (aVal - bVal) * sortState.dir;
      return aCell.textContent.trim().localeCompare(bCell.textContent.trim()) * sortState.dir;
    });

    rows.forEach(function (row, i) {
      var firstTd = row.querySelectorAll('td')[0];
      if (firstTd) firstTd.textContent = i + 1;
      tbody.appendChild(row);
    });

    table.querySelectorAll('.sort-col').forEach(function (th) {
      th.classList.remove('sort-asc', 'sort-desc');
      var icon = th.querySelector('.sort-icon');
      if (icon) icon.textContent = '↕';
    });
    table.querySelectorAll('.sort-col').forEach(function (th) {
      if (parseInt(th.getAttribute('data-col')) === colIndex) {
        th.classList.add(sortState.dir === -1 ? 'sort-desc' : 'sort-asc');
        var icon = th.querySelector('.sort-icon');
        if (icon) icon.textContent = sortState.dir === -1 ? '↓' : '↑';
      }
    });
  }

  // Init sort when Players tab opened
  ptabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (btn.getAttribute('data-tab') === 'players' && !window._sortInitialized) {
        initSort();
        window._sortInitialized = true;
      }
    });
  });

  initSort(); // also try on load

}); // end DOMContentLoaded
