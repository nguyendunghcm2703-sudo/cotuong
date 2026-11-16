// Luật cờ tướng (xiangqi) dùng chung cho client và server.
//
// Bàn cờ: 10 hàng x 9 cột, mảng phẳng 90 ô, chỉ số = hàng * 9 + cột.
// Hàng 0 là đầu bên Đen (phía xa), hàng 9 là đầu bên Đỏ (phía gần).
// Quân: chữ HOA = Đỏ, chữ thường = Đen, '.' = ô trống.
//   K/k tướng, A/a sĩ, B/b tượng, R/r xe, N/n mã, C/c pháo, P/p tốt.
// Lượt đi: 'r' (Đỏ) hoặc 'b' (Đen). Đỏ đi trước.
//
// Phạm vi bản đầu: luật cơ bản + hai tướng không đối mặt + chiếu bí/hết nước.
// Hòa khi một thế lặp lại lần thứ 3 hoặc 60 nước (120 ply) không ăn quân.
// Chưa có luật chiếu liên tục / đuổi liên tục (làm ở bản sau).

export const ROWS = 10;
export const COLS = 9;
export const INITIAL_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

export const CHARS = {
  K: '帥', A: '仕', B: '相', R: '俥', N: '傌', C: '炮', P: '兵',
  k: '將', a: '士', b: '象', r: '車', n: '馬', c: '砲', p: '卒',
};

const NO_CAPTURE_LIMIT = 120;
const REPETITION_LIMIT = 3;
const FILES = 'abcdefghi';

export const sq = (r, c) => r * COLS + c;
export const rowOf = (i) => Math.floor(i / COLS);
export const colOf = (i) => i % COLS;

export const sideOf = (p) => (p === '.' ? null : p === p.toUpperCase() ? 'r' : 'b');
const opponent = (side) => (side === 'r' ? 'b' : 'r');
const inBoard = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

// ---------- FEN ----------

export function parseFen(fen) {
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  if (rows.length !== ROWS) throw new Error('FEN sai: cần 10 hàng');
  const board = [];
  for (const row of rows) {
    let count = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '9') {
        for (let k = 0; k < Number(ch); k++) board.push('.');
        count += Number(ch);
      } else if ('KABRNCPkabrncp'.includes(ch)) {
        board.push(ch);
        count += 1;
      } else {
        throw new Error('FEN sai: ký tự lạ ' + ch);
      }
    }
    if (count !== COLS) throw new Error('FEN sai: mỗi hàng cần 9 cột');
  }
  const t = parts[1] || 'w';
  const turn = t === 'b' ? 'b' : 'r';
  return { board, turn };
}

export function toFen(state) {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    let s = '';
    let empty = 0;
    for (let c = 0; c < COLS; c++) {
      const p = state.board[sq(r, c)];
      if (p === '.') {
        empty++;
      } else {
        if (empty) s += empty;
        empty = 0;
        s += p;
      }
    }
    if (empty) s += empty;
    rows.push(s);
  }
  return rows.join('/') + ' ' + (state.turn === 'r' ? 'w' : 'b');
}

// ---------- Ký hiệu nước đi (ICCS: "h2e2") ----------
// Cột a..i từ trái sang phải (nhìn từ phía Đỏ), hàng 0..9 từ dưới (Đỏ) lên.

export function toICCS(move) {
  const f = (i) => FILES[colOf(i)] + (ROWS - 1 - rowOf(i));
  return f(move.from) + f(move.to);
}

export function fromICCS(str) {
  const m = /^([a-i])([0-9])([a-i])([0-9])$/.exec(str);
  if (!m) throw new Error('Nước đi sai định dạng: ' + str);
  const at = (file, rank) => sq(ROWS - 1 - Number(rank), FILES.indexOf(file));
  return { from: at(m[1], m[2]), to: at(m[3], m[4]) };
}

// ---------- Sinh nước đi ----------

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const HORSE = [
  [-2, -1], [-2, 1], [2, -1], [2, 1],
  [-1, -2], [1, -2], [-1, 2], [1, 2],
];

function inPalace(side, r, c) {
  return c >= 3 && c <= 5 && (side === 'r' ? r >= 7 : r <= 2);
}

// Các ô quân ở ô i có thể đến (chưa xét tự bị chiếu).
function pseudoTargets(board, i) {
  const piece = board[i];
  const side = sideOf(piece);
  const r = rowOf(i);
  const c = colOf(i);
  const out = [];

  const canLand = (rr, cc) => {
    if (!inBoard(rr, cc)) return false;
    const t = board[sq(rr, cc)];
    return t === '.' || sideOf(t) !== side;
  };

  switch (piece.toUpperCase()) {
    case 'K':
      for (const [dr, dc] of ORTHO) {
        const nr = r + dr;
        const nc = c + dc;
        if (inPalace(side, nr, nc) && canLand(nr, nc)) out.push(sq(nr, nc));
      }
      break;

    case 'A':
      for (const [dr, dc] of DIAG) {
        const nr = r + dr;
        const nc = c + dc;
        if (inPalace(side, nr, nc) && canLand(nr, nc)) out.push(sq(nr, nc));
      }
      break;

    case 'B':
      for (const [dr, dc] of DIAG) {
        const nr = r + dr * 2;
        const nc = c + dc * 2;
        if (!inBoard(nr, nc)) continue;
        if (side === 'r' ? nr < 5 : nr > 4) continue; // không qua sông
        if (board[sq(r + dr, c + dc)] !== '.') continue; // cản tượng (mắt tượng)
        if (canLand(nr, nc)) out.push(sq(nr, nc));
      }
      break;

    case 'N':
      for (const [dr, dc] of HORSE) {
        const legR = Math.abs(dr) === 2 ? r + Math.sign(dr) : r;
        const legC = Math.abs(dr) === 2 ? c : c + Math.sign(dc);
        if (board[sq(legR, legC)] !== '.') continue; // cản mã (chân mã)
        const nr = r + dr;
        const nc = c + dc;
        if (canLand(nr, nc)) out.push(sq(nr, nc));
      }
      break;

    case 'R':
      for (const [dr, dc] of ORTHO) {
        let nr = r + dr;
        let nc = c + dc;
        while (inBoard(nr, nc)) {
          const t = board[sq(nr, nc)];
          if (t === '.') {
            out.push(sq(nr, nc));
          } else {
            if (sideOf(t) !== side) out.push(sq(nr, nc));
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      break;

    case 'C':
      for (const [dr, dc] of ORTHO) {
        let nr = r + dr;
        let nc = c + dc;
        // đi thường: chỉ vào ô trống, dừng khi gặp quân (ngòi)
        while (inBoard(nr, nc) && board[sq(nr, nc)] === '.') {
          out.push(sq(nr, nc));
          nr += dr;
          nc += dc;
        }
        // ăn quân: nhảy qua đúng một quân (ngòi), ăn quân địch đầu tiên phía sau
        nr += dr;
        nc += dc;
        while (inBoard(nr, nc)) {
          const t = board[sq(nr, nc)];
          if (t !== '.') {
            if (sideOf(t) !== side) out.push(sq(nr, nc));
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      break;

    case 'P': {
      const fwd = side === 'r' ? -1 : 1;
      if (canLand(r + fwd, c)) out.push(sq(r + fwd, c));
      const crossed = side === 'r' ? r <= 4 : r >= 5;
      if (crossed) {
        if (canLand(r, c - 1)) out.push(sq(r, c - 1));
        if (canLand(r, c + 1)) out.push(sq(r, c + 1));
      }
      break;
    }

    default:
      break;
  }
  return out;
}

function findGeneral(board, side) {
  const target = side === 'r' ? 'K' : 'k';
  return board.indexOf(target);
}

// Hai tướng cùng cột và không có quân nào ở giữa.
function generalsFacing(board) {
  const a = board.indexOf('k');
  const b = board.indexOf('K');
  if (a < 0 || b < 0 || colOf(a) !== colOf(b)) return false;
  for (let i = a + COLS; i < b; i += COLS) {
    if (board[i] !== '.') return false;
  }
  return true;
}

function isAttacked(board, target, bySide) {
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (p === '.' || sideOf(p) !== bySide) continue;
    if (pseudoTargets(board, i).includes(target)) return true;
  }
  return false;
}

export function isInCheck(state, side = state.turn) {
  const g = findGeneral(state.board, side);
  if (g < 0) return true;
  return isAttacked(state.board, g, opponent(side));
}

function leavesOwnSideSafe(board, from, to, side) {
  const nb = board.slice();
  nb[to] = nb[from];
  nb[from] = '.';
  if (generalsFacing(nb)) return false;
  const g = findGeneral(nb, side);
  if (g < 0) return false;
  return !isAttacked(nb, g, opponent(side));
}

export function legalMoves(state) {
  const { board, turn } = state;
  const moves = [];
  for (let i = 0; i < board.length; i++) {
    const p = board[i];
    if (p === '.' || sideOf(p) !== turn) continue;
    for (const to of pseudoTargets(board, i)) {
      if (leavesOwnSideSafe(board, i, to, turn)) moves.push({ from: i, to });
    }
  }
  return moves;
}

// ---------- Trạng thái ván cờ ----------

function positionKey(board, turn) {
  return board.join('') + turn;
}

export function createGame(fen = INITIAL_FEN) {
  const { board, turn } = parseFen(fen);
  return {
    board,
    turn,
    halfmoveClock: 0,
    history: [],
    posCounts: { [positionKey(board, turn)]: 1 },
  };
}

// Trả về trạng thái mới, ném lỗi nếu nước đi không hợp lệ.
export function applyMove(state, move) {
  const legal = legalMoves(state).some((m) => m.from === move.from && m.to === move.to);
  if (!legal) throw new Error('Nước đi không hợp lệ');

  const board = state.board.slice();
  const piece = board[move.from];
  const captured = board[move.to];
  board[move.to] = piece;
  board[move.from] = '.';

  const turn = opponent(state.turn);
  const key = positionKey(board, turn);
  return {
    board,
    turn,
    halfmoveClock: captured === '.' ? state.halfmoveClock + 1 : 0,
    history: [
      ...state.history,
      {
        from: move.from,
        to: move.to,
        piece,
        captured: captured === '.' ? null : captured,
        iccs: toICCS(move),
      },
    ],
    posCounts: { ...state.posCounts, [key]: (state.posCounts[key] || 0) + 1 },
  };
}

// { over: false } hoặc { over: true, winner: 'r' | 'b' | null, reason }
// reason: 'checkmate' | 'stalemate' | 'repetition' | 'no-capture'
// Trong cờ tướng, bên hết nước đi (kể cả không bị chiếu) là bên thua.
export function getResult(state) {
  if (legalMoves(state).length === 0) {
    return {
      over: true,
      winner: opponent(state.turn),
      reason: isInCheck(state) ? 'checkmate' : 'stalemate',
    };
  }
  if ((state.posCounts[positionKey(state.board, state.turn)] || 0) >= REPETITION_LIMIT) {
    return { over: true, winner: null, reason: 'repetition' };
  }
  if (state.halfmoveClock >= NO_CAPTURE_LIMIT) {
    return { over: true, winner: null, reason: 'no-capture' };
  }
  return { over: false };
}
