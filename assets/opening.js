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
  const film = opening.querySelector('.orbit-film');
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
    film.pause();
    opening.remove();
    if (immediate) map.finishOpening();
  }

  function start() {
    if (finished) return;
    clearTimeout(timers[0]);
    document.documentElement.classList.add('is-opening');
    opening.classList.add('rolling');
    film.src = 'assets/santiago-orbit.mp4';
    film.play().catch(() => {}); // The poster shares the camera move when autoplay is unavailable.
    timers.push(setTimeout(() => {
      map.begin();
      opening.classList.add('fade');
    }, 2350));
    timers.push(setTimeout(() => release(false), 3050));
  }

  window.ZT_openingReady = true;
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
  film.addEventListener('playing', () => film.classList.add('playing'), listen);
  film.addEventListener('error', () => film.classList.remove('playing'), listen);
  poster.addEventListener('load', start, listen);
  poster.addEventListener('error', () => release(true), listen);
  timers.push(setTimeout(() => release(true), 1000));
  poster.src = 'assets/santiago-orbit.webp';
})();
