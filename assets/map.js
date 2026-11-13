// 地图。两层 canvas：底层是点阵陆地（镜头不动就不重画），上层是光束和站点（每帧重画）。
(function (G) {
'use strict';
const ZT = G.ZT, geo = ZT.geo, P = geo.PLACES, D2R = geo.D2R, TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// 世界坐标：x 是经度（-180..180，智利在左、北京在右，航线跨大西洋与欧洲）；y 是 Miller 纵坐标，向北为正。
const pt = p => ({x: p.lon, y: geo.millerY(p.lat)});
const SITES = {
  chile: Object.assign(pt(P.santiago), {rgb: '255,179,71'}),
  beijing: Object.assign(pt(P.beijing), {rgb: '95,225,255'})
};
// 光束从智利出发向右（东），跨大西洋、经欧洲上空弯过去，落在北京。bow=50° 让弧顶正对欧洲中部。
const BOW = 50;
const BEAM = geo.eastArc(P.santiago, P.beijing, 200, BOW).map(p => ({x: p.lon, y: geo.millerY(p.lat)}));
const APEX = BEAM.reduce((a, b) => (b.y > a.y ? b : a));
// 全景取景：北纬 73° 到南纬 58.5°，中心定在智利与北京的经度正中，横向至少放得下光束两端和两侧的余量。
const VIEW = {x: (P.santiago.lon + P.beijing.lon) / 2, top: geo.millerY(73), bottom: geo.millerY(-58.5), minW: 209};
VIEW.y = (VIEW.top + VIEW.bottom) / 2;
VIEW.h = VIEW.top - VIEW.bottom;
// 标签相对站点的位置：ax/ay 是标签自身的锚点（0..1），dx/dy 是离站点的像素偏移。智利在最左，标签放它右边
const CHIPS = {chile: {ax: 0, ay: .5, dx: 26, dy: 0}, beijing: {ax: 0, ay: 0, dx: 20, dy: 26}};
const RING = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [.7, .7], [-.7, .7], [.7, -.7], [-.7, -.7]];
const WARM = [255, 179, 71], WHITE = [255, 246, 228], COOL = [95, 225, 255];
const mix = (a, b, t) => Math.round(lerp(a[0], b[0], t)) + ',' + Math.round(lerp(a[1], b[1], t)) + ',' + Math.round(lerp(a[2], b[2], t));
const beamRgb = t => (t < .5 ? mix(WARM, WHITE, t * 2) : mix(WHITE, COOL, t * 2 - 1));   // 暖色出发，冷色到达
const LEVELS = 10, DAY = .82, NIGHT = .4;

function create(o) {
  const stage = o.stage, base = o.base, fx = o.fx, land = o.land, L = o.labels;
  const bc = base.getContext('2d'), fc = fx.getContext('2d');
  const still = () => !!o.reduced();
  let W = 1, H = 1, dpr = 1, k0 = 1, pitch = 7, wide = true;
  let cam = {x: VIEW.x, y: VIEW.y, k: 1, ax: 0, ay: 0};      // 世界点 (x, y) 落在屏幕 (ax, ay)，k 是每度多少像素
  let view = 'overview', fly = null, inset = {right: 0, bottom: 0};
  let dirty = true, hover = null, raf = 0, born = 0, minute = 0;
  let beam = null, lit = [], chile = [], pulses = [], bursts = [], nextPulse = 0, reveal = 0;
  let hold = 0, spots = {chile: CHIPS.chile, beijing: CHIPS.beijing};
  let dots = {n: 0, x: new Float32Array(4096), y: new Float32Array(4096), r: new Float32Array(4096)};

  const sx = x => (x - cam.x) * cam.k + cam.ax, sy = y => (cam.y - y) * cam.k + cam.ay;
  const ux = px => (px - cam.ax) / cam.k + cam.x, uy = py => cam.y - (py - cam.ay) / cam.k;

  /* ---------- 取景 ---------- */
  function target(name) {
    const fw = W - inset.right, fh = H - inset.bottom;
    if (wide && name === 'chile') return {x: SITES.chile.x, y: (geo.millerY(-17.5) + geo.millerY(-56)) / 2, k: k0 * 2, ax: fw * .47, ay: fh / 2};
    if (wide && name === 'beijing') return {x: 116.6, y: geo.millerY(37.4), k: k0 * 4, ax: fw * .47, ay: fh / 2};
    return {x: VIEW.x, y: VIEW.y, k: k0, ax: W / 2, ay: H / 2};
  }
  function measure() {
    const r = stage.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    dpr = Math.min(G.devicePixelRatio || 1, 2);
    wide = !!o.wide();
    k0 = Math.min(H / VIEW.h, W / VIEW.minW);
    pitch = wide ? clamp(H / 118, 6.4, 10) : clamp(W / 84, 4.4, 7);
    for (const cv of [base, fx]) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    fly = null; cam = target(view); dirty = true;
    // 自我介绍落在光弧右下方、印度洋开阔海域：左边让开马达加斯加（55°E），底部锚在南纬 50°，文字往上自然生长
    const left = W / 2 + (55 - target('overview').x) * k0;
    const bottom = H / 2 - (VIEW.y - geo.millerY(-50)) * k0;
    if (o.onLayout) o.onLayout({wide, k0, left, bottom, width: Math.max(80 * k0, 330)});
  }

  /* ---------- 底层：经纬网 + 点阵陆地 ---------- */
  const lonText = x => { const v = ((Math.round(x) % 360) + 360) % 360; return v === 0 ? '0°' : v === 180 ? '180°' : v < 180 ? v + '°E' : 360 - v + '°W'; };
  const latText = v => (v === 0 ? '0°' : Math.abs(v) + (v > 0 ? '°N' : '°S'));
  function graticule(c) {
    const z = cam.k / k0, minor = z < 1.5 ? 10 : z < 3 ? 5 : 2, major = z < 1.5 ? 30 : 10;
    c.lineWidth = 1; c.font = '500 9.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'; c.textBaseline = 'middle';
    for (let x = Math.ceil(ux(0) / minor) * minor; x <= ux(W); x += minor) {
      const px = Math.round(sx(x)) + .5, big = x % major === 0;
      c.strokeStyle = big ? 'rgba(150,180,225,.075)' : 'rgba(150,180,225,.032)';
      c.beginPath(); c.moveTo(px, 0); c.lineTo(px, H); c.stroke();
      if (big && wide) { c.fillStyle = 'rgba(150,180,225,.36)'; c.textAlign = 'center'; c.fillText(lonText(x), px, 74); }
    }
    for (let lat = -80; lat <= 80; lat += minor) {
      const py = Math.round(sy(geo.millerY(lat))) + .5, big = lat % major === 0;
      if (py < 0 || py > H) continue;
      c.strokeStyle = lat === 0 ? 'rgba(150,180,225,.12)' : big ? 'rgba(150,180,225,.075)' : 'rgba(150,180,225,.032)';
      c.beginPath(); c.moveTo(0, py); c.lineTo(W, py); c.stroke();
      if (big && wide && py > 96 && py < H - 60) { c.fillStyle = 'rgba(150,180,225,.36)'; c.textAlign = 'left'; c.fillText(latText(lat), 9, py - 8); }
    }
  }

  function push(px, py, r) {
    if (dots.n === dots.x.length) for (const k of ['x', 'y', 'r']) { const a = new Float32Array(dots.n * 2); a.set(dots[k]); dots[k] = a; }
    dots.x[dots.n] = px; dots.y[dots.n] = py; dots.r[dots.n++] = r;
  }
  // 扫一级三角点阵。onlyNew：只画这一级比上一级多出来的点（它们随着镜头拉近渐渐显现）。
  function scan(paths, sp, onlyNew, a, sunNow) {
    const rowH = sp * .8660254, foot = pitch / cam.k, r0 = pitch * .225, mid = ux(W / 2);
    const xa = Math.max(ux(-pitch), mid - 180), xb = Math.min(ux(W + pitch), mid + 180);      // 画面比一整圈还宽时，世界只画一遍
    const sinS = Math.sin(sunNow.lat * D2R), cosS = Math.cos(sunNow.lat * D2R);
    for (let j = Math.floor(uy(H + pitch) / rowH), j1 = Math.ceil(uy(-pitch) / rowH); j <= j1; j++) {
      const y = j * rowH, lat = geo.millerLat(y);
      if (lat >= land.latTop || lat <= land.latBottom) continue;
      const odd = j & 1, off = odd ? sp / 2 : 0, shift = (j >> 1) & 1, py = sy(y);
      const sinL = Math.sin(lat * D2R) * sinS, cosL = Math.cos(lat * D2R) * cosS, dLat = foot * .866 * Math.cos(.8 * lat * D2R);
      for (let i = Math.ceil((xa - off) / sp), i1 = Math.floor((xb - off) / sp); i <= i1; i++) {
        if (onlyNew && !odd && !((i - shift) & 1)) continue;          // 这个点上一级已经画过
        const x = i * sp + off, cov = land.cover(x, lat, foot, dLat);
        if (cov < .22) continue;
        const px = sx(x), isCl = land.isChile(x, lat);
        const r = r0 * (.62 + .38 * cov) * (onlyNew ? .55 + .45 * a : 1) * (isCl ? 1.14 : 1);
        const day = smooth(-.16, .09, sinL + cosL * Math.cos((x - sunNow.lon) * D2R));   // 太阳高度角的正弦：晨昏线附近平滑过渡
        const alpha = (isCl ? 1 : lerp(NIGHT, DAY, day) / DAY) * (.5 + .5 * cov) * a;
        const p = paths[(isCl ? LEVELS : 0) + clamp(Math.round(alpha * (LEVELS - 1)), 0, LEVELS - 1)];
        p.moveTo(px + r, py); p.arc(px, py, r, 0, TAU);
        push(px, py, r);
        if (isCl) chile.push(px, py, r);
      }
    }
  }
  function drawBase() {
    const c = bc, z = cam.k / k0, lg = Math.log2(z), lv = Math.floor(lg + .001), f = clamp(lg - lv, 0, 1);
    const sp = pitch / k0 / Math.pow(2, lv), fine = smooth(.1, .9, f), sunNow = geo.sun(Date.now());
    const paths = Array.from({length: LEVELS * 2}, () => new Path2D());
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    graticule(c);
    dots.n = 0; chile = [];
    scan(paths, sp, false, 1, sunNow);
    if (fine > 0) scan(paths, sp / 2, true, fine, sunNow);
    for (let i = 0; i < LEVELS; i++) {
      const a = i / (LEVELS - 1);
      c.fillStyle = 'rgba(160,186,226,' + (a * DAY).toFixed(3) + ')'; c.fill(paths[i]);
      c.fillStyle = 'rgba(255,188,92,' + (.25 + .75 * a).toFixed(3) + ')'; c.fill(paths[LEVELS + i]);
    }
  }

  /* ---------- 光束在屏幕上的位置 ---------- */
  function project() {
    const n = BEAM.length, x = new Float32Array(n), y = new Float32Array(n), s = new Float32Array(n);
    for (let i = 0; i < n; i++) { x[i] = sx(BEAM[i].x); y[i] = sy(BEAM[i].y); s[i] = i ? s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]) : 0; }
    beam = {n, x, y, s, len: s[n - 1]};
    const grad = a => { const g = fc.createLinearGradient(x[0], y[0], x[n - 1], y[n - 1]); g.addColorStop(0, 'rgba(' + WARM + ',' + a + ')'); g.addColorStop(.5, 'rgba(' + WHITE + ',' + a + ')'); g.addColorStop(1, 'rgba(' + COOL + ',' + a + ')'); return g; };
    beam.glow = [grad(.05), grad(.15), grad(.95)];
  }
  // 弧长 sv 处的点；f 是它在整条光束上的比例
  function at(sv) {
    const b = beam; sv = clamp(sv, 0, b.len);
    let lo = 0, hi = b.n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (b.s[mid] <= sv) lo = mid; else hi = mid; }
    const d = b.s[hi] - b.s[lo], t = d > 0 ? (sv - b.s[lo]) / d : 0;
    return {x: lerp(b.x[lo], b.x[hi], t), y: lerp(b.y[lo], b.y[hi], t), i: lo, f: (lo + t) / (b.n - 1)};
  }
  const sOf = u => { const q = clamp(u, 0, 1) * (beam.n - 1), i = Math.min(beam.n - 2, Math.floor(q)); return lerp(beam.s[i], beam.s[i + 1], q - i); };
  function trace(c, s0, s1) {
    const a = at(s0), b = at(s1);
    c.beginPath(); c.moveTo(a.x, a.y);
    for (let i = a.i + 1; i <= b.i; i++) c.lineTo(beam.x[i], beam.y[i]);
    c.lineTo(b.x, b.y);
  }
  // 光束附近的陆地点：光经过时会被照亮
  function nearBeam() {
    lit = [];
    const R = 84, b = beam;
    for (let d = 0; d < dots.n; d++) {
      const x = dots.x[d], y = dots.y[d];
      let best = R * R, bi = -1;
      for (let i = 0; i < b.n; i += 2) { const dx = b.x[i] - x, dy = b.y[i] - y, q = dx * dx + dy * dy; if (q < best) { best = q; bi = i; } }
      if (bi >= 0) lit.push({x, y, r: dots.r[d], s: b.s[bi]});
    }
    lit.sort((p, q) => p.s - q.s);
  }

  /* ---------- 上层：光束、光脉冲、站点 ---------- */
  function drawPulse(c, sv, power) {
    const tail = Math.max(70, beam.len * .14), n = 24;
    let prev = at(sv - tail);
    c.lineCap = 'round';
    for (let q = 1; q <= n; q++) {
      const u = q / n, cur = at(sv - tail * (1 - u));
      c.strokeStyle = 'rgba(' + beamRgb(cur.f) + ',' + (u * u * .9 * power).toFixed(3) + ')';
      c.lineWidth = .6 + 2.8 * u;
      c.beginPath(); c.moveTo(prev.x, prev.y); c.lineTo(cur.x, cur.y); c.stroke();
      prev = cur;
    }
    const h = prev, rgb = beamRgb(h.f), g = c.createRadialGradient(h.x, h.y, 0, h.x, h.y, 28);
    g.addColorStop(0, 'rgba(255,255,255,' + .95 * power + ')'); g.addColorStop(.16, 'rgba(' + rgb + ',' + .75 * power + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
    c.fillStyle = g; c.beginPath(); c.arc(h.x, h.y, 28, 0, TAU); c.fill();
    // 照亮沿途的陆地
    let lo = 0, hi = lit.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (lit[mid].s < sv - 100) lo = mid + 1; else hi = mid; }
    c.fillStyle = 'rgb(' + rgb + ')';
    for (let i = lo; i < lit.length && lit[i].s <= sv + 100; i++) {
      const p = lit[i], d = Math.hypot(p.x - h.x, p.y - h.y);
      if (d > 90) continue;
      const k = (1 - d / 90) * (1 - d / 90) * power;
      c.globalAlpha = .95 * k; c.beginPath(); c.arc(p.x, p.y, p.r * (1.1 + .9 * k), 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
  }
  function drawSite(c, id, t) {
    const s = SITES[id], x = sx(s.x), y = sy(s.y), hot = hover === id || view === id;
    if (x < -70 || x > W + 70 || y < -70 || y > H + 70) return;
    const g = c.createRadialGradient(x, y, 0, x, y, 28);
    g.addColorStop(0, 'rgba(' + s.rgb + ',.45)'); g.addColorStop(1, 'rgba(' + s.rgb + ',0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, 28, 0, TAU); c.fill();
    c.lineWidth = 1;
    if (!still()) for (let q = 0; q < 2; q++) {            // 一圈圈向外扩散
      const p = (t / 2.6 + q / 2) % 1;
      c.strokeStyle = 'rgba(' + s.rgb + ',' + ((1 - p) * (1 - p) * .65).toFixed(3) + ')';
      c.beginPath(); c.arc(x, y, 8 + p * 26, 0, TAU); c.stroke();
    }
    c.strokeStyle = 'rgba(' + s.rgb + ',.95)'; c.lineWidth = 1.3;
    c.beginPath(); c.arc(x, y, 7.5, 0, TAU); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, 2.8, 0, TAU); c.fill();
    if (hot) {                                             // 悬停或已打开：转动的准星
      c.save(); c.translate(x, y); c.rotate(still() ? 0 : t * .8);
      c.strokeStyle = 'rgba(' + s.rgb + ',.85)'; c.setLineDash([5, 6]);
      c.beginPath(); c.arc(0, 0, 14.5, 0, TAU); c.stroke(); c.setLineDash([]);
      for (let q = 0; q < 4; q++) { c.rotate(Math.PI / 2); c.beginPath(); c.moveTo(19, 0); c.lineTo(25, 0); c.stroke(); }
      c.restore();
    }
    // 站点到标签的引线
    const q = spots[id], m = wide ? 1 : .55, len = Math.hypot(q.dx, q.dy), vx = q.dx / len, vy = q.dy / len;
    if (!L[id].classList.contains('off')) {
      c.strokeStyle = 'rgba(' + s.rgb + ',.55)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x + vx * 10, y + vy * 10); c.lineTo(x + q.dx * m, y + q.dy * m); c.stroke();
    }
  }
  function drawFx(now) {
    const c = fc, t = (now - born) / 1000, shown = still() ? 1 : reveal;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);

    c.globalCompositeOperation = 'lighter';
    // 智利在呼吸；指上去更亮
    const breath = (still() ? .12 : .1 + .08 * Math.sin(t * 1.8)) + (hover === 'chile' ? .24 : view === 'chile' ? .08 : 0);
    c.fillStyle = 'rgba(255,179,71,' + breath.toFixed(3) + ')';
    c.beginPath();
    for (let i = 0; i < chile.length; i += 3) { c.moveTo(chile[i] + chile[i + 2] * 1.8, chile[i + 1]); c.arc(chile[i], chile[i + 1], chile[i + 2] * 1.8, 0, TAU); }
    c.fill();

    // 光束本体：三层描边叠出辉光，再加一串顺着方向流动的光点
    if (shown > 0) {
      c.lineCap = 'round'; c.lineJoin = 'round';
      const end = shown * beam.len, widths = [26, 8, 1.9];
      for (let i = 0; i < 3; i++) { c.strokeStyle = beam.glow[i]; c.lineWidth = widths[i]; trace(c, 0, end); c.stroke(); }
      if (!still()) {
        c.setLineDash([2, 20]); c.lineDashOffset = -t * 64; c.strokeStyle = 'rgba(255,255,255,.6)'; c.lineWidth = 1.7;
        trace(c, 0, end); c.stroke(); c.setLineDash([]);
      }
    }
    if (!still()) {
      for (const p of pulses) { const q = (now - p.t0) / p.dur; if (q > 0 && q < 1) drawPulse(c, (.75 * q + .25 * smooth(0, 1, q)) * beam.len, 1); }
      if (fly && fly.ride > 0) drawPulse(c, sOf(fly.e), 1);
      for (const u of bursts) {                             // 光到达时，北京亮一下
        const q = (now - u.t0) / 1100, s = SITES[u.id];
        c.strokeStyle = 'rgba(' + s.rgb + ',' + ((1 - q) * (1 - q) * .9).toFixed(3) + ')'; c.lineWidth = 2 - q;
        c.beginPath(); c.arc(sx(s.x), sy(s.y), 8 + 52 * (1 - (1 - q) * (1 - q)), 0, TAU); c.stroke();
      }
    }
    c.globalCompositeOperation = 'source-over';
    for (const id in SITES) drawSite(c, id, t);
  }

  /* ---------- 地图上的标签（真正的 DOM 元素） ---------- */
  function put(el, x, y, ax, ay, show) {
    const w = el.offsetWidth, h = el.offsetHeight, left = x - ax * w, top = y - ay * h;
    el.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
    el.classList.toggle('off', !(show && left > -w * .5 && left + w * .5 < W - inset.right && top > -h * .5 && top + h * .5 < H - inset.bottom));
  }
  function place() {
    const z = cam.k / k0, m = wide ? 1 : .55;
    for (const id in CHIPS) {
      const s = SITES[id], x = sx(s.x), w = L[id].offsetWidth;
      const q = CHIPS[id];
      spots[id] = q;
      // 全屏宽模式下“北京”标签悬在城市点左上方，避开左下角 intro 卡片
      if (id === 'beijing' && wide) put(L[id], x - 18, sy(s.y) - 16, 1, 1, view === 'overview' || view === id);
      else put(L[id], x + q.dx * m, sy(s.y) + q.dy * m, q.ax, q.ay, view === 'overview' || view === id);
    }
    // “航线 20,040 KM”标签悬在光弧顶点下方：扫描光束折线，取落在标签横向范围内的
    // 最大屏幕 y，再把标签放到“辉光下缘(半宽 13px)再留 8px”之下，任何尺寸都不被光束压字。
    // 极窄宽屏下标签右端可能碰到“北京”标签，向左收到其左缘之外（所需的 y 由扫描自动加深）。
    const tw = L.tag.offsetWidth, tx = Math.min(sx(APEX.x), sx(SITES.beijing.x) - 18 - L.beijing.offsetWidth - tw / 2 - 6);
    let ty = sy(APEX.y) + 34;
    for (let i = 0, x0 = tx - tw / 2 - 2, x1 = tx + tw / 2 + 2; i < BEAM.length; i++) {
      const X = sx(BEAM[i].x);
      if (X < x0 || X > x1) continue;
      const Y = sy(BEAM[i].y) + 21;
      if (Y > ty) ty = Y;
    }
    put(L.tag, tx, ty, .5, 0, wide && view === 'overview' && !fly && reveal >= 1);
  }

  /* ---------- 镜头 ---------- */
  const beamAt = u => { const q = clamp(u, 0, 1) * (BEAM.length - 1), i = Math.min(BEAM.length - 2, Math.floor(q)), t = q - i; return {x: lerp(BEAM[i].x, BEAM[i + 1].x, t), y: lerp(BEAM[i].y, BEAM[i + 1].y, t)}; };
  function stepFly(now) {
    const a = fly;
    if (!a.t0) a.t0 = now;
    const t = clamp((now - a.t0) / a.dur, 0, 1), e = a.ride ? (t < .5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)) : ease(t);
    let x = lerp(a.from.x, a.to.x, e), y = lerp(a.from.y, a.to.y, e), k = a.from.k * Math.pow(a.to.k / a.from.k, e);
    if (a.ride) {                                          // 两个站点之间：镜头沿着光束飞，途中拉远
      const u = a.ride > 0 ? e : 1 - e, p = beamAt(u), p0 = beamAt(a.ride > 0 ? 0 : 1), p1 = beamAt(a.ride > 0 ? 1 : 0);
      x = p.x + lerp(a.from.x - p0.x, a.to.x - p1.x, e); y = p.y + lerp(a.from.y - p0.y, a.to.y - p1.y, e);
      k *= Math.pow(1.35 * k0 / Math.sqrt(a.from.k * a.to.k), Math.pow(Math.sin(Math.PI * t), 2));
      a.e = u;
    }
    cam = {x, y, k, ax: lerp(a.from.ax, a.to.ax, e), ay: lerp(a.from.ay, a.to.ay, e)};
    dirty = true;
    if (t >= 1) { cam = a.to; fly = null; if (a.ride > 0) bursts.push({id: 'beijing', t0: now}); }
  }
  function flyTo(name, opt) {
    const prev = view, to = target(name);
    view = name; reveal = 1;
    if (still() || !wide || (opt && opt.jump)) { fly = null; cam = to; dirty = true; kick(); return; }
    const ride = prev !== 'overview' && name !== 'overview' && prev !== name ? (name === 'beijing' ? 1 : -1) : 0;
    const far = Math.hypot(to.x - cam.x, to.y - cam.y) * k0;
    fly = {from: cam, to, t0: 0, dur: ride ? 3200 : clamp(700 + far * .8, 850, 1500), ride, e: ride > 0 ? 0 : 1};
    if (ride) hold = 4600;
    dirty = true; kick();
  }

  /* ---------- 每一帧 ---------- */
  function frame(now) {
    raf = 0;
    if (!born) { born = now; pulses.push({t0: now + 450, dur: 2700, first: true}); nextPulse = now + 450 + 5600; }
    if (hold) { nextPulse = now + hold; hold = 0; }        // 推迟下一束光：刚飞完一程，或者页面刚切回来
    if (fly) stepFly(now);
    if (still()) { reveal = 1; pulses = []; bursts = []; }
    const m = Math.floor(Date.now() / 60000);
    if (m !== minute) { minute = m; dirty = true; }        // 晨昏线每分钟挪一点
    if (dirty) { project(); drawBase(); if (!fly) nearBeam(); dirty = false; place(); }
    if (!still()) {
      if (now >= nextPulse) { pulses.push({t0: now, dur: 2700}); nextPulse = now + 5600; }
      pulses = pulses.filter(p => {
        const q = (now - p.t0) / p.dur;
        if (p.first && q > 0) { const was = reveal; reveal = Math.max(reveal, Math.min(1, .75 * q + .25 * smooth(0, 1, q))); if (was < 1 && reveal >= 1) place(); }
        if (q >= 1) bursts.push({id: 'beijing', t0: now});
        return q < 1;
      });
      bursts = bursts.filter(u => now - u.t0 < 1100);
    }
    drawFx(now);
    if (!still() && !document.hidden) raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  /* ---------- 指针 ---------- */
  function pick(px, py, tol) {
    for (const id in SITES) if (Math.hypot(px - sx(SITES[id].x), py - sy(SITES[id].y)) <= 20 + tol) return id;
    for (const q of RING) if (land.isChile(ux(px + q[0] * tol), geo.millerLat(uy(py + q[1] * tol)))) return 'chile';
    return null;
  }
  function setHover(id) {
    if (id === hover) return;
    hover = id; stage.style.cursor = id ? 'pointer' : '';
    if (o.onHover) o.onHover(id);
    kick();
  }
  const local = e => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  stage.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const chip = e.target.closest && e.target.closest('.chip');
    setHover(chip ? chip.dataset.go : view === 'overview' ? pick(...local(e), 7) : null);
  });
  stage.addEventListener('pointerleave', () => setHover(null));
  stage.addEventListener('click', e => {
    if (e.target.closest('.chip') || view !== 'overview') return;
    const id = pick(...local(e), matchMedia('(pointer:coarse)').matches ? 16 : 7);
    if (id && o.onPick) o.onPick(id);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { hold = 900; kick(); } });

  measure(); kick();
  return {
    flyTo, setHover, kick,
    resize() { measure(); kick(); },
    setInset(v) { inset = {right: v.right || 0, bottom: v.bottom || 0}; if (!fly) { cam = target(view); dirty = true; } else fly.to = target(view); kick(); }
  };
}

G.ZTMap = {create};
})(window);
