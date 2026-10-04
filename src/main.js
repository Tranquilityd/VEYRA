// Veyra — entry point
import { Game } from './core/Game.js';
import { runTests } from './tests.js';
import { installLitvmWalletAdapter } from './systems/LitvmWalletAdapter.js';

installLitvmWalletAdapter();
const game = new Game();
window.veyra = game;                 // debug / e2e handle
game.boot();

const developmentHost = ['localhost', '127.0.0.1'].includes(location.hostname);
if (developmentHost && new URLSearchParams(location.search).has('test')) {
  setTimeout(() => {
    const results = runTests(game);
    window.__veyraTests = results;
    const panel = document.getElementById('test-panel');
    if (panel) {
      panel.classList.remove('hidden');
      panel.innerHTML = results.lines
        .map((l) => `<span class="${l.ok ? 'pass' : 'fail'}">${l.ok ? 'PASS' : 'FAIL'} ${l.name}${l.info ? ' — ' + l.info : ''}</span>`)
        .join('\n') + `\n\n${results.pass}/${results.total} passed`;
    }
  }, 400);
}
