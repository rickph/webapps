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

      // Init sort when Players tab is opened
      if (tabName === 'players' && !window._sortInitialized) {
        initSort();
        window._sortInitialized = true;
      }
    });
  });

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

    // Auto sort by PTS on first open
    sortTable(4);
  }

  function sortTable(colIndex) {
    var table = document.getElementById('playerStatsTable');
    var tbody = document.getElementById('playerTableBody');
    if (!table || !tbody) return;

    var rows = Array.from(tbody.querySelectorAll('tr'));
    if (rows.length === 0) return;

    // Toggle direction if same col clicked again
    if (sortState.col === colIndex) {
      sortState.dir *= -1;
    } else {
      sortState.col = colIndex;
      sortState.dir = -1; // descending by default
    }

    rows.sort(function (a, b) {
      var aCell = a.querySelectorAll('td')[colIndex];
      var bCell = b.querySelectorAll('td')[colIndex];
      if (!aCell || !bCell) return 0;

      // Use data-val attribute for numeric sorting
      var aVal = parseFloat(aCell.getAttribute('data-val'));
      var bVal = parseFloat(bCell.getAttribute('data-val'));

      if (!isNaN(aVal) && !isNaN(bVal)) {
        return (aVal - bVal) * sortState.dir;
      }
      // Fallback to text sort
      return aCell.textContent.trim().localeCompare(bCell.textContent.trim()) * sortState.dir;
    });

    // Re-append sorted rows and update rank numbers
    rows.forEach(function (row, i) {
      var firstTd = row.querySelectorAll('td')[0];
      if (firstTd) firstTd.textContent = i + 1;
      tbody.appendChild(row);
    });

    // Reset all header icons
    table.querySelectorAll('.sort-col').forEach(function (th) {
      th.classList.remove('sort-asc', 'sort-desc');
      var icon = th.querySelector('.sort-icon');
      if (icon) icon.textContent = '↕';
    });

    // Highlight the active sorted column
    table.querySelectorAll('.sort-col').forEach(function (th) {
      if (parseInt(th.getAttribute('data-col')) === colIndex) {
        th.classList.add(sortState.dir === -1 ? 'sort-desc' : 'sort-asc');
        var icon = th.querySelector('.sort-icon');
        if (icon) icon.textContent = sortState.dir === -1 ? '↓' : '↑';
      }
    });
  }

  // Also try to init sort immediately in case table is already visible
  initSort();

}); // end DOMContentLoaded
