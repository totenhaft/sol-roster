const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = html.match(/<script id="app-script">([\s\S]*?)<\/script>/)[1];
const serverScript = fs.readFileSync(path.join(root, 'apps-script/Code.gs'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function app() {
  const handlers = {}, elements = {};
  const element = () => ({ textContent: '', innerHTML: '', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
  elements.app = element();
  elements.app.addEventListener = (type, fn) => { handlers[type] = fn; };
  elements['app-state'] = { textContent: '{}' };
  elements['app-style'] = element();
  elements['app-script'] = element();
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const c = vm.createContext({
    window: { innerWidth: 1200, addEventListener() {}, scrollTo() {} },
    document: { getElementById(id) { return elements[id] || null; }, addEventListener() {}, activeElement: null },
    localStorage: storage, sessionStorage: storage, console, setTimeout() { return 1; }, clearTimeout() {},
  });
  // Expose the existing app closure in an isolated test context; never boot or contact the live server.
  vm.runInContext(script.replace(/^\(function\(\)\{/, '').replace(/\}\)\(\);\s*$/, '').replace(/\r?\nboot\(\);/, '\n'), c);
  c.handlers = handlers;
  c.elements = elements;
  c.render = () => { c.clearDI(); };
  reset(c);
  return c;
}

function reset(c, need = { full: 2, half: 1, night: 1 }) {
  const s = c.blankState();
  s.clinic = '테스트 병원';
  s.hours[1].night = true;
  s.hours[5].night = true;
  s.teams = [{
    id: 't1', name: '테스트팀', need,
    staff: [1, 2, 3].map(n => ({ id: 's' + n, name: '직원' + n, weekDays: 6, avail: [1, 2, 3, 4, 5, 6], night: true })),
  }];
  c.S = c.normalize(s);
  c.rebuildTypes();
  c.clearDI();
  c.ui.ym = '2026-11';
  c.ui.team = 'all';
  c.ui.preview = 'admin';
  c.ui.dirty = c.freshDirty();
  return c.S.teams[0];
}

function backend(team) {
  const c = vm.createContext({ console });
  vm.runInContext(serverScript, c);
  let data = { config: { teamOrder: ['t1'] }, teams: { t1: plain(team) }, sched: {} };
  c.auth_ = () => ({ role: 'admin' });
  c.readData_ = () => plain(data);
  c.writeData_ = d => { data = plain(d); };
  c.histAdd_ = () => {};
  c.data = () => plain(data);
  return c;
}

test('legacy full-day, half-day and night minimums keep the same behavior', () => {
  const c = app(), t = c.S.teams[0];
  assert.equal(c.needOf(t, c.di('2026-11-02'), 'am'), 2);
  assert.equal(c.needOf(t, c.di('2026-11-02'), 'pm'), 2);
  assert.equal(c.needOf(t, c.di('2026-11-02'), 'night'), 1);
  assert.equal(c.needOf(t, c.di('2026-11-07'), 'am'), 1);
  assert.equal(c.needOf(t, c.di('2026-11-07'), 'pm'), 0);
  assert.equal(c.needOf(t, c.di('2026-11-03'), 'night'), 0);
});

test('weekday and session overrides preserve explicit zero; omitted fields inherit', () => {
  const c = app(), t = reset(c, { full: 2, half: 1, night: 1, byDay: { 1: { am: 4, pm: 0, night: 2 }, 6: { am: 3 } } });
  assert.deepEqual(['am', 'pm', 'night'].map(k => c.needOf(t, c.di('2026-11-02'), k)), [4, 0, 2]);
  assert.equal(c.needOf(t, c.di('2026-11-03'), 'am'), 2);
  assert.equal(c.needOf(t, c.di('2026-11-07'), 'am'), 3);
});

test('front and server normalize bounds and empty fields consistently', () => {
  const c = app(), b = backend(c.S.teams[0]);
  const raw = { full: 2, half: 1, night: 1, byDay: { 1: { am: 0, pm: '', night: null }, 2: { am: 99, pm: -3, night: '2' }, 3: { am: 'bad', pm: ' ' }, 9: { am: 5 } } };
  const expected = { full: 2, half: 1, night: 1, byDay: { 1: { am: 0 }, 2: { am: 30, pm: 0, night: 2 } } };
  assert.deepEqual(plain(c.cleanNeed(raw)), expected);
  assert.deepEqual(plain(b.cleanNeed_(raw)), expected);
});

test('closed days ignore overrides, while date-specific openings use their weekday', () => {
  const c = app(), t = reset(c, { full: 2, half: 1, night: 1, byDay: { 0: { am: 3, pm: 4, night: 2 }, 5: { am: 5 } } });
  assert.deepEqual(['am', 'pm', 'night'].map(k => c.needOf(t, c.di('2026-11-01'), k)), [0, 0, 0]);
  assert.equal(c.needOf(t, c.di('2026-12-25'), 'am'), 0);
  c.S.dateHours['2026-11-01'] = { closed: false, h: c.fixHours({ type: 'full', night: true }, 0) };
  c.clearDI();
  assert.deepEqual(['am', 'pm', 'night'].map(k => c.needOf(t, c.di('2026-11-01'), k)), [3, 4, 2]);
  c.S.dateHours['2026-11-03'] = { closed: false, h: c.fixHours({ type: 'half', end: '13:00', lunch: false }, 2) };
  c.clearDI();
  assert.equal(c.needOf(t, c.di('2026-11-03'), 'am'), 1);
  assert.equal(c.needOf(t, c.di('2026-11-03'), 'pm'), 0);
});

test('settings UI has seven days, session labels, zero values and inherited placeholders', () => {
  const c = app(), t = reset(c, { full: 2, half: 1, night: 1, byDay: { 1: { am: 0, night: 2 } } });
  const output = c.needEditor(t);
  assert.equal((output.match(/data-dw=/g) || []).length, 21);
  assert.match(output, /월요일 오전 최소 인원/);
  assert.match(output, /일요일 야간 최소 인원/);
  assert.match(output, /data-dw="1" data-k="am" value="0"/);
  assert.match(output, /data-dw="2" data-k="am" value="" placeholder="기본 2"/);
});

test('old servers cannot silently discard weekday edits; version 16 enables them', () => {
  const c = app(), t = c.S.teams[0];
  c.MODE = 'server';
  c.ui.status = { version: 15 };
  assert.equal((c.needEditor(t).match(/ disabled/g) || []).length, 21);
  c.ui.status.version = 16;
  assert.equal((c.needEditor(t).match(/ disabled/g) || []).length, 0);
});

test('editing and clearing a weekday field uses zero correctly and marks only its team dirty', () => {
  const c = app(), t = c.S.teams[0];
  const target = { dataset: { nd: 't1', dw: '1', k: 'am' }, value: '0' };
  c.handlers.change({ target });
  assert.equal(c.needOf(t, c.di('2026-11-02'), 'am'), 0);
  assert.ok(c.ui.dirty.teams.t1);
  assert.equal(c.ui.dirty.config, false);
  target.value = '';
  c.handlers.change({ target });
  assert.equal(c.needOf(t, c.di('2026-11-02'), 'am'), 2);
  assert.deepEqual(plain(t.need.byDay), {});
  c.ui.preview = 'viewer';
  target.value = '8';
  c.handlers.change({ target });
  assert.equal(c.needOf(t, c.di('2026-11-02'), 'am'), 2);
});

test('save/load round trip retains weekday values through the actual frontend and server paths', async () => {
  const c = app(), t = reset(c, { full: 2, half: 1, night: 1, byDay: { 1: { am: 4, pm: 0, night: 2 } } });
  const b = backend(t);
  c.MODE = 'server';
  c.ui.auth = { role: 'admin', pin: 'test' };
  c.ui.status = { version: 16 };
  c.ui.dirty.teams.t1 = 1;
  c.api = (action, payload) => {
    assert.equal(action, 'saveTeam');
    return Promise.resolve(b.saveTeam_(payload));
  };
  await c.saveServer();
  assert.equal(Object.keys(c.ui.dirty.teams).length, 0);
  c.applyServer({ data: b.data() });
  assert.deepEqual(plain(c.S.teams[0].need.byDay), { 1: { am: 4, pm: 0, night: 2 } });
  assert.equal(c.needOf(c.S.teams[0], c.di('2026-11-02'), 'pm'), 0);
});

test('an older browser saving defaults preserves overrides; explicit empty map clears them', () => {
  const c = app(), t = reset(c, { full: 2, half: 1, night: 1, byDay: { 1: { am: 4 } } }), b = backend(t);
  let payload = plain(t);
  delete payload.need.byDay;
  payload.need.full = 3;
  assert.equal(b.saveTeam_({ team: payload, base: 0 }).ok, true);
  assert.deepEqual(b.data().teams.t1.need.byDay, { 1: { am: 4 } });
  payload = b.data().teams.t1;
  payload.need.byDay = {};
  assert.equal(b.saveTeam_({ team: payload, base: payload.updatedAt }).ok, true);
  assert.deepEqual(b.data().teams.t1.need.byDay, {});
});

test('server team permissions and conflict checks still protect staffing changes', () => {
  const c = app(), b = backend(c.S.teams[0]), payload = plain(c.S.teams[0]);
  b.auth_ = () => ({ role: 'leader', teamId: 't2' });
  assert.equal(b.saveTeam_({ team: payload, base: 0 }).error, 'forbidden');
  b.auth_ = () => ({ role: 'leader', teamId: 't1', name: '팀장' });
  assert.equal(b.saveTeam_({ team: payload, base: 123 }).error, 'conflict');
  assert.equal(b.saveTeam_({ team: payload, base: 0 }).ok, true);
});

test('statistics, date detail, calendar and printed table use session-specific shortages', () => {
  const c = app(), t = reset(c, { full: 2, half: 1, night: 0, byDay: { 1: { am: 4, pm: 2, night: 2 } } });
  const day = c.stats('2026-11', [t]).days['2026-11-02'].teams.t1;
  assert.deepEqual([day.am, day.pm, day.nn, day.sAM, day.sPM, day.sNT], [4, 2, 2, true, false, true]);
  const detail = c.teamDayCount(t, c.roster('2026-11', 't1'), '2026-11-02', c.di('2026-11-02'));
  assert.match(detail, /bad">오전 3\/4/);
  assert.match(detail, /오후 3\/2/);
  assert.match(detail, /bad">야간 0\/2/);
  assert.match(c.calendarView('2026-11', [t]), /인원|부족/);
  assert.match(c.printDoc('2026-11'), /class="short">3/);
  c.elements.gfoot = { innerHTML: '' };
  c.refreshStats();
  assert.match(c.elements.gfoot.innerHTML, /오전 3명 \/ 필요 4명/);
  assert.match(c.elements.gfoot.innerHTML, /오후 3명 \/ 필요 2명/);
  assert.match(c.elements.gfoot.innerHTML, /야간 0명 \/ 필요 2명/);
});

test('automatic generation meets feasible weekday day/night minimums and keeps fixed cells', () => {
  const c = app(), t = reset(c, { full: 2, half: 1, night: 0, byDay: { 1: { am: 3, pm: 3, night: 2 }, 5: { night: 1 } } });
  c.S.rules.effort = 'fast';
  const r = c.roster('2026-11', 't1', true);
  c.setIn(r.cells, 's1', '2026-11-03', 'V');
  c.setIn(r.locks, 's1', '2026-11-03', 1);
  c.genTeam('2026-11', t);
  const s = c.stats('2026-11', [t]);
  assert.equal(c.gc(r, 's1', '2026-11-03'), 'V');
  assert.equal(s.days['2026-11-02'].teams.t1.c[2], 2);
  assert.equal(s.days['2026-11-06'].teams.t1.c[2], 1);
  assert.equal(s.T.shortDays, 0);
});

test('automatic generation prioritizes high-demand weekdays when placing weekly time off', () => {
  const c = app(), t = reset(c, { full: 0, half: 0, night: 0, byDay: { 1: { am: 3, pm: 3 }, 2: { am: 3, pm: 3 }, 3: { am: 3, pm: 3 }, 4: { am: 3, pm: 3 }, 5: { am: 3, pm: 3 } } });
  t.staff.forEach(p => { p.weekDays = 5; });
  c.S.rules.effort = 'fast';
  c.genTeam('2026-11', t);
  const s = c.stats('2026-11', [t]);
  assert.equal(s.T.shortDays, 0);
  assert.equal(s.days['2026-11-07'].teams.t1.c[0], 0);
});
