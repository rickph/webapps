// PH Hoops Admin Panel — external JS (no inline handlers)

document.addEventListener('DOMContentLoaded', function () {

  // ── TAB SWITCHING ───────────────────────────────────────────────────────────
  var tabs = document.querySelectorAll('.atab');
  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tabName = btn.getAttribute('data-tab');
      document.querySelectorAll('.atab-pane').forEach(function (p) {
        p.classList.add('hidden');
      });
      tabs.forEach(function (b) { b.classList.remove('active'); });
      var pane = document.getElementById('tab-' + tabName);
      if (pane) pane.classList.remove('hidden');
      btn.classList.add('active');
    });
  });

  // ── CONFIRM DELETE LINKS ────────────────────────────────────────────────────
  document.querySelectorAll('[data-confirm]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      var msg = el.getAttribute('data-confirm') || 'Are you sure?';
      if (!confirm(msg + '\n\nThis cannot be undone.')) {
        e.preventDefault();
      }
    });
  });

});
