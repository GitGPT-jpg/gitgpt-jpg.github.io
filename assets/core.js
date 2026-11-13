// 页面里所有“会算”的东西都在这里，不碰 DOM；tests/ 直接加载这个文件来验证。
(function (G) {
'use strict';

/* ================= 地理：投影、大圆航线、昼夜 ================= */
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const EARTH_KM = 6371.0088, LIGHT_KM_S = 299792.458;

const PLACES = Object.freeze({
  santiago: Object.freeze({lon: -70.6693, lat: -33.4489, tz: 'America/Santiago'}),
  beijing: Object.freeze({lon: 116.4074, lat: 39.9042, tz: 'Asia/Shanghai'})
});

// Miller 圆柱投影。x 直接用经度（度），y 也折算成“度”，赤道附近两个方向等比例。
const millerY = lat => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * D2R)) * R2D;
const millerLat = y => (2.5 * Math.atan(Math.exp(0.8 * y * D2R)) - 0.625 * Math.PI) * R2D;

const unit = p => { const a = p.lon * D2R, b = p.lat * D2R, c = Math.cos(b); return [c * Math.cos(a), c * Math.sin(a), Math.sin(b)]; };
function arc(a, b) {                                   // 两点间的球心角（弧度）
  const u = unit(a), v = unit(b);
  const x = u[1] * v[2] - u[2] * v[1], y = u[2] * v[0] - u[0] * v[2], z = u[0] * v[1] - u[1] * v[0];
  return Math.atan2(Math.hypot(x, y, z), u[0] * v[0] + u[1] * v[1] + u[2] * v[2]);
}
const distanceKm = (a, b) => arc(a, b) * EARTH_KM;
const lightMs = km => km / LIGHT_KM_S * 1000;          // 真空中的光走完这段路要多久

// 大圆航线上的 n+1 个点。经度从起点开始连续展开，相邻两点不会跳 360°。
function greatCircle(a, b, n) {
  const u = unit(a), v = unit(b), w = arc(a, b), s = Math.sin(w), out = [];
  let prev = a.lon;
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = Math.sin((1 - t) * w) / s, q = Math.sin(t * w) / s;
    const x = p * u[0] + q * v[0], y = p * u[1] + q * v[1], z = p * u[2] + q * v[2];
    let lon = Math.atan2(y, x) * R2D;
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push({lon, lat: Math.atan2(z, Math.hypot(x, y)) * R2D});
    prev = lon;
  }
  return out;
}

// 向东的航线：经度从 a 线性递增到 b（走大西洋、欧洲一侧），纬度线性插值再叠一个正弦弓起，
// 让航线像真实航班一样从大陆上空弯过去。bow 是弓高（度）。
function eastArc(a, b, n, bow) {
  const k = bow || 0, out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({lon: (1 - t) * a.lon + t * b.lon, lat: (1 - t) * a.lat + t * b.lat + k * Math.sin(Math.PI * t)});
  }
  return out;
}
// 折线路径的总长度（公里），相邻点很近，大圆距离就是局部弧长
const pathKm = pts => { let km = 0; for (let i = 1; i < pts.length; i++) km += distanceKm(pts[i - 1], pts[i]); return km; };

// 太阳直射点（低精度天文公式，误差远小于一个点阵格子）
function sun(ms) {
  const n = ms / 86400000 - 10957.5;                   // 距 J2000.0 的天数
  const L = (280.46 + 0.9856474 * n) * D2R, g = (357.528 + 0.9856003 * n) * D2R;
  const lam = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R, eps = (23.439 - 4e-7 * n) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam)), gmst = (280.46061837 + 360.98564736629 * n) * D2R;
  const lon = ((((ra - gmst) * R2D + 180) % 360) + 360) % 360 - 180;
  return {lon, lat: Math.asin(Math.sin(eps) * Math.sin(lam)) * R2D};
}
// 某地此刻的太阳高度角（度）：大于 0 是白天
const sunAltitude = (p, s) => Math.asin(Math.sin(p.lat * D2R) * Math.sin(s.lat * D2R) + Math.cos(p.lat * D2R) * Math.cos(s.lat * D2R) * Math.cos((p.lon - s.lon) * D2R)) * R2D;

// 某个时区此刻的墙上时间
const fmts = {};
function zoneTime(ms, tz) {
  const f = fmts[tz] || (fmts[tz] = new Intl.DateTimeFormat('en-US', {timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'}));
  const p = {};
  for (const part of f.formatToParts(new Date(ms))) p[part.type] = +part.value;
  const pad = v => String(v).padStart(2, '0');
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return {h: p.hour, m: p.minute, s: p.second, text: pad(p.hour) + ':' + pad(p.minute) + ':' + pad(p.second), offsetMin: Math.round((wall - Math.floor(ms / 1000) * 1000) / 60000)};
}

const geo = {D2R, R2D, PLACES, millerY, millerLat, arc, distanceKm, lightMs, greatCircle, eastArc, pathKm, sun, sunAltitude, zoneTime};

/* ================= 陆地位图：解码 assets/land.js ================= */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LUT = new Uint8Array(128);
for (let i = 0; i < 64; i++) LUT[ALPHABET.charCodeAt(i)] = i;

// 0/1 交替的游程；每个字符低 5 位是数据，第 6 位表示这个数还没完
function decodeRuns(str, n) {
  const out = new Uint8Array(n);
  let i = 0, v = 0, shift = 0, cur = 0;
  for (let p = 0; p < str.length; p++) {
    const d = LUT[str.charCodeAt(p)];
    v |= (d & 31) << shift;
    if (d & 32) { shift += 5; continue; }
    if (cur) out.fill(1, i, i + v);
    i += v; cur ^= 1; v = 0; shift = 0;
  }
  return out;
}

function createLand(data) {
  const {w, h, step, lonMin, latTop} = data, W1 = w + 1;
  const bits = decodeRuns(data.land, w * h);
  const sat = new Uint32Array(W1 * (h + 1));           // 积分图：任意矩形里的陆地格数 O(1) 可查
  for (let r = 0; r < h; r++) {
    let run = 0;
    for (let c = 0; c < w; c++) { run += bits[r * w + c]; sat[(r + 1) * W1 + c + 1] = sat[r * W1 + c + 1] + run; }
  }
  const ch = data.chile, cbits = decodeRuns(ch.bits, ch.w * ch.h);
  const col = lon => ((Math.floor((lon - lonMin) / step) % w) + w) % w;
  const row = lat => Math.floor((latTop - lat) / step);
  const isLand = (lon, lat) => { const r = row(lat); return r >= 0 && r < h && bits[r * w + col(lon)] === 1; };
  const isChile = (lon, lat) => { const r = row(lat) - ch.r0, c = col(lon) - ch.c0; return r >= 0 && r < ch.h && c >= 0 && c < ch.w && cbits[r * ch.w + c] === 1; };
  const box = (r0, r1, c0, c1) => sat[r1 * W1 + c1] - sat[r0 * W1 + c1] - sat[r1 * W1 + c0] + sat[r0 * W1 + c0];
  // 以 (lon, lat) 为中心、宽 dLon 高 dLat（度）的矩形里，陆地占的比例
  function cover(lon, lat, dLon, dLat) {
    const r0 = Math.max(0, Math.floor((latTop - lat - dLat / 2) / step)), r1 = Math.min(h, Math.max(r0 + 1, Math.ceil((latTop - lat + dLat / 2) / step)));
    if (r1 <= r0 || r0 >= h) return 0;
    const a = Math.floor((lon - dLon / 2 - lonMin) / step), n = Math.min(w, Math.max(1, Math.ceil((lon + dLon / 2 - lonMin) / step) - a));
    const c0 = ((a % w) + w) % w, c1 = c0 + n;
    const sum = c1 <= w ? box(r0, r1, c0, c1) : box(r0, r1, c0, w) + box(r0, r1, 0, c1 - w);
    return sum / (n * (r1 - r0));
  }
  return {isLand, isChile, cover, latTop, latBottom: latTop - h * step};
}

/* ================= 智利：通信设备升级 Agent Harness ================= */
// 浏览器里按同一套规则重做：Agent 只能通过类型化工具提出动作，状态机校验前置条件、任务状态和授权，
// 通过之后才交给设备适配器（这里是 Mock）。会话上下文、任务状态、执行证据是三样分开的东西。
const STEPS = Object.freeze(['precheck', 'upload', 'install', 'verify']);

function createHarness(opt) {
  opt = opt || {};
  const clock = opt.clock || (() => 0);
  const tasks = new Map();          // 任务状态：SQLite 里 tasks 表的替身
  const byRequest = new Map();      // request_id → task_id，重复建单返回已有任务
  const events = [];                // 执行证据：追加式事件流，JSONL 的替身
  const context = [];               // 会话上下文：可以被裁剪；状态机从不读它
  let fault = opt.fault || null;    // Mock 适配器的故障注入：null | 'install' | 'verify'

  const emit = (type, data) => { const e = Object.freeze(Object.assign({seq: events.length + 1, ts: clock(), type}, data)); events.push(e); return e; };
  const move = (t, to, extra) => { Object.assign(t, {state: to}, extra); emit('state', Object.assign({task_id: t.task_id, to}, extra)); };
  const reject = (tool, code, detail) => { emit('tool.result', {tool, ok: false, code, detail}); return {ok: false, code, detail}; };

  const tools = {
    create_task(args) {
      emit('tool.call', {tool: 'create_task', args});
      const had = byRequest.get(args.request_id);
      if (had) { emit('tool.result', {tool: 'create_task', ok: true, task_id: had, deduped: true}); return {ok: true, task_id: had, deduped: true}; }
      const task_id = 'T-' + String(tasks.size + 1).padStart(4, '0');
      tasks.set(task_id, {task_id, request_id: args.request_id, device: args.device, target: args.target, state: 'created', step: null, failed_step: null, approvals: {}});
      byRequest.set(args.request_id, task_id);
      emit('tool.result', {tool: 'create_task', ok: true, task_id, request_id: args.request_id, device: args.device, target: args.target});
      return {ok: true, task_id, deduped: false};
    },
    get_status(args) {
      emit('tool.call', {tool: 'get_status', args});
      const t = tasks.get(args.task_id);
      if (!t) return reject('get_status', 'NOT_FOUND', '没有这个任务');
      emit('tool.result', {tool: 'get_status', ok: true, task_id: t.task_id, state: t.state, step: t.step});
      return {ok: true, state: t.state, step: t.step, failed_step: t.failed_step};
    },
    start_upgrade(args) {
      emit('tool.call', {tool: 'start_upgrade', args});
      const t = tasks.get(args.task_id);
      if (!t) return reject('start_upgrade', 'NOT_FOUND', '没有这个任务');
      if (t.state !== 'created') return reject('start_upgrade', 'BAD_STATE', '任务已是 ' + t.state + '，不能再次启动');
      if (!t.approvals.upgrade) return reject('start_upgrade', 'AUTH_REQUIRED', '启动升级需要人工批准');
      emit('tool.result', {tool: 'start_upgrade', ok: true, task_id: t.task_id});
      move(t, 'running', {step: STEPS[0]});
      return {ok: true};
    },
    rollback(args) {
      emit('tool.call', {tool: 'rollback', args});
      const t = tasks.get(args.task_id);
      if (!t) return reject('rollback', 'NOT_FOUND', '没有这个任务');
      if (t.state !== 'halted') return reject('rollback', 'BAD_STATE', '只有停在失败步骤上的任务才能回滚');
      if (!t.approvals.rollback) return reject('rollback', 'AUTH_REQUIRED', '回滚需要独立授权；已有的批准只覆盖 ' + (Object.keys(t.approvals).join('、') || '无'));
      emit('tool.result', {tool: 'rollback', ok: true, task_id: t.task_id});
      move(t, 'rolling_back', {});
      return {ok: true};
    }
  };

  // 人工批准：一次批准只对应一个动作。对 upgrade 的批准不会顺带授权 rollback。
  function approve(task_id, action, by) {
    const t = tasks.get(task_id), need = {upgrade: 'created', rollback: 'halted'}[action];
    if (!t || !need || t.state !== need) return {ok: false, code: 'BAD_STATE'};
    const e = emit('approval', {task_id, action, by});
    t.approvals[action] = e.seq;
    return {ok: true, seq: e.seq};
  }

  // 状态机推进一步：把当前步骤交给设备适配器。失败就停在原地，不会自己回滚。
  function advance(task_id) {
    const t = tasks.get(task_id);
    if (t && t.state === 'running') {
      const op = t.step, ok = fault !== op;
      emit('adapter', ok ? {task_id, op, ok} : {task_id, op, ok, error: 'mock: ' + op + ' failed (injected)'});
      if (!ok) move(t, 'halted', {failed_step: op});
      else if (op === STEPS[STEPS.length - 1]) move(t, 'done', {step: null});
      else move(t, 'running', {step: STEPS[STEPS.indexOf(op) + 1]});
      return {op, ok};
    }
    if (t && t.state === 'rolling_back') {
      emit('adapter', {task_id, op: 'rollback', ok: true});
      move(t, 'rolled_back', {step: null});
      return {op: 'rollback', ok: true};
    }
    return null;
  }

  // 只读持久记录回答两个问题：设备走到了哪一步？谁批准了哪个动作？
  function answer(task_id) {
    const t = tasks.get(task_id);
    return t ? {
      state: t.state, step: t.step, failed_step: t.failed_step,
      approvals: events.filter(e => e.type === 'approval' && e.task_id === task_id).map(e => ({action: e.action, by: e.by, seq: e.seq, ts: e.ts}))
    } : null;
  }

  return {
    tools, approve, advance, answer, tasks, events, context,
    say(who, text) { context.push({who, text}); },
    trimContext() { const n = context.length; context.length = 0; return n; },
    setFault(f) { fault = f || null; },
    get fault() { return fault; }
  };
}

// 只凭事件流重建任务状态：执行轨迹可回放
function replay(events) {
  const tasks = new Map();
  for (const e of events) {
    if (e.type === 'tool.result' && e.tool === 'create_task' && e.ok && !e.deduped) tasks.set(e.task_id, {task_id: e.task_id, request_id: e.request_id, device: e.device, target: e.target, state: 'created', step: null, failed_step: null, approvals: {}});
    else if (e.type === 'approval') tasks.get(e.task_id).approvals[e.action] = e.seq;
    else if (e.type === 'state') {
      const t = tasks.get(e.task_id);
      t.state = e.to;
      if ('step' in e) t.step = e.step;
      if ('failed_step' in e) t.failed_step = e.failed_step;
    }
  }
  return tasks;
}

const harness = {STEPS, create: createHarness, replay};

/* ================= 北京：北辰的证据门禁 ================= */
// 每类根因要满足的证据条件，写成可以执行的判定。症状是共性的，所以结论的确定性只能跟着证据走。
const LEVELS = Object.freeze({confirmed: '确认', suspected: '疑似', pending: '待查', ruled_out: '排除'});
const SYMPTOMS = Object.freeze(['detokenizer 心跳停止', '就绪探针返回 503']);
const CAUSES = Object.freeze([
  Object.freeze({id: 'oom', name: '内存耗尽'}),
  Object.freeze({id: 'ep', name: 'MoE 专家并行组重配置'}),
  Object.freeze({id: 'qp', name: 'RDMA 资源耗尽'}),
  Object.freeze({id: 'kv', name: 'KV 传输异常'})
]);
const list = a => a.join('、');

const GATES = Object.freeze({
  ep: Object.freeze({
    id: 'ep', name: 'EP 组故障',
    need: ['worker 心跳、缩容或重配置事件、请求路由变化，三项联合核对吻合'],
    checks: [
      {id: 'heartbeat', label: 'worker 心跳', source: '服务指标', states: {match: '吻合', mismatch: '不吻合', missing: '没取到'}},
      {id: 'reconfig', label: '缩容或重配置事件', source: 'Pod 生命周期', states: {match: '吻合', mismatch: '不吻合', missing: '没取到'}},
      {id: 'routing', label: '请求路由变化', source: '单请求轨迹', states: {match: '吻合', mismatch: '不吻合', missing: '没取到'}}
    ],
    initial: {heartbeat: 'match', reconfig: 'missing', routing: 'missing'},
    decide(ev) {
      const by = s => this.checks.filter(c => ev[c.id] === s).map(c => c.label), ok = by('match'), bad = by('mismatch'), miss = by('missing');
      if (bad.length) return {level: 'ruled_out', reason: list(bad) + '与 EP 组故障不吻合。', missing: [], next: 'EP 组这一项排除，转查其余候选。'};
      if (!miss.length) return {level: 'confirmed', reason: 'worker 心跳、缩容或重配置事件、请求路由变化，三项联合核对吻合。', missing: [], next: '进入处置；处置后回到就绪检查验证。'};
      if (ok.length) return {level: 'suspected', reason: list(ok) + '吻合，' + list(miss) + '还没取到；三项要联合核对。', missing: miss, next: '补取' + list(miss) + '。'};
      return {level: 'pending', reason: '三项证据都还没取到。', missing: miss, next: '取 worker 心跳、缩容或重配置事件、请求路由变化。'};
    }
  }),
  qp: Object.freeze({
    id: 'qp', name: 'RDMA 队列对（QP）耗尽',
    need: ['完成相关排除检查', '取得故障节点的 QP 实测，且显示耗尽'],
    checks: [
      {id: 'exclusions', label: '相关排除检查', source: '日志 · 服务指标 · Pod 生命周期', states: {done: '已完成', todo: '未完成'}},
      {id: 'qp', label: '故障节点 QP 实测', source: '节点指标', states: {exhausted: '实测耗尽', sufficient: '资源充足', timeout: '节点查询超时'}}
    ],
    initial: {exclusions: 'done', qp: 'timeout'},
    decide(ev) {
      const done = ev.exclusions === 'done';
      if (ev.qp === 'sufficient') return {level: 'ruled_out', reason: '故障节点的 QP 实测显示资源充足。', missing: [], next: 'QP 耗尽这一项排除，转查其余候选。'};
      if (ev.qp === 'exhausted') return done
        ? {level: 'confirmed', reason: '相关排除检查已完成，并在故障节点上实测到 QP 耗尽。', missing: [], next: '进入处置；处置后回到就绪检查验证。'}
        : {level: 'suspected', reason: '故障节点实测到 QP 耗尽，但其余候选还没有排除。', missing: ['相关排除检查'], next: '补做相关排除检查。'};
      return done
        ? {level: 'suspected', reason: '相关排除检查已完成，但节点查询超时，没有取到故障节点的 QP 实测。', missing: ['故障节点 QP 实测'], next: '重试节点查询，取到故障节点的 QP 实测后再定级。'}
        : {level: 'pending', reason: '排除检查未完成，节点查询超时。', missing: ['相关排除检查', '故障节点 QP 实测'], next: '先做相关排除检查，同时重试节点查询。'};
    }
  })
});

// 一份结构化证据。简报和完整报告都从它渲染，不各写各的。
function diagnose(gateId, evidence) {
  const g = GATES[gateId], ev = Object.assign({}, g.initial, evidence), d = g.decide(ev);
  return {
    target: {instance: 'decode-07', window: '14:02 – 14:07'},
    observed: [{text: SYMPTOMS[1], source: '服务指标'}, {text: SYMPTOMS[0], source: '日志'}],
    fact: '该实例未通过就绪检查',                       // 观测事实：不随假设升降级
    hypothesis: {id: g.id, name: g.name}, need: g.need,
    level: d.level, reason: d.reason, missing: d.missing, next: d.next,
    checks: g.checks.map(c => ({id: c.id, label: c.label, source: c.source, state: ev[c.id], text: c.states[ev[c.id]]}))
  };
}
// 给值班人员看的九行简报
const brief = c => [
  ['对象', c.target.instance], ['时间窗', c.target.window], ['现象', c.observed.map(o => o.text).join('；')],
  ['已确认', c.fact], ['假设', c.hypothesis.name], ['确定性', LEVELS[c.level]],
  ['依据', c.reason], ['未决', c.missing.length ? list(c.missing) : '无'], ['下一步', c.next]
];
// 完整报告：证据、未决项、验证方法
const report = c => ({
  verdict: c.hypothesis.name + '：' + LEVELS[c.level],
  fact: c.fact + '（观测事实，已确认）',
  evidence: c.observed.map(o => ({item: o.text, source: o.source, status: '已观测'})).concat(c.checks.map(k => ({item: k.label, source: k.source, status: k.text}))),
  open: c.missing, verify: c.need
});

/* 分段打点：并行工具的实际占用按时间区间的并集算，不能逐个相加 */
function unionMs(spans) {
  let total = 0, end = -Infinity;
  for (const s of spans.slice().sort((a, b) => a.from - b.from)) {
    if (s.from > end) { total += s.to - s.from; end = s.to; }
    else if (s.to > end) { total += s.to - end; end = s.to; }
  }
  return total;
}
const sumMs = spans => spans.reduce((t, s) => t + s.to - s.from, 0);
// 一轮诊断的打点（合成数据）。kind：tool = 数据源，model = 模型，orch = 编排往返
const TRACE = Object.freeze([
  {kind: 'orch', name: '主理人路由', from: 0, to: 180},
  {kind: 'tool', name: '日志', from: 180, to: 1380},
  {kind: 'tool', name: '服务指标', from: 180, to: 920},
  {kind: 'tool', name: '节点指标', from: 180, to: 3180},
  {kind: 'tool', name: 'Pod 生命周期', from: 180, to: 760},
  {kind: 'tool', name: '单请求轨迹', from: 180, to: 1650},
  {kind: 'tool', name: '对应版本源码', from: 180, to: 1100},
  {kind: 'orch', name: '证据回传', from: 3180, to: 3300},
  {kind: 'model', name: '诊断专家研判', from: 3300, to: 5100},
  {kind: 'orch', name: '答复回传', from: 5100, to: 5220}
].map(Object.freeze));
function timing(trace) {
  const of = k => trace.filter(s => s.kind === k);
  return {
    total: unionMs(trace), tool: unionMs(of('tool')), toolSum: sumMs(of('tool')), model: unionMs(of('model')), orch: unionMs(of('orch')),
    slowest: of('tool').reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))
  };
}

const xiaobei = {LEVELS, SYMPTOMS, CAUSES, GATES, diagnose, brief, report, unionMs, sumMs, TRACE, timing};

/* ================= 北京：自进化闸门 ================= */
// 一次 Skill 修改是一个候选假设：先过审查，再和旧版在同一批冻结取证包上回放，主指标严格更好、人工确认后才采纳。
const PACKS = Object.freeze([
  {id: 'P1', family: '内存耗尽', truth: 'oom'},
  {id: 'P2', family: 'EP 组重配置', truth: 'ep'},
  {id: 'P3', family: 'QP 耗尽', truth: 'qp'},
  {id: 'P4', family: 'QP 实测缺失', truth: 'unknown'},     // 证据缺失：参考答案就是“未知”
  {id: 'P5', family: 'KV 传输异常', truth: 'kv'},
  {id: 'P6', family: '探针抖动', truth: 'none'}             // 没有故障：用来测误报
].map(Object.freeze));
const ANSWERS = Object.freeze({oom: '内存耗尽', ep: 'EP 重配置', qp: 'QP 耗尽', kv: 'KV 传输异常', unknown: '未知', none: '无故障'});
const VERSIONS = Object.freeze({
  base: {name: '旧版', note: '线上正在用的 Skill', out: {P1: 'oom', P2: 'ep', P3: 'qp', P4: 'qp', P5: 'unknown', P6: 'none'}},
  A: {name: '候选 A', note: '节点查询超时，也按 QP 耗尽下结论', review: true, out: {P1: 'oom', P2: 'ep', P3: 'qp', P4: 'qp', P5: 'kv', P6: 'qp'}},
  B: {name: '候选 B', note: '取不到实测，就回答“未知”', review: true, out: {P1: 'oom', P2: 'ep', P3: 'qp', P4: 'unknown', P5: 'unknown', P6: 'none'}},
  C: {name: '候选 C', note: '只改了报告的措辞', review: true, out: {P1: 'oom', P2: 'ep', P3: 'qp', P4: 'qp', P5: 'unknown', P6: 'none'}},
  D: {name: '候选 D', note: '顺手改了门禁以外的文件', review: false, out: null}
});
const isFault = a => a !== 'unknown' && a !== 'none';

// 题面如果带着故障类别，凡是“有具体故障”的包，谁来答都对：分数涨了，却说明不了策略变好
function replayPacks(version, leak) {
  return PACKS.map(p => {
    const out = leak && isFault(p.truth) ? p.truth : version.out[p.id];
    return {id: p.id, family: p.family, truth: p.truth, out, ok: out === p.truth, falseAlarm: isFault(out) && out !== p.truth};
  });
}
function score(rows) {
  const faults = rows.filter(r => isFault(r.truth)), gaps = rows.filter(r => r.truth === 'unknown');
  return {
    main: rows.filter(r => r.ok).length, total: rows.length,
    hit: faults.filter(r => r.ok).length, faults: faults.length,
    falseAlarm: rows.filter(r => r.falseAlarm).length,
    unknownOk: gaps.filter(r => r.ok).length, gaps: gaps.length
  };
}
// 闸门：审查 → 冻结取证包回放 → 主指标严格优于基线 → 人工确认
function judgePatch(id, opt) {
  opt = opt || {};
  const cand = VERSIONS[id];
  if (!cand.review) return {status: 'rejected', stage: 'review', reason: '改动超出了允许的修改范围，没有进入回放。'};
  const baseRows = replayPacks(VERSIONS.base, opt.leak), candRows = replayPacks(cand, opt.leak), base = score(baseRows), next = score(candRows);
  const out = {baseRows, candRows, base, cand: next};
  if (opt.leak) return Object.assign(out, {status: 'invalid', stage: 'replay', reason: '题面泄漏了故障类别，这一轮对比无效：分不清分数来自诊断策略，还是来自题面的暗示。'});
  if (next.main <= base.main) return Object.assign(out, {status: 'rejected', stage: 'compare', reason: next.main === base.main ? '主指标与基线持平。要采纳，必须严格优于基线。' : '主指标低于基线。'});
  if (!opt.humanOk) return Object.assign(out, {status: 'awaiting_human', stage: 'human', reason: '开发集主指标严格优于基线，等待人工确认。'});
  return Object.assign(out, {status: 'adopted', stage: 'done', reason: '主指标严格优于基线，并经人工确认，采纳。'});
}

const evolve = {PACKS, ANSWERS, VERSIONS, replayPacks, score, judgePatch};

/* ================= 北京：推理研发工作台的独立验收器 ================= */
// 只认证据：真实退出码、主指标、阈值、硬约束。每份结果还绑定执行批次和轮次，迟到的旧结果改不了当前结论。
function accept(result, current) {
  if (result.run_id !== current.run_id || result.round !== current.round) {
    return {status: 'stale', title: '不采信', reason: '这份结果属于 ' + result.run_id + ' 的第 ' + result.round + ' 轮，当前是 ' + current.run_id + ' 的第 ' + current.round + ' 轮。迟到的旧结果只归档，不覆盖当前结论。', carry: null, need: []};
  }
  if (result.exit_code !== 0) return {status: 'failed', title: '本轮失败', reason: '压测进程以退出码 ' + result.exit_code + ' 结束。', carry: '上一轮失败：压测进程非正常退出（退出码 ' + result.exit_code + '）。', need: []};
  if (result.metric == null) return {status: 'blocked', title: '本轮阻塞', reason: '压测正常退出，但没有采到主指标。进程退出码是 0，不等于实验成功。', carry: null, need: ['主指标：未命中 token 吞吐率']};
  if (!result.hard_ok) return {status: 'failed', title: '本轮失败', reason: '数据有效，但违反了硬约束。', carry: '上一轮失败：违反硬约束。', need: []};
  if (!result.meets) return {status: 'failed', title: '本轮失败', reason: '数据有效，但主指标没有达到阈值。', carry: '上一轮失败：主指标未达阈值。', need: []};
  return {status: 'passed', title: '验收通过', reason: '正常退出，主指标有效并达到阈值，硬约束满足。', carry: null, need: []};
}

const bench = {accept};

G.ZT = {geo, decodeRuns, createLand, harness, xiaobei, evolve, bench};
if (typeof module === 'object' && module.exports) module.exports = G.ZT;
})(typeof globalThis !== 'undefined' ? globalThis : this);
