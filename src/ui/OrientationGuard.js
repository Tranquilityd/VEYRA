// Veyra — orientation guard: full-screen rotate prompt on mobile portrait only.
// Pure predicate kept separate so it is unit-testable.
import { isMobileLike } from '../core/device.js';

export function shouldLock(mobileLike, portrait) {
  return !!mobileLike && !!portrait;
}

export function initOrientationGuard(game) {
  const mq = typeof matchMedia !== 'undefined' ? matchMedia('(orientation: portrait)') : null;
  const apply = () => {
    const portrait = mq ? mq.matches : window.innerHeight > window.innerWidth;
    const show = shouldLock(isMobileLike, portrait);
    document.body.classList.toggle('orientation-locked', show);
    game.events.emit('orientation:locked', { locked: show });
    if (show && game.states.currentName === 'play') {
      const st = game.states.get('play');
      if (st && !st.paused) st.togglePause();
    }
  };
  if (mq) {
    if (mq.addEventListener) mq.addEventListener('change', apply);
    else if (mq.addListener) mq.addListener(apply);
  }
  window.addEventListener('resize', apply);
  apply();
}
