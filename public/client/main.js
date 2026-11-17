// Vòng chơi cờ tướng 3D: chơi online qua mã phòng, hoặc hai người chung một máy.
// Online: server là nơi quyết định, client chỉ gửi nước đi và hiển thị những gì server xác nhận.

import { createGame, legalMoves, applyMove, getResult, isInCheck, fromICCS } from '../shared/xiangqi.js';
import { createBestView } from './views.js';
import { capturedFromHistory } from './tray.js';
import { playClack, unlockAudio, setSoundEnabled } from './sound.js';
import { connect } from './net.js';

const $ = (id) => document.getElementById(id);
let view = null; // 3D hoặc 2D, tạo ở phần khởi động
const BASE_TITLE = 'Cờ tướng 3D';

// ---------- trạng thái chung ----------
let mode = 'lobby'; // 'lobby' | 'local' | 'online'
let states = [createGame()];
let selected = null;
let targetSet = new Set();
let busy = false;
let flipped = false;
let autoFlip = false;
let sound = true;
let lowQuality = false;
let uiHidden = false;
let prefer2d = false;
let rotateOn = false;
let slowHinted = false;
let switching = false;
let roomPw = null;
let creating = false;

// ---------- trạng thái online ----------
let net = null;
let roomCode = null;
let myId = null;
let mySide = null; // 'r' | 'b' | 'spectator'
let seats = { r: false, b: false };
let peers = { r: false, b: false }; // ai đang kết nối
let serverOver = null;
let drawOffer = null;
let rematch = { r: false, b: false };
let connStatus = 'closed';
let pending = false;
let pendingTimer = null;
let queue = [];
let epoch = 0;
let gotSnapshot = false;
let toastTimer = null;
let memId = null;

const cur = () => states[states.length - 1];
const sideName = (s) => (s === 'r' ? 'Đỏ' : 'Đen');
const opp = (s) => (s === 'r' ? 'b' : 'r');
const isMine = (piece, turn) => piece !== '.' && (piece === piece.toUpperCase()) === (turn === 'r');
const isSeated = () => mySide === 'r' || mySide === 'b';

// ---------- cài đặt lưu trên máy ----------
function loadPrefs() {
  // màn hình nhỏ (điện thoại ngang): mặc định ẩn thanh nút để không che bàn cờ
  uiHidden = window.matchMedia('(max-height: 520px)').matches;
  try {
    const raw = localStorage.getItem('cotuong3d.prefs');
    if (!raw) return;
    const p = JSON.parse(raw);
    sound = p.sound !== false;
    autoFlip = p.autoFlip === true;
    lowQuality = p.lowQuality === true;
    if (typeof p.uiHidden === 'boolean') uiHidden = p.uiHidden;
    prefer2d = p.prefer2d === true;
    rotateOn = p.rotateOn === true;
  } catch (e) {
    /* bỏ qua */
  }
}
function savePrefs() {
  try {
    localStorage.setItem(
      'cotuong3d.prefs',
      JSON.stringify({ sound, autoFlip, lowQuality, uiHidden, prefer2d, rotateOn })
    );
  } catch (e) {
    /* bỏ qua */
  }
}

// ---------- định danh và mã phòng ----------
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(n = 6) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (v) => CODE_ALPHABET[v % CODE_ALPHABET.length]).join('');
}

function randomId() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Mỗi tab có một id riêng (mở hai tab trên một máy sẽ thành hai người chơi).
// Id được nhớ theo phòng để mở lại bằng tab mới vẫn lấy lại được chỗ ngồi.
function tabId() {
  try {
    let id = sessionStorage.getItem('cotuong3d.sid');
    if (!id) {
      id = randomId();
      sessionStorage.setItem('cotuong3d.sid', id);
    }
    return id;
  } catch (e) {
    if (!memId) memId = randomId();
    return memId;
  }
}
function lastIdForRoom(code) {
  try {
    return localStorage.getItem('cotuong3d.room.' + code) || null;
  } catch (e) {
    return null;
  }
}
function rememberIdForRoom(code, id) {
  try {
    localStorage.setItem('cotuong3d.room.' + code, id);
  } catch (e) {
    /* bỏ qua */
  }
}

function savedPw(code) {
  try {
    return localStorage.getItem('cotuong3d.pw.' + code) || '';
  } catch (e) {
    return '';
  }
}
function rememberPw(code, pw) {
  try {
    if (pw) localStorage.setItem('cotuong3d.pw.' + code, pw);
    else localStorage.removeItem('cotuong3d.pw.' + code);
  } catch (e) {
    /* bỏ qua */
  }
}
const PW_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function randomPw(n = 5) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (v) => PW_ALPHABET[v % PW_ALPHABET.length]).join('');
}

function normalizeCode(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
const validCode = (c) => /^[A-Z0-9]{4,12}$/.test(c);

function setUrlRoom(code) {
  try {
    history.replaceState(null, '', code ? `?room=${code}` : location.pathname);
  } catch (e) {
    /* bỏ qua */
  }
}

function toast(text, ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

// ---------- view 3D / 2D ----------
function syncView(g) {
  view.sync(g.board, capturedFromHistory(g.history));
}

let down = null;
function bindPointer(v) {
  v.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  v.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved < 8 && quick) onTap(e.clientX, e.clientY);
  });
}

// Chừa chỗ cho thanh trạng thái phía trên và thanh nút phía dưới để không che bàn cờ.
function updateInsets() {
  if (!view) return;
  const bottomOf = (id) => {
    const el = $(id);
    if (!el || el.hidden) return 0;
    const r = el.getBoundingClientRect();
    return r.height > 0 ? r.bottom : 0;
  };
  const topOf = (id) => {
    const el = $(id);
    if (!el || el.hidden) return window.innerHeight;
    const r = el.getBoundingClientRect();
    return r.height > 0 ? r.top : window.innerHeight;
  };
  let top = 0;
  let bottom = 0;
  if (mode !== 'lobby') {
    top = Math.max(bottomOf('hud'), mode === 'online' ? bottomOf('roomBar') : 0);
    if (top) top += 6;
    const tt = topOf('toolbar');
    if (tt < window.innerHeight) bottom = window.innerHeight - tt + 6;
  }
  view.setInsets(top, bottom);
}
window.addEventListener('resize', () => requestAnimationFrame(updateInsets));

function renderViewUi() {
  const is3d = view && view.kind === '3d';
  document.body.dataset.view = is3d ? '3d' : '2d';
  $('btnView').textContent = `Chế độ: ${is3d ? '3D' : '2D'}`;
  $('btnRotate').textContent = `Xoay: ${rotateOn ? 'mở' : 'khóa'}`;
  $('btnRotate').setAttribute('aria-pressed', String(rotateOn));
}

function attachView(v) {
  view = v;
  v.onSlow = handleSlow;
  v.onContextLost = handleLost;
  bindPointer(v);
  v.setQuality(lowQuality);
  v.setRotateEnabled(rotateOn);
  v.setFlipped(flipped, false);
  syncView(cur());
  renderViewUi();
  updateInsets();
}

async function mountView(use2d) {
  const r = await createBestView($('stage'), use2d);
  attachView(r.view);
  return r.reason;
}

async function switchView(use2d) {
  if (switching) return;
  switching = true;
  try {
    const t0 = performance.now();
    while (busy && performance.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 50));
    if (busy) {
      toast('Đang đi quân, thử lại sau giây lát');
      return;
    }
    const old = view;
    old.onSlow = null;
    old.onContextLost = null;
    old.dispose();
    const reason = await mountView(use2d);
    refresh();
    if (!use2d && reason) toast('Thiết bị này chưa chạy được 3D, đang dùng 2D');
  } finally {
    switching = false;
  }
}

function handleSlow() {
  if (!view || view.kind !== '3d') return;
  if (!lowQuality) {
    lowQuality = true;
    view.setQuality(true);
    savePrefs();
    renderToggles();
    toast('Máy hơi chậm nên đã tự giảm đồ họa');
  } else if (!slowHinted) {
    slowHinted = true;
    toast('Vẫn chậm? Bấm "Chế độ: 3D" để chuyển sang 2D cho nhẹ', 5500);
  }
}

function handleLost() {
  toast('Màn hình 3D bị ngắt, đang chuyển sang 2D', 4000);
  prefer2d = false;
  switchView(true);
}

// ---------- hiển thị ----------
function currentResult() {
  if (mode === 'online') return serverOver;
  const r = getResult(cur());
  return r.over ? { winner: r.winner, reason: r.reason } : null;
}

function reasonText(res) {
  switch (res.reason) {
    case 'checkmate': return 'chiếu bí';
    case 'stalemate': return 'hết nước đi';
    case 'resign': return `${sideName(opp(res.winner))} xin thua`;
    case 'repetition': return 'lặp thế 3 lần';
    case 'no-capture': return '60 nước không ăn quân';
    case 'draw-agreed': return 'hai bên đồng ý hòa';
    default: return '';
  }
}

function resultText(res) {
  if (!res.winner) return `Hòa — ${reasonText(res)}`;
  const who =
    mode === 'online' && isSeated()
      ? res.winner === mySide ? 'Bạn thắng' : 'Bạn thua'
      : `${sideName(res.winner)} thắng`;
  return `${who} — ${reasonText(res)}`;
}

function renderRoomInfo() {
  const box = $('roomInfo');
  box.textContent = '';
  if (mode !== 'online' || !roomCode) return;
  const b = document.createElement('b');
  b.textContent = roomCode;
  box.append('Phòng ', b, ' · ', isSeated() ? `Bạn cầm ${sideName(mySide)}` : 'Bạn đang xem');
}

function refresh() {
  const s = cur();
  const res = currentResult();
  const checked = isInCheck(s);
  const online = mode === 'online';
  const seated = online && isSeated();
  const bothSeated = seats.r && seats.b;
  const waiting = online && !bothSeated;

  $('turnDot').className = 'dot ' + (s.turn === 'r' ? 'red' : 'black');
  let turnText;
  if (res) turnText = 'Ván kết thúc';
  else if (waiting) turnText = 'Đang chờ đối thủ…';
  else turnText = `Lượt: ${sideName(s.turn)}` + (seated && s.turn === mySide ? ' (bạn)' : '');
  $('turnText').textContent = turnText;

  let msg = '';
  if (online && connStatus !== 'open') msg = 'Mất kết nối, đang nối lại…';
  else if (!res && checked && !waiting) msg = 'Chiếu!';
  else if (seated && bothSeated && !res && !peers[opp(mySide)]) msg = 'Đối thủ mất kết nối';
  $('msg').textContent = msg;

  renderRoomInfo();

  const last = s.history[s.history.length - 1];
  view.setLastMove(last ? last.from : null, last ? last.to : null);
  view.setCheck(checked ? s.board.indexOf(s.turn === 'r' ? 'K' : 'k') : null);

  $('btnUndo').disabled = states.length < 2 || busy;
  const canAct = seated && bothSeated && !res;
  $('btnDraw').disabled = !canAct || drawOffer === mySide;
  $('btnDraw').textContent = seated && drawOffer === mySide ? 'Đã xin hòa…' : 'Xin hòa';
  $('btnResign').disabled = !canAct;

  const nb = $('bannerNew');
  if (res) {
    $('bannerText').textContent = resultText(res);
    if (online) {
      nb.hidden = !seated;
      nb.disabled = seated && !!rematch[mySide];
      nb.textContent = nb.disabled ? 'Đang chờ đối thủ…' : 'Chơi lại';
    } else {
      nb.hidden = false;
      nb.disabled = false;
      nb.textContent = 'Ván mới';
    }
    $('banner').hidden = false;
  } else {
    $('banner').hidden = true;
  }

  $('offer').hidden = !(seated && !res && drawOffer && drawOffer !== mySide);
  updateInsets();
}

function setMode(m) {
  mode = m;
  document.body.dataset.mode = m;
  $('lobby').hidden = m !== 'lobby';
}

function setFlip(flag, animate = true) {
  if (flag === flipped) return;
  flipped = flag;
  view.setFlipped(flag, animate);
}

// ---------- chọn quân ----------
function deselect() {
  selected = null;
  targetSet = new Set();
  view.select(null, []);
}

function selectPiece(idx) {
  const s = cur();
  const moves = legalMoves(s).filter((m) => m.from === idx);
  selected = idx;
  targetSet = new Set(moves.map((m) => m.to));
  view.select(
    idx,
    moves.map((m) => ({ to: m.to, capture: s.board[m.to] !== '.' }))
  );
}

// Đưa mọi thứ về trạng thái ban đầu (dùng khi bắt đầu ván hoặc rời phòng).
function resetCommon() {
  epoch += 1;
  clearTimeout(pendingTimer);
  states = [createGame()];
  queue = [];
  busy = false;
  pending = false;
  mySide = null;
  seats = { r: false, b: false };
  peers = { r: false, b: false };
  serverOver = null;
  drawOffer = null;
  rematch = { r: false, b: false };
  gotSnapshot = false;
  deselect();
  syncView(cur());
  setFlip(false, false);
}

// ---------- đi nước ----------
function doMove(from, to) {
  if (mode === 'online') {
    if (!net || !net.send({ t: 'move', from, to })) {
      toast('Đang mất kết nối, thử lại sau giây lát');
      return;
    }
    pending = true;
    deselect();
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      if (pending) {
        pending = false;
        if (net) net.send({ t: 'sync' });
      }
    }, 4000);
    return;
  }

  const prev = cur();
  const capture = prev.board[to] !== '.';
  const next = applyMove(prev, { from, to });
  busy = true;
  deselect();
  $('btnUndo').disabled = true;
  view.animateMove(from, to, () => {
    playClack(capture);
    states.push(next);
    syncView(next);
    busy = false;
    refresh();
    if (autoFlip) setFlip(next.turn === 'b');
  });
}

function onTap(clientX, clientY) {
  unlockAudio();
  if (mode === 'lobby' || busy || pending || currentResult()) return;
  const s = cur();
  if (mode === 'online' && !(isSeated() && seats.r && seats.b && s.turn === mySide)) {
    deselect();
    return;
  }
  const cell = view.pickCell(clientX, clientY);
  if (!cell) {
    deselect();
    return;
  }
  const idx = cell.row * 9 + cell.col;
  if (selected !== null && targetSet.has(idx)) {
    doMove(selected, idx);
  } else if (isMine(s.board[idx], s.turn)) {
    selectPiece(idx);
  } else {
    deselect();
  }
}

// ---------- online: nhận tin từ server ----------
const ERRORS = {
  waiting: 'Chưa có đối thủ trong phòng',
  not_your_turn: 'Chưa đến lượt bạn',
  illegal: 'Nước đi không hợp lệ',
  game_over: 'Ván đã kết thúc',
  spectator: 'Bạn đang ở chế độ xem',
  bad_id: 'Lỗi định danh, hãy tải lại trang',
};

const AUTH_ERRORS = {
  need_password: 'Phòng này cần mật khẩu. Nhập mật khẩu rồi bấm Vào phòng.',
  bad_password: 'Sai mật khẩu',
  locked: 'Nhập sai nhiều lần, hãy thử lại sau 1 phút',
  room_taken: 'Mã phòng này đã có người dùng, hãy tạo phòng mới',
  bad_pw_format: 'Mật khẩu cần từ 4 đến 32 ký tự',
};

function authFail(code, room) {
  if (code === 'bad_password' || code === 'need_password') rememberPw(room, '');
  leaveRoom();
  $('codeInput').value = room;
  lobbyError(AUTH_ERRORS[code]);
  $('pwInput').value = '';
  $('pwInput').focus();
}

function applyOrientation(animate) {
  setFlip(mySide === 'b', animate);
}

function loadSnapshot(m) {
  epoch += 1;
  clearTimeout(pendingTimer);
  let g = createGame();
  try {
    for (const iccs of m.moves) g = applyMove(g, fromICCS(iccs));
  } catch (e) {
    toast('Không đọc được thế cờ từ server, hãy tải lại trang');
  }
  states = [g];
  queue = [];
  busy = false;
  pending = false;
  mySide = m.you;
  seats = m.seats;
  peers = m.online;
  serverOver = m.over;
  drawOffer = m.drawOffer;
  rematch = m.rematch;
  deselect();
  syncView(g);
  applyOrientation(gotSnapshot);
  gotSnapshot = true;
  if (isSeated() && roomCode) rememberIdForRoom(roomCode, myId);
  refresh();
}

function playServerMove(it) {
  const prev = cur();
  if (it.n <= prev.history.length) return; // đã có nước này rồi
  let next = null;
  if (it.n === prev.history.length + 1) {
    try {
      next = applyMove(prev, { from: it.from, to: it.to });
    } catch (e) {
      next = null;
    }
  }
  if (!next) {
    // lệch với server: xin lại toàn bộ trạng thái
    queue = [];
    if (net) net.send({ t: 'sync' });
    return;
  }
  const myEpoch = epoch;
  const capture = prev.board[it.to] !== '.';
  busy = true;
  pending = false;
  clearTimeout(pendingTimer);
  deselect();
  view.animateMove(it.from, it.to, () => {
    if (myEpoch !== epoch) return; // trạng thái đã được thay bằng bản mới từ server
    playClack(capture);
    states = [next];
    syncView(next);
    drawOffer = null;
    if (it.over) serverOver = it.over;
    busy = false;
    refresh();
    notifyTurn();
    pump();
  });
}

function pump() {
  while (!busy && queue.length) {
    const it = queue.shift();
    if (it.kind === 'move') {
      playServerMove(it);
    } else if (it.kind === 'over') {
      serverOver = it.over;
      drawOffer = null;
      refresh();
    } else if (it.kind === 'offer') {
      drawOffer = it.by;
      refresh();
    } else if (it.kind === 'offer_clear') {
      const was = drawOffer;
      drawOffer = null;
      refresh();
      if (was === mySide && isSeated()) toast('Đối thủ từ chối hòa');
    }
  }
}

function notifyTurn() {
  if (mode !== 'online' || currentResult() || !isSeated() || cur().turn !== mySide) return;
  if (document.hidden) {
    document.title = '● Đến lượt bạn — ' + BASE_TITLE;
    try {
      if (navigator.vibrate) navigator.vibrate(150);
    } catch (e) {
      /* bỏ qua */
    }
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) document.title = BASE_TITLE;
});

function onNetMessage(m) {
  switch (m.t) {
    case 'state':
      loadSnapshot(m);
      break;
    case 'move':
      queue.push({ kind: 'move', n: m.n, from: m.from, to: m.to, over: m.over });
      pump();
      break;
    case 'over':
      queue.push({ kind: 'over', over: m.over });
      pump();
      break;
    case 'draw_offer':
      queue.push({ kind: 'offer', by: m.by });
      pump();
      break;
    case 'draw_declined':
      queue.push({ kind: 'offer_clear' });
      pump();
      break;
    case 'rematch':
      rematch = m.rematch;
      refresh();
      break;
    case 'presence':
      seats = m.seats;
      peers = m.online;
      refresh();
      break;
    case 'error':
      if (AUTH_ERRORS[m.code]) {
        authFail(m.code, roomCode);
        break;
      }
      pending = false;
      toast(ERRORS[m.code] || 'Có lỗi, hãy thử lại');
      refresh();
      break;
    default:
      break;
  }
}

// ---------- bắt đầu / rời ván ----------
function startLocal() {
  leaveRoom(false);
  setMode('local');
  resetCommon();
  refresh();
}

function startOnline(code, want, pw = '', create = false) {
  leaveRoom(false);
  resetCommon();
  setMode('online');
  roomCode = code;
  roomPw = pw || null;
  creating = create;
  if (pw) rememberPw(code, pw);
  myId = tabId();
  connStatus = 'connecting';
  setUrlRoom(code);
  net = connect({
    code,
    clientId: myId,
    prevId: lastIdForRoom(code),
    want,
    pw: roomPw || undefined,
    create: creating || undefined,
    onMessage: onNetMessage,
    onStatus: (s) => {
      connStatus = s;
      refresh();
    },
  });
  refresh();
}

function leaveRoom(toLobby = true) {
  if (net) net.close();
  net = null;
  roomCode = null;
  roomPw = null;
  creating = false;
  connStatus = 'closed';
  if (toLobby) {
    setUrlRoom(null);
    resetCommon();
    setMode('lobby');
    document.title = BASE_TITLE;
    refresh();
  }
}

async function invite() {
  const pwPart = roomPw ? `#pw=${encodeURIComponent(roomPw)}` : '';
  const url = `${location.origin}${location.pathname}?room=${roomCode}${pwPart}`;
  const text = `Đánh cờ tướng 3D với mình nhé! Mã phòng: ${roomCode}` + (roomPw ? `, mật khẩu: ${roomPw}` : '');
  const touch = window.matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.share) {
    try {
      await navigator.share({ title: BASE_TITLE, text, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Đã sao chép link mời, hãy gửi cho bạn');
  } catch (e) {
    window.prompt('Sao chép link này rồi gửi cho bạn:', url);
  }
}

// ---------- nút: một máy ----------
function newGame() {
  if (busy) return;
  if (states.length > 1 && !currentResult() && !window.confirm('Bắt đầu ván mới?')) return;
  resetCommon();
  refresh();
}

function undo() {
  if (busy || states.length < 2) return;
  states.pop();
  deselect();
  syncView(cur());
  refresh();
  if (autoFlip) setFlip(cur().turn === 'b');
}

function renderToggles() {
  $('btnAuto').textContent = `Tự lật: ${autoFlip ? 'bật' : 'tắt'}`;
  $('btnAuto').setAttribute('aria-pressed', String(autoFlip));
  $('btnSound').textContent = `Âm thanh: ${sound ? 'bật' : 'tắt'}`;
  $('btnSound').setAttribute('aria-pressed', String(sound));
  $('btnQuality').textContent = `Đồ họa: ${lowQuality ? 'thấp' : 'cao'}`;
  $('btnQuality').setAttribute('aria-pressed', String(lowQuality));
}

$('btnNew').addEventListener('click', newGame);
$('btnUndo').addEventListener('click', undo);
$('btnFlip').addEventListener('click', () => setFlip(!flipped));
$('btnAuto').addEventListener('click', () => {
  autoFlip = !autoFlip;
  if (autoFlip) setFlip(cur().turn === 'b');
  savePrefs();
  renderToggles();
});

// ---------- nút: online ----------
$('btnInvite').addEventListener('click', invite);
$('btnDraw').addEventListener('click', () => {
  if (net) net.send({ t: 'draw_offer' });
});
$('btnResign').addEventListener('click', () => {
  if (net && window.confirm('Bạn chắc chắn muốn xin thua?')) net.send({ t: 'resign' });
});
$('btnLeave').addEventListener('click', () => {
  if (window.confirm('Rời phòng? Bạn vẫn có thể vào lại bằng link hoặc mã phòng.')) leaveRoom();
});
$('bannerLeave').addEventListener('click', () => leaveRoom());
$('bannerNew').addEventListener('click', () => {
  if (mode === 'online') {
    if (net) net.send({ t: 'rematch' });
  } else {
    newGame();
  }
});
$('offerYes').addEventListener('click', () => {
  if (net) net.send({ t: 'draw_accept' });
});
$('offerNo').addEventListener('click', () => {
  if (net) net.send({ t: 'draw_decline' });
});

// ---------- ẩn/hiện menu và toàn màn hình ----------
function applyUi() {
  $('toolbar').hidden = uiHidden;
  $('btnMenu').textContent = uiHidden ? '☰' : '✕';
  $('btnMenu').setAttribute('aria-expanded', String(!uiHidden));
  updateInsets();
}

const fsRoot = document.documentElement;
const fsSupported = !!(fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen);
const isFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

function updateFullBtn() {
  $('btnFull').textContent = isFull() ? 'Thoát toàn màn hình' : 'Toàn màn hình';
}

async function toggleFull() {
  if (!fsSupported) {
    toast('Trình duyệt này không hỗ trợ toàn màn hình. Trên iPhone: bấm Chia sẻ rồi chọn "Thêm vào MH chính".', 5500);
    return;
  }
  try {
    if (isFull()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else await (fsRoot.requestFullscreen || fsRoot.webkitRequestFullscreen).call(fsRoot);
  } catch (e) {
    toast('Không bật được toàn màn hình');
  }
}

$('btnMenu').addEventListener('click', () => {
  uiHidden = !uiHidden;
  applyUi();
  savePrefs();
});
$('btnFull').addEventListener('click', toggleFull);
document.addEventListener('fullscreenchange', updateFullBtn);
document.addEventListener('webkitfullscreenchange', updateFullBtn);

// ---------- nút: chung ----------
$('btnExit').addEventListener('click', () => {
  if (states.length > 1 && !currentResult() && !window.confirm('Thoát ván đang chơi?')) return;
  leaveRoom();
});
$('btnView').addEventListener('click', () => {
  const to2d = view.kind === '3d';
  prefer2d = to2d;
  savePrefs();
  switchView(to2d);
});
$('btnRotate').addEventListener('click', () => {
  rotateOn = !rotateOn;
  view.setRotateEnabled(rotateOn);
  savePrefs();
  renderViewUi();
});
$('btnSeat').addEventListener('click', () => view.resetCamera());
$('btnTop').addEventListener('click', () => view.topView());
$('btnSound').addEventListener('click', () => {
  sound = !sound;
  setSoundEnabled(sound);
  unlockAudio();
  savePrefs();
  renderToggles();
});
$('btnQuality').addEventListener('click', () => {
  lowQuality = !lowQuality;
  view.setQuality(lowQuality);
  savePrefs();
  renderToggles();
});

// ---------- sảnh ----------
function lobbyError(text) {
  $('lobbyErr').textContent = text;
}

$('btnCreate').addEventListener('click', () => {
  unlockAudio();
  const want = document.querySelector('input[name="side"]:checked').value;
  let pw = $('pwInput').value.trim();
  if (!pw) {
    pw = randomPw();
    $('pwInput').value = pw;
  }
  if (pw.length < 4 || pw.length > 32) {
    lobbyError('Mật khẩu cần từ 4 đến 32 ký tự');
    return;
  }
  lobbyError('');
  startOnline(randomCode(), want, pw, true);
});

function joinFromInput() {
  unlockAudio();
  const code = normalizeCode($('codeInput').value);
  if (!validCode(code)) {
    lobbyError('Mã phòng gồm 4 đến 12 chữ và số');
    return;
  }
  lobbyError('');
  startOnline(code, 'any', $('pwInput').value.trim() || savedPw(code), false);
}
$('btnJoin').addEventListener('click', joinFromInput);
$('codeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinFromInput();
});
$('codeInput').addEventListener('input', () => lobbyError(''));
$('btnLocal').addEventListener('click', () => {
  unlockAudio();
  startLocal();
});

// ---------- khởi động ----------
async function start() {
  loadPrefs();
  setSoundEnabled(sound);
  renderToggles();
  applyUi();
  updateFullBtn();
  try {
    const reason = await mountView(prefer2d);
    if (reason === 'no-webgl' || reason === 'error') {
      toast('Thiết bị này chưa chạy được 3D, đang dùng chế độ 2D nhìn từ trên', 5000);
    }
  } catch (e) {
    $('loading').textContent = 'Không khởi tạo được bàn cờ. Hãy tải lại trang hoặc dùng trình duyệt khác.';
    throw e;
  }
  refresh();

  // Link mời: ?room=MÃ#pw=MẬT-KHẨU. Phần sau dấu # không gửi lên server, và được xóa khỏi thanh địa chỉ.
  const roomFromUrl = normalizeCode(new URLSearchParams(location.search).get('room'));
  let pwFromUrl = '';
  {
    const m = /(?:^|[#&])pw=([^&]*)/.exec(location.hash);
    if (m) {
      try {
        pwFromUrl = decodeURIComponent(m[1]).slice(0, 32);
      } catch (e) {
        pwFromUrl = '';
      }
    }
  }
  if (validCode(roomFromUrl)) {
    setUrlRoom(roomFromUrl);
    startOnline(roomFromUrl, 'any', pwFromUrl || savedPw(roomFromUrl), false);
  } else {
    setMode('lobby');
  }

  $('loading').hidden = true;
}

start();
