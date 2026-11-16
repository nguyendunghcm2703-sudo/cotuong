// Vòng chơi cờ tướng 3D (hai người chơi chung một máy).
// Bước sau sẽ thay phần "đi nước" bằng việc gửi lên server qua WebSocket.

import { createGame, legalMoves, applyMove, getResult, isInCheck } from '../shared/xiangqi.js';
import { createView } from './board3d.js';
import { playClack, unlockAudio, setSoundEnabled } from './sound.js';

const $ = (id) => document.getElementById(id);
const view = createView($('stage'));

let states = [createGame()];
let selected = null;
let targetSet = new Set();
let busy = false;
let flipped = false;
let autoFlip = false;
let sound = true;
let lowQuality = false;

const cur = () => states[states.length - 1];
const sideName = (s) => (s === 'r' ? 'Đỏ' : 'Đen');
const isMine = (piece, turn) => piece !== '.' && (piece === piece.toUpperCase()) === (turn === 'r');

// ---------- cài đặt lưu trên máy ----------
function loadPrefs() {
  try {
    const raw = localStorage.getItem('cotuong3d.prefs');
    if (!raw) return;
    const p = JSON.parse(raw);
    sound = p.sound !== false;
    autoFlip = p.autoFlip === true;
    lowQuality = p.lowQuality === true;
  } catch (e) {
    /* bỏ qua */
  }
}
function savePrefs() {
  try {
    localStorage.setItem('cotuong3d.prefs', JSON.stringify({ sound, autoFlip, lowQuality }));
  } catch (e) {
    /* bỏ qua */
  }
}

// ---------- hiển thị ----------
function resultText(res) {
  if (res.reason === 'checkmate') return `${sideName(res.winner)} thắng — chiếu bí`;
  if (res.reason === 'stalemate') return `${sideName(res.winner)} thắng — đối phương hết nước đi`;
  if (res.reason === 'repetition') return 'Hòa — lặp thế 3 lần';
  return 'Hòa — 60 nước không ăn quân';
}

function refresh() {
  const s = cur();
  const res = getResult(s);
  const checked = isInCheck(s);

  $('turnDot').className = 'dot ' + (s.turn === 'r' ? 'red' : 'black');
  $('turnText').textContent = res.over ? 'Ván kết thúc' : `Lượt: ${sideName(s.turn)}`;
  $('msg').textContent = !res.over && checked ? 'Chiếu!' : '';

  const last = s.history[s.history.length - 1];
  view.setLastMove(last ? last.from : null, last ? last.to : null);
  view.setCheck(checked ? s.board.indexOf(s.turn === 'r' ? 'K' : 'k') : null);

  $('btnUndo').disabled = states.length < 2 || busy;

  if (res.over) {
    $('bannerText').textContent = resultText(res);
    $('banner').hidden = false;
  } else {
    $('banner').hidden = true;
  }
}

function setFlip(flag) {
  flipped = flag;
  view.setFlipped(flag, true);
}

// ---------- thao tác trên bàn ----------
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

function doMove(from, to) {
  const prev = cur();
  const capture = prev.board[to] !== '.';
  const next = applyMove(prev, { from, to });
  busy = true;
  deselect();
  $('btnUndo').disabled = true;
  view.animateMove(from, to, () => {
    playClack(capture);
    states.push(next);
    view.sync(next.board);
    busy = false;
    refresh();
    if (autoFlip) setFlip(next.turn === 'b');
  });
}

function onTap(clientX, clientY) {
  unlockAudio();
  if (busy || getResult(cur()).over) return;
  const cell = view.pickCell(clientX, clientY);
  if (!cell) {
    deselect();
    return;
  }
  const idx = cell.row * 9 + cell.col;
  const s = cur();
  if (selected !== null && targetSet.has(idx)) {
    doMove(selected, idx);
  } else if (isMine(s.board[idx], s.turn)) {
    selectPiece(idx);
  } else {
    deselect();
  }
}

// Phân biệt chạm/nhấp (chọn ô) với kéo (xoay camera).
let down = null;
view.domElement.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
});
view.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 500;
  down = null;
  if (moved < 8 && quick) onTap(e.clientX, e.clientY);
});

// ---------- nút ----------
function newGame() {
  if (busy) return;
  if (states.length > 1 && !getResult(cur()).over && !window.confirm('Bắt đầu ván mới?')) return;
  states = [createGame()];
  deselect();
  view.sync(cur().board);
  refresh();
  if (flipped) setFlip(false);
}

function undo() {
  if (busy || states.length < 2) return;
  states.pop();
  deselect();
  view.sync(cur().board);
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
$('bannerNew').addEventListener('click', newGame);
$('btnUndo').addEventListener('click', undo);
$('btnFlip').addEventListener('click', () => setFlip(!flipped));
$('btnSeat').addEventListener('click', () => view.resetCamera());
$('btnTop').addEventListener('click', () => view.topView());
$('btnAuto').addEventListener('click', () => {
  autoFlip = !autoFlip;
  if (autoFlip) setFlip(cur().turn === 'b');
  savePrefs();
  renderToggles();
});
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

// ---------- khởi động ----------
loadPrefs();
setSoundEnabled(sound);
view.setQuality(lowQuality);
view.sync(cur().board);
if (autoFlip) {
  flipped = cur().turn === 'b';
  view.setFlipped(flipped, false);
}
renderToggles();
refresh();
$('loading').hidden = true;
