/**
 * 솔안과 근무표 - 구글 드라이브 저장 서버 (Google Apps Script)
 *
 * 하는 일
 *  - 근무표 데이터를 관리자(이 스크립트를 만든 사람)의 구글 드라이브에 JSON 파일 하나로 저장해요.
 *  - 관리자 PIN, 팀장 PIN, 열람 PIN으로 누가 무엇을 고칠 수 있는지 확인해요.
 *  - 여러 팀장이 동시에 저장해도 서로의 팀을 덮어쓰지 않도록 팀·달 단위로 저장해요.
 *
 * 설치 방법은 README.md를 보세요. 이 파일은 고치지 않고 그대로 붙여 넣으면 돼요.
 */

var DATA_FILE_NAME = '솔안과_근무표_데이터.json';
var MAX_FAILS = 10;          // PIN을 이만큼 틀리면
var LOCK_SECONDS = 600;      // 이 시간(초) 동안 로그인을 막아요

function doGet() {
  return ContentService.createTextOutput('솔안과 근무표 서버가 동작 중이에요. 이 주소를 config.js에 넣으세요.');
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad_request' }); }
  try { return out_(handle_(req)); }
  catch (err) { return out_({ ok: false, error: 'server', message: String(err && err.message || err) }); }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  migrateTeamPins_();
  switch (req && req.action) {
    case 'status': return status_();
    case 'claimAdmin': return withLock_(function () { return claimAdmin_(req); });
    case 'login': return login_(req);
    case 'load': return load_(req);
    case 'saveConfig': return withLock_(function () { return saveConfig_(req); });
    case 'saveTeam': return withLock_(function () { return saveTeam_(req); });
    case 'saveRoster': return withLock_(function () { return saveRoster_(req); });
    case 'setPin': return withLock_(function () { return setPin_(req); });
    case 'addLeader': return withLock_(function () { return addLeader_(req); });
    case 'updateLeader': return withLock_(function () { return updateLeader_(req); });
    case 'deleteLeader': return withLock_(function () { return deleteLeader_(req); });
    case 'handbook': return handbook_(req);
    case 'att': return att_(req);
    case 'history': return history_(req);
    case 'restore': return withLock_(function () { return restore_(req); });
    case 'saveAtt': return withLock_(function () { return saveAtt_(req); });
    case 'saveArticle': return withLock_(function () { return saveArticle_(req); });
    case 'addArticles': return withLock_(function () { return addArticles_(req); });
    case 'deleteArticle': return withLock_(function () { return deleteArticle_(req); });
  }
  return { ok: false, error: 'unknown_action' };
}

/* ---------- storage ---------- */
function props_() { return PropertiesService.getScriptProperties(); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy', message: '잠시 뒤 다시 저장하세요.' };
  try { return fn(); } finally { lock.releaseLock(); }
}

function defaultData_() {
  var hours = {};
  for (var dw = 0; dw < 7; dw++) {
    hours[dw] = { type: dw === 0 ? 'closed' : dw === 6 ? 'half' : 'full', start: '09:00', end: dw === 6 ? '13:00' : '18:00',
      lunch: dw !== 6, ls: '13:00', le: '14:00', night: false, ne: '20:00' };
  }
  var now = Date.now();
  return {
    config: {
      clinic: '연세솔안과', holidayCredit: true, hours: hours, dateHours: {},
      types: [
        { id: 'T1', name: '외근', short: '외', color: 'blue', kind: 'out', time: 'full' },
        { id: 'T2', name: '교육', short: '교', color: 'violet', kind: 'out', time: 'full' },
        { id: 'T3', name: '경조사', short: '경', color: 'rose', kind: 'paid', time: 'full' }
      ],
      teamOrder: ['t1', 't2'], updatedAt: now
    },
    teams: {
      t1: { id: 't1', name: '외래팀', leader: '', need: { full: 2, half: 1, night: 0 }, staff: [], updatedAt: now },
      t2: { id: 't2', name: '검안팀', leader: '', need: { full: 2, half: 1, night: 0 }, staff: [], updatedAt: now }
    },
    sched: {}
  };
}

function dataFile_() {
  var p = props_(), id = p.getProperty('DATA_FILE_ID');
  if (id) {
    try { return DriveApp.getFileById(id); } catch (err) { /* 파일이 지워졌으면 새로 만들어요 */ }
  }
  var file = DriveApp.createFile(DATA_FILE_NAME, JSON.stringify(defaultData_()), 'application/json');
  p.setProperty('DATA_FILE_ID', file.getId());
  return file;
}

function readData_() {
  var text = dataFile_().getBlob().getDataAsString('UTF-8');
  var d = JSON.parse(text || '{}');
  d.config = d.config || defaultData_().config;
  d.teams = d.teams || {};
  d.sched = d.sched || {};
  return d;
}

function writeData_(d) { dataFile_().setContent(JSON.stringify(d)); }

/* ---------- PIN ---------- */
function salt_() {
  var p = props_(), s = p.getProperty('SALT');
  if (!s) { s = Utilities.getUuid(); p.setProperty('SALT', s); }
  return s;
}

function hash_(pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt_() + ':' + String(pin), Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function locked_() {
  var n = Number(CacheService.getScriptCache().get('fails') || 0);
  return n >= MAX_FAILS;
}

function fail_() {
  var c = CacheService.getScriptCache(), n = Number(c.get('fails') || 0) + 1;
  c.put('fails', String(n), LOCK_SECONDS);
}

/* ---------- 팀장 (사람마다 이름과 PIN) ---------- */
function leaders_() {
  var raw = props_().getProperty('LEADERS');
  try { return raw ? JSON.parse(raw) : []; } catch (err) { return []; }
}
function saveLeaders_(list) { props_().setProperty('LEADERS', JSON.stringify(list)); }
function newId_() { return 'L' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }

/** 예전 방식(팀마다 PIN 하나)으로 정한 팀장 PIN을 사람별 팀장으로 옮겨요. 한 번만 일어나요. */
function migrateTeamPins_() {
  var p = props_();
  var has = Object.keys(p.getProperties()).some(function (k) { return k.indexOf('TEAM_PIN_') === 0; });
  if (!has) return;
  withLock_(function () {
    var list = leaders_(), d = readData_(), all = p.getProperties();
    Object.keys(all).forEach(function (k) {
      if (k.indexOf('TEAM_PIN_') !== 0) return;
      var tid = k.slice(9), tm = d.teams[tid];
      if (tm) list.push({ id: newId_(), teamId: tid, name: String(tm.leader || (tm.name + ' 팀장')).slice(0, 30), hash: all[k] });
      p.deleteProperty(k);
    });
    saveLeaders_(list);
    return {};
  });
}

/** 이 PIN 해시를 다른 사람이 이미 쓰고 있는지 확인해요 */
function pinTaken_(h, exceptLeaderId, exceptKey) {
  var p = props_().getProperties();
  if (exceptKey !== 'ADMIN_PIN' && p.ADMIN_PIN === h) return true;
  if (exceptKey !== 'VIEW_PIN' && p.VIEW_PIN === h) return true;
  return leaders_().some(function (l) { return l.id !== exceptLeaderId && l.hash === h; });
}

function actorName_(a) { return a.role === 'admin' ? '관리자' : (a.name || '팀장'); }

/** PIN이 누구 것인지 찾아요. 없으면 null */
function who_(pin) {
  if (!pin) return null;
  var p = props_().getProperties(), h = hash_(pin);
  if (p.ADMIN_PIN && p.ADMIN_PIN === h) return { role: 'admin' };
  var l = leaders_().filter(function (x) { return x.hash === h; })[0];
  if (l) return { role: 'leader', teamId: l.teamId, leaderId: l.id, name: l.name };
  if (p.VIEW_PIN && p.VIEW_PIN === h) return { role: 'viewer' };
  return null;
}

/** pin을 확인하고, 틀리면 실패 횟수를 올려요 */
function auth_(pin) {
  if (locked_()) return { error: 'locked' };
  var w = who_(pin);
  if (!w) { fail_(); return { error: 'pin' }; }
  return w;
}

function pinsInfo_(d) {
  var order = d.config.teamOrder || [];
  return {
    view: !!props_().getProperty('VIEW_PIN'),
    leaders: leaders_().filter(function (l) { return order.indexOf(l.teamId) >= 0; })
      .map(function (l) { return { id: l.id, teamId: l.teamId, name: l.name }; })
  };
}

/* ---------- actions ---------- */
var VERSION = 19;
function statusOf_(d, p) {
  return {
    ok: true, version: VERSION, hasAdmin: !!p.ADMIN_PIN, viewPin: !!p.VIEW_PIN, clinic: d.config.clinic,
    teams: (d.config.teamOrder || []).map(function (id) { return { id: id, name: (d.teams[id] || {}).name || '' }; })
  };
}
function status_() { return statusOf_(readData_(), props_().getProperties()); }
function meOf_(a) { return { role: a.role, teamId: a.teamId || null, leaderId: a.leaderId || null, name: a.name || '' }; }

function claimAdmin_(req) {
  var p = props_();
  if (p.getProperty('ADMIN_PIN')) return { ok: false, error: 'exists' };
  var pin = String(req.pin || '');
  if (pin.length < 4 || pin.length > 12) return { ok: false, error: 'weak' };
  p.setProperty('ADMIN_PIN', hash_(pin));
  dataFile_();
  return { ok: true };
}

function login_(req) {
  var a = auth_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  return { ok: true, role: a.role, teamId: a.teamId || null, leaderId: a.leaderId || null, name: a.name || '' };
}

/**
 * 근무표를 여는 요청 한 번으로 서버 상태 + PIN 주인 + 데이터를 함께 보내요.
 * (예전에는 status → login → load 세 번 오갔어요)
 */
function load_(req) {
  var d = readData_(), p = props_().getProperties(), st = statusOf_(d, p), a = null;
  if (req.pin) {
    a = auth_(req.pin);
    if (a.error) return { ok: false, error: a.error, status: st };
  } else if (p.VIEW_PIN) {
    return { ok: false, error: 'auth', status: st };
  }
  delete d.handbook;   // 취업규칙은 rules.html에서 따로 불러와요
  // 근태(지문 기록)는 관리자에게만 보내요. 그것도 최근 몇 달만 함께 보내고, 나머지는 근태 탭에서 그 달을 열 때 따로 불러와요
  var att = d.att || {}, months = Object.keys(att).sort(), cut = ymShift_(ymNow_(), -3), recent = {};
  if (a && a.role === 'admin') months.forEach(function (m) { if (m >= cut) recent[m] = att[m]; });
  else months = [];
  d.att = recent;
  return { ok: true, data: d, pins: pinsInfo_(d), me: a ? meOf_(a) : null, status: st, attMonths: months, serverTime: Date.now() };
}

/** 취업규칙 페이지(rules.html)용: '관리자·팀장만' 글은 관리자·팀장에게만 보내요 */
function handbook_(req) {
  var d = readData_(), viewPin = !!props_().getProperty('VIEW_PIN'), a = null, base = { clinic: d.config.clinic, viewPin: viewPin };
  if (req.pin) {
    a = auth_(req.pin);
    if (a.error) return mix_({ ok: false, error: a.error }, base);
  } else if (viewPin) {
    return mix_({ ok: false, error: 'auth' }, base);
  }
  var mgr = !!a && (a.role === 'admin' || a.role === 'leader');
  return mix_({ ok: true, me: a ? meOf_(a) : null, items: hb_(d).items.filter(function (x) { return mgr || x.vis !== 'mgr'; }) }, base);
}
function mix_(o, b) { Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }

function requireAdmin_(pin) {
  var a = auth_(pin);
  if (a.error) return a;
  if (a.role !== 'admin') return { error: 'forbidden' };
  return a;
}

function canTeam_(a, teamId) { return a.role === 'admin' || (a.role === 'leader' && a.teamId === teamId); }

function str_(v, max) { return String(v == null ? '' : v).slice(0, max || 60); }
function int_(v, lo, hi) { v = parseInt(v, 10); if (isNaN(v)) v = 0; return Math.max(lo, Math.min(hi, v)); }
function cleanHours_(h) {
  h = h || {};
  return { type: ['full', 'half', 'closed'].indexOf(h.type) >= 0 ? h.type : 'full', start: str_(h.start, 5), end: str_(h.end, 5),
    lunch: !!h.lunch, ls: str_(h.ls, 5), le: str_(h.le, 5), night: !!h.night, ne: str_(h.ne, 5) };
}

function half30_(v) { return Math.round(int_(v, 0, 480) / 30) * 30; }
function r5_(v, max) { return Math.round(int_(v, 0, max || 480) / 5) * 5; }
function pick_(v, list, def) { return list.indexOf(v) >= 0 ? v : def; }
function cleanRules_(r) {
  r = r || {};
  var lv = ['off', 'low', 'mid', 'high'];
  return {
    pref: pick_(r.pref, lv, 'mid'), satFair: pick_(r.satFair, lv, 'mid'), nightFair: pick_(r.nightFair, lv, 'mid'),
    maxWeekH: int_(r.maxWeekH || 52, 20, 80), maxWeek: pick_(r.maxWeek, lv, 'high'),
    maxRun: int_(r.maxRun || 6, 2, 14), run: pick_(r.run, lv, 'mid'),
    offStyle: pick_(r.offStyle, ['together', 'spread', 'none'], 'together'),
    partial: pick_(r.partial, ['half', 'any', 'full'], 'half'),
    effort: pick_(r.effort, ['fast', 'normal', 'thorough'], 'normal')
  };
}
function cleanMemo_(o, ym, max) {
  var r = {};
  Object.keys(o || {}).forEach(function (iso) {
    if (iso.indexOf(ym) !== 0) return;
    var v = str_(o[iso], max);
    if (v) r[iso] = v;
  });
  return r;
}
function cleanNotes_(a, ids, ym) {
  var r = {};
  Object.keys(a || {}).forEach(function (sid) {
    if (!ids[sid]) return;
    var row = cleanMemo_(a[sid], ym, 30);
    if (Object.keys(row).length) r[sid] = row;
  });
  return r;
}
function cleanGroups_(a) {
  return (Array.isArray(a) ? a : []).slice(0, 50).map(function (g) {
    g = g || {};
    var mem = [];
    (g.members || []).slice(0, 10).forEach(function (x) { x = str_(x, 20); if (x && mem.indexOf(x) < 0) mem.push(x); });
    return { id: str_(g.id, 20), label: str_(g.label, 20), members: mem, max: int_(g.max || 1, 1, 9) };
  }).filter(function (g) { return g.id; });
}
function cleanAdj_(a, ids, ym) {
  var outv = {};
  Object.keys(a || {}).forEach(function (sid) {
    if (!ids[sid]) return;
    var row = {};
    Object.keys(a[sid] || {}).forEach(function (iso) {
      if (iso.indexOf(ym) !== 0) return;
      var c = a[sid][iso] || {}, x = {};
      if (c.e !== undefined) x.e = r5_(c.e);
      if (c.l !== undefined) x.l = r5_(c.l);
      if (c.ot && (x.e || x.l)) x.ot = 1;   // 오버타임으로 쓴 조퇴·늦은 출근 (예전 방식)
      // 야간 대체(n: 쓴 야간 날짜들, nm: 그 시간)와 OT 사용(o)으로 나눠 쓴 조퇴·늦은 출근
      if (x.e || x.l) {
        if (c.o !== undefined) x.o = r5_(c.o);
        var nn = (Array.isArray(c.n) ? c.n : []).filter(function (d, i, arr) { return /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== iso && arr.indexOf(d) === i; }).slice(0, 3);
        if (nn.length) { x.n = nn; x.nm = r5_(c.nm, 960); }
        if (x.o !== undefined || x.n) delete x.ot;
      }
      if (Object.keys(x).length) row[iso] = x;
    });
    if (Object.keys(row).length) outv[sid] = row;
  });
  return outv;
}

function saveConfig_(req) {
  var a = requireAdmin_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  var d = readData_(), c = req.config || {}, now = Date.now();
  if ((req.base || 0) !== (d.config.updatedAt || 0)) return { ok: false, error: 'conflict' };
  var hours = {};
  for (var dw = 0; dw < 7; dw++) hours[dw] = cleanHours_((c.hours || {})[dw]);
  var dateHours = {};
  Object.keys(c.dateHours || {}).slice(0, 2000).forEach(function (iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    var o = c.dateHours[iso] || {};
    dateHours[iso] = o.closed ? { closed: true, note: str_(o.note, 60) } : { closed: false, note: str_(o.note, 60), h: cleanHours_(o.h) };
  });
  var types = (c.types || []).slice(0, 30).map(function (t) {
    return { id: str_(t.id, 20), name: str_(t.name, 20), short: str_(t.short, 2), color: str_(t.color, 10), kind: str_(t.kind, 5), time: str_(t.time, 5) };
  });
  var order = [], keep = {}, hist = [{ k: 'c', label: '진료 시간·근무 형태·팀 설정', prev: copy_(d.config), by: actorName_(a) }];
  (c.teams || []).slice(0, 30).forEach(function (t) {
    var id = str_(t.id, 20);
    if (!id || keep[id]) return;
    keep[id] = 1; order.push(id);
    var tm = d.teams[id];
    if (!tm) tm = d.teams[id] = { id: id, name: '', leader: '', need: { full: 1, half: 1, night: 0 }, staff: [], updatedAt: now };
    tm.name = str_(t.name, 30); tm.leader = str_(t.leader, 30);
  });
  Object.keys(d.teams).forEach(function (id) {
    if (keep[id]) return;
    var nm = d.teams[id].name || '팀';
    hist.push({ k: 't|' + id, team: id, label: nm + ' 직원 명단 (팀 삭제 전)', prev: d.teams[id], by: actorName_(a) });
    Object.keys(d.sched).forEach(function (ym) { if (d.sched[ym][id]) hist.push({ k: 'r|' + ym + '|' + id, team: id, label: nm + ' ' + ymLabel_(ym) + ' 근무표 (팀 삭제 전)', prev: d.sched[ym][id], by: actorName_(a) }); });
    delete d.teams[id];
    Object.keys(d.sched).forEach(function (ym) { delete d.sched[ym][id]; });
  });
  saveLeaders_(leaders_().filter(function (l) { return keep[l.teamId]; }));
  d.config = { clinic: str_(c.clinic, 40), holidayCredit: c.holidayCredit !== false, labels: cleanLabels_(c.labels), attRule: cleanAttRule_(c.attRule), rules: cleanRules_(c.rules), groups: cleanGroups_(c.groups), hours: hours, dateHours: dateHours, types: types, teamOrder: order, updatedAt: now, updatedBy: actorName_(a) };
  histAdd_(hist);
  writeData_(d);
  var teamTimes = {};
  order.forEach(function (id) { teamTimes[id] = d.teams[id].updatedAt; });
  return { ok: true, updatedAt: now, teams: teamTimes };
}

// calendar row names (야간 / 연차 / 포상), blank = default
function cleanLabels_(o) {
  o = o || {};
  var r = {};
  ['night', 'leave', 'etc'].forEach(function (k) { var v = str_(o[k], 12).trim(); if (v) r[k] = v; });
  return r;
}

// 연도별 총 연차 { "2026": 15 }
// 기간별 설정: 그 기간에만 평소 근무시간(t: e/l)이나 야간(n: off·on·must)을 바꿔요
function cleanPer_(a) {
  var re = /^\d{4}-\d{2}-\d{2}$/;
  return (Array.isArray(a) ? a : []).slice(0, 12).map(function (x) {
    x = x || {};
    var o = { id: str_(x.id, 20) || ('v' + Utilities.getUuid().slice(0, 6)), from: re.test(x.from) ? x.from : '', to: re.test(x.to) ? x.to : '', why: str_(x.why, 20) };
    if (x.t) { o.t = 1; o.e = half30_(x.e); o.l = half30_(x.l); }
    if (['off', 'on', 'must'].indexOf(x.n) >= 0) o.n = x.n;
    return o;
  }).filter(function (x) { return x.from && (!x.to || x.to >= x.from) && (x.t || x.n); });
}
// 요일별 최소 인원 { '1': { d: 주간, n: 야간 } }
function cleanNeedDow_(o) {
  var r = {};
  Object.keys(o || {}).forEach(function (k) {
    if (!/^[0-6]$/.test(k)) return;
    var x = o[k] || {}, y = {};
    if (x.d !== undefined && x.d !== null && x.d !== '') y.d = int_(x.d, 0, 30);
    if (x.n !== undefined && x.n !== null && x.n !== '') y.n = int_(x.n, 0, 30);
    if (Object.keys(y).length) r[k] = y;
  });
  return r;
}
function cleanLt_(o) {
  var r = {};
  Object.keys(o || {}).forEach(function (y) {
    if (!/^\d{4}$/.test(y)) return;
    var v = Math.round(Number(o[y]) * 4) / 4; // 반반차(0.25일) 단위
    if (v > 0 && v <= 400) r[y] = v;
  });
  return r;
}
// OT 적립 { sid: { 'YYYY-MM-DD': 분 } }
function cleanOt_(a, ids, ym) {
  var r = {};
  Object.keys(a || {}).forEach(function (sid) {
    if (!ids[sid]) return;
    var row = {};
    Object.keys(a[sid] || {}).forEach(function (iso) {
      if (iso.indexOf(ym) !== 0) return;
      var v = r5_(a[sid][iso], 600);
      if (v > 0) row[iso] = v;
    });
    if (Object.keys(row).length) r[sid] = row;
  });
  return r;
}

// leave of absence (육아휴직 등): { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' or '', why }
function cleanAbs_(a) {
  var re = /^\d{4}-\d{2}-\d{2}$/;
  if (!a || !re.test(String(a.from || ''))) return null;
  var to = re.test(String(a.to || '')) && a.to >= a.from ? a.to : '';
  return { from: a.from, to: to, why: str_(a.why || '휴직', 12) || '휴직' };
}

function saveTeam_(req) {
  var a = auth_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  var t = req.team || {}, d = readData_(), tm = d.teams[t.id];
  if (!tm) return { ok: false, error: 'not_found', message: '팀을 찾을 수 없어요. 새로고침하세요.' };
  if (!canTeam_(a, tm.id)) return { ok: false, error: 'forbidden' };
  if ((req.base || 0) !== (tm.updatedAt || 0)) return { ok: false, error: 'conflict' };
  var before = copy_(tm);
  var n = t.need || {};
  tm.need = { full: int_(n.full, 0, 30), half: int_(n.half, 0, 30), night: int_(n.night, 0, 30), dow: cleanNeedDow_(n.dow) };
  tm.staff = (t.staff || []).slice(0, 80).map(function (p) {
    return { id: str_(p.id, 20), name: str_(p.name, 30), weekDays: int_(p.weekDays, 1, 7),
      avail: (p.avail || []).map(Number).filter(function (x) { return x >= 0 && x <= 6; }), night: !!p.night,
      must: (p.must || []).map(Number).filter(function (x, i, a) { return x >= 0 && x <= 6 && a.indexOf(x) === i && (p.avail || []).map(Number).indexOf(x) >= 0; }),
      nightMust: !!(p.night && p.nightMust),
      per: cleanPer_(p.per),
      early: half30_(p.early), late: half30_(p.late),
      leave0: p.leave0 && p.leave0.y ? { y: int_(p.leave0.y, 2000, 2100), d: Math.max(0, Math.min(400, Math.round(Number(p.leave0.d || 0) * 4) / 4)) } : null,
      abs: cleanAbs_(p.abs), post: str_(p.post, 20),
      lt: cleanLt_(p.lt), ot0: int_(p.ot0, -60000, 60000) };
  });
  // 근무 배치 자리 (1번 진료실, 데스크 …): 팀장이 정해요
  tm.posts = (Array.isArray(t.posts) ? t.posts : []).slice(0, 30).map(function (x) {
    x = x || {};
    return { id: str_(x.id, 20), name: str_(x.name, 20), need: int_(x.need, 0, 9) };
  }).filter(function (x) { return x.id; });
  var postIds = {};
  tm.posts.forEach(function (x) { postIds[x.id] = 1; });
  tm.staff.forEach(function (p) { if (!postIds[p.post]) p.post = ''; });
  var sids = {};
  tm.staff.forEach(function (p) { sids[p.id] = 1; });
  // 같은 팀 안의 '함께 쉬지 않기' 묶음 (팀장도 정할 수 있어요)
  tm.groups = cleanGroups_(t.groups).map(function (g) {
    g.members = g.members.filter(function (x) { return sids[x]; });
    return g;
  });
  tm.updatedAt = Date.now();
  tm.updatedBy = actorName_(a);
  histAdd_([{ k: 't|' + tm.id, team: tm.id, label: (tm.name || '팀') + ' 직원 명단', prev: before, by: actorName_(a) }]);
  writeData_(d);
  return { ok: true, updatedAt: tm.updatedAt, updatedBy: tm.updatedBy };
}

function saveRoster_(req) {
  var a = auth_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  var ym = String(req.ym || ''), tid = String(req.teamId || '');
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, error: 'bad_request' };
  var d = readData_();
  if (!d.teams[tid]) return { ok: false, error: 'not_found', message: '팀을 찾을 수 없어요. 새로고침하세요.' };
  if (!canTeam_(a, tid)) return { ok: false, error: 'forbidden' };
  var m = d.sched[ym] || (d.sched[ym] = {}), cur = m[tid];
  if ((req.base || 0) !== ((cur && cur.updatedAt) || 0)) return { ok: false, error: 'conflict' };
  var r = req.roster || {}, ids = {};
  d.teams[tid].staff.forEach(function (p) { ids[p.id] = 1; });
  function clean(o) {
    var outv = {};
    Object.keys(o || {}).forEach(function (sid) {
      if (!ids[sid]) return;
      var row = {};
      Object.keys(o[sid] || {}).forEach(function (iso) {
        if (iso.indexOf(ym) === 0) row[iso] = typeof o[sid][iso] === 'number' ? 1 : str_(o[sid][iso], 20);
      });
      outv[sid] = row;
    });
    return outv;
  }
  histAdd_([{ k: 'r|' + ym + '|' + tid, team: tid, label: (d.teams[tid].name || '팀') + ' ' + ymLabel_(ym) + ' 근무표', prev: cur || null, by: actorName_(a) }]);
  m[tid] = { cells: clean(r.cells), locks: clean(r.locks), reqs: clean(r.reqs), adj: cleanAdj_(r.adj, ids, ym), memo: cleanMemo_(r.memo, ym, 40), notes: cleanNotes_(r.notes, ids, ym), place: cleanNotes_(r.place, ids, ym), ot: cleanOt_(r.ot, ids, ym), dut: cleanDut_(r.dut, ids, ym), gen: !!r.gen, updatedAt: Date.now(), updatedBy: actorName_(a) };
  writeData_(d);
  return { ok: true, updatedAt: m[tid].updatedAt, updatedBy: m[tid].updatedBy };
}

function setPin_(req) {
  var a = auth_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  var target = String(req.target || ''), newPin = String(req.newPin || ''), p = props_();
  if (target === 'admin' || target === 'view') {
    if (a.role !== 'admin') return { ok: false, error: 'forbidden' };
    var key = target === 'admin' ? 'ADMIN_PIN' : 'VIEW_PIN';
    if (!newPin) {
      if (target === 'admin') return { ok: false, error: 'weak' };
      p.deleteProperty(key);
      return { ok: true, pins: pinsInfo_(readData_()) };
    }
    if (newPin.length < 4 || newPin.length > 12) return { ok: false, error: 'weak' };
    var h = hash_(newPin);
    if (pinTaken_(h, null, key)) return { ok: false, error: 'duplicate' };
    p.setProperty(key, h);
    return { ok: true, pins: pinsInfo_(readData_()) };
  }
  if (target.indexOf('leader:') === 0) {
    var id = target.slice(7);
    if (!(a.role === 'admin' || (a.role === 'leader' && a.leaderId === id))) return { ok: false, error: 'forbidden' };
    if (newPin.length < 4 || newPin.length > 12) return { ok: false, error: 'weak' };
    var list = leaders_(), l = list.filter(function (x) { return x.id === id; })[0];
    if (!l) return { ok: false, error: 'not_found', message: '팀장을 찾을 수 없어요. 새로고침하세요.' };
    var h2 = hash_(newPin);
    if (pinTaken_(h2, id)) return { ok: false, error: 'duplicate' };
    l.hash = h2;
    saveLeaders_(list);
    return { ok: true, pins: pinsInfo_(readData_()) };
  }
  return { ok: false, error: 'bad_request' };
}

/** 관리자만: 팀장 한 명 등록 (이름·팀·PIN) */
function addLeader_(req) {
  var a = requireAdmin_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  var d = readData_(), tid = String(req.teamId || ''), name = str_(req.name, 30).trim(), pin = String(req.newPin || '');
  if (!d.teams[tid]) return { ok: false, error: 'not_found', message: '팀을 먼저 저장하세요.' };
  if (!name) return { ok: false, error: 'name' };
  if (pin.length < 4 || pin.length > 12) return { ok: false, error: 'weak' };
  var h = hash_(pin);
  if (pinTaken_(h)) return { ok: false, error: 'duplicate' };
  var list = leaders_();
  if (list.length >= 60) return { ok: false, error: 'bad_request', message: '팀장은 60명까지 등록할 수 있어요.' };
  list.push({ id: newId_(), teamId: tid, name: name, hash: h });
  saveLeaders_(list);
  return { ok: true, pins: pinsInfo_(d) };
}

/** 관리자만: 팀장 이름이나 팀 바꾸기 */
function updateLeader_(req) {
  var a = requireAdmin_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  var d = readData_(), list = leaders_(), l = list.filter(function (x) { return x.id === req.leaderId; })[0];
  if (!l) return { ok: false, error: 'not_found', message: '팀장을 찾을 수 없어요. 새로고침하세요.' };
  if (req.name !== undefined) {
    var n = str_(req.name, 30).trim();
    if (!n) return { ok: false, error: 'name' };
    l.name = n;
  }
  if (req.teamId !== undefined) {
    if (!d.teams[req.teamId]) return { ok: false, error: 'not_found', message: '팀을 먼저 저장하세요.' };
    l.teamId = String(req.teamId);
  }
  saveLeaders_(list);
  return { ok: true, pins: pinsInfo_(d) };
}

/** 관리자만: 팀장 삭제 (그 사람의 PIN도 함께 없어져요) */
function deleteLeader_(req) {
  var a = requireAdmin_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  saveLeaders_(leaders_().filter(function (x) { return x.id !== req.leaderId; }));
  return { ok: true, pins: pinsInfo_(readData_()) };
}

/** 관리자 PIN을 잊었을 때: 편집기에서 이 함수를 한 번 실행하면 관리자 PIN이 지워지고, 다음 접속 때 새로 만들 수 있어요. */
function resetAdminPin() {
  props_().deleteProperty('ADMIN_PIN');
  CacheService.getScriptCache().remove('fails');
}

/* ---------- 7. 취업규칙: 관리자와 팀장이 우리 병원 규칙·복지를 적어 두는 곳 ---------- */
var HB_CATS = ['근무시간', '휴가·휴일', '급여·수당', '복지', '복무·규정', '기타'];
var HB_MAX = 200;

function hb_(d) {
  var h = d.handbook || (d.handbook = { items: [] });
  if (!Array.isArray(h.items)) h.items = [];
  return h;
}
/** 취업규칙은 관리자만 쓰고 고쳐요 (팀장과 직원은 보기만) */
function writer_(pin) {
  var a = auth_(pin);
  if (a.error) return a;
  if (a.role !== 'admin') return { error: 'forbidden' };
  return a;
}
function ownKey_(a) { return a.role === 'admin' ? 'admin' : 'L:' + a.leaderId; }
/** 관리자는 모든 글을, 팀장은 자기가 쓴 글만 고치고 지울 수 있어요 */
function canArticle_(a, it) { return a.role === 'admin' || it.own === ownKey_(a); }
function cleanArticle_(x) {
  x = x || {};
  return { cat: pick_(x.cat, HB_CATS, '기타'), title: str_(x.title, 80).trim(), body: str_(x.body, 4000), vis: x.vis === 'mgr' ? 'mgr' : 'all' };
}
function newArticle_(a, x, now) {
  return { id: 'a' + Utilities.getUuid().replace(/-/g, '').slice(0, 10), cat: x.cat, title: x.title, body: x.body, vis: x.vis,
    own: ownKey_(a), createdAt: now, updatedAt: now, updatedBy: actorName_(a) };
}

function saveArticle_(req) {
  var a = writer_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  var x = cleanArticle_(req.article);
  if (!x.title) return { ok: false, error: 'title' };
  var d = readData_(), h = hb_(d), id = str_((req.article || {}).id, 20), now = Date.now(), it;
  if (id) {
    it = h.items.filter(function (y) { return y.id === id; })[0];
    if (!it) return { ok: false, error: 'gone' };
    if (!canArticle_(a, it)) return { ok: false, error: 'forbidden' };
    if ((req.base || 0) !== (it.updatedAt || 0)) return { ok: false, error: 'conflict', item: it };
    it.cat = x.cat; it.title = x.title; it.body = x.body; it.vis = x.vis;
    it.updatedAt = now; it.updatedBy = actorName_(a);
  } else {
    if (h.items.length >= HB_MAX) return { ok: false, error: 'full' };
    it = newArticle_(a, x, now);
    h.items.push(it);
  }
  writeData_(d);
  return { ok: true, item: it };
}

/** 처음 쓸 때 '자주 쓰는 항목 틀'을 한 번에 넣어요 */
function addArticles_(req) {
  var a = writer_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  var d = readData_(), h = hb_(d), now = Date.now(), added = [];
  (Array.isArray(req.items) ? req.items : []).slice(0, 30).forEach(function (raw) {
    var x = cleanArticle_(raw);
    if (!x.title || h.items.length >= HB_MAX) return;
    var it = newArticle_(a, x, now);
    h.items.push(it);
    added.push(it);
  });
  writeData_(d);
  return { ok: true, items: added };
}

function deleteArticle_(req) {
  var a = writer_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  var d = readData_(), h = hb_(d), id = str_(req.id, 20);
  var it = h.items.filter(function (y) { return y.id === id; })[0];
  if (!it) return { ok: true };
  if (!canArticle_(a, it)) return { ok: false, error: 'forbidden' };
  h.items = h.items.filter(function (y) { return y.id !== id; });
  writeData_(d);
  return { ok: true };
}

/* ---------- 7. 근태: 지문 기록(달마다 하나), 직접 고친 값, 정산 수정값 ---------- */
function ymNow_() { var t = new Date(); return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2); }
function ymShift_(ym, k) { var p = ym.split('-'), y = +p[0], m = +p[1] + k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return y + '-' + ('0' + m).slice(-2); }
function hm_(v) { var m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '')); return m && +m[1] < 48 && +m[2] < 60 ? ('0' + (+m[1])).slice(-2) + ':' + m[2] : ''; }
function cleanAttRule_(r) {
  r = r || {};
  return { round: r.round === 'near' ? 'near' : 'up', bonus: int_(r.bonus === undefined ? 20 : r.bonus, 0, 120), rate: [1, 1.5, 2].indexOf(+r.rate) >= 0 ? +r.rate : 1.5,
    wEnd: hm_(r.wEnd) || '18:00', nEnd: hm_(r.nEnd) || '20:00', sEnd: hm_(r.sEnd) || '15:00' };
}
// 수납 OT 당번: { 'YYYY-MM-DD': { t: '20:15', s: [직원 id] } }
function cleanDut_(o, ids, ym) {
  var r = {};
  Object.keys(o || {}).forEach(function (iso) {
    if (iso.indexOf(ym) !== 0 || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
    var x = o[iso] || {}, t = hm_(x.t), s = [];
    (x.s || []).forEach(function (id) { id = str_(id, 20); if (ids[id] && s.indexOf(id) < 0) s.push(id); });
    if (t && s.length) r[iso] = { t: t, s: s };
  });
  return r;
}
function attKeyOk_(k, ids) { return !!ids[k] || (String(k).indexOf('n:') === 0 && String(k).length <= 32); }
function cleanAtt_(a, ids, ym) {
  a = a || {};
  var out = { rows: {}, fix: {}, fin: {}, map: {}, file: null };
  Object.keys(a.rows || {}).slice(0, 200).forEach(function (k) {
    if (!attKeyOk_(k, ids)) return;
    var row = {};
    Object.keys(a.rows[k] || {}).forEach(function (iso) {
      if (iso.indexOf(ym) !== 0 || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return;
      var v = a.rows[k][iso] || [], i = hm_(v[0]), o = hm_(v[1]);
      if (i || o) row[iso] = [i, o];
    });
    if (Object.keys(row).length) out.rows[k] = row;
  });
  Object.keys(a.fix || {}).slice(0, 200).forEach(function (k) {
    if (!attKeyOk_(k, ids)) return;
    var row = {};
    Object.keys(a.fix[k] || {}).forEach(function (iso) {
      if (iso.indexOf(ym) !== 0) return;
      var f = a.fix[k][iso] || {}, x = {};
      if (f.i !== undefined) x.i = hm_(f.i);
      if (f.o !== undefined) x.o = hm_(f.o);
      if (f.n !== undefined && f.n !== null && f.n !== '') x.n = int_(f.n, 0, 600);
      if (f.h !== undefined && f.h !== null && f.h !== '') x.h = int_(f.h, 0, 1440);
      if (f.x) x.x = str_(f.x, 60);
      if (Object.keys(x).length) row[iso] = x;
    });
    if (Object.keys(row).length) out.fix[k] = row;
  });
  Object.keys(a.fin || {}).slice(0, 200).forEach(function (k) {
    if (!attKeyOk_(k, ids)) return;
    var f = a.fin[k] || {}, x = {};
    ['n', 'h'].forEach(function (q) { var v = f[q]; if (v !== undefined && v !== null && v !== '' && !isNaN(+v)) x[q] = Math.max(0, Math.min(999, Math.round(+v * 100) / 100)); });
    if (f.x) x.x = str_(f.x, 60);
    if (Object.keys(x).length) out.fin[k] = x;
  });
  Object.keys(a.map || {}).slice(0, 200).forEach(function (n) { var v = str_(a.map[n], 40); if (v) out.map[str_(n, 30)] = v; });
  if (a.file && a.file.name) out.file = { name: str_(a.file.name, 80), at: Number(a.file.at) || 0, by: str_(a.file.by, 30), n: int_(a.file.n, 0, 100000) };
  return out;
}
function staffIds_(d, teamId) {
  var ids = {};
  Object.keys(d.teams).forEach(function (tid) { if (teamId && tid !== teamId) return; (d.teams[tid].staff || []).forEach(function (p) { ids[p.id] = 1; }); });
  return ids;
}
/** 근태 탭에서 그 달을 열 때 */
function att_(req) {
  if (!req.pin) return { ok: false, error: 'auth' };
  var a = auth_(req.pin), ym = String(req.ym || '');
  if (a.error) return { ok: false, error: a.error };
  if (a.role !== 'admin') return { ok: false, error: 'forbidden' };   // 근태는 관리자만 봐요
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, error: 'bad_request' };
  var d = readData_();
  return { ok: true, att: (d.att || {})[ym] || null };
}
/** 근태는 관리자만 저장해요 (지문 기록·정산값까지 전부). 수납 OT는 근무표에 들어 있어서 팀장도 근무표 탭에서 기록해요 */
function saveAtt_(req) {
  var a = auth_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  if (a.role !== 'admin') return { ok: false, error: 'forbidden' };
  var ym = String(req.ym || '');
  if (!/^\d{4}-\d{2}$/.test(ym)) return { ok: false, error: 'bad_request' };
  var d = readData_(), all = d.att || (d.att = {}), cur = all[ym] || null;
  // 달 전체를 바꾸니 다른 창에서 먼저 저장했는지 확인해요
  if ((req.base || 0) !== ((cur && cur.updatedAt) || 0)) return { ok: false, error: 'conflict' };
  var x = cleanAtt_(req.att, staffIds_(d), ym);
  x.updatedAt = Date.now();
  x.updatedBy = actorName_(a);
  histAdd_([{ k: 'a|' + ym, label: ymLabel_(ym) + ' 근태', prev: cur, by: actorName_(a) }]);
  all[ym] = x;
  writeData_(d);
  return { ok: true, updatedAt: x.updatedAt, updatedBy: x.updatedBy };
}

/* ---------- 저장 기록과 되돌리기 ----------
 * 저장할 때마다 '저장하기 전 상태'를 따로 만든 파일(솔안과_근무표_저장기록.json)에 남겨요.
 * 근무표는 팀·달마다, 직원 명단은 팀마다 최근 8번, 근태는 달마다 최근 3번까지 남고, 전체 150개를 넘으면 오래된 것부터 지워요.
 * 근무표 데이터 파일에는 넣지 않아서 근무표를 여는 속도에는 영향이 없어요. */
var HIST_FILE_NAME = '솔안과_근무표_저장기록.json';
var HIST_PER_KEY = 8, HIST_MAX = 150, HIST_MERGE_MS = 10 * 60 * 1000;
function copy_(o) { return o === undefined || o === null ? null : JSON.parse(JSON.stringify(o)); }
function ymLabel_(ym) { var p = String(ym).split('-'); return p[0] + '년 ' + (+p[1]) + '월'; }
function histFile_() {
  var p = props_(), id = p.getProperty('HIST_FILE_ID');
  if (id) { try { return DriveApp.getFileById(id); } catch (err) { /* 지워졌으면 새로 만들어요 */ } }
  var f = DriveApp.createFile(HIST_FILE_NAME, JSON.stringify({ items: [] }), 'application/json');
  p.setProperty('HIST_FILE_ID', f.getId());
  return f;
}
function readHist_() {
  try { var h = JSON.parse(histFile_().getBlob().getDataAsString('UTF-8') || '{}'); if (!Array.isArray(h.items)) h.items = []; return h; }
  catch (err) { return { items: [] }; }
}
function histAdd_(list) {
  if (!list || !list.length) return;
  var h = readHist_(), now = Date.now();
  list.forEach(function (e) {
    // 자동 저장: 같은 사람이 같은 것을 10분 안에 이어서 저장하면 한 번으로 묶어요.
    // 묶인 기록을 되돌리면 그 사람이 고치기 시작하기 전 상태로 돌아가요.
    var idx = -1;
    for (var i = 0; i < h.items.length; i++) if (h.items[i].k === e.k) { idx = i; break; }
    var last = idx >= 0 ? h.items[idx] : null;
    if (!e.nm && last && !last.nm && last.by === (e.by || '') && last.label === e.label && now - last.at < HIST_MERGE_MS) {
      last.at = now; last.n = (last.n || 1) + 1;
      h.items.splice(idx, 1); h.items.unshift(last);
      return;
    }
    h.items.unshift({ id: 'h' + Utilities.getUuid().replace(/-/g, '').slice(0, 10), k: e.k, team: e.team || '', label: e.label, at: now, from: now, n: 1, nm: !!e.nm, by: e.by || '',
      prevAt: (e.prev && e.prev.updatedAt) || 0, prevBy: (e.prev && e.prev.updatedBy) || '', data: copy_(e.prev) });
  });
  var per = {};
  h.items = h.items.filter(function (x) { per[x.k] = (per[x.k] || 0) + 1; return per[x.k] <= (x.k.charAt(0) === 'a' ? 3 : HIST_PER_KEY); }).slice(0, HIST_MAX);
  histFile_().setContent(JSON.stringify(h));
}
/** 관리자는 모두, 팀장은 자기 팀의 근무표·직원 명단만 되돌릴 수 있어요 */
function canHist_(a, x) {
  if (a.role === 'admin') return true;
  return a.role === 'leader' && (x.k.indexOf('r|') === 0 || x.k.indexOf('t|') === 0) && x.team === a.teamId;
}
function history_(req) {
  var a = auth_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  if (a.role !== 'admin' && a.role !== 'leader') return { ok: false, error: 'forbidden' };
  var items = readHist_().items, seen = {}, out = [];
  items.forEach(function (x) {
    var later = seen[x.k] || 0;
    seen[x.k] = later + 1;
    if (out.length < 40 && canHist_(a, x)) out.push({ id: x.id, k: x.k, label: x.label, at: x.at, from: x.from || x.at, n: x.n || 1, by: x.by, prevAt: x.prevAt, prevBy: x.prevBy, empty: !x.data, later: later });
  });
  return { ok: true, items: out };
}
function restore_(req) {
  var a = auth_(req.pin);
  if (a.error) return { ok: false, error: a.error };
  if (a.role !== 'admin' && a.role !== 'leader') return { ok: false, error: 'forbidden' };
  var h = readHist_(), it = h.items.filter(function (x) { return x.id === req.id; })[0];
  if (!it) return { ok: false, error: 'not_found', message: '저장 기록을 찾을 수 없어요. 목록을 새로 불러오세요.' };
  if (!canHist_(a, it)) return { ok: false, error: 'forbidden' };
  var d = readData_(), p = it.k.split('|'), now = Date.now(), by = actorName_(a) + ' (되돌림)', back = [];
  if (p[0] === 'r') {
    var ym = p[1], tid = p[2];
    if (!d.teams[tid]) return { ok: false, error: 'not_found', message: '이 팀이 지금은 없어요. 관리자가 팀 직원 명단을 먼저 되돌려야 해요.' };
    var m = d.sched[ym] || (d.sched[ym] = {});
    back.push({ k: it.k, team: tid, label: it.label.replace(/ \(팀 삭제 전\)$/, ''), prev: m[tid] || null, by: by, nm: true });
    if (it.data) { var x = copy_(it.data); x.updatedAt = now; x.updatedBy = by; m[tid] = x; } else delete m[tid];
  } else if (p[0] === 't') {
    var t2 = p[1], cur = d.teams[t2];
    if (!cur && a.role !== 'admin') return { ok: false, error: 'forbidden' };
    if (!it.data) return { ok: false, error: 'bad_request', message: '되돌릴 내용이 없어요.' };
    back.push({ k: it.k, team: t2, label: it.label.replace(/ \(팀 삭제 전\)$/, ''), prev: cur || null, by: by, nm: true });
    var y = copy_(it.data);
    if (cur) { y.name = cur.name; y.leader = cur.leader; }
    y.updatedAt = now; y.updatedBy = by;
    d.teams[t2] = y;
    if ((d.config.teamOrder || []).indexOf(t2) < 0) { d.config.teamOrder.push(t2); d.config.updatedAt = now; }
  } else if (p[0] === 'c') {
    if (a.role !== 'admin') return { ok: false, error: 'forbidden' };
    if (!it.data) return { ok: false, error: 'bad_request', message: '되돌릴 내용이 없어요.' };
    back.push({ k: 'c', label: it.label, prev: d.config, by: by, nm: true });
    var c = copy_(it.data);
    c.teamOrder = d.config.teamOrder;   // 팀 목록은 그대로 두고 설정만 되돌려요
    c.updatedAt = now; c.updatedBy = by;
    d.config = c;
  } else if (p[0] === 'a') {
    if (a.role !== 'admin') return { ok: false, error: 'forbidden' };
    var ym2 = p[1], all = d.att || (d.att = {});
    back.push({ k: it.k, label: it.label, prev: all[ym2] || null, by: by, nm: true });
    if (it.data) { var z = copy_(it.data); z.updatedAt = now; z.updatedBy = by; all[ym2] = z; } else delete all[ym2];
  } else return { ok: false, error: 'bad_request' };
  histAdd_(back);
  writeData_(d);
  // 팀을 지울 때 그 팀장 등록(PIN)도 지워져요. PIN은 저장 기록에 남기지 않으니 다시 등록해야 해요.
  var noLeader = p[0] === 't' && !leaders_().some(function (l) { return l.teamId === p[1]; });
  return { ok: true, label: it.label, noLeader: noLeader };
}
