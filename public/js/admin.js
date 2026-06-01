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

  // ── PRINT BUTTON ────────────────────────────────────────────────────────────
  var printBtn = document.getElementById('printBtn');
  if (printBtn) {
    printBtn.addEventListener('click', function () {
      window.print();
    });
  }

// ── DATE PICKER WIRING ────────────────────────────────────────────────────────
(function() {
  function wireDatePicker(dateId, timeId, hiddenId) {
    var d = document.getElementById(dateId) || document.querySelector('[name="game_date"]');
    var t = document.getElementById(timeId) || document.querySelector('[name="game_time"]');
    var h = document.getElementById(hiddenId);
    if (!d || !h) return;
    function upd() {
      if (!d.value) return;
      var dt = new Date(d.value + 'T' + ((t && t.value) || '00:00'));
      h.value = dt.toLocaleDateString('en-PH', { month:'long', day:'numeric', year:'numeric' }) +
        ((t && t.value) ? ', ' + dt.toLocaleTimeString('en-PH', { hour:'numeric', minute:'2-digit', hour12:true }) : '');
    }
    d.addEventListener('change', upd);
    if (t) t.addEventListener('change', upd);
  }
  wireDatePicker(null, null, 'addGameDate');
  wireDatePicker('editGameDatePicker', 'editGameTimePicker', 'editGameDate');
})();
