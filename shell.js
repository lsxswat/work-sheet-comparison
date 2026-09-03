/* Shell navigation: the cover page routes between Slip Sheet (Drawing +
   Specification) and Sheet Comparison. Both modules stay on the page and keep
   their own state, so switching tools never discards an uploaded PDF. */
(function () {
  const body = document.body;

  function setPdfWorker() {
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
  }

  function clearAppState() {
    body.classList.remove('app-cover-active', 'app-slip', 'app-compare', 'app-entering');
  }

  function showCover() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    clearAppState();
    // Reset the Slip Sheet sub-cover so it is ready if that tool is picked again.
    document.querySelectorAll('#slip-mode-switch .mode').forEach(b => b.classList.remove('active'));
    body.classList.remove('mode-entering', 'mode-selected');
    body.classList.add('app-cover-active', 'mode-cover-active');
  }

  function openSlipSheet() {
    clearAppState();
    body.classList.add('app-slip', 'app-entering', 'mode-cover-active');
    window.setTimeout(() => body.classList.remove('app-entering'), 620);
  }

  function openComparison() {
    clearAppState();
    body.classList.remove('mode-cover-active', 'mode-entering', 'mode-selected');
    body.classList.add('app-compare', 'app-entering');
    // Stay at the top so the topbar (and its back-to-cover brand) is reachable,
    // which matters most on narrow screens.
    window.scrollTo({ top: 0 });
    window.setTimeout(() => body.classList.remove('app-entering'), 620);
  }

  document.addEventListener('DOMContentLoaded', () => {
    setPdfWorker();

    document.querySelectorAll('.app-mode').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.app === 'comparison') openComparison();
        else openSlipSheet();
      });
    });

    document.getElementById('back-to-cover')?.addEventListener('click', showCover);
  });
})();
