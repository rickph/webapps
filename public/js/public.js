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

  // ── SORTABLE PLAYER STATS TABLE ─────────────────────────────────────────────
  var table = document.getElementById('playerStatsTable');
  if (table) {
    var sortState = { col: 4, dir: -1 }; // default PTS descending

    function sortTable(colIndex) {
      var tbody = document.getElementById('playerTableBody');
      if (!tbody) return;
      var rows = Array.from(tbody.querySelectorAll('tr'));
      if (rows.length === 0) return;

      // Toggle direction if same col, else reset to descending
      if (sortState.col === colIndex) {
        sortState.dir *= -1;
      } else {
        sortState.col = colIndex;
        sortState.dir = -1;
      }

      rows.sort(function (a, b) {
        var aCells = a.querySelectorAll('td');
        var bCells = b.querySelectorAll('td');
        var aCell  = aCells[colIndex];
        var bCell  = bCells[colIndex];
        if (!aCell || !bCell) return 0;

        var aRaw = aCell.getAttribute('data-val');
        var bRaw = bCell.getAttribute('data-val');

        // Use data-val for numeric sort, fall back to text
        var aNum = parseFloat(aRaw);
        var bNum = parseFloat(bRaw);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return (aNum - bNum) * sortState.dir;
        }
        var aText = aCell.textContent.trim();
        var bText = bCell.textContent.trim();
        return aText.localeCompare(bText) * sortState.dir;
      });

      // Rebuild tbody with sorted rows + update rank
      rows.forEach(function (row, i) {
        var firstTd = row.querySelectorAll('td')[0];
        if (firstTd) firstTd.textContent = i + 1;
        tbody.appendChild(row);
      });

      // Update all header icons
      table.querySelectorAll('.sort-col').forEach(function (th) {
        th.classList.remove('sort-asc', 'sort-desc');
        var icon = th.querySelector('.sort-icon');
        if (icon) icon.textContent = '↕';
      });

      // Highlight active header
      table.querySelectorAll('.sort-col').forEach(function (th) {
        if (parseInt(th.getAttribute('data-col')) === colIndex) {
          th.classList.add(sortState.dir === -1 ? 'sort-desc' : 'sort-asc');
          var icon = th.querySelector('.sort-icon');
          if (icon) icon.textContent = sortState.dir === -1 ? ' ↓' : ' ↑';
        }
      });
    }

    // Attach click handlers
    table.querySelectorAll('.sort-col').forEach(function (th) {
      th.addEventListener('click', function () {
        sortTable(parseInt(th.getAttribute('data-col')));
      });
    });

    // Auto sort by PTS on load
    sortTable(4);
  }

}); // end DOMContentLoaded
