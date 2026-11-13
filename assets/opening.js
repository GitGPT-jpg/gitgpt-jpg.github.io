// 开场动画：旋转的地球 → 真实地图"虚拟化"成点阵 → 点亮智利 → 高亮北京 → 光弧相连 → 光束抵达北京 → 名片卡缓缓浮现。
// 只在页面打开的前几秒出现一次；随后把舞台交还给 map.js 的日常动画（呼吸、光脉冲、镜头飞行）。
// 数据完全来自 land.js 的陆地位图和页面现成的点阵，不引入任何外部资源。
(function () {
'use strict';
const G = window, ZT = G.ZT, geo = ZT.geo, P = geo.PLACES, D2R = geo.D2R;
const cv = G.document.getElementById('opening-cv');
const el = G.document.getElementById('opening');
const map = G.ZT && G.ZT.map;
if (!cv || !el || !map) return;

// 减少动态效果：跳过开场，直接呈现最终页面
if (matchMedia('(prefers-reduced-motion: reduce)').matches) { map.finishOpening(); return; }

G.ZT_openingReady = true;                               // 告诉 map.js：开场脚本在位，别用 4 秒兜底
document.documentElement.classList.add('is-opening');      // 顶栏、页脚、名片卡先藏起来
const ctx = cv.getContext('2d');

const TAU = Math.PI * 2;
const RANGE = 38 * D2R;                                 // 球面可见半径
const CENTER = -32 * D2R;                               // 散开成点阵后球心的经度（北大西洋中部）
const FL = .52;                                         // 斜视的远近压缩
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// —— 时间轴（毫秒）——
const T_DISSOLVE_A = 2400, T_DISSOLVE_B = 3300;         // 点阵从球面散开、落到页面上
const T_GLOBE_FADE_A = 2500, T_GLOBE_FADE_B = 3300;     // 真实纹理随散开淡出
const T_CHILE_FLASH = 2700;                             // 点亮智利（两圈琥珀色闪光）
const T_BEIJING_RING = 3300;                            // 高亮北京（两圈冷色光环）
const T_BEGIN = 3450;                                   // 交还地图：智利暖化、光束出发
const T_OVERLAY_FADE = 3700;                            // 遮罩淡出

// —— 地球纹理：land.js 的陆地位图在 Miller 网格上采样（与页面点阵同构）——
const SUN = geo.sun(Date.now());
const sinS = Math.sin(SUN.lat * D2R), cosS = Math.cos(SUN.lat * D2R);
const LAND_LA = [], LAND_LON = [], LAND_STYLE = [];
{
  const land = ZT.createLand(G.ZT_LAND);
  for (let my = -59; my <= 74; my += .6) {
    const lat = geo.millerLat(my), la = lat * D2R;
    for (let lon = -178; lon <= 178; lon += .6) {
      if (!land.isLand(lon, lat)) continue;
      const day = smooth(-.16, .09, Math.sin(la) * sinS + Math.cos(la) * cosS * Math.cos(lon * D2R - SUN.lon * D2R));
      // 白昼的陆地偏土黄，黑夜沉成深蓝
      const r = Math.round(20 + 96 * day), g = Math.round(28 + 92 * day), b = Math.round(44 + 74 * day);
      LAND_LA.push(la); LAND_LON.push(lon * D2R); LAND_STYLE.push('rgb(' + r + ',' + g + ',' + b + ')');
    }
  }
}

// 球面正交投影（s 是视线纬度）：结果写进 bX/bY/bZ，bZ 为深度
let bX = 0, bY = 0, bZ = 0;
function ball(la, dLon, s) {
  const cl = Math.cos(la), sl = Math.sin(la), sd = Math.sin(dLon), cd = Math.cos(dLon), cs = Math.cos(s), ss = Math.sin(s);
  bX = sd * cl;
  bY = cs * sl - ss * cl * cd;
  bZ = ss * sl + cs * cl * cd;
}
const CAP = Math.cos(RANGE), DISK = Math.sin(RANGE), INV = 1 / (1 - CAP);

// —— 页面上现成的点阵（等 map 首帧画完再取）——
let DOTS = null;
function buildDots(d) {
  const land = ZT.createLand(G.ZT_LAND), n = d.n;
  const o = {n, x: new Float32Array(n), y: new Float32Array(n), r: new Float32Array(n), la: new Float32Array(n), lon: new Float32Array(n), cl: new Uint8Array(n)};
  for (let i = 0; i < n; i++) {
    o.x[i] = d.x[i]; o.y[i] = d.y[i]; o.r[i] = d.r[i];
    const lat = geo.millerLat(d.wy[i]);
    o.la[i] = lat * D2R; o.lon[i] = d.wx[i] * D2R;
    o.cl[i] = land.isChile(d.wx[i], lat) ? 1 : 0;
  }
  return o;
}

let W = 0, H = 0, dpr = 1, off = {x: 0, y: 0};
function resize() {
  dpr = G.devicePixelRatio || 1;
  W = cv.clientWidth; H = cv.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const r = G.document.getElementById('stage').getBoundingClientRect();   // 舞台在视口中的偏移（窄屏时地图是一条横带）
  off = {x: r.left, y: r.top};
}
G.addEventListener('resize', resize); resize();

const sitePos = id => { const p = id === 'chile' ? P.santiago : P.beijing, s = map.w2s(p.lon, p.lat); return [s[0] + off.x, s[1] + off.y]; };
const site = {chile: sitePos('chile'), beijing: sitePos('beijing')};

function ring(x, y, q, r0, r1, a, rgb) {
  if (q <= 0 || q >= 1) return;
  ctx.strokeStyle = 'rgba(' + rgb + ',' + (a * (1 - q) * (1 - q)).toFixed(3) + ')';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r0 + q * r1, 0, TAU); ctx.stroke();
}

let raf = 0, done = false, t0 = 0, began = false, faded = false, remover = 0;
function endShow() {                                     // 正常放完：遮罩已淡出，交还页面
  if (done) return; done = true;
  cancelAnimationFrame(raf); clearTimeout(remover);
  el.remove();
}
function skip() {                                        // 用户跳过：直接呈现最终画面
  if (done) return; done = true;
  cancelAnimationFrame(raf); clearTimeout(remover);
  el.remove();
  map.finishOpening();
}
G.document.getElementById('opening-skip').addEventListener('click', skip);

function frame(now) {
  if (done) return;
  if (!t0) t0 = now;
  const t = now - t0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#04070d';
  ctx.fillRect(0, 0, W, H);

  const cx = W * .5, cy = H * .55, Rc = Math.min(W, H) * .5;
  const alpha = smooth(T_DISSOLVE_A, T_DISSOLVE_B, t);   // 0：还是真实地图球；1：完全散成页面点阵
  const globe = 1 - smooth(T_GLOBE_FADE_A, T_GLOBE_FADE_B, t);
  const s = .34 - .18 * smooth(0, 2200, t);              // 视线从南纬慢慢转到中纬（智利 → 京沪之间）
  const lonOff = CENTER + .55 * t / 1000;                // 地球自转，渐渐停在北大西洋中部

  // —— 真实地图球面：深海圆盘 + 阳光明暗的陆地纹理 ——
  if (globe > .02) {
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(Rc, Rc * FL);
    ctx.fillStyle = 'rgba(9,17,31,' + globe.toFixed(3) + ')';
    ctx.beginPath(); ctx.arc(0, 0, DISK, 0, TAU); ctx.fill();
    ctx.globalAlpha = globe;
    for (let i = 0; i < LAND_LA.length; i++) {
      ball(LAND_LA[i], LAND_LON[i] - lonOff, s);
      if (bZ <= CAP) continue;
      ctx.fillStyle = LAND_STYLE[i];
      ctx.fillRect(bX - .006, -bY - .006, .012, .012);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // —— 点阵从球面散开，原样飞回页面上的位置（智利点已带暖色）——
  if (DOTS && alpha > .03) {
    const late = smooth(3000, T_DISSOLVE_B, t);          // 球背面的点：最后再悄悄现身
    for (let i = 0; i < DOTS.n; i++) {
      ball(DOTS.la[i], DOTS.lon[i] - lonOff, s);
      const gx = cx + bX * Rc, gy = cy - bY * Rc * FL, px = DOTS.x[i] + off.x, py = DOTS.y[i] + off.y;
      const x = gx + (px - gx) * alpha, y = gy + (py - gy) * alpha;
      let a = bZ > CAP ? alpha * (.35 + .65 * (bZ - CAP) * INV) : late;
      a *= .4 + .6 * Math.min(1, DOTS.r[i] / 2.4);
      if (a <= .02) continue;
      ctx.fillStyle = DOTS.cl[i] ? 'rgba(255,190,96,' + a.toFixed(3) + ')' : 'rgba(163,189,229,' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, y, Math.max(.9, DOTS.r[i]), 0, TAU); ctx.fill();
    }
  }

  // —— 点亮智利：两圈琥珀色闪光 ——
  for (let k = 0; k < 2; k++) ring(site.chile[0], site.chile[1], smooth(T_CHILE_FLASH + k * 160, T_CHILE_FLASH + 800 + k * 160, t), 8, 30, .95, '255,190,96');
  // —— 高亮北京：两圈冷色光环（随后光束才从智利出发）——
  for (let k = 0; k < 2; k++) ring(site.beijing[0], site.beijing[1], smooth(T_BEIJING_RING + k * 160, T_BEIJING_RING + 800 + k * 160, t), 8, 34, .9, '110,225,255');

  if (!began && t >= T_BEGIN) { began = true; map.begin(); }
  if (!faded && t >= T_OVERLAY_FADE) { faded = true; el.classList.add('fade'); remover = setTimeout(endShow, 720); }

  if (t > 7000) endShow();
  raf = requestAnimationFrame(frame);
}

// 等 map 首帧把点阵铺好，再开演
(function tryDots() {
  const d = map.dots();
  if (d && d.n > 2) { DOTS = buildDots(d); resize(); site.chile = sitePos('chile'); site.beijing = sitePos('beijing'); raf = requestAnimationFrame(frame); }
  else raf = requestAnimationFrame(tryDots);
})();
})();
