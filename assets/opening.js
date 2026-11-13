// 开场动画：旋转的真实谷歌地球 → 全息扫描逐渐数字化成 3D 点阵球 → 展开为页面点状地图 → 点亮智利 → 高亮北京 → 光弧相连 → 名片浮现。
// 只在页面打开的前几秒出现一次；随后把舞台交还给 map.js 的日常动画（呼吸、光脉冲、镜头飞行）。
// 地球球面纹理来自 NASA 公开影像（Blue Marble 昼半球 + 夜间城市灯光），随仓库内置，无运行时外部请求；
// 纹理未就绪时回退程序化噪点地球。点位完全来自 land.js 与页面现成的点阵。
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
document.documentElement.classList.add('is-opening');   // 顶栏、页脚、名片卡先藏起来
const ctx = cv.getContext('2d');

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// —— 时间轴（毫秒）：真实谷歌地球旋转 → 全息扫描数字化 → 3D 点云展开为平面地图 → 点亮智利/北京 & 光束 ——
const T_SCAN_A = 1150, T_SCAN_B = 2450;                 // 数字化扫描波从西向东扫过真实地球，扫过处化为发光数字点云
const T_UNFOLD_A = 2250, T_UNFOLD_B = 3350;             // 3D 数字点云球平滑解构展开，精准落位到 2D 页面点阵
const T_CHILE_FLASH = 2850;                             // 点亮智利（琥珀色脉冲光环）
const T_BEIJING_RING = 3350;                            // 高亮北京（冷青色响应光环）
const T_BEGIN = 3480;                                   // 交还地图：智利暖化、跨洋光束出发
const T_OVERLAY_FADE = 3720;                            // 开场遮罩淡出

// —— 确定性伪随机与球面多频噪声（用于生成逼真的卫星地形、植被、沙漠、云层纹理）——
const fract = x => x - Math.floor(x);
const hash2 = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return lerp(lerp(hash2(ix, iy), hash2(ix + 1, iy), u), lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), u), v);
}
const fbm = (x, y) => .54 * vnoise(x, y) + .3 * vnoise(x * 2.07 + 13.7, y * 2.07 + 9.2) + .16 * vnoise(x * 4.23 - 7.1, y * 4.23 + 19.4);

// —— 星空背景粒子 ——
const STARS = [];
for (let i = 0; i < 140; i++) {
  STARS.push({
    u: hash2(i * 1.3, 7.1),
    v: hash2(i * 2.7, 19.3),
    r: .45 + 1.15 * Math.pow(hash2(i * 5.1, 3.7), 2),
    a: .18 + .55 * hash2(i * 3.9, 11.2),
    ph: hash2(i * 7.3, 29.1) * TAU,
    c: i % 5 === 0 ? '185,220,255' : i % 7 === 0 ? '255,228,195' : '220,235,255'
  });
}

// —— 预计算真实卫星级地球球面采样库（等面积 Fibonacci 球面 + 高密度的海岸与大陆细节）——
const land = ZT.createLand(G.ZT_LAND);
const SUN = geo.sun(Date.now());
// 为了让开场地球既有立体晨昏光影，又能看清南美到大西洋再到欧亚的壮丽蓝色星球，主光源固定在左上方偏暖阳光角度
const L_DIR = [-0.42, 0.36, 0.833];

// 程序化云层：大气环流云带（赤道辐合带、中纬气旋涡旋）——叠加在真实卫星影像上，作为影像未就绪时的回退与细节补充
function sampleCloud(lonDeg, latDeg) {
  const nx = lonDeg * .045, ny = latDeg * .045;
  const n1 = fbm(nx, ny), n2 = fbm(nx * 2.4 + 31.4, ny * 2.4 - 18.2);
  const swirl = Math.sin(lonDeg * D2R * 3.2 + n1 * 4.2) * Math.cos((latDeg - 8) * D2R * 2.6 - n2 * 3.5);
  return clamp((fbm(lonDeg * .055 + swirl * .8, latDeg * .075 - swirl * .6) - .54) * 2.6, 0, 1) * (.35 + .65 * smooth(78, 52, Math.abs(latDeg)));
}

// 根据经纬度计算逼真的 Blue Marble 卫星色彩（海洋深浅 + 陆地森林/草原/沙漠/高山/冰原 + 云层）
function sampleEarthColor(lonDeg, latDeg) {
  const isL = land.isLand(lonDeg, latDeg);
  const absLat = Math.abs(latDeg);
  const nx = lonDeg * .045, ny = latDeg * .045;
  const n1 = fbm(nx, ny), n2 = fbm(nx * 2.4 + 31.4, ny * 2.4 - 18.2);
  const cloud = sampleCloud(lonDeg, latDeg);

  let r, g, b;
  if (!isL) {
    // 海洋：探测近岸大陆架浅海 vs 深海海沟
    const coast = (land.isLand(lonDeg + 1.6, latDeg) || land.isLand(lonDeg - 1.6, latDeg) || land.isLand(lonDeg, latDeg + 1.4) || land.isLand(lonDeg, latDeg - 1.4)) ? 1 : 0;
    const shelf = coast * .65 + clamp((n1 - .45) * .9, 0, .45);
    const warmSea = smooth(58, 12, absLat);
    r = 6 + 14 * shelf + 6 * warmSea;
    g = 24 + 54 * shelf + 18 * warmSea;
    b = 58 + 72 * shelf + 32 * warmSea;
  } else {
    // 陆地生物群落：热带雨林、温带森林/草原、副热带荒漠带（撒哈拉/阿拉伯/中亚/澳洲/阿塔卡马）、高山与极地冰原
    const desertBelt = smooth(14, 24, absLat) * smooth(42, 30, absLat);
    const saharaArabia = desertBelt * smooth(-18, 8, lonDeg) * smooth(78, 52, lonDeg);
    const centralAsia = smooth(32, 42, latDeg) * smooth(50, 40, latDeg) * smooth(52, 72, lonDeg) * smooth(112, 95, lonDeg) * .75;
    const australia = smooth(-32, -20, latDeg) * smooth(-14, -22, latDeg) * smooth(114, 124, lonDeg) * smooth(150, 140, lonDeg) * .85;
    const atacama = smooth(-32, -20, latDeg) * smooth(-14, -22, latDeg) * smooth(-74, -67, lonDeg) * .7;
    const arid = clamp(Math.max(saharaArabia, centralAsia, australia, atacama) + (n1 - .46) * .55 * desertBelt, 0, 1);

    const tropic = smooth(25, 4, absLat) * (1 - arid * .8);
    const boreal = smooth(46, 62, absLat) * smooth(74, 64, absLat);
    const snow = clamp(smooth(64, 76, absLat) + smooth(27, 36, latDeg) * smooth(40, 32, latDeg) * smooth(74, 82, lonDeg) * smooth(102, 94, lonDeg) * .65 * n2, 0, 1);

    // 基底温带植被绿与森林深绿
    r = 34 + 32 * n1 - 14 * tropic - 8 * boreal;
    g = 74 + 38 * n1 + 18 * tropic - 14 * boreal;
    b = 42 + 16 * n1 - 8 * tropic + 6 * boreal;

    // 叠加上干旱沙漠暖金ochre色
    r = lerp(r, 178 + 38 * n2, arid);
    g = lerp(g, 146 + 32 * n2, arid);
    b = lerp(b, 96 + 22 * n2, arid);

    // 山脉褶皱明暗与高纬极地冰雪
    const ridge = (n2 - .5) * 32;
    r = clamp(r + ridge, 18, 235);
    g = clamp(g + ridge * .9, 26, 235);
    b = clamp(b + ridge * .7, 22, 240);

    r = lerp(r, 232, snow);
    g = lerp(g, 240, snow);
    b = lerp(b, 250, snow);
  }
  return {r, g, b, cloud, isL};
}

// 离屏球面渲染缓冲（184×184 像素正圆球面逐像素渲染，兼顾 60fps 丝滑帧率与真实谷歌地球连续纹理质感）
const G_RES = 184;
const gCv = G.document.createElement('canvas');
gCv.width = G_RES; gCv.height = G_RES;
const gCtx = gCv.getContext('2d');
const gImg = gCtx.createImageData(G_RES, G_RES);
const gData = gImg.data;

// 预烘焙一张 720×360（0.5° 精度）的等距圆柱地球 RGB+云层+海陆贴图，渲染球体时 O(1) 查表插值，每帧 < 1.5ms
// 这是程序化回退纹理：真实 NASA 影像加载完成后由 bakeRealTextures 覆盖，并追加夜间城市灯光贴图
const TEX_W = 720, TEX_H = 360;
const texR = new Uint8Array(TEX_W * TEX_H);
const texG = new Uint8Array(TEX_W * TEX_H);
const texB = new Uint8Array(TEX_W * TEX_H);
const texC = new Uint8Array(TEX_W * TEX_H);
const texL = new Uint8Array(TEX_W * TEX_H);
{
  let idx = 0;
  for (let y = 0; y < TEX_H; y++) {
    const lat = 90 - (y + .5) * (180 / TEX_H);
    for (let x = 0; x < TEX_W; x++, idx++) {
      const lon = -180 + (x + .5) * (360 / TEX_W);
      if (lat > 83.5 || lat < -83.5) {
        texR[idx] = 215; texG[idx] = 228; texB[idx] = 245; texC[idx] = 60; texL[idx] = 1;
        continue;
      }
      const c = sampleEarthColor(lon, lat);
      texR[idx] = c.r; texG[idx] = c.g; texB[idx] = c.b;
      texC[idx] = Math.round(c.cloud * 255);
      texL[idx] = c.isL ? 1 : 0;
    }
  }
}

// —— 真实 NASA 卫星影像纹理（Blue Marble 昼半球 + 夜间城市灯光，随仓库内置）——
// 加载成功后逐像素烘焙进同一套 720×360 查表：昼半球 RGB、海陆掩膜与夜间灯光贴图。
// 陆海掩膜从影像本身按“海洋蓝色占优”提取，与真实海岸线逐像素对齐，保证海面镜面高光不洒到陆地上。
const texNR = new Uint8Array(TEX_W * TEX_H);
const texNG = new Uint8Array(TEX_W * TEX_H);
const texNB = new Uint8Array(TEX_W * TEX_H);
let REAL_TEX = false;
const TEX_LOAD_T0 = performance.now();
function bakeImage(img, outA, outB, outC, wantMask, wantCloud) {
  const c = G.document.createElement('canvas');
  c.width = TEX_W; c.height = TEX_H;
  const cc = c.getContext('2d');
  cc.drawImage(img, 0, 0, TEX_W, TEX_H);
  const d = cc.getImageData(0, 0, TEX_W, TEX_H).data;
  let idx = 0;
  for (let y = 0; y < TEX_H; y++) {
    const lat = 90 - (y + .5) * (180 / TEX_H);
    for (let x = 0; x < TEX_W; x++, idx++) {
      const r = d[idx * 4], g = d[idx * 4 + 1], b = d[idx * 4 + 2];
      outA[idx] = r; outB[idx] = g; outC[idx] = b;
      if (wantMask) texL[idx] = (b > r + 8 && b > g) ? 0 : 1;
      if (wantCloud) texC[idx] = Math.round(sampleCloud(-180 + (x + .5) * (360 / TEX_W), lat) * 255);
    }
  }
}
function bakeRealTextures(dayImg, nightImg) {
  bakeImage(dayImg, texR, texG, texB, true, true);
  bakeImage(nightImg, texNR, texNG, texNB, false, false);
  REAL_TEX = true;
  G.ZT_openingRealTex = true;   // 供无头浏览器验证：真实卫星纹理已烘焙
}
const dayImg = new Image(), nightImg = new Image();
let dayReady = false, nightReady = false;
dayImg.onload = () => { dayReady = true; if (nightReady) bakeRealTextures(dayImg, nightImg); };
nightImg.onload = () => { nightReady = true; if (dayReady) bakeRealTextures(dayImg, nightImg); };
dayImg.src = 'assets/earth-day.jpg';
nightImg.src = 'assets/earth-night.jpg';

// 预计算球面圆盘内每个像素的法向量 (nx, ny, nz) 与边缘大气散射系数
const gMask = new Int32Array(G_RES * G_RES);
const gNx = new Float32Array(G_RES * G_RES);
const gNy = new Float32Array(G_RES * G_RES);
const gNz = new Float32Array(G_RES * G_RES);
const gRim = new Float32Array(G_RES * G_RES);
let gCount = 0;
{
  const half = G_RES / 2, rInv = 1 / (half - 1.5);
  for (let py = 0; py < G_RES; py++) {
    const ny = (half - .5 - py) * rInv;
    for (let px = 0; px < G_RES; px++) {
      const nx = (px + .5 - half) * rInv;
      const rr = nx * nx + ny * ny;
      if (rr > 1) continue;
      const nz = Math.sqrt(1 - rr);
      const i = gCount++;
      gMask[i] = py * G_RES + px;
      gNx[i] = nx; gNy[i] = ny; gNz[i] = nz;
      gRim[i] = Math.pow(1 - nz, 2.35);
    }
  }
}

// 球面正交投影（s 是视线纬度）：结果写进 bX/bY/bZ，bZ 为深度（>0 在正面半球）
let bX = 0, bY = 0, bZ = 0;
function ball(la, dLon, s) {
  const cl = Math.cos(la), sl = Math.sin(la), sd = Math.sin(dLon), cd = Math.cos(dLon), cs = Math.cos(s), ss = Math.sin(s);
  bX = sd * cl;
  bY = cs * sl - ss * cl * cd;
  bZ = ss * sl + cs * cl * cd;
}

// 渲染离屏 3D 真实谷歌地球（带数字化扫描裁剪面：scanProg 从 -1.15 扫到 +1.15，扫过之处真实表面量子化消隐并闪现科技扫描锋面）
function renderGlobeTexture(lonOff, tiltLat, scanProg, globeAlpha) {
  const cs = Math.cos(tiltLat), ss = Math.sin(tiltLat);
  const lx = L_DIR[0], ly = L_DIR[1], lz = L_DIR[2];
  // 半角向量 H = normalize(L + V)，V = (0, 0, 1)，用于计算海洋太阳镜面高光
  const hx = lx, hy = ly, hz = lz + 1, hLen = Math.hypot(hx, hy, hz);
  const hnx = hx / hLen, hny = hy / hLen, hnz = hz / hLen;

  for (let i = 0; i < gCount; i++) {
    const pIdx = gMask[i] * 4;
    const nx = gNx[i], ny = gNy[i], nz = gNz[i];

    // 数字化扫描锋面：按球面横向位置 + 微弧度弯曲从左（西/智利侧）向右（东/北京侧）推进
    const waveCoord = nx - .14 * ny * ny;
    const distToScan = scanProg - waveCoord; // >0 表示已被扫描波扫过（转化为数字点云）
    if (distToScan > .18) {
      gData[pIdx + 3] = 0;
      continue;
    }

    // 逆正交投影求球面点地理纬度 lat 与经度 lon
    const sinLat = clamp(ny * cs + nz * ss, -1, 1);
    const latRad = Math.asin(sinLat);
    const yRot = nz * cs - ny * ss;
    let lonRad = lonOff + Math.atan2(nx, yRot);
    // 归一化到 [-PI, PI)
    lonRad = ((lonRad + Math.PI) % TAU + TAU) % TAU - Math.PI;

    const u = (lonRad + Math.PI) / TAU;
    const v = (Math.PI / 2 - latRad) / Math.PI;
    // 双线性采样（经度方向无缝环绕，极点钳位），消除真实影像旋转时的锯齿闪烁
    const fu = u * TEX_W - .5, fv = v * TEX_H - .5;
    let x0 = Math.floor(fu), y0 = Math.floor(fv);
    const wu = fu - x0, wv = fv - y0;
    y0 = clamp(y0, 0, TEX_H - 1);
    const y1 = clamp(y0 + 1, 0, TEX_H - 1);
    x0 = ((x0 % TEX_W) + TEX_W) % TEX_W;
    const x1 = (x0 + 1) % TEX_W;
    const i00 = y0 * TEX_W + x0, i10 = y0 * TEX_W + x1, i01 = y1 * TEX_W + x0, i11 = y1 * TEX_W + x1;
    const bl = (a0, a1, b0, b1) => (a0 + (a1 - a0) * wu) + ((b0 + (b1 - b0) * wu) - (a0 + (a1 - a0) * wu)) * wv;

    let r = bl(texR[i00], texR[i10], texR[i01], texR[i11]);
    let g = bl(texG[i00], texG[i10], texG[i01], texG[i11]);
    let b = bl(texB[i00], texB[i10], texB[i01], texB[i11]);
    const cloud = bl(texC[i00], texC[i10], texC[i01], texC[i11]) * (1 / 255);
    const isL = bl(texL[i00], texL[i10], texL[i01], texL[i11]) > .5;

    // 光照计算：漫反射 + 晨昏线柔和暖光 + 背面深空夜色
    const ndotl = nx * lx + ny * ly + nz * lz;
    const diff = smooth(-.28, .85, ndotl);
    const light = .15 + .88 * diff;
    // 晨昏线暖色瑞利散射带
    const twilight = smooth(-.22, .05, ndotl) * smooth(.28, .02, ndotl);

    r = r * light + twilight * 28;
    g = g * light + twilight * 12;
    b = b * light * (.92 + .08 * diff) + (1 - diff) * 14;

    // 海洋镜面太阳高光（Google Earth 标志性的海面反光）
    if (!isL) {
      const ndoth = Math.max(0, nx * hnx + ny * hny + nz * hnz);
      const spec = Math.pow(ndoth, 28) * .58 * (1 - cloud * .75);
      r += spec * 210;
      g += spec * 235;
      b += spec * 255;
    }

    // 叠加白色大气云层
    if (cloud > .01) {
      const cLight = .22 + .82 * diff;
      const cw = cloud * .55;
      r = lerp(r, 242 * cLight, cw);
      g = lerp(g, 248 * cLight, cw);
      b = lerp(b, 255 * cLight, cw);
    }

    // 夜半球：叠入真实夜间城市灯光影像（NASA Earth at Night），Google Earth 式的昼夜过渡
    if (REAL_TEX) {
      const nightMix = smooth(.05, -.42, ndotl);
      if (nightMix > 0) {
        const nr = bl(texNR[i00], texNR[i10], texNR[i01], texNR[i11]) * 1.3;
        const ng = bl(texNG[i00], texNG[i10], texNG[i01], texNG[i11]) * 1.3;
        const nb = bl(texNB[i00], texNB[i10], texNB[i01], texNB[i11]) * 1.4;
        r = lerp(r, nr, nightMix);
        g = lerp(g, ng, nightMix);
        b = lerp(b, nb, nightMix);
      }
    }

    // 球体边缘瑞利散射蔚蓝大气辉光（Atmosphere Rim Glow）
    const rim = gRim[i];
    const rimLight = .35 + .65 * smooth(-.35, .6, ndotl);
    r = lerp(r, 78 * rimLight, rim * .72);
    g = lerp(g, 168 * rimLight, rim * .78);
    b = lerp(b, 255 * rimLight, rim * .88);

    // 边缘 1.5px 抗锯齿平滑与扫描锋面电光高亮
    let a = smooth(0, .12, nz) * globeAlpha;
    if (distToScan > -.09) {
      // 正在被数字扫描环切过的窄带：泛起青蓝/琥珀全息电光，随后迅速量子化消隐
      const band = 1 - Math.abs(distToScan - .03) / .12;
      if (band > 0) {
        const glow = band * band;
        r = lerp(r, 115, glow * .85);
        g = lerp(g, 232, glow * .92);
        b = lerp(b, 255, glow);
      }
      if (distToScan > 0) {
        a *= clamp(1 - distToScan / .18, 0, 1);
      }
    }

    gData[pIdx] = clamp(r | 0, 0, 255);
    gData[pIdx + 1] = clamp(g | 0, 0, 255);
    gData[pIdx + 2] = clamp(b | 0, 0, 255);
    gData[pIdx + 3] = clamp((a * 255) | 0, 0, 255);
  }
  gCtx.putImageData(gImg, 0, 0);
}

// —— 页面上现成的点阵（等 map 首帧画完再取）——
let DOTS = null;
function buildDots(d) {
  const n = d.n;
  const o = {
    n,
    x: new Float32Array(n), y: new Float32Array(n), r: new Float32Array(n),
    la: new Float32Array(n), lon: new Float32Array(n),
    cl: new Uint8Array(n), bj: new Uint8Array(n), seed: new Float32Array(n)
  };
  for (let i = 0; i < n; i++) {
    o.x[i] = d.x[i]; o.y[i] = d.y[i]; o.r[i] = d.r[i];
    const lat = geo.millerLat(d.wy[i]), lon = d.wx[i];
    o.la[i] = lat * D2R; o.lon[i] = lon * D2R;
    o.cl[i] = land.isChile(lon, lat) ? 1 : 0;
    o.bj[i] = Math.hypot(lon - P.beijing.lon, lat - P.beijing.lat) < 4.5 ? 1 : 0;
    o.seed[i] = hash2(i * 1.17, lon + lat);
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

// 绘制球面上的 3D 经纬网格线（数字化扫描期间浮现，随展开淡出）
function drawGlobeGraticule(cx, cy, R, lonOff, tiltLat, scanProg, gridAlpha) {
  if (gridAlpha <= .01) return;
  ctx.save();
  ctx.lineWidth = 1;
  // 经线
  for (let lonD = -180; lonD < 180; lonD += 30) {
    const lon = lonD * D2R;
    ctx.beginPath();
    let started = false;
    for (let latD = -75; latD <= 75; latD += 5) {
      ball(latD * D2R, lon - lonOff, tiltLat);
      if (bZ <= .02) { started = false; continue; }
      const sx = cx + bX * R, sy = cy - bY * R;
      if (!started) { ctx.moveTo(sx, sy); started = true; }
      else ctx.lineTo(sx, sy);
    }
    ctx.strokeStyle = 'rgba(110,195,255,' + (gridAlpha * .22).toFixed(3) + ')';
    ctx.stroke();
  }
  // 纬线
  for (let latD = -60; latD <= 60; latD += 30) {
    const la = latD * D2R;
    ctx.beginPath();
    let started = false;
    for (let lonD = -180; lonD <= 180; lonD += 5) {
      ball(la, lonD * D2R - lonOff, tiltLat);
      if (bZ <= .02) { started = false; continue; }
      const sx = cx + bX * R, sy = cy - bY * R;
      if (!started) { ctx.moveTo(sx, sy); started = true; }
      else ctx.lineTo(sx, sy);
    }
    ctx.strokeStyle = latD === 0
      ? 'rgba(125,220,255,' + (gridAlpha * .36).toFixed(3) + ')'
      : 'rgba(110,195,255,' + (gridAlpha * .2).toFixed(3) + ')';
    ctx.stroke();
  }
  // 数字化扫描波锋面弧线
  if (scanProg > -1.02 && scanProg < 1.02) {
    ctx.beginPath();
    let started = false;
    for (let ny = -.98; ny <= .98; ny += .04) {
      const nx = scanProg + .14 * ny * ny;
      if (nx * nx + ny * ny >= .99) { started = false; continue; }
      const sx = cx + nx * R, sy = cy - ny * R;
      if (!started) { ctx.moveTo(sx, sy); started = true; }
      else ctx.lineTo(sx, sy);
    }
    ctx.strokeStyle = 'rgba(135,238,255,' + (gridAlpha * .85).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(95,225,255,.8)';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
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

  // 深空背景（带微弱星云径向纵深）
  ctx.fillStyle = '#04070d';
  ctx.fillRect(0, 0, W, H);

  const cx = W * .5, cy = H * .5, R = Math.min(W, H) * .35;
  // 展开进度：0 为正球体，1 为完全落位到页面 2D 点阵
  const unfold = easeInOut(clamp((t - T_UNFOLD_A) / (T_UNFOLD_B - T_UNFOLD_A), 0, 1));
  // 扫描进度：从 -1.15（球体左侧）扫到 +1.25（球体右侧）
  const scanRaw = clamp((t - T_SCAN_A) / (T_SCAN_B - T_SCAN_A), 0, 1);
  const scanProg = -1.15 + 2.4 * easeInOut(scanRaw);
  const globeAlpha = 1 - smooth(T_UNFOLD_A + 150, T_UNFOLD_B - 100, t);

  // 地球自转：从西经 95°（太平洋/美洲视角，一眼看到智利与南北美洲）平稳向东旋转到东经 18°（大西洋与欧亚非同框）
  const spinEase = 1 - Math.pow(1 - clamp(t / 2900, 0, 1), 2.2);
  const lonOff = (-92 + 110 * spinEase) * D2R;
  const tiltLat = (-12 + 24 * spinEase) * D2R;

  // —— 1. 太空星辰背景（随展开为平面地图柔和隐去）——
  const starFade = 1 - smooth(T_UNFOLD_A, T_UNFOLD_B, t);
  if (starFade > .02) {
    for (let i = 0; i < STARS.length; i++) {
      const st = STARS[i];
      const sx = ((st.u * W - t * .008) % W + W) % W;
      const sy = st.v * H;
      // 避开地球正圆内部
      if (Math.hypot(sx - cx, sy - cy) < R * .98) continue;
      const tw = .65 + .35 * Math.sin(t * .004 + st.ph);
      ctx.fillStyle = 'rgba(' + st.c + ',' + (st.a * tw * starFade).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(sx, sy, st.r, 0, TAU); ctx.fill();
    }
  }

  // —— 2. 真实谷歌地球球体 + 外层蔚蓝大气光晕 ——
  if (globeAlpha > .01) {
    // 球体背后与边缘的大气瑞利散射辉光（Atmosphere Corona）
    const atmos = ctx.createRadialGradient(cx - R * .08, cy - R * .08, R * .78, cx, cy, R * 1.24);
    atmos.addColorStop(0, 'rgba(35,115,235,0)');
    atmos.addColorStop(.68, 'rgba(55,148,255,' + (.18 * globeAlpha).toFixed(3) + ')');
    atmos.addColorStop(.83, 'rgba(95,190,255,' + (.34 * globeAlpha).toFixed(3) + ')');
    atmos.addColorStop(.92, 'rgba(45,120,235,' + (.12 * globeAlpha).toFixed(3) + ')');
    atmos.addColorStop(1, 'rgba(4,7,13,0)');
    ctx.fillStyle = atmos;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.24, 0, TAU); ctx.fill();

    // 渲染并绘制真实地球球面纹理
    renderGlobeTexture(lonOff, tiltLat, scanProg, globeAlpha);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(gCv, cx - R, cy - R, R * 2, R * 2);
    ctx.restore();
  }

  // —— 3. 数字化全息经纬网与扫描波锋面 ——
  const gridAlpha = smooth(T_SCAN_A - 150, T_SCAN_A + 350, t) * (1 - smooth(T_UNFOLD_A + 100, T_UNFOLD_B - 150, t));
  drawGlobeGraticule(cx, cy, R, lonOff, tiltLat, scanProg, gridAlpha);

  // —— 4. 数字化点云球 → 展开并落位到 2D 页面点阵 ——
  if (DOTS && t >= T_SCAN_A - 80) {
    const backReveal = smooth(T_UNFOLD_A + 250, T_UNFOLD_B, t); // 球面背面的点在展开后半段平滑浮现
    for (let i = 0; i < DOTS.n; i++) {
      ball(DOTS.la[i], DOTS.lon[i] - lonOff, tiltLat);

      // 该点在球面上的扫描触发进度
      const waveCoord = bX - .14 * bY * bY;
      const scanned = smooth(waveCoord - .08, waveCoord + .08, scanProg);
      const vis = Math.max(scanned, unfold);
      if (vis <= .01) continue;

      // 3D 球面坐标（背面点从球体边缘外侧优雅折入平面坐标）
      const front = smooth(-.15, .12, bZ);
      const gx = cx + bX * R, gy = cy - bY * R;
      const px = DOTS.x[i] + off.x, py = DOTS.y[i] + off.y;

      // 每个点带一点极细微的相位差，让点云解构展开更有数字粒子流质感，但在 unfold=1 时 100% 精确落位
      const delay = DOTS.seed[i] * .14;
      const uLocal = clamp((unfold - delay * (1 - unfold)) / (1 - delay * .5), 0, 1);
      const x = lerp(gx, px, uLocal), y = lerp(gy, py, uLocal);

      // 透明度：正面点随扫描立刻析出并闪烁电光；背面点随展开渐显
      const sphereA = front * (.45 + .55 * Math.max(0, bZ)) * scanned;
      const flatA = (.4 + .6 * Math.min(1, DOTS.r[i] / 2.4));
      let a = lerp(sphereA, flatA, Math.max(unfold, backReveal * (1 - front)));
      if (a <= .02) continue;

      // 刚被扫描波扫过瞬间的高亮脉冲
      const spark = scanned * (1 - smooth(waveCoord + .06, waveCoord + .32, scanProg)) * (1 - unfold) * front;
      const rad = Math.max(.9, lerp(DOTS.r[i] * (.85 + .45 * spark), DOTS.r[i], unfold));

      if (DOTS.cl[i]) {
        ctx.fillStyle = 'rgba(255,190,96,' + Math.min(1, a + spark * .4).toFixed(3) + ')';
      } else if (spark > .15) {
        ctx.fillStyle = 'rgba(130,232,255,' + Math.min(1, a + spark * .5).toFixed(3) + ')';
      } else {
        ctx.fillStyle = 'rgba(163,189,229,' + a.toFixed(3) + ')';
      }
      ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
    }
  }

  // —— 5. 点亮智利（琥珀色脉冲）& 高亮北京（冷青色光环）——
  for (let k = 0; k < 2; k++) ring(site.chile[0], site.chile[1], smooth(T_CHILE_FLASH + k * 160, T_CHILE_FLASH + 800 + k * 160, t), 8, 30, .95, '255,190,96');
  for (let k = 0; k < 2; k++) ring(site.beijing[0], site.beijing[1], smooth(T_BEIJING_RING + k * 160, T_BEIJING_RING + 800 + k * 160, t), 8, 34, .9, '110,225,255');

  if (!began && t >= T_BEGIN) { began = true; map.begin(); }
  if (!faded && t >= T_OVERLAY_FADE) { faded = true; el.classList.add('fade'); remover = setTimeout(endShow, 720); }

  if (t > 7000) endShow();
  raf = requestAnimationFrame(frame);
}

// 等 map 首帧把点阵铺好、真实卫星纹理就绪（最长等 1.2s，超时按程序化纹理开演），再开演
(function tryDots() {
  const d = map.dots();
  const ready = d && d.n > 2;
  const texOk = REAL_TEX || performance.now() - TEX_LOAD_T0 > 1200;
  if (ready && texOk) { DOTS = buildDots(d); resize(); site.chile = sitePos('chile'); site.beijing = sitePos('beijing'); raf = requestAnimationFrame(frame); }
  else raf = requestAnimationFrame(tryDots);
})();
})();
