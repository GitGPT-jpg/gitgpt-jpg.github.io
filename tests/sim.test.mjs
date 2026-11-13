// 直接取 index.html 里的 zt-sim 脚本来验证：页面跑的和这里测的是同一份代码。
// 运行：node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({});
vm.runInContext(html.match(/<script id="zt-sim">([\s\S]*?)<\/script>/)[1], ctx);
const Z = ctx.ZT, C = Z.CFG;

test('第一次：排队 → Prefill → 首个 token → 逐 token', () => {
  const r = Z.run(0);
  assert.equal(r.queue[1], 120);
  assert.equal(r.computed, 800);
  assert.equal(r.prefillMs, 480);
  assert.equal(r.ttft, 600);
  assert.equal(r.times.length, C.tokens.length);
  assert.equal(r.times[0], r.ttft);
  assert.ok(r.times.every((t, i) => !i || t - r.times[i - 1] === C.decodeMs));
  assert.ok(r.total <= C.axis);
});

test('复用前缀：同样的请求和排队，只省命中的那段 Prefill', () => {
  const a = Z.run(0), b = Z.run(C.prefix), d = Z.compare(a, b);
  assert.equal(d.sameQueue, true);
  assert.equal(b.times.length, a.times.length);          // 同一个请求，输出一样长
  assert.equal(b.computed, C.suffix);                    // 没命中的部分照常计算
  assert.equal(b.ttft, 216);
  assert.equal(d.ttftDelta, 384);
  assert.equal(d.ttftDelta, d.prefillDelta);             // 首个 token 提前的量 = 省下的 Prefill
  assert.equal(d.ttftDelta, b.savedMs);
  assert.equal(a.total - b.total, 384);                  // 解码速度不变
});

test('只命中一部分：未命中的前缀仍然要算', () => {
  const a = Z.run(0);
  for (let hit = 0; hit <= C.prefix; hit += 40) {
    const b = Z.run(hit);
    assert.equal(b.computed, C.prefix - hit + C.suffix);
    assert.equal(a.ttft - b.ttft, b.savedMs);
    assert.ok(Number.isInteger(b.ttft));
    assert.equal(b.segs[b.segs.length - 1].kind, 'suffix');
    assert.equal(b.segs[0].from, C.queue);
    assert.equal(b.segs[b.segs.length - 1].to, b.ttft);
  }
  assert.equal(Z.run(0).ttft, Z.run(-5).ttft);
  assert.ok(Number.isInteger(Z.run(333).ttft));          // 任意输入都对齐到整毫秒
  assert.equal(Z.run(9999).hit, C.prefix);
  assert.equal(Z.compare(a, Z.run(0)).ttftDelta, 0);
});

test('同一时刻对比两次请求', () => {
  const a = Z.run(0), b = Z.run(C.prefix);
  assert.equal(Z.at(a, 60).phase, 'queue');
  assert.equal(Z.at(b, 60).phase, 'queue');
  assert.equal(Z.at(a, 300).phase, 'prefill');
  assert.equal(Z.at(a, 300).shown, 0);
  assert.equal(Z.at(b, 300).phase, 'decode');
  assert.equal(Z.at(b, 300).shown, 2);
  assert.equal(Z.at(a, 600).shown, 1);
  assert.equal(Z.at(a, Infinity).phase, 'done');
  assert.equal(Z.at(a, Infinity).shown, C.tokens.length);
  assert.equal(Z.at(a, -1).shown, 0);
});

test('BiDi 分配：每条链路两端成对', () => {
  const list = Z.assign(Z.LINKS);
  assert.equal(list.length, Z.LINKS.length);
  assert.equal(Z.check(list), true);
  list[2].bEnd = 'U';
  assert.equal(Z.check(list), false);
});

test('实验记录：正常退出但主指标缺失 → blocked，原因带进下一轮', () => {
  const rec = {round: 3, exitCode: 0, metric: null}, v = Z.judge(rec);
  assert.equal(v.status, 'blocked');
  assert.equal(v.missing.length, 1);
  const nx = Z.nextRound(rec, v);
  assert.equal(nx.round, 4);
  assert.equal(nx.carried, v.carry);
  assert.equal(Z.judge({round: 3, exitCode: 0, metric: 12.5}).status, 'done');
  assert.equal(Z.judge({round: 3, exitCode: 1, metric: null}).status, 'failed');
});
