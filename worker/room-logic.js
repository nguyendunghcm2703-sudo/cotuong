// Logic một phòng cờ tướng online. Thuần JS, không phụ thuộc Cloudflare,
// nên test được bằng Node. Lớp Durable Object (room.js) chỉ lo kết nối và lưu trữ.
//
// Dữ liệu phòng (lưu nguyên vào storage của Durable Object):
//   seats:     { r: idNgườiChơi | null, b: ... }   (id là mã bí mật của từng trình duyệt)
//   game:      trạng thái ván cờ của shared/xiangqi.js
//   over:      null | { winner: 'r'|'b'|null, reason }
//   drawOffer: null | 'r' | 'b'   (bên đang xin hòa)
//   rematch:   { r: bool, b: bool }  (bên nào đã bấm "chơi lại")

import { createGame, applyMove, getResult } from '../public/shared/xiangqi.js';

const opp = (s) => (s === 'r' ? 'b' : 'r');
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const isValidId = (id) => typeof id === 'string' && ID_RE.test(id);

export function newRoomData() {
  return {
    v: 1,
    gameNo: 1,
    seats: { r: null, b: null },
    game: createGame(),
    over: null,
    drawOffer: null,
    rematch: { r: false, b: false },
    pw: null, // { salt, hash } khi phòng có mật khẩu
    fails: 0,
    lockUntil: 0,
  };
}

// ---------- mật khẩu phòng ----------
export const PW_MIN = 4;
export const PW_MAX = 32;
export const MAX_FAILS = 5;
export const LOCK_MS = 60 * 1000;

export const isValidPw = (pw) => typeof pw === 'string' && pw.length >= PW_MIN && pw.length <= PW_MAX;

async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(n = 16) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const roomIsEmpty = (data) => !data.seats.r && !data.seats.b && data.game.history.length === 0;

// Kiểm tra quyền vào phòng trước khi xếp chỗ. Trả về { ok, error?, changed }.
//   msg: { id, pw?, create? }
//   Người đã có chỗ (cùng id bí mật) được vào lại không cần mật khẩu.
//   Sai mật khẩu quá MAX_FAILS lần thì khóa LOCK_MS.
export async function authorize(data, msg, now = Date.now()) {
  if (roleOf(data, msg.id) !== 'spectator') return { ok: true, changed: false };

  if (!data.pw) {
    if (msg.create) {
      if (!isValidPw(msg.pw)) return { ok: false, error: 'bad_pw_format', changed: false };
      if (!roomIsEmpty(data)) return { ok: false, error: 'room_taken', changed: false };
      const salt = randomHex();
      data.pw = { salt, hash: await sha256Hex(salt + ':' + msg.pw) };
      data.fails = 0;
      data.lockUntil = 0;
      return { ok: true, changed: true };
    }
    return { ok: true, changed: false }; // phòng cũ chưa đặt mật khẩu
  }

  if (data.lockUntil && now < data.lockUntil) return { ok: false, error: 'locked', changed: false };
  if (typeof msg.pw !== 'string' || msg.pw === '') {
    return { ok: false, error: 'need_password', changed: false };
  }
  const hash = await sha256Hex(data.pw.salt + ':' + msg.pw.slice(0, PW_MAX));
  if (sameText(hash, data.pw.hash)) {
    const changed = data.fails !== 0 || data.lockUntil !== 0;
    data.fails = 0;
    data.lockUntil = 0;
    return { ok: true, changed };
  }
  data.fails = (data.fails || 0) + 1;
  if (data.fails >= MAX_FAILS) {
    data.fails = 0;
    data.lockUntil = now + LOCK_MS;
  }
  return { ok: false, error: 'bad_password', changed: true };
}

export function roleOf(data, id) {
  if (id && data.seats.r === id) return 'r';
  if (id && data.seats.b === id) return 'b';
  return 'spectator';
}

// Xếp chỗ cho người vừa vào phòng. Trả về 'r' | 'b' | 'spectator'.
//   want:  'r' | 'b' | khác (ngẫu nhiên) — chỉ có tác dụng khi cả hai chỗ còn trống.
//   opts.prev:      id cũ của cùng trình duyệt (để lấy lại chỗ khi mở lại bằng tab mới).
//   opts.connected: Set các id đang có kết nối (không được "cướp" chỗ của người đang online).
export function join(data, id, want, opts = {}) {
  const { prev = null, connected = new Set(), rand = Math.random } = opts;

  const existing = roleOf(data, id);
  if (existing !== 'spectator') return existing;

  if (isValidId(prev) && prev !== id && !connected.has(prev)) {
    const prevRole = roleOf(data, prev);
    if (prevRole !== 'spectator') {
      data.seats[prevRole] = id;
      return prevRole;
    }
  }

  const free = ['r', 'b'].filter((s) => !data.seats[s]);
  if (free.length === 0) return 'spectator';

  let seat;
  if (free.length === 1) seat = free[0];
  else if (want === 'r' || want === 'b') seat = want;
  else seat = rand() < 0.5 ? 'r' : 'b';

  data.seats[seat] = id;
  return seat;
}

export function snapshot(data, role, online) {
  const g = data.game;
  return {
    t: 'state',
    you: role,
    gameNo: data.gameNo,
    seats: { r: !!data.seats.r, b: !!data.seats.b },
    online,
    turn: g.turn,
    moves: g.history.map((h) => h.iccs),
    over: data.over,
    drawOffer: data.drawOffer,
    rematch: data.rematch,
  };
}

const isCell = (n) => Number.isInteger(n) && n >= 0 && n < 90;

// Xử lý một tin nhắn từ người chơi. Trả về:
//   events:  các tin cần gửi cho mọi người trong phòng ({t:'snapshot'} = gửi lại toàn bộ trạng thái)
//   changed: dữ liệu phòng đã đổi (cần lưu)
//   error:   mã lỗi gửi riêng cho người gửi
//   resync:  gửi lại toàn bộ trạng thái riêng cho người gửi
export function handle(data, role, msg) {
  const out = { events: [], changed: false, error: null, resync: false };
  const fail = (code) => {
    out.error = code;
    return out;
  };
  const seated = role === 'r' || role === 'b';
  const bothSeated = !!(data.seats.r && data.seats.b);

  switch (msg.t) {
    case 'sync':
      out.resync = true;
      return out;

    case 'move': {
      if (!seated) return fail('spectator');
      if (data.over) return fail('game_over');
      if (!bothSeated) return fail('waiting');
      if (data.game.turn !== role) return fail('not_your_turn');
      if (!isCell(msg.from) || !isCell(msg.to)) return fail('bad_move');

      let next;
      try {
        next = applyMove(data.game, { from: msg.from, to: msg.to });
      } catch (e) {
        out.resync = true;
        return fail('illegal');
      }
      data.game = next;
      data.drawOffer = null;
      const res = getResult(next);
      if (res.over) data.over = { winner: res.winner, reason: res.reason };
      out.changed = true;
      out.events.push({
        t: 'move',
        n: next.history.length,
        from: msg.from,
        to: msg.to,
        turn: next.turn,
        over: data.over,
      });
      return out;
    }

    case 'resign':
      if (!seated) return fail('spectator');
      if (data.over) return fail('game_over');
      data.over = { winner: opp(role), reason: 'resign' };
      data.drawOffer = null;
      out.changed = true;
      out.events.push({ t: 'over', over: data.over });
      return out;

    case 'draw_offer':
      if (!seated) return fail('spectator');
      if (data.over) return fail('game_over');
      if (!bothSeated) return fail('waiting');
      if (data.drawOffer === role) return out;
      if (data.drawOffer === opp(role)) {
        // đối phương đã xin hòa trước: coi như đồng ý
        data.over = { winner: null, reason: 'draw-agreed' };
        data.drawOffer = null;
        out.changed = true;
        out.events.push({ t: 'over', over: data.over });
        return out;
      }
      data.drawOffer = role;
      out.changed = true;
      out.events.push({ t: 'draw_offer', by: role });
      return out;

    case 'draw_accept':
      if (!seated) return fail('spectator');
      if (data.over) return fail('game_over');
      if (data.drawOffer !== opp(role)) return fail('no_offer');
      data.over = { winner: null, reason: 'draw-agreed' };
      data.drawOffer = null;
      out.changed = true;
      out.events.push({ t: 'over', over: data.over });
      return out;

    case 'draw_decline':
      if (!seated) return fail('spectator');
      if (data.drawOffer !== opp(role)) return fail('no_offer');
      data.drawOffer = null;
      out.changed = true;
      out.events.push({ t: 'draw_declined' });
      return out;

    case 'rematch':
      if (!seated) return fail('spectator');
      if (!data.over) return fail('not_over');
      data.rematch[role] = true;
      out.changed = true;
      if (data.rematch.r && data.rematch.b) {
        // ván mới, đổi bên
        data.seats = { r: data.seats.b, b: data.seats.r };
        data.game = createGame();
        data.over = null;
        data.drawOffer = null;
        data.rematch = { r: false, b: false };
        data.gameNo += 1;
        out.events.push({ t: 'snapshot' });
      } else {
        out.events.push({ t: 'rematch', rematch: data.rematch });
      }
      return out;

    default:
      return fail('unknown');
  }
}
