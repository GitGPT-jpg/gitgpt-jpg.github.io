#!/usr/bin/env node
// 生成 assets/land.js：把 Natural Earth 1:50m 的陆地栅格化成 0.25° 的位图，再做游程编码。
// 地图只回答“这里是不是陆地”，不含任何国界；另外单独导出智利本土的掩码，用来点亮智利。
//
// 数据来源（公有领域）：Natural Earth 1:50m 的 land / admin-0 countries（取自 world-atlas 2.0.2）和 lakes。
//
// 准备数据：
//   mkdir -p /tmp/zt-land-src && cd /tmp/zt-land-src
//   npm pack world-atlas@2.0.2 && tar -xzf world-atlas-2.0.2.tgz
//   curl -LO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_lakes.geojson
// 运行：
//   node tools/make-land.mjs /tmp/zt-land-src [--preview /tmp/land.png]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';

const STEP = 0.25, LON0 = -180, LAT_TOP = 84, LAT_BOT = -60;
const W = Math.round(360 / STEP), H = Math.round((LAT_TOP - LAT_BOT) / STEP);
const SS = 4;                       // 每个格子纵向取 4 条扫描线，横向按精确覆盖长度累加
const LAKE_MIN_AREA = 1.5;          // 只挖掉面积超过 1.5 平方度的大湖
const CHILE_BOX = {lon: [-76.5, -66], lat: [-56.5, -17]};   // 只要本土，不含远海岛屿
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const args = process.argv.slice(2);
const srcDir = args.find(a => !a.startsWith('--'));
const previewAt = args.includes('--preview') ? args[args.indexOf('--preview') + 1] : null;
if (!srcDir) { console.error('用法：node tools/make-land.mjs <数据目录> [--preview out.png]（数据准备方法见文件头）'); process.exit(1); }
const find = name => {
  for (const p of [path.join(srcDir, name), path.join(srcDir, 'package', name)]) if (fs.existsSync(p)) return p;
  throw new Error('找不到 ' + name + '，请先按文件头的说明准备数据');
};
const readJson = name => JSON.parse(fs.readFileSync(find(name), 'utf8'));

/* ---------- 读取：TopoJSON / GeoJSON → 多边形数组，每个多边形是 [外环, 洞, 洞…] ---------- */
function topoPolygons(topo, geom) {
  const {scale, translate} = topo.transform;
  const arcs = topo.arcs.map(arc => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; }); });
  const ring = ids => {
    const pts = [];
    for (const id of ids) { const a = id < 0 ? arcs[~id].slice().reverse() : arcs[id]; for (let k = pts.length ? 1 : 0; k < a.length; k++) pts.push(a[k]); }
    return pts;
  };
  const walk = g => g.type === 'Polygon' ? [g.arcs.map(ring)] : g.type === 'MultiPolygon' ? g.arcs.map(p => p.map(ring)) : g.type === 'GeometryCollection' ? g.geometries.flatMap(walk) : [];
  return walk(geom);
}
const geoPolygons = g => g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const ringArea = r => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a / 2); };

/* ---------- 栅格化：逐环做奇偶扫描线，外环加、洞减，输出每个格子的覆盖率 0..1 ---------- */
// world-atlas 里跨 180° 经线的陆地是缝合过的，环上相邻两点的经度会跳 360°。
// 所以先把每个环的经度展开成连续的，填充时再把超出 ±180° 的部分绕回来。
function coverage(polygons) {
  const cov = new Float32Array(W * H), n = H * SS, k = SS / STEP;
  const add = (row, a, b, w) => {                       // 给一行的 [a, b) 经度区间累加覆盖
    const fa = Math.max(0, Math.min(W, (a - LON0) / STEP)), fb = Math.max(0, Math.min(W, (b - LON0) / STEP));
    if (fb <= fa) return;
    const ca = Math.floor(fa), cb = Math.floor(fb);
    if (ca === cb) { cov[row + ca] += (fb - fa) * w; return; }
    cov[row + ca] += (ca + 1 - fa) * w;
    for (let c = ca + 1; c < cb; c++) cov[row + c] += w;
    if (cb < W) cov[row + cb] += (fb - cb) * w;
  };
  for (const poly of polygons) poly.forEach((ring, ri) => {
    const pts = [ring[0].slice()];
    for (let i = 1; i < ring.length; i++) {
      let x = ring[i][0]; const px = pts[i - 1][0];
      while (x - px > 180) x -= 360;
      while (x - px < -180) x += 360;
      pts.push([x, ring[i][1]]);
    }
    if (Math.abs(pts[pts.length - 1][0] - pts[0][0]) > 1) return;      // 绕极一圈的环（南极洲），不在本图范围内
    const hits = [];
    for (let i = 0; i < pts.length - 1; i++) {
      let [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      if (y0 === y1) continue;
      if (y0 > y1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
      const sMin = Math.max(0, Math.floor((LAT_TOP - y1) * k - 0.5) + 1), sMax = Math.min(n - 1, Math.floor((LAT_TOP - y0) * k - 0.5));
      for (let s = sMin; s <= sMax; s++) { const lat = LAT_TOP - (s + 0.5) / k; hits.push([s, x0 + (lat - y0) * (x1 - x0) / (y1 - y0)]); }
    }
    hits.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const w = (ri ? -1 : 1) / SS;
    for (let i = 0; i + 1 < hits.length; i += 2) {
      if (hits[i][0] !== hits[i + 1][0]) throw new Error('扫描线交点不成对');
      const row = Math.floor(hits[i][0] / SS) * W, a = hits[i][1], b = hits[i + 1][1];
      for (const shift of [-360, 0, 360]) add(row, a + shift, b + shift, w);
    }
  });
  return cov;
}

/* ---------- 编码：0/1 交替的游程，变长 6 位字符（低 5 位是数据，第 6 位表示后面还有） ---------- */
function encodeRuns(bits) {
  let out = '', i = 0, cur = 0;
  const put = v => { do { const d = v & 31; v >>>= 5; out += ALPHABET[d | (v ? 32 : 0)]; } while (v); };
  while (i < bits.length) { let j = i; while (j < bits.length && bits[j] === cur) j++; put(j - i); i = j; cur ^= 1; }
  return out;
}
function decodeRuns(str, n) {
  const out = new Uint8Array(n);
  let i = 0, v = 0, shift = 0, cur = 0;
  for (let p = 0; p < str.length; p++) {
    const d = ALPHABET.indexOf(str[p]);
    v |= (d & 31) << shift;
    if (d & 32) { shift += 5; continue; }
    if (cur) out.fill(1, i, i + v);
    i += v; cur ^= 1; v = 0; shift = 0;
  }
  return out;
}

/* ---------- 主流程 ---------- */
const landTopo = readJson('land-50m.json'), countryTopo = readJson('countries-50m.json'), lakes = readJson('ne_50m_lakes.geojson');
const chileGeom = countryTopo.objects.countries.geometries.find(g => g.id === '152');
if (!chileGeom || chileGeom.properties.name !== 'Chile') throw new Error('countries-50m.json 里找不到智利（id 152）');

const landCov = coverage(topoPolygons(landTopo, landTopo.objects.land));
const lakeCov = coverage(lakes.features.flatMap(f => geoPolygons(f.geometry)).filter(p => ringArea(p[0]) >= LAKE_MIN_AREA));
const chileCov = coverage(topoPolygons(countryTopo, chileGeom));

const land = new Uint8Array(W * H);
for (let i = 0; i < land.length; i++) land[i] = landCov[i] - lakeCov[i] >= 0.5 ? 1 : 0;

const colOf = lon => Math.round((lon - LON0) / STEP), rowOf = lat => Math.round((LAT_TOP - lat) / STEP);
const c0 = colOf(CHILE_BOX.lon[0]), c1 = colOf(CHILE_BOX.lon[1]), r0 = rowOf(CHILE_BOX.lat[1]), r1 = rowOf(CHILE_BOX.lat[0]);
const cw = c1 - c0, ch = r1 - r0, chile = new Uint8Array(cw * ch);
for (let r = 0; r < ch; r++) for (let c = 0; c < cw; c++) {
  const i = (r0 + r) * W + c0 + c;
  chile[r * cw + c] = land[i] && chileCov[i] >= 0.5 * landCov[i] ? 1 : 0;       // 这个格子里的陆地多数属于智利
}

const landStr = encodeRuns(land), chileStr = encodeRuns(chile);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
if (!same(decodeRuns(landStr, land.length), land) || !same(decodeRuns(chileStr, chile.length), chile)) throw new Error('编码自检失败');

const outFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'land.js');
fs.writeFileSync(outFile,
  '/* 由 tools/make-land.mjs 生成，请勿手改。数据：Natural Earth 1:50m（公有领域）。只含“是否陆地”，不含任何国界。 */\n' +
  '(function (G) {\nG.ZT_LAND = {\n' +
  `  step: ${STEP}, lonMin: ${LON0}, latTop: ${LAT_TOP}, w: ${W}, h: ${H},\n` +
  `  land: "${landStr}",\n` +
  `  chile: {c0: ${c0}, r0: ${r0}, w: ${cw}, h: ${ch}, bits: "${chileStr}"}\n` +
  '};\n})(typeof globalThis !== \'undefined\' ? globalThis : this);\n');

const count = a => a.reduce((s, v) => s + v, 0);
console.log(`网格 ${W}×${H}（${STEP}°）· 陆地 ${count(land)} 格 · 智利 ${count(chile)} 格`);
console.log(`land ${landStr.length} 字符 · chile ${chileStr.length} 字符 → ${path.relative(process.cwd(), outFile)}（${fs.statSync(outFile).size} 字节）`);

if (previewAt) {
  const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const td = Buffer.concat([Buffer.from(type), data]), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const raw = Buffer.alloc((W + 1) * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const inBox = r >= r0 && r < r1 && c >= c0 && c < c1;
    raw[r * (W + 1) + 1 + c] = inBox && chile[(r - r0) * cw + c - c0] ? 255 : land[r * W + c] ? 150 : 18;
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8;
  fs.writeFileSync(previewAt, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  console.log('预览图 → ' + previewAt);
}
