// 直接加载页面用的 assets/core.js 和 assets/land.js：页面跑的和这里测的是同一份代码。
// 运行：node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const ZT = require('../assets/core.js');
require('../assets/land.js');
const {geo, harness, xiaobei, evolve, bench} = ZT;
const {santiago, beijing} = geo.PLACES;
const plain = v => JSON.parse(JSON.stringify(v));

/* ---------- 地图 ---------- */

test('光束：圣地亚哥向东跨大西洋、经欧洲到北京', () => {
  const km = geo.distanceKm(santiago, beijing);
  assert.ok(km > 19000 && km < 19120, '约 19,060 km，实际 ' + km);
  assert.ok(km > Math.PI * 6371 * 0.94, '两地接近对跖点');
  assert.equal(Math.round(geo.lightMs(km)), 64);

  const path = geo.eastArc(santiago, beijing, 180, 50);
  assert.equal(path.length, 181);
  assert.ok(Math.abs(path[0].lon - santiago.lon) < 1e-9 && Math.abs(path[0].lat - santiago.lat) < 1e-9);
  assert.ok(Math.abs(path[180].lon - beijing.lon) < 1e-9 && Math.abs(path[180].lat - beijing.lat) < 1e-9);
  assert.ok(path.every((p, i) => !i || p.lon > path[i - 1].lon), '一路向东，经度连续递增');
  const top = path.reduce((a, b) => (b.lat > a.lat ? b : a));
  assert.ok(top.lat > 58 && top.lat < 60 && top.lon > 50 && top.lon < 54, '弧顶在西伯利亚，刚过欧洲');
  const mid = path[90];
  assert.ok(mid.lon > 21 && mid.lon < 25 && mid.lat > 52 && mid.lat < 54, '中点正跨欧洲中部（德波一带）');
  const span = geo.pathKm(path);
  assert.ok(span > 19800 && span < 20200, '航线约 20,000 km，实际 ' + span);
});

test('Miller 投影可逆', () => {
  for (const lat of [-58, -33.45, 0, 39.9, 72]) assert.ok(Math.abs(geo.millerLat(geo.millerY(lat)) - lat) < 1e-9);
  assert.ok(Math.abs(geo.millerY(0)) < 1e-9);
  assert.ok(geo.millerY(60) > 60 && geo.millerY(60) < 75);
});

test('昼夜：太阳直射点', () => {
  const equinox = geo.sun(Date.UTC(2026, 2, 20, 14, 46)), june = geo.sun(Date.UTC(2026, 5, 21, 12)), dec = geo.sun(Date.UTC(2026, 11, 21, 12));
  assert.ok(Math.abs(equinox.lat) < 0.2);
  assert.ok(Math.abs(june.lat - 23.44) < 0.1 && Math.abs(dec.lat + 23.44) < 0.1);
  assert.ok(Math.abs(geo.sun(Date.UTC(2026, 5, 21, 12)).lon) < 5, 'UTC 正午，直射点在本初子午线附近');
  assert.ok(Math.abs(geo.sun(Date.UTC(2026, 5, 21, 0)).lon) > 175);
  // 北京正午前后是白天；此刻的圣地亚哥在地球另一面，是夜里
  const s = geo.sun(Date.UTC(2026, 10, 11, 4));
  assert.ok(geo.sunAltitude(beijing, s) > 20);
  assert.ok(geo.sunAltitude(santiago, s) < -20);
});

test('两地时钟', () => {
  const t = Date.UTC(2026, 10, 11, 4, 5, 6);
  assert.equal(geo.zoneTime(t, beijing.tz).text, '12:05:06');
  assert.equal(geo.zoneTime(t, beijing.tz).offsetMin, 480);
  assert.equal(geo.zoneTime(t, santiago.tz).text, '01:05:06');
  assert.equal(geo.zoneTime(Date.UTC(2026, 6, 1, 16), santiago.tz).offsetMin, -240);   // 智利冬令时
});

test('陆地位图：只分陆地和海，单独标出智利本土', () => {
  const land = ZT.createLand(globalThis.ZT_LAND);
  const at = (lon, lat) => land.isLand(lon, lat);
  assert.ok(at(santiago.lon, santiago.lat) && at(beijing.lon, beijing.lat));
  assert.ok(at(geo.PLACES.nanjing.lon, geo.PLACES.nanjing.lat));
  assert.ok(at(santiago.lon + 360, santiago.lat), '经度可以绕一圈');
  assert.ok(at(121, 23.7) && at(109.7, 19.2) && at(135, -25) && at(-100, 40));
  assert.ok(!at(-150, 0) && !at(-175, -30) && !at(160, 40) && !at(120, 38.6), '太平洋和渤海是海');
  assert.ok(!at(-87, 44) && !at(108, 53.5), '大湖挖掉了');
  assert.ok(!at(0, 86) && !at(0, -75), '位图范围以外按海处理');

  assert.ok(land.isChile(santiago.lon, santiago.lat) && land.isChile(-70.3, -23.6) && land.isChile(-72.6, -41.3));
  assert.ok(!land.isChile(-68.8, -32.9) && !land.isChile(-58.4, -34.6) && !land.isChile(-68.1, -16.5) && !land.isChile(-77, -12), '门多萨、布宜诺斯艾利斯、拉巴斯、利马不是智利');
  assert.ok(!land.isChile(beijing.lon, beijing.lat) && !land.isChile(-80, -33));

  assert.equal(land.cover(100, 35, 4, 4), 1);
  assert.equal(land.cover(-150, 0, 4, 4), 0);
  const coast = land.cover(santiago.lon - 1, santiago.lat, 2, 2);
  assert.ok(coast > 0.05 && coast < 0.95);
  assert.ok(Math.abs(land.cover(180, 66, 6, 2) - land.cover(-180, 66, 6, 2)) < 1e-12, '跨 180° 经线');
});

/* ---------- 智利：升级 Harness ---------- */

function booted(fault) {
  let tick = 0;
  const h = harness.create({fault, clock: () => ++tick});
  const {task_id} = h.tools.create_task({request_id: 'req-1', device: 'mock-ne-07', target: 'v2.2.0'});
  return {h, id: task_id, row: () => h.tasks.get(task_id)};
}
function run(h, id) { const ops = []; for (let r; (r = h.advance(id));) ops.push(r.op + (r.ok ? '' : '!')); return ops; }

test('没有批准，动作不执行；批准只对应它那一个动作', () => {
  const {h, id, row} = booted('install');
  assert.equal(h.tools.start_upgrade({task_id: id}).code, 'AUTH_REQUIRED');
  assert.equal(row().state, 'created');
  assert.equal(h.advance(id), null, '没进状态机的动作，到不了设备适配器');
  assert.equal(h.approve(id, 'rollback', '值班工程师').ok, false, '还没失败，无从批准回滚');

  assert.ok(h.approve(id, 'upgrade', '值班工程师').ok);
  assert.ok(h.tools.start_upgrade({task_id: id}).ok);
  assert.deepEqual(run(h, id), ['precheck', 'upload', 'install!']);
  assert.equal(row().state, 'halted');
  assert.equal(row().failed_step, 'install');
  assert.equal(h.advance(id), null, '停在原地，不会自己回滚');

  const no = h.tools.rollback({task_id: id});
  assert.equal(no.code, 'AUTH_REQUIRED');
  assert.match(no.detail, /upgrade/);
  assert.equal(row().state, 'halted');
  assert.ok(!h.events.some(e => e.type === 'adapter' && e.op === 'rollback'));

  assert.ok(h.approve(id, 'rollback', '值班工程师').ok);
  assert.ok(h.tools.rollback({task_id: id}).ok);
  assert.deepEqual(run(h, id), ['rollback']);
  assert.equal(row().state, 'rolled_back');
  assert.equal(h.tools.start_upgrade({task_id: id}).code, 'BAD_STATE');
});

test('验证失败同样停下；不注入故障则四步走完', () => {
  let s = booted('verify');
  s.h.approve(s.id, 'upgrade', 'e'); s.h.tools.start_upgrade({task_id: s.id});
  assert.deepEqual(run(s.h, s.id), ['precheck', 'upload', 'install', 'verify!']);
  assert.equal(s.row().failed_step, 'verify');

  s = booted(null);
  s.h.approve(s.id, 'upgrade', 'e'); s.h.tools.start_upgrade({task_id: s.id});
  assert.deepEqual(run(s.h, s.id), harness.STEPS.slice());
  assert.equal(s.row().state, 'done');
  assert.equal(s.h.tools.rollback({task_id: s.id}).code, 'BAD_STATE');
  assert.equal(s.h.approve(s.id, 'rollback', 'e').ok, false);
});

test('request_id 幂等：重复建单返回已有任务', () => {
  const {h, id} = booted(null);
  const again = h.tools.create_task({request_id: 'req-1', device: 'mock-ne-07', target: 'v2.2.0'});
  assert.deepEqual(plain(again), {ok: true, task_id: id, deduped: true});
  assert.equal(h.tasks.size, 1);
  assert.notEqual(h.tools.create_task({request_id: 'req-2', device: 'mock-ne-08', target: 'v2.2.0'}).task_id, id);
  assert.equal(h.tasks.size, 2);
});

test('裁剪会话上下文后，仍能从持久记录回答走到哪一步、谁批准了什么', () => {
  const {h, id} = booted('install');
  h.say('工程师', '今晚把 mock-ne-07 升到 v2.2.0');
  h.approve(id, 'upgrade', '值班工程师'); h.tools.start_upgrade({task_id: id}); run(h, id);
  const before = plain(h.answer(id));
  assert.equal(h.trimContext(), 1);
  assert.equal(h.context.length, 0);
  assert.deepEqual(plain(h.answer(id)), before);
  assert.equal(before.state, 'halted');
  assert.equal(before.failed_step, 'install');
  assert.deepEqual(before.approvals.map(a => a.action), ['upgrade']);
  assert.equal(h.events[before.approvals[0].seq - 1].type, 'approval');
});

test('事件流只追加，按它回放能重建任务状态', () => {
  for (const fault of [null, 'install', 'verify']) {
    const {h, id} = booted(fault);
    h.tools.create_task({request_id: 'req-1', device: 'mock-ne-07', target: 'v2.2.0'});
    h.approve(id, 'upgrade', 'e'); h.tools.start_upgrade({task_id: id}); run(h, id);
    h.tools.rollback({task_id: id});
    if (fault) { h.approve(id, 'rollback', 'e'); h.tools.rollback({task_id: id}); run(h, id); }
    h.tools.get_status({task_id: id});
    assert.deepEqual(plain([...harness.replay(h.events)]), plain([...h.tasks]), String(fault));
    assert.ok(h.events.every((e, i) => e.seq === i + 1 && Object.isFrozen(e)));
    assert.ok(h.events.every(e => JSON.parse(JSON.stringify(e)).seq === e.seq), '每条都能写成一行 JSON');
    // 截到任意位置回放，得到的都是当时的状态
    const cut = h.events.findIndex(e => e.type === 'state' && e.to === 'running') + 1;
    assert.equal(harness.replay(h.events.slice(0, cut)).get(id).state, 'running');
  }
});

/* ---------- 北京：北辰 ---------- */

test('QP 耗尽：节点查询超时，最多到“疑似”；已观测的事实不降级', () => {
  const d = ev => xiaobei.diagnose('qp', ev);
  assert.equal(d({exclusions: 'done', qp: 'exhausted'}).level, 'confirmed');
  assert.equal(d({exclusions: 'done', qp: 'timeout'}).level, 'suspected');
  assert.equal(d({exclusions: 'todo', qp: 'exhausted'}).level, 'suspected');
  assert.equal(d({exclusions: 'todo', qp: 'timeout'}).level, 'pending');
  assert.equal(d({exclusions: 'done', qp: 'sufficient'}).level, 'ruled_out');
  assert.equal(d({exclusions: 'todo', qp: 'sufficient'}).level, 'ruled_out');
  assert.deepEqual(d({exclusions: 'done', qp: 'timeout'}).missing, ['故障节点 QP 实测']);
  const facts = new Set();
  for (const exclusions of ['done', 'todo']) for (const qp of ['exhausted', 'sufficient', 'timeout']) facts.add(d({exclusions, qp}).fact);
  assert.deepEqual([...facts], ['该实例未通过就绪检查']);
});

test('EP 组故障：三项联合核对', () => {
  const d = ev => xiaobei.diagnose('ep', ev).level;
  const all = ['match', 'mismatch', 'missing'];
  for (const heartbeat of all) for (const reconfig of all) for (const routing of all) {
    const st = [heartbeat, reconfig, routing], level = d({heartbeat, reconfig, routing});
    if (st.includes('mismatch')) assert.equal(level, 'ruled_out');
    else if (st.every(s => s === 'match')) assert.equal(level, 'confirmed');
    else if (st.includes('match')) assert.equal(level, 'suspected');
    else assert.equal(level, 'pending');
  }
  assert.deepEqual(xiaobei.diagnose('ep', {heartbeat: 'match', reconfig: 'match', routing: 'missing'}).missing, ['请求路由变化']);
});

test('九行简报和完整报告出自同一份结构化证据', () => {
  for (const [gate, ev] of [['qp', {exclusions: 'done', qp: 'timeout'}], ['qp', {exclusions: 'done', qp: 'exhausted'}], ['ep', {heartbeat: 'match', reconfig: 'missing', routing: 'match'}]]) {
    const c = xiaobei.diagnose(gate, ev), lines = xiaobei.brief(c), rep = xiaobei.report(c), get = k => lines.find(l => l[0] === k)[1];
    assert.equal(lines.length, 9);
    assert.ok(lines.every(l => l.length === 2 && l[1]));
    assert.equal(get('确定性'), xiaobei.LEVELS[c.level]);
    assert.equal(get('已确认'), '该实例未通过就绪检查');
    assert.equal(rep.verdict, get('假设') + '：' + get('确定性'));
    assert.deepEqual(rep.open, c.missing);
    assert.equal(get('未决'), c.missing.length ? c.missing.join('、') : '无');
    assert.equal(rep.evidence.length, 2 + c.checks.length);
    assert.ok(rep.verify.length > 0);
  }
  assert.equal(xiaobei.SYMPTOMS.length, 2);
  assert.equal(xiaobei.CAUSES.length, 4);
});

test('分段打点：并行工具按区间并集计时', () => {
  const u = xiaobei.unionMs;
  assert.equal(u([{from: 0, to: 10}, {from: 5, to: 20}, {from: 30, to: 40}]), 30);
  assert.equal(u([{from: 0, to: 100}, {from: 10, to: 20}, {from: 20, to: 30}]), 100);
  assert.equal(u([{from: 5, to: 6}, {from: 0, to: 1}]), 2);
  assert.equal(u([]), 0);
  const t = xiaobei.timing(xiaobei.TRACE);
  assert.equal(t.tool, 3000);
  assert.equal(t.toolSum, 7910);
  assert.equal(t.tool + t.model + t.orch, t.total);
  assert.equal(t.slowest.name, '节点指标');
});

/* ---------- 北京：自进化闸门 ---------- */

test('候选补丁：主指标必须严格优于基线，并经人工确认', () => {
  const j = evolve.judgePatch;
  assert.equal(j('D').status, 'rejected');
  assert.equal(j('D').stage, 'review');
  assert.equal(j('D').candRows, undefined, '审查没过，不进入回放');

  const a = j('A'), b = j('B'), c = j('C');
  assert.equal(a.base.main, 4);
  assert.deepEqual([a.cand.main, a.cand.falseAlarm, a.status, a.stage], [4, 2, 'rejected', 'compare']);
  assert.deepEqual([c.cand.main, c.status], [4, 'rejected']);
  assert.match(c.reason, /持平/);
  assert.deepEqual([b.cand.main, b.cand.unknownOk, b.cand.falseAlarm, b.status], [5, 1, 0, 'awaiting_human']);
  assert.equal(j('B', {humanOk: true}).status, 'adopted');
  assert.equal(j('A', {humanOk: true}).status, 'rejected', '人工确认不能替代对照实验');
  for (const r of [a, b, c]) assert.deepEqual(plain(r.baseRows.map(x => x.id)), plain(r.candRows.map(x => x.id)), '新旧两版吃同一批冻结取证包');
});

test('题面泄漏故障类别：分数再好，这一轮也判无效', () => {
  const clean = evolve.judgePatch('B'), leaked = evolve.judgePatch('B', {leak: true, humanOk: true});
  assert.ok(leaked.cand.main > clean.cand.main && leaked.base.main > clean.base.main, '泄漏会把两边的分数都抬高');
  assert.equal(leaked.cand.main, leaked.cand.total);
  assert.equal(leaked.status, 'invalid');
  for (const id of ['A', 'C']) assert.equal(evolve.judgePatch(id, {leak: true}).status, 'invalid');
  assert.equal(evolve.judgePatch('D', {leak: true}).stage, 'review');
});

/* ---------- 北京：验收器 ---------- */

test('验收器：退出码是 0 不等于成功；迟到的旧结果不覆盖当前结论', () => {
  const cur = {run_id: 'run-b', round: 2}, ok = {run_id: 'run-b', round: 2, exit_code: 0, metric: 1, meets: true, hard_ok: true};
  const st = patch => bench.accept(Object.assign({}, ok, patch), cur);
  assert.equal(st({}).status, 'passed');

  const blocked = st({metric: null});
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.need.length, 1);
  assert.equal(blocked.carry, null);

  for (const patch of [{meets: false}, {hard_ok: false}, {exit_code: 137}]) {
    const v = st(patch);
    assert.equal(v.status, 'failed');
    assert.ok(v.carry, '失败原因带进下一轮');
  }
  assert.equal(st({exit_code: 1, metric: null}).status, 'failed');
  assert.equal(st({hard_ok: false, meets: false}).status, 'failed');

  assert.equal(st({run_id: 'run-a'}).status, 'stale');
  assert.equal(st({round: 1}).status, 'stale');
  assert.equal(st({run_id: 'run-a', exit_code: 1, metric: null}).status, 'stale', '旧批次的结果，无论好坏都不采信');
});
