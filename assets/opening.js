// Play a locally rendered orbit, then hand off to the live Santiago–Beijing route.
(function () {
  'use strict';
  const map = window.ZT && window.ZT.map;
  const opening = document.getElementById('opening');
  if (!map || !opening) return;

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches || location.hash || document.hidden) {
    map.finishOpening();
    return;
  }

  const poster = opening.querySelector('.orbit-poster');
  const skip = document.getElementById('opening-skip');
  const timers = [];
  const events = new AbortController();
  const listen = {signal: events.signal};
  let finished = false;

  function release(immediate) {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    events.abort();
    opening.remove();
    if (immediate) map.finishOpening();
  }

  function start() {
    if (finished) return;
    clearTimeout(timers[0]);
    opening.classList.add('rolling');
    timers.push(setTimeout(() => {
      map.begin();
      opening.classList.add('fade');
    }, 2950));
    timers.push(setTimeout(() => release(false), 3650));
  }

  window.ZT_openingReady = true;
  document.documentElement.classList.add('is-opening');
  skip.addEventListener('click', () => release(true), listen);
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') release(true);
    if (e.key === 'Tab' && opening.classList.contains('rolling') && !opening.classList.contains('fade')) {
      e.preventDefault();
      skip.focus();
    }
  }, listen);
  window.addEventListener('hashchange', () => release(true), listen);
  motion.addEventListener('change', e => { if (e.matches) release(true); }, listen);
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(true); }, listen);
  poster.addEventListener('load', start, {once: true, signal: events.signal});
  poster.addEventListener('error', () => release(true), listen);
  timers.push(setTimeout(() => release(true), 4500));
  poster.sizes = '(max-aspect-ratio: 1/1) 166vw, max(101vw, 152vh)';
  poster.srcset = 'assets/orbit-1280.webp 1280w, assets/orbit-2160.webp 2160w, assets/orbit-3840.webp 3840w';
  poster.src = 'assets/orbit-1280.webp';
})();
