// 临时的端到端检查脚本（不进仓库）。用法：node e2e.mjs <场景> ...
import {createRequire} from 'node:module';
import fs from 'node:fs';
const require = createRequire('/opt/playwright-mcp/node_modules/');
const {chromium} = require('playwright');

const OUT = '/tmp/zt-homepage-build/shots';
fs.mkdirSync(OUT, {recursive: true});
const URL_HTTP = 'http://127.0.0.1:47613/index.html';
const URL_FILE = 'file:///root/zhangteng-homepage/index.html';
const which = process.argv.slice(2);
const want = name => !which.length || which.includes(name);
const log = (...a) => console.log(...a);
let failed = 0;
const check = (ok, what) => { if (!ok) failed++; log((ok ? '  ok   ' : '  FAIL ') + what); };

const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox']});
async function open(opt = {}) {
  const ctx = await browser.newContext({viewport: opt.viewport || {width: 1440, height: 900}, reducedMotion: opt.reduced ? 'reduce' : 'no-preference', hasTouch: !!opt.touch, deviceScaleFactor: opt.dpr || 1});
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  if (opt.clock) await page.clock.install({time: new Date(opt.clock)});
  await page.goto((opt.url || URL_HTTP) + (opt.hash || ''));
  return {ctx, page, errors};
}
const shot = (page, name) => page.screenshot({path: `${OUT}/${name}.png`});
const state = page => page.evaluate(() => ({
  hash: location.hash, mode: document.documentElement.dataset.mode, site: document.documentElement.classList.contains('is-site'),
  open: [...document.querySelectorAll('.site.open')].map(e => e.id), clock: document.getElementById('t-cl').textContent,
  focus: document.activeElement && (document.activeElement.id || document.activeElement.className || document.activeElement.tagName)
}));
// 画布上某一块区域里有多少非透明像素
const ink = (page, id, x, y, w, h) => page.evaluate(([id, x, y, w, h]) => { const c = document.getElementById(id), d = c.getContext('2d').getImageData(x, y, w, h).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return n; }, [id, x, y, w, h]);

if (want('file')) {
  log('file:// 直接打开');
  const {ctx, page, errors} = await open({url: URL_FILE});
  await page.waitForTimeout(3600);
  let s = await state(page);
  check(s.mode === 'wide' && /^\d\d:\d\d:\d\d$/.test(s.clock), '脚本跑起来了：' + JSON.stringify(s));
  check(await ink(page, 'map-base', 0, 0, 1440, 900) > 20000, '底层画出了陆地');
  check(await ink(page, 'map-fx', 0, 0, 1440, 900) > 3000, '上层画出了光束');
  await page.mouse.click(1203, 800);                       // 点智利的国土
  await page.waitForTimeout(1800);
  s = await state(page);
  check(s.hash === '#chile' && s.open.join() === 'chile', '点智利 → 打开智利面板：' + JSON.stringify(s));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  s = await state(page);
  check(!s.site && s.open.length === 0 && s.hash === '', 'Esc 回到全景：' + JSON.stringify(s));
  await page.goBack(); await page.waitForTimeout(300);
  check((await state(page)).open.join() === 'chile', '浏览器后退 → 回到智利面板');
  check(errors.length === 0, '没有报错 ' + errors.join(' | '));
  await ctx.close();
}

if (want('reveal')) {
  log('开场：光从智利射向北京（固定时钟，逐帧截图）');
  const {ctx, page, errors} = await open({clock: '2026-11-11T04:00:00Z'});
  for (const ms of [400, 900, 1500, 2100, 2800, 3300, 3800]) { await page.clock.runFor(ms - (page._t || 0)); page._t = ms; await shot(page, 'reveal-' + String(ms).padStart(4, '0')); }
  check(errors.length === 0, '没有报错 ' + errors.join(' | '));
  await ctx.close();
}

if (want('ride')) {
  log('智利 → 北京：镜头沿光束飞');
  const {ctx, page, errors} = await open({clock: '2026-11-11T16:00:00Z'});
  await page.clock.runFor(4000);
  await page.click('#chip-chile'); await page.clock.runFor(2000); await shot(page, 'ride-0-chile');
  await page.click('#chile .site-next a');
  let t = 0;
  for (const ms of [300, 900, 1600, 2200, 2800, 3300, 4400]) { await page.clock.runFor(ms - t); t = ms; await shot(page, 'ride-' + String(ms).padStart(4, '0')); }
  check((await state(page)).open.join() === 'beijing', '到北京后面板打开');
  await page.click('#beijing .site-next a');
  t = 0;
  for (const ms of [1600, 4400]) { await page.clock.runFor(ms - t); t = ms; await shot(page, 'back-' + String(ms).padStart(4, '0')); }
  check((await state(page)).open.join() === 'chile', '逆着光回到智利');
  check(errors.length === 0, '没有报错 ' + errors.join(' | '));
  await ctx.close();
}

if (want('reduced')) {
  log('减少动态效果');
  const {ctx, page, errors} = await open({reduced: true});
  await page.waitForTimeout(600);
  await shot(page, 'reduced-overview');
  check(await ink(page, 'map-fx', 0, 0, 1440, 900) > 3000, '光束直接完整画出');
  const frames = await page.evaluate(() => new Promise(r => { let n = 0; const raf = window.requestAnimationFrame; window.requestAnimationFrame = f => { n++; return raf(f); }; setTimeout(() => r(n), 700); }));
  check(frames === 0, '没有持续的动画循环（700ms 内请求了 ' + frames + ' 帧）');
  await page.click('#chip-beijing'); await page.waitForTimeout(300);
  await shot(page, 'reduced-beijing');
  const s = await state(page);
  check(s.open.join() === 'beijing', '点北京 → 面板直接出现：' + JSON.stringify(s));
  await page.click('a[href="#chile"][data-ride]'); await page.waitForTimeout(300);
  check((await state(page)).open.join() === 'chile', '切到智利不等动画');
  await page.click('[data-act="approve-upgrade"]'); await page.waitForTimeout(300);
  check(await page.locator('.hx-ctl.halt').count() === 1, '演练不加延时，直接停在失败步骤');
  await shot(page, 'reduced-chile');
  check(errors.length === 0, '没有报错 ' + errors.join(' | '));
  await ctx.close();
}

if (want('keys')) {
  log('只用键盘');
  const {ctx, page, errors} = await open();
  await page.waitForTimeout(3600);
  await page.keyboard.press('Tab');
  let s = await state(page);
  check(s.focus === 'chip-chile', '第一个焦点是智利：' + s.focus);
  await page.keyboard.press('Enter'); await page.waitForTimeout(1700);
  s = await state(page);
  check(s.open.join() === 'chile' && s.focus === 'chile', '回车打开，焦点进面板：' + JSON.stringify(s));
  await page.keyboard.press('Tab');
  check((await state(page)).focus === 'site-x', '面板里第一个可聚焦的是关闭按钮');
  await page.keyboard.press('Escape'); await page.waitForTimeout(1700);
  s = await state(page);
  check(!s.site && s.focus === 'chip-chile', 'Esc 关闭，焦点回到智利的标签：' + JSON.stringify(s));
  await shot(page, 'keys-focus');
  check(errors.length === 0, '没有报错 ' + errors.join(' | '));
  await ctx.close();
}

if (want('sizes')) {
  log('各种窗口');
  for (const [w, h] of [[2560, 1440], [1920, 1080], [1536, 730], [1280, 720], [1366, 657], [1024, 768], [1100, 650], [960, 660], [900, 700], [3440, 1440], [1000, 600]]) {
    const {ctx, page, errors} = await open({viewport: {width: w, height: h}, clock: '2026-11-11T04:00:00Z'});
    await page.clock.runFor(5200);
    await shot(page, `size-${w}x${h}`);
    const over = await page.evaluate(() => {
      const r = id => document.getElementById(id).getBoundingClientRect(), hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const intro = r('intro'), foot = document.querySelector('.route').getBoundingClientRect();
      return {mode: document.documentElement.dataset.mode, cl: hit(intro, r('chip-chile')), bj: hit(intro, r('chip-beijing')), foot: hit(intro, foot), introH: Math.round(intro.height)};
    });
    check(!over.cl && !over.bj && !over.foot && errors.length === 0, `${w}×${h} ${JSON.stringify(over)} ${errors.join(' | ')}`);
    await ctx.close();
  }
}

if (want('mobile')) {
  log('手机');
  const {ctx, page, errors} = await open({viewport: {width: 390, height: 844}, touch: true, dpr: 3});
  await page.waitForTimeout(3800);
  await shot(page, 'mobile-overview');
  let s = await state(page);
  check(s.mode === 'stack', '窄屏布局');
  await page.tap('#chip-chile'); await page.waitForTimeout(900);
  s = await state(page);
  check(s.open.join() === 'chile', '点智利 → 面板从底部升起');
  await shot(page, 'mobile-chile');
  await page.evaluate(() => document.getElementById('harness').scrollIntoView());
  await page.tap('[data-act="approve-upgrade"]'); await page.waitForTimeout(4200);
  await page.evaluate(() => { document.querySelector('#chile .site-body').scrollTop = document.getElementById('harness').offsetTop + 130; });
  await shot(page, 'mobile-halted');
  await page.tap('#chile .site-x'); await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await page.locator('#map-fx').boundingBox();
  await page.touchscreen.tap(box.x + box.width * .915, box.y + box.height * .8);     // 点地图上的智利
  await page.waitForTimeout(800);
  check((await state(page)).open.join() === 'chile', '直接点地图上的智利也能打开');
  await page.tap('a[href="#beijing"][data-ride]'); await page.waitForTimeout(900);
  await shot(page, 'mobile-beijing');
  for (const id of ['xiaobei', 'evolve', 'workbench']) { await page.evaluate(id => { document.querySelector('#beijing .site-body').scrollTop = document.getElementById(id).offsetTop - 6; }, id); await page.waitForTimeout(150); await shot(page, 'mobile-' + id); }
  const wide = await page.evaluate(() => [...document.querySelectorAll('.site.open *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.ev-wrap, pre')).map(e => e.className || e.tagName).slice(0, 8));
  check(wide.length === 0, '面板里没有横向溢出的元素 ' + wide.join(','));
  check(errors.length === 0, '没有报错 ' + errors.join(' | '));
  await ctx.close();
}

await browser.close();
log(failed ? `\n${failed} 项没过` : '\n全部通过');
process.exit(failed ? 1 : 0);
