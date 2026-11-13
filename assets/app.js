// 页面交互：地图取景、路由、时钟、面板，以及几个演练台。会算的部分都在 core.js。
(function () {
'use strict';
const ZT = window.ZT, geo = ZT.geo, P = geo.PLACES, root = document.documentElement;
const $ = id => document.getElementById(id);
const rm = matchMedia('(prefers-reduced-motion: reduce)');
const esc = s => String(s).replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[ch]));
const wait = ms => new Promise(r => setTimeout(r, rm.matches ? 0 : ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// 一组互斥的按钮
function seg(label, options, value, onChange) {
  const box = el('div', 'seg');
  let cur = value;
  box.setAttribute('role', 'group'); box.setAttribute('aria-label', label);
  const btns = options.map(([v, text]) => {
    const b = el('button'); b.type = 'button'; b.textContent = text;
    b.addEventListener('click', () => { if (v !== cur) { set(v); onChange(v); } });
    box.appendChild(b);
    return [v, b];
  });
  function set(v) { cur = v; for (const [bv, b] of btns) b.setAttribute('aria-pressed', String(bv === v)); }
  set(value);
  return {el: box, set, disable(off) { for (const [, b] of btns) b.disabled = off; }};
}
function field(label, control) { const d = el('div', 'field'); d.append(el('span', '', esc(label)), control); return d; }

/* ================= 智利：升级演练 ================= */
function harnessApp(box) {
  const HX = ZT.harness;
  const NAME = {precheck: '预检', upload: '上传', install: '安装', verify: '验证', rollback: '回滚'};
  const STATE = {created: '已建单，等待启动批准', running: '执行中', halted: '已停下，等待回滚授权', rolling_back: '回滚中', rolled_back: '已回滚', done: '升级完成'};
  const STEP = {todo: '', run: '执行中', ok: '通过', fail: '失败', wait: '待授权'};
  const REQ = {request_id: 'req-0407', device: 'mock-ne-07', target: 'v2.2.0'};
  const OPEN = 2 * 3600, CLOSE = 4 * 3600, SPEED = 12;       // 演练时钟比真实时间快 12 倍
  const hms = s => [s / 3600, s / 60 % 60, s % 60].map(v => String(Math.floor(v)).padStart(2, '0')).join(':');

  box.innerHTML = `
    <div class="hx-win"><span>维护窗口 <b>02:00 – 04:00</b></span><span>演练时钟 <b data-now>02:00:00</b></span><span>剩余 <b data-left>02:00:00</b></span><button type="button" class="btn btn-s" data-act="reset">重置</button></div>
    <ol class="hx-pipe" aria-label="一个动作要穿过的四层">
      <li data-p="agent"><b>OpenClaw Agent</b><span>理解目标 · 提出动作</span></li>
      <li data-p="tool"><b>类型化工具</b><span data-tool>—</span></li>
      <li data-p="fsm"><b>Python 状态机</b><span data-fsm></span></li>
      <li data-p="adapter"><b>设备适配器</b><span>Mock 设备</span></li>
    </ol>
    <ol class="hx-steps" aria-label="升级步骤">
      ${HX.STEPS.map(s => `<li data-s="${s}"><i></i>${NAME[s]}<em></em></li>`).join('')}
      <li class="rb" data-s="rollback"><i></i>回滚<em></em></li>
    </ol>
    <div class="hx-ctl" tabindex="-1" aria-live="polite"></div>
    <div class="hx-three">
      <section><h4>会话上下文 <em>可以被裁剪</em></h4><div class="hx-chat" tabindex="0" aria-label="会话上下文"></div>
        <div class="hx-btns"><button type="button" class="btn btn-s" data-act="trim">裁剪上下文</button><button type="button" class="btn btn-s" data-act="ask">追问：走到哪一步？谁批准了什么？</button></div></section>
      <section><h4>任务状态 <em>SQLite</em></h4><dl class="kv"></dl>
        <div class="hx-btns"><button type="button" class="btn btn-s" data-act="resend">用同一个 request_id 重发建单</button></div></section>
    </div>
    <section class="hx-log"><h4>执行证据 <em>JSONL · 只追加</em><button type="button" class="btn btn-s" data-act="replay">回放轨迹</button></h4>
      <pre tabindex="0" aria-label="事件流"></pre><p class="hx-replay" aria-live="polite"></p></section>`;
  const q = s => box.querySelector(s);
  const ui = {now: q('[data-now]'), left: q('[data-left]'), pipe: [...box.querySelectorAll('.hx-pipe li')], steps: [...box.querySelectorAll('.hx-steps li')], ctl: q('.hx-ctl'), chat: q('.hx-chat'), row: q('.kv'), log: q('pre'), note: q('.hx-replay')};
  let h, id, fault = 'install', run = 0, busy = false, t0 = performance.now(), logged = 0, cut = 0, refused = '', pipe = {}, last = {};
  const faultSeg = seg('注入故障', [['install', '安装失败'], ['verify', '验证失败'], ['', '不注入']], fault, v => { fault = v; h.setFault(v); });
  const simNow = () => Math.min(CLOSE, OPEN + (performance.now() - t0) / 1000 * SPEED);

  function boot() {
    run++; busy = false; t0 = performance.now(); logged = 0; cut = 0; refused = ''; pipe = {}; last = {};
    ui.log.textContent = ''; ui.note.textContent = '';
    h = HX.create({fault, clock: () => hms(simNow())});
    h.say('工程师', '今晚窗口里，把 ' + REQ.device + ' 升到 ' + REQ.target + '。');
    id = h.tools.create_task(REQ).task_id;
    h.say('Agent', '已建单 ' + id + '。预检、上传、安装、验证四步，等你批准后启动。');
    paint();
  }

  function paint() {
    const t = h.tasks.get(id), done = {};
    for (const li of ui.pipe) li.className = pipe[li.dataset.p] || '';
    q('[data-tool]').textContent = pipe.toolName || '—';
    q('[data-fsm]').textContent = pipe.fsmText || '校验前置条件 · 状态 · 授权';
    for (const e of h.events) if (e.type === 'adapter') done[e.op] = e.ok ? 'ok' : 'fail';
    for (const li of ui.steps) {
      const s = li.dataset.s;
      const st = done[s] || (s === 'rollback' ? (t.state === 'rolling_back' ? 'run' : t.state === 'halted' ? 'wait' : 'todo') : t.state === 'running' && t.step === s ? 'run' : 'todo');
      li.dataset.st = st; li.querySelector('em').textContent = STEP[st];
    }
    paintCtl(t);
    ui.chat.replaceChildren(...(cut ? [el('p', 'cut', '✂ 上下文已裁剪，丢弃了 ' + cut + ' 条消息')] : []), ...h.context.map(m => el('p', m.who === 'Agent' ? 'a' : '', '<b>' + esc(m.who) + '</b>' + esc(m.text))));
    ui.chat.scrollTop = ui.chat.scrollHeight;
    const data = {task_id: t.task_id, request_id: t.request_id, state: t.state, '': STATE[t.state], step: t.step || '—', failed_step: t.failed_step || '—', approvals: Object.keys(t.approvals).map(k => k + ' #' + t.approvals[k]).join(' · ') || '—'};
    ui.row.innerHTML = Object.keys(data).map(k => '<dt>' + k + '</dt><dd class="' + (k in last && last[k] !== data[k] ? 'chg' : '') + '">' + esc(data[k]) + '</dd>').join('');
    last = data;
    for (; logged < h.events.length; logged++) {
      const e = h.events[logged], line = el('span', e.type === 'approval' ? 'l-approval' : e.ok === false ? 'l-no' : e.type === 'state' ? 'l-state' : '');
      line.textContent = JSON.stringify(e);
      ui.log.appendChild(line);
    }
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function paintCtl(t) {
    const kids = [], p = html => el('p', '', html);
    const row = (...nodes) => { const d = el('div', 'row'); d.append(...nodes); return d; };
    const btn = (act, text, cls) => { const b = el('button', 'btn ' + (cls || '')); b.type = 'button'; b.dataset.act = act; b.textContent = text; b.disabled = busy; return b; };
    const had = ui.ctl.contains(document.activeElement);
    ui.ctl.classList.toggle('halt', t.state === 'halted');
    if (t.state === 'created') {
      faultSeg.disable(busy);
      kids.push(p('<b>' + REQ.device + '</b> 升到 <b>' + REQ.target + '</b>，已建单。<small>先定 Mock 设备要不要出故障，再批准启动。没有你的批准，状态机不会放行。</small>'));
      kids.push(row(el('span', '', '注入故障'), faultSeg.el, btn('approve-upgrade', '批准启动升级', 'btn-ac')));
    } else if (t.state === 'running') {
      kids.push(p('<b>升级已获批准，状态机在逐步执行。</b><small>每一步通过了，才把下一步交给设备适配器。这一段没有需要人判断的事。</small>'));
    } else if (t.state === 'halted') {
      kids.push(p('<b>' + NAME[t.failed_step] + '失败，状态机停在这里。</b><small>先前的批准只覆盖“启动升级”。要不要回滚，是结合设备状态、业务影响和剩余窗口的另一次判断。</small>'));
      if (refused) kids.push(p('<span class="tone-bad">状态机拒绝了 Agent 的回滚：' + esc(refused) + '。</span>'));
      kids.push(row(btn('try-rollback', '让 Agent 直接回滚试试'), btn('approve-rollback', '批准回滚', 'btn-ac')));
    } else if (t.state === 'rolling_back') {
      kids.push(p('<b>回滚授权已到，正在回滚。</b>'));
    } else if (t.state === 'rolled_back') {
      kids.push(p('<b>已回滚。</b><small>两次批准各管各的：事件 #' + t.approvals.upgrade + ' 批准 upgrade，事件 #' + t.approvals.rollback + ' 批准 rollback。</small>'));
      kids.push(row(btn('reset', '再值一次班')));
    } else {
      kids.push(p('<b>四步走完，升级完成。</b><small>回滚授权从头到尾没有出现，也没有被默认授予。换一种故障再试一次。</small>'));
      kids.push(row(btn('reset', '再值一次班')));
    }
    ui.ctl.replaceChildren(...kids);
    if (had && !ui.ctl.contains(document.activeElement)) (ui.ctl.querySelector('.btn-ac:not(:disabled)') || ui.ctl).focus({preventScroll: true});
  }

  // 一个动作穿过四层：Agent 提出 → 类型化工具 → 状态机校验 → 设备适配器
  async function flow(tool, call) {
    const my = run;
    pipe = {agent: 'on', toolName: tool + '()'}; paint(); await wait(300); if (my !== run) return null;
    pipe.tool = 'on'; paint(); await wait(300); if (my !== run) return null;
    const res = call();
    pipe.fsm = res.ok ? 'ok' : 'no';
    pipe.fsmText = res.deduped ? '幂等 · 返回已有任务' : res.ok ? '校验通过' : '拒绝 · ' + res.code;
    pipe.adapter = res.ok && !res.deduped ? 'on' : 'idle';
    paint(); await wait(res.ok ? 340 : 0);
    return my === run ? res : null;
  }
  // 状态机一步一步把动作交给适配器，直到走完或者停下
  async function drive(my) {
    for (;;) {
      const t = h.tasks.get(id);
      if (t.state !== 'running' && t.state !== 'rolling_back') break;
      paint(); await wait(780); if (my !== run) return;
      h.advance(id);
    }
    const t = h.tasks.get(id);
    if (t.state === 'halted') { pipe.adapter = 'no'; pipe.fsmText = '停在' + NAME[t.failed_step] + ' · 不自动回滚'; h.say('Agent', NAME[t.failed_step] + '失败，状态机已经停下。要不要回滚，需要你单独批准。'); }
    else { pipe.adapter = 'ok'; h.say('Agent', t.state === 'done' ? '四步都通过，升级完成。' : '已回滚，任务结束。'); }
    busy = false; paint();
  }
  const acts = {
    reset: boot,
    async 'approve-upgrade'() {
      const my = run; busy = true;
      h.approve(id, 'upgrade', '值班工程师'); h.say('工程师', '批准启动升级。'); paint();
      await wait(360); if (my !== run) return;
      if (await flow('start_upgrade', () => h.tools.start_upgrade({task_id: id}))) await drive(my);
    },
    async 'try-rollback'() {
      const my = run; busy = true;
      h.say('Agent', '我提出回滚。');
      const res = await flow('rollback', () => h.tools.rollback({task_id: id})); if (my !== run || !res) return;
      refused = res.detail; h.say('Agent', '被状态机拒绝：' + res.detail + '。');
      busy = false; paint();
    },
    async 'approve-rollback'() {
      const my = run; busy = true;
      h.approve(id, 'rollback', '值班工程师'); h.say('工程师', '批准回滚。'); refused = ''; paint();
      await wait(360); if (my !== run) return;
      if (await flow('rollback', () => h.tools.rollback({task_id: id}))) await drive(my);
    },
    trim() { cut += h.trimContext(); paint(); },
    ask() {
      const a = h.answer(id);
      const where = STATE[a.state] + (a.state === 'running' ? '（' + NAME[a.step] + '）' : a.failed_step ? '（' + NAME[a.failed_step] + '失败）' : '');
      const who = a.approvals.length ? a.approvals.map(v => v.by + '批准了 ' + v.action + '（事件 #' + v.seq + '，' + v.ts + '）').join('；') : '还没有任何批准';
      h.say('工程师', '走到哪一步了？谁批准过什么？');
      h.say('Agent', id + '：' + where + '。' + who + '。依据是 tasks 表和事件流，不靠对话记忆。');
      paint();
    },
    async resend() {
      if (busy) { h.tools.create_task(REQ); paint(); return; }
      const res = await flow('create_task', () => h.tools.create_task(REQ));
      if (res) { h.say('Agent', '同一个 request_id，返回已有任务 ' + res.task_id + '，没有新建。'); paint(); }
    },
    async replay() {
      const same = (a, b) => typeof a === 'object' && a && b ? Object.keys(Object.assign({}, a, b)).every(k => same(a[k], b[k])) : a === b;
      const my = run, ok = same(HX.replay(h.events).get(id), h.tasks.get(id)), n = h.events.length;
      ui.note.textContent = '';
      for (const line of [...ui.log.children]) { line.classList.add('l-hit'); line.scrollIntoView({block: 'nearest'}); await wait(34); line.classList.remove('l-hit'); if (my !== run) return; }
      ui.note.textContent = '回放 ' + n + ' 条事件，重建出的任务状态与 tasks 表' + (ok ? '一致 ✓' : '不一致 ✕');
    }
  };
  box.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) acts[b.dataset.act](); });
  setInterval(() => { const s = simNow(); ui.now.textContent = hms(s); ui.left.textContent = s >= CLOSE ? '00:00:00 · 窗口到点' : hms(CLOSE - s); }, 500);
  boot();
  // 每次打开面板时，如果还没开始，就把演练时钟拨回窗口开头
  return {open() { const t = h.tasks.get(id); if (t.state === 'created' && h.events.length <= 2 && !cut) boot(); }};
}

/* ================= 北京：症状 → 候选根因 ================= */
function fanFig(box) {
  const X = ZT.xiaobei, ys = [46, 110], yc = [15, 57, 99, 141];
  box.innerHTML = `<div class="fan-in">
      <ul class="fan-l" aria-label="症状">${X.SYMPTOMS.map(s => '<li>' + esc(s) + '</li>').join('')}</ul>
      <svg viewBox="0 0 100 156" preserveAspectRatio="none" aria-hidden="true">${ys.map(a => yc.map(b => `<path d="M0 ${a}C50 ${a} 50 ${b} 100 ${b}"/>`).join('')).join('')}</svg>
      <ul class="fan-r" aria-label="候选根因">${X.CAUSES.map(c => '<li>' + esc(c.name) + '</li>').join('')}</ul>
    </div><figcaption>同样的两个症状，背后可能是四类事件中的任何一类。只看症状，分不出来。</figcaption>`;
}

/* ================= 北京：证据门禁 ================= */
function gateApp(box) {
  const X = ZT.xiaobei, BARS = {ruled_out: 0, pending: 1, suspected: 2, confirmed: 3};
  const ev = {qp: Object.assign({}, X.GATES.qp.initial), ep: Object.assign({}, X.GATES.ep.initial)};
  let gate = 'qp', last = null;
  box.innerHTML = `<div class="gt-top"><div class="gt-in"></div>
      <div class="meter" aria-live="polite"><small>确定性</small><strong></strong><ol aria-hidden="true"><li></li><li></li><li></li></ol></div></div>
    <h4>九行简报 <em>给值班人员</em></h4><dl class="brief"></dl>
    <details class="report"><summary>完整报告：证据、未决项、验证方法</summary><div class="report-in"></div></details>
    <p class="synth">合成案例。门禁的判定在你的浏览器里执行：拨动证据，看结论跟到哪一步。</p>`;
  const inputs = box.querySelector('.gt-in'), meter = box.querySelector('.meter'), briefEl = box.querySelector('.brief'), rep = box.querySelector('.report-in');
  const hyp = seg('怀疑的根因', ['qp', 'ep'].map(k => [k, X.GATES[k].name]), gate, v => { gate = v; last = null; controls(); render(); });
  function controls() {
    inputs.replaceChildren(field('怀疑的根因', hyp.el), ...X.GATES[gate].checks.map(c => field(c.label, seg(c.label, Object.entries(c.states), ev[gate][c.id], v => { ev[gate][c.id] = v; render(); }).el)));
  }
  function render() {
    const c = X.diagnose(gate, ev[gate]), lines = X.brief(c), r = X.report(c);
    meter.className = 'meter lv-' + c.level;
    meter.querySelector('strong').textContent = X.LEVELS[c.level];
    meter.querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', i < BARS[c.level]));
    briefEl.className = 'brief lv-' + c.level;
    briefEl.innerHTML = lines.map(([k, v], i) => '<dt>' + k + '</dt><dd class="' + (k === '确定性' ? 'lv ' : '') + (last && last[i] !== v ? 'chg' : '') + '">' + esc(v) + (k === '已确认' ? '<small>观测事实，不随证据升降</small>' : '') + '</dd>').join('');
    last = lines.map(l => l[1]);
    rep.innerHTML = '<h5>结论</h5><p>' + esc(r.verdict) + '</p><p>' + esc(r.fact) + '</p>' +
      '<h5>证据</h5><table class="tbl"><thead><tr><th>项目</th><th>来源</th><th>取数状态</th></tr></thead><tbody>' + r.evidence.map(e => '<tr><td>' + esc(e.item) + '</td><td class="dim">' + esc(e.source) + '</td><td>' + esc(e.status) + '</td></tr>').join('') + '</tbody></table>' +
      '<h5>未决项</h5>' + (r.open.length ? '<ul>' + r.open.map(v => '<li>' + esc(v) + '</li>').join('') + '</ul>' : '<p>无</p>') +
      '<h5>验证方法</h5><ul>' + r.verify.map(v => '<li>' + esc(v) + '</li>').join('') + '</ul>';
  }
  controls(); render();
}

/* ================= 北京：分段打点 ================= */
function traceFig(box) {
  const X = ZT.xiaobei, T = X.TRACE, t = X.timing(T), sec = ms => (ms / 1000).toFixed(2) + ' s', pc = ms => (ms / t.total * 100).toFixed(2) + '%';
  box.innerHTML = `<div class="tr-rows">
      <span></span><div class="axis"><b>0</b><b>${sec(t.total)}</b></div>
      ${T.map(s => `<span class="${s === t.slowest ? 'slow' : ''}">${esc(s.name)}</span><div><i class="k-${s.kind}" style="left:${pc(s.from)};width:${pc(s.to - s.from)}"></i></div>`).join('')}
    </div>
    <div class="tr-sum">
      <p class="no">六个并行工具，耗时逐个相加<b>${sec(t.toolSum)}</b></p>
      <p class="yes">按时间区间的并集，实际占用<b>${sec(t.tool)}</b></p>
    </div>
    <div class="tr-split" aria-hidden="true"><i class="k-tool" style="flex:${t.tool}"></i><i class="k-model" style="flex:${t.model}"></i><i class="k-orch" style="flex:${t.orch}"></i></div>
    <ul class="tr-key" aria-label="这一轮的时间构成"><li class="k-tool">数据源 ${sec(t.tool)}</li><li class="k-model">模型 ${sec(t.model)}</li><li class="k-orch">编排往返 ${sec(t.orch)}</li></ul>
    <figcaption>合成数据。这一轮 ${sec(t.total)}，大头在数据源：光是“${esc(t.slowest.name)}”就占了 ${sec(t.slowest.to - t.slowest.from)}。先该动的是它，不是模型。</figcaption>`;
}

/* ================= 北京：自进化闸门 ================= */
function evolveApp(box) {
  const E = ZT.evolve, STAGES = ['优化队列', '候选补丁', '审查', '冻结取证包回放', '严格优于基线', '人工确认', '采纳'];
  const AT = {review: 2, replay: 3, compare: 4, human: 5, done: 6};
  const TITLE = {rejected: '驳回', invalid: '本轮无效', awaiting_human: '等待人工确认', adopted: '已采纳'};
  let cand = 'B', leak = false, humanOk = false;
  box.innerHTML = `<ol class="ev-flow" aria-label="一条候选补丁要过的关">${STAGES.map(s => '<li>' + s + '</li>').join('')}</ol>
    <div class="ev-ctl"></div><p class="ev-note"></p>
    <div class="ev-wrap"><table class="tbl"></table></div>
    <div class="ev-out" aria-live="polite"></div>
    <p class="synth">合成样例，只为说明闸门怎么判。类别标签留在评分侧；数据集按案例族切分。</p>`;
  const flowEl = [...box.querySelectorAll('.ev-flow li')], wrap = box.querySelector('.ev-wrap'), table = box.querySelector('table'), out = box.querySelector('.ev-out');
  const check = el('label', 'check', '<input type="checkbox">题面里带着故障类别');
  check.firstChild.addEventListener('change', e => { leak = e.target.checked; humanOk = false; render(); });
  box.querySelector('.ev-ctl').append(seg('候选补丁', ['A', 'B', 'C', 'D'].map(k => [k, E.VERSIONS[k].name]), cand, v => { cand = v; humanOk = false; render(); }).el, check);
  out.addEventListener('click', e => { if (e.target.closest('button')) { humanOk = true; render(); } });

  function render() {
    const r = E.judgePatch(cand, {leak, humanOk}), v = E.VERSIONS[cand], at = AT[r.stage];
    const baseRows = r.baseRows || E.replayPacks(E.VERSIONS.base, leak), base = r.base || E.score(baseRows);
    const cell = x => x ? '<td><span class="mark ' + (x.ok ? 'tone-ok">✓' : 'tone-bad">✕') + '</span>' + E.ANSWERS[x.out] + '</td>' : '<td class="dim">—</td>';
    const sum = s => s ? '<td><b>' + s.main + ' / ' + s.total + '</b></td>' : '<td>没有进入回放</td>';
    const sub = s => s ? '<td>' + s.hit + '/' + s.faults + ' · ' + s.falseAlarm + ' · ' + s.unknownOk + '/' + s.gaps + '</td>' : '<td>—</td>';
    flowEl.forEach((li, i) => { li.className = i < at ? 'pass' : i > at ? '' : r.status === 'adopted' ? 'ok' : r.status === 'awaiting_human' ? 'wait' : 'bad'; });
    box.querySelector('.ev-note').textContent = v.name + '：' + v.note + '。';
    wrap.classList.toggle('void', r.status === 'invalid');
    table.innerHTML = '<thead><tr><th>冻结取证包</th><th>参考答案</th><th>旧版</th><th>' + v.name + '</th></tr></thead><tbody>' +
      baseRows.map((b, i) => '<tr><td>' + b.id + ' · ' + b.family + '</td><td class="dim">' + E.ANSWERS[b.truth] + '</td>' + cell(b) + cell(r.candRows && r.candRows[i]) + '</tr>').join('') +
      '</tbody><tfoot><tr><td colspan="2">开发集主指标：答对</td>' + sum(base) + sum(r.cand) + '</tr><tr><td colspan="2">故障命中 · 误报 · 正确的“未知”</td>' + sub(base) + sub(r.cand) + '</tr></tfoot>';
    out.className = 'ev-out st-' + r.status;
    out.innerHTML = '<strong>' + TITLE[r.status] + '</strong><p>' + esc(r.reason) + '</p>' + (r.status === 'awaiting_human' ? '<button type="button" class="btn btn-ac">人工确认，采纳</button>' : '');
  }
  render();
}

/* ================= 北京：验收器 ================= */
function benchApp(box) {
  const CUR = {run_id: 'run-b', round: 2};
  const s = {src: 'cur', exit: 0, metric: 'no', meets: 'yes', hard: 'yes'};
  box.innerHTML = `<dl class="bn-head">
      <dt>实验</dt><dd>固定模型、负载和并发，比较不同缓存配置对未命中 token 吞吐率的影响</dd>
      <dt>当前</dt><dd>${CUR.run_id} · 第 ${CUR.round} 轮（任务重开过一次，run-a 是重开前的执行批次）</dd></dl>
    <div class="bn-in"></div><div class="bn-out" aria-live="polite"></div>
    <p class="synth">合成样例。验收器只看证据，不看 Agent 怎么说。</p>`;
  const out = box.querySelector('.bn-out');
  const pick = (key, label, options) => { const g = seg(label, options, s[key], v => { s[key] = v; render(true); }); g.key = key; return g; };
  const groups = [
    pick('src', '这份结果来自', [['cur', 'run-b · 第 2 轮'], ['old', 'run-a · 第 1 轮（迟到）']]),
    pick('exit', '压测退出码', [[0, '0'], [137, '137']]),
    pick('metric', '主指标', [['yes', '采到了'], ['no', '缺失']]),
    pick('meets', '阈值', [['yes', '达标'], ['no', '未达标']]),
    pick('hard', '硬约束', [['yes', '满足'], ['no', '违反']])
  ];
  box.querySelector('.bn-in').append(...groups.map(g => field(g.el.getAttribute('aria-label'), g.el)));
  function render(pop) {
    const v = ZT.bench.accept({
      run_id: s.src === 'cur' ? CUR.run_id : 'run-a', round: s.src === 'cur' ? CUR.round : 1,
      exit_code: s.exit, metric: s.metric === 'yes' ? 1 : null, meets: s.meets === 'yes', hard_ok: s.hard === 'yes'
    }, CUR);
    groups.find(g => g.key === 'meets').disable(s.metric !== 'yes');       // 没有主指标，就谈不上达不达标
    const next = v.status === 'blocked' ? '记录需要补采的证据：' + v.need.join('、') + '。补采之后再验收。'
      : v.status === 'failed' ? '带进第 ' + (CUR.round + 1) + ' 轮：' + v.carry
      : v.status === 'stale' ? '当前结论保持不变。' : '这一轮的结论成立。';
    out.className = 'bn-out st-' + v.status;
    out.innerHTML = '<span class="stamp' + (pop ? ' pop' : '') + '">' + v.status + '</span><b>' + v.title + '</b><p>' + esc(v.reason) + '</p><p class="next">' + esc(next) + '</p>';
  }
  render(false);
}

/* ================= 地图、路由、面板 ================= */
const sites = {chile: $('chile'), beijing: $('beijing')};
const BLOCKS = {harness: 'chile', xiaobei: 'beijing', evolve: 'beijing', workbench: 'beijing'};
const chips = {chile: $('chip-chile'), beijing: $('chip-beijing')};
let current = null;

function applyMode() {
  root.dataset.mode = window.ZT_MODE();
  root.style.setProperty('--band', Math.round(clamp(innerWidth * .75, 220, innerHeight * .6)) + 'px');
}
applyMode();

const map = window.ZTMap.create({
  stage: $('stage'), base: $('map-base'), fx: $('map-fx'), land: ZT.createLand(window.ZT_LAND),
  labels: {chile: chips.chile, beijing: chips.beijing, tag: $('beam-tag')},
  wide: () => root.dataset.mode === 'wide',
  reduced: () => rm.matches,
  onPick: id => go(id),
  onHover: id => { for (const k in chips) chips[k].classList.toggle('hot', k === id); },
  onLayout(v) {                                            // 自我介绍跟着地图走：底部锚在南纬 50° 的印度洋上，往上自然生长
    const s = root.style;
    s.setProperty('--u', v.k0.toFixed(3) + 'px');
    s.setProperty('--ix', Math.round(v.left) + 'px'); s.setProperty('--ib', Math.round(v.bottom) + 'px');
    s.setProperty('--iw', Math.round(v.width) + 'px');
  }
});

const harness = harnessApp($('harness-app'));
fanFig($('fan-app')); gateApp($('gate-app')); traceFig($('trace-app')); evolveApp($('evolve-app')); benchApp($('bench-app'));

function setInset() { map.setInset({right: current && root.dataset.mode === 'wide' ? sites[current].offsetWidth + 24 : 0}); }
let opening = 0;
function show(site, block) {
  const prev = current, inside = prev && sites[prev].contains(document.activeElement);
  const ride = prev && site && prev !== site && root.dataset.mode === 'wide' && !rm.matches;
  current = site;
  clearTimeout(opening);
  root.classList.toggle('is-site', !!site);
  for (const id in sites) if (id !== site) sites[id].classList.remove('open');
  setInset();
  if (site !== prev) map.flyTo(site || 'overview');
  if (!site) {
    if (inside) setTimeout(() => { if (!current) chips[prev].focus({preventScroll: true}); }, rm.matches ? 0 : 1300);
    return;
  }
  const open = () => {
    const body = sites[site].querySelector('.site-body');
    sites[site].classList.add('open');
    if (site !== prev) { body.scrollTop = 0; sites[site].focus({preventScroll: true}); if (site === 'chile') harness.open(); }
    if (block) body.scrollTo({top: $(block).offsetTop - 12, behavior: site === prev && !rm.matches ? 'smooth' : 'auto'});
  };
  if (ride) opening = setTimeout(open, 2100); else open();      // 沿光束飞的时候，等镜头快到了再把面板推出来
}
function route() {
  const key = decodeURIComponent(location.hash.slice(1));
  show(sites[key] ? key : BLOCKS[key] || null, BLOCKS[key] ? key : null);
}
function go(key) { if (location.hash === '#' + key) route(); else location.hash = key; }
function close() {
  try { history.pushState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
  route();
}

document.addEventListener('click', e => {
  const chip = e.target.closest('[data-go]');
  if (chip) return go(chip.dataset.go);
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const key = a.getAttribute('href').slice(1);
  if (!key) { e.preventDefault(); close(); }
  else if (sites[key] || BLOCKS[key]) { e.preventDefault(); go(key); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && current) close(); });
window.addEventListener('hashchange', route);
for (const a of document.querySelectorAll('.qs a')) {
  a.addEventListener('pointerenter', () => map.setHover(a.dataset.site));
  a.addEventListener('pointerleave', () => map.setHover(null));
  a.addEventListener('focus', () => map.setHover(a.dataset.site));
  a.addEventListener('blur', () => map.setHover(null));
}

// 北京面板顶上的小导航：滚到哪一段，哪一项亮
{
  const body = sites.beijing.querySelector('.site-body'), links = [...sites.beijing.querySelectorAll('.site-nav a')], marks = links.map(a => $(a.getAttribute('href').slice(1)));
  let queued = false;
  const spy = () => {
    queued = false;
    let on = 0;
    marks.forEach((m, i) => { if (m.offsetTop - 90 <= body.scrollTop) on = i; });
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 4) on = marks.length - 1;
    links.forEach((a, i) => a.classList.toggle('on', i === on));
  };
  body.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(spy); } }, {passive: true});
  spy();
}

let resizing = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(resizing); resizing = requestAnimationFrame(() => { applyMode(); map.resize(); setInset(); }); });
rm.addEventListener('change', () => map.kick());

/* ================= 两地时钟、昼夜、光束的长度 ================= */
function tick() {
  const now = Date.now(), sunNow = geo.sun(now), off = {};
  for (const [k, place] of [['cl', P.santiago], ['bj', P.beijing]]) {
    const z = geo.zoneTime(now, place.tz), alt = geo.sunAltitude(place, sunNow), dn = alt > 0 ? '昼' : alt > -6 ? '晨昏' : '夜';
    off[k] = z.offsetMin;
    $('t-' + k).textContent = z.text; $('d-' + k).textContent = dn;
    $('p-t-' + k).textContent = z.text.slice(0, 5); $('p-d-' + k).textContent = dn;
  }
  $('t-gap').textContent = '相差 ' + (off.bj - off.cl) / 60 + ' 小时';
}
{
  const route = geo.eastArc(P.santiago, P.beijing, 200, 50), km = geo.pathKm(route), text = (Math.round(km / 10) * 10).toLocaleString('en-US'), ms = Math.round(geo.lightMs(km));
  $('beam-tag').textContent = '航线 ' + text + ' KM · 光行约 ' + ms + ' MS';
  $('beam-meta').textContent = '圣地亚哥 → 北京 · 向东跨大西洋、经欧洲 · 航线约 ' + text + ' km · 真空中的光约走 ' + ms + ' ms';
}
tick(); setInterval(tick, 1000);
route();
})();
