'use strict';
/* ============================================================
   BOOT: load car models, wire UI, start the game, handle first-run errors
   ============================================================ */
(function () {
  function start() {
    try {
      UI.init(); Net.init(); Net.bindUI();
      if (!Game.init()) { UI.loading(false); return; }
      UI.loading(false);
    } catch (e) {
      if (window.console) console.error(e);
      UI.loading(false); showFatal('Startup failed: ' + e.message);
    }
  }
  function go() { CarModels.load().then(start, start); } // cars are needed before the garage is drawn
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
