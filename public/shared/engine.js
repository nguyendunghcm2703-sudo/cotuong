// Máy đánh cờ tướng: bàn cờ nhanh (make/unmake) + alpha-beta, quiescence, bảng băm.
// Thuần JS, không phụ thuộc DOM nên chạy được trong Web Worker và trong Node (để test).
//
// Quy ước ngoài: board là mảng 90 ký tự như xiangqi.js (hoa = Đỏ, thường = Đen, '.' = trống),
// turn là 'r' | 'b'. Nước đi trả về dạng { from, to } cùng chỉ số với xiangqi.js.

const K = 1, A = 2, B = 3, N = 4, R = 5, C = 6, P = 7;
const TYPE = { K, A, B, N, R, C, P };
const VALUE = [0, 0, 200, 200, 400, 900, 450, 100];
const MATE = 30000;
const INF = 32000;

const ROW = new Int8Array(90);
const COL = new Int8Array(90);
for (let i = 0; i < 90; i++) {
  ROW[i] = (i / 9) | 0;
  COL[i] = i % 9;
}

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const HORSE = [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]];

// ---------- Zobrist ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
}
const rnd = rng(20240607);
const Z1 = new Int32Array(16 * 90);
const Z2 = new Int32Array(16 * 90);
for (let i = 0; i < Z1.length; i++) {
  Z1[i] = rnd();
  Z2[i] = rnd();
}
const ZS1 = rnd();
const ZS2 = rnd();

function toCode(ch) {
  if (ch === '.') return 0;
  const u = ch.toUpperCase();
  return ch === u ? TYPE[u] : TYPE[u] + 8;
}

// ---------- Bảng điểm vị trí đơn giản ----------
// PST[type][side][sq]
const PST = [];
for (let t = 0; t < 8; t++) PST.push([new Int16Array(90), new Int16Array(90)]);
for (let side = 0; side < 2; side++) {
  for (let i = 0; i < 90; i++) {
    const r = ROW[i];
    const c = COL[i];
    const adv = side === 0 ? 9 - r : r; // số hàng đã tiến lên (0..9)
    const cen = 4 - Math.abs(c - 4); // 0..4
    PST[N][side][i] = cen * 5 + Math.min(adv, 6) * 4 - 10;
    PST[R][side][i] = cen * 2 + (adv >= 5 ? 12 : 0);
    PST[C][side][i] = cen * 3 + (adv >= 3 && adv <= 6 ? 8 : 0);
    if (adv >= 5) PST[P][side][i] = 100 + (adv - 5) * 12 + cen * 5;
    else PST[P][side][i] = adv >= 3 ? 0 : -5;
    PST[A][side][i] = 0;
    PST[B][side][i] = c === 2 || c === 6 ? 4 : 0;
  }
}

export const LEVELS = {
  de: { name: 'Dễ', maxDepth: 2, timeMs: 300, noise: 140, blunder: 0.2, opening: 0 },
  vua: { name: 'Vừa', maxDepth: 4, timeMs: 1200, noise: 12, blunder: 0, opening: 0 },
  kho: { name: 'Khó', maxDepth: 8, timeMs: 3000, noise: 0, blunder: 0, opening: 8 },
};

const TT_BITS = 18;
const TT_SIZE = 1 << TT_BITS;

export class Engine {
  constructor() {
    this.b = new Int8Array(90);
    this.kingPos = [-1, -1];
    this.turn = 0;
    this.h1 = 0;
    this.h2 = 0;
    this.stack = []; // băm các thế đã qua (h1) để phát hiện lặp
    this.undo = [];
    this.ttKey = new Int32Array(TT_SIZE);
    this.ttData = new Int32Array(TT_SIZE * 2);
    this.killers = [];
    for (let i = 0; i < 64; i++) this.killers.push([0, 0]);
    this.moveBuf = [];
    for (let i = 0; i < 64; i++) this.moveBuf.push({ m: new Int32Array(128), s: new Int32Array(128) });
    this.nodes = 0;
    this.deadline = 0;
    this.aborted = false;
    this.clock = () => Date.now();
  }

  set(board, turn, priorKeys = []) {
    this.b.fill(0);
    this.kingPos = [-1, -1];
    this.h1 = 0;
    this.h2 = 0;
    for (let i = 0; i < 90; i++) {
      const p = toCode(board[i]);
      this.b[i] = p;
      if (p) {
        this.h1 ^= Z1[p * 90 + i];
        this.h2 ^= Z2[p * 90 + i];
        if ((p & 7) === K) this.kingPos[p >> 3] = i;
      }
    }
    this.turn = turn === 'r' ? 0 : 1;
    if (this.turn) {
      this.h1 ^= ZS1;
      this.h2 ^= ZS2;
    }
    this.stack = [];
    this.undo = [];
    this.priorHashes = priorKeys; // không dùng băm ngoài, xem setHistory
  }

  // ----- tấn công -----
  attacked(t, by) {
    const b = this.b;
    const r = ROW[t];
    const c = COL[t];
    const enemyBase = by << 3;
    // xe, pháo, tướng đối mặt: quét 4 hướng
    for (let d = 0; d < 4; d++) {
      const dr = ORTHO[d][0];
      const dc = ORTHO[d][1];
      let nr = r + dr;
      let nc = c + dc;
      let seen = 0;
      while (nr >= 0 && nr < 10 && nc >= 0 && nc < 9) {
        const p = b[nr * 9 + nc];
        if (p) {
          if (seen === 0) {
            if ((p >> 3) === by) {
              const ty = p & 7;
              if (ty === R) return true;
              if (ty === K && dc === 0) return true;
              if (ty === K && false) return true;
            }
            seen = 1;
          } else {
            if ((p >> 3) === by && (p & 7) === C) return true;
            break;
          }
        }
        nr += dr;
        nc += dc;
      }
    }
    // mã
    for (let k = 0; k < 8; k++) {
      const pr = r + HORSE[k][0];
      const pc = c + HORSE[k][1];
      if (pr < 0 || pr > 9 || pc < 0 || pc > 8) continue;
      if (b[pr * 9 + pc] !== enemyBase + N) continue;
      // mã ở (pr,pc) nhảy về t theo (-dr,-dc); chân mã nằm cạnh mã
      const dr = -HORSE[k][0];
      const dc = -HORSE[k][1];
      const lr = Math.abs(dr) === 2 ? pr + Math.sign(dr) : pr;
      const lc = Math.abs(dr) === 2 ? pc : pc + Math.sign(dc);
      if (b[lr * 9 + lc] === 0) return true;
    }
    // tốt: Đỏ tiến lên (row giảm), Đen tiến xuống (row tăng)
    const fwd = by === 0 ? -1 : 1; // hướng tiến của bên tấn công
    // tốt ở (r - fwd, c) tiến tới t
    {
      const pr = r - fwd;
      if (pr >= 0 && pr < 10 && b[pr * 9 + c] === enemyBase + P) return true;
    }
    // tốt đã qua sông đi ngang
    for (const dc of [-1, 1]) {
      const pc = c + dc;
      if (pc < 0 || pc > 8) continue;
      if (b[r * 9 + pc] === enemyBase + P) {
        const crossed = by === 0 ? r <= 4 : r >= 5;
        if (crossed) return true;
      }
    }
    return false;
  }

  inCheck(side) {
    return this.attacked(this.kingPos[side], side ^ 1);
  }

  // ----- sinh nước đi giả hợp lệ -----
  gen(ply, capsOnly) {
    const buf = this.moveBuf[ply];
    const ms = buf.m;
    const ss = buf.s;
    let n = 0;
    const b = this.b;
    const side = this.turn;
    const base = side << 3;
    const add = (from, to, attacker) => {
      const v = b[to];
      if (v) {
        if ((v >> 3) === side) return;
        ms[n] = from | (to << 7);
        ss[n] = 10000 + VALUE[v & 7] * 10 - VALUE[attacker] + ((v & 7) === K ? 100000 : 0);
        n++;
      } else if (!capsOnly) {
        ms[n] = from | (to << 7);
        ss[n] = 0;
        n++;
      }
    };
    for (let i = 0; i < 90; i++) {
      const p = b[i];
      if (!p || (p >> 3) !== side) continue;
      const ty = p & 7;
      const r = ROW[i];
      const c = COL[i];
      switch (ty) {
        case K:
          for (let d = 0; d < 4; d++) {
            const nr = r + ORTHO[d][0];
            const nc = c + ORTHO[d][1];
            if (nc < 3 || nc > 5) continue;
            if (side === 0 ? nr < 7 || nr > 9 : nr < 0 || nr > 2) continue;
            add(i, nr * 9 + nc, K);
          }
          break;
        case A:
          for (let d = 0; d < 4; d++) {
            const nr = r + DIAG[d][0];
            const nc = c + DIAG[d][1];
            if (nc < 3 || nc > 5) continue;
            if (side === 0 ? nr < 7 || nr > 9 : nr < 0 || nr > 2) continue;
            add(i, nr * 9 + nc, A);
          }
          break;
        case B:
          for (let d = 0; d < 4; d++) {
            const nr = r + DIAG[d][0] * 2;
            const nc = c + DIAG[d][1] * 2;
            if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
            if (side === 0 ? nr < 5 : nr > 4) continue;
            if (b[(r + DIAG[d][0]) * 9 + c + DIAG[d][1]]) continue;
            add(i, nr * 9 + nc, B);
          }
          break;
        case N:
          for (let k = 0; k < 8; k++) {
            const dr = HORSE[k][0];
            const dc = HORSE[k][1];
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr > 9 || nc < 0 || nc > 8) continue;
            const lr = Math.abs(dr) === 2 ? r + Math.sign(dr) : r;
            const lc = Math.abs(dr) === 2 ? c : c + Math.sign(dc);
            if (b[lr * 9 + lc]) continue;
            add(i, nr * 9 + nc, N);
          }
          break;
        case R:
          for (let d = 0; d < 4; d++) {
            let nr = r + ORTHO[d][0];
            let nc = c + ORTHO[d][1];
            while (nr >= 0 && nr < 10 && nc >= 0 && nc < 9) {
              const to = nr * 9 + nc;
              const v = b[to];
              if (v) {
                add(i, to, R);
                break;
              }
              add(i, to, R);
              nr += ORTHO[d][0];
              nc += ORTHO[d][1];
            }
          }
          break;
        case C:
          for (let d = 0; d < 4; d++) {
            const dr = ORTHO[d][0];
            const dc = ORTHO[d][1];
            let nr = r + dr;
            let nc = c + dc;
            while (nr >= 0 && nr < 10 && nc >= 0 && nc < 9 && !b[nr * 9 + nc]) {
              add(i, nr * 9 + nc, C);
              nr += dr;
              nc += dc;
            }
            nr += dr;
            nc += dc;
            while (nr >= 0 && nr < 10 && nc >= 0 && nc < 9) {
              const to = nr * 9 + nc;
              if (b[to]) {
                add(i, to, C);
                break;
              }
              nr += dr;
              nc += dc;
            }
          }
          break;
        case P: {
          const fwd = side === 0 ? -1 : 1;
          const nr = r + fwd;
          if (nr >= 0 && nr < 10) add(i, nr * 9 + c, P);
          const crossed = side === 0 ? r <= 4 : r >= 5;
          if (crossed) {
            if (c > 0) add(i, r * 9 + c - 1, P);
            if (c < 8) add(i, r * 9 + c + 1, P);
          }
          break;
        }
        default:
          break;
      }
    }
    void base;
    return n;
  }

  make(m) {
    const from = m & 127;
    const to = m >> 7;
    const b = this.b;
    const p = b[from];
    const cap = b[to];
    const side = this.turn;
    this.undo.push(cap, this.h1, this.h2);
    this.h1 ^= Z1[p * 90 + from] ^ Z1[p * 90 + to] ^ ZS1;
    this.h2 ^= Z2[p * 90 + from] ^ Z2[p * 90 + to] ^ ZS2;
    if (cap) {
      this.h1 ^= Z1[cap * 90 + to];
      this.h2 ^= Z2[cap * 90 + to];
    }
    b[to] = p;
    b[from] = 0;
    if ((p & 7) === K) this.kingPos[side] = to;
    this.turn = side ^ 1;
    this.stack.push(this.h1);
    // hợp lệ: tướng mình không bị chiếu và hai tướng không đối mặt
    const ok = !this.attacked(this.kingPos[side], side ^ 1);
    return ok;
  }

  unmake(m) {
    const from = m & 127;
    const to = m >> 7;
    const b = this.b;
    this.stack.pop();
    const h2 = this.undo.pop();
    const h1 = this.undo.pop();
    const cap = this.undo.pop();
    this.h1 = h1;
    this.h2 = h2;
    this.turn ^= 1;
    const p = b[to];
    b[from] = p;
    b[to] = cap;
    if ((p & 7) === K) this.kingPos[this.turn] = from;
  }

  evaluate() {
    const b = this.b;
    let score = 0;
    for (let i = 0; i < 90; i++) {
      const p = b[i];
      if (!p) continue;
      const side = p >> 3;
      const ty = p & 7;
      const v = VALUE[ty] + PST[ty][side][i];
      score += side === 0 ? v : -v;
    }
    score = this.turn === 0 ? score : -score;
    return score + 8;
  }

  legalRootMoves() {
    const n = this.gen(0, false);
    const out = [];
    const ms = this.moveBuf[0].m.slice(0, n);
    for (let i = 0; i < n; i++) {
      const m = ms[i];
      if (this.make(m)) out.push(m);
      this.unmake(m);
    }
    return out;
  }

  timeUp() {
    if ((this.nodes & 1023) === 0 && this.clock() > this.deadline) this.aborted = true;
    return this.aborted;
  }

  quiesce(alpha, beta, ply, qd) {
    this.nodes++;
    if (this.timeUp()) return 0;
    const stand = this.evaluate();
    if (stand >= beta) return stand;
    if (qd >= 6 || ply >= 60) return stand;
    if (stand > alpha) alpha = stand;
    const n = this.gen(ply, true);
    const buf = this.moveBuf[ply];
    this.sortMoves(buf, n, 0);
    for (let i = 0; i < n; i++) {
      const m = buf.m[i];
      if (!this.make(m)) {
        this.unmake(m);
        continue;
      }
      const sc = -this.quiesce(-beta, -alpha, ply + 1, qd + 1);
      this.unmake(m);
      if (this.aborted) return 0;
      if (sc >= beta) return sc;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  }

  sortMoves(buf, n, ttMove, ply = -1) {
    const ms = buf.m;
    const ss = buf.s;
    if (ttMove || ply >= 0) {
      for (let i = 0; i < n; i++) {
        if (ms[i] === ttMove && ttMove) ss[i] += 1000000;
        else if (ply >= 0 && !ss[i]) {
          if (ms[i] === this.killers[ply][0]) ss[i] = 9000;
          else if (ms[i] === this.killers[ply][1]) ss[i] = 8000;
        }
      }
    }
    // chọn lọc đơn giản (n nhỏ)
    for (let i = 1; i < n; i++) {
      const m = ms[i];
      const s = ss[i];
      let j = i - 1;
      while (j >= 0 && ss[j] < s) {
        ms[j + 1] = ms[j];
        ss[j + 1] = ss[j];
        j--;
      }
      ms[j + 1] = m;
      ss[j + 1] = s;
    }
  }

  repeated() {
    const st = this.stack;
    const cur = st[st.length - 1];
    for (let i = st.length - 3; i >= 0; i -= 2) {
      if (st[i] === cur) return true;
    }
    return false;
  }

  negamax(depth, alpha, beta, ply) {
    this.nodes++;
    if (this.timeUp()) return 0;
    if (ply > 0 && this.repeated()) return 0;
    if (ply >= 58) return this.evaluate();

    const inChk = this.inCheck(this.turn);
    if (inChk && ply < 40) depth++;
    if (depth <= 0) return this.quiesce(alpha, beta, ply, 0);

    const idx = this.h1 & (TT_SIZE - 1);
    let ttMove = 0;
    if (this.ttKey[idx] === this.h2) {
      const d = this.ttData[idx * 2];
      const info = this.ttData[idx * 2 + 1];
      const flag = info & 3;
      let sc = info >> 2;
      ttMove = d & 0x3fff;
      const dd = d >> 14;
      if (dd >= depth && ply > 0) {
        if (sc > MATE - 100) sc -= ply;
        else if (sc < -MATE + 100) sc += ply;
        if (flag === 0) return sc;
        if (flag === 1 && sc >= beta) return sc;
        if (flag === 2 && sc <= alpha) return sc;
      }
    }

    const n = this.gen(ply, false);
    const buf = this.moveBuf[ply];
    this.sortMoves(buf, n, ttMove, ply);
    let best = -INF;
    let bestMove = 0;
    let legal = 0;
    const origAlpha = alpha;
    for (let i = 0; i < n; i++) {
      const m = buf.m[i];
      if (!this.make(m)) {
        this.unmake(m);
        continue;
      }
      legal++;
      const sc = -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.unmake(m);
      if (this.aborted) return 0;
      if (sc > best) {
        best = sc;
        bestMove = m;
        if (sc > alpha) {
          alpha = sc;
          if (alpha >= beta) {
            if (!this.b[m >> 7] && this.killers[ply][0] !== m) {
              this.killers[ply][1] = this.killers[ply][0];
              this.killers[ply][0] = m;
            }
            break;
          }
        }
      }
    }
    if (legal === 0) return -MATE + ply; // hết nước đi = thua

    let flag = 0;
    if (best <= origAlpha) flag = 2;
    else if (best >= beta) flag = 1;
    let store = best;
    if (store > MATE - 100) store += ply;
    else if (store < -MATE + 100) store -= ply;
    this.ttKey[idx] = this.h2;
    this.ttData[idx * 2] = bestMove | (Math.min(depth, 60) << 14);
    this.ttData[idx * 2 + 1] = (store << 2) | flag;
    return best;
  }

  // Điểm từng nước ở gốc, cửa sổ đầy đủ (dùng cho cấp thấp và khai cuộc ngẫu nhiên).
  rootScores(depth, moves) {
    const out = [];
    for (const m of moves) {
      this.make(m);
      const sc = -this.negamax(depth - 1, -INF, INF, 1);
      this.unmake(m);
      if (this.aborted) return null;
      out.push({ m, score: sc });
    }
    return out;
  }

  // Trả về { from, to, score, depth, nodes } hoặc null nếu hết nước đi.
  think(levelKey, opts = {}) {
    const lv = LEVELS[levelKey] || LEVELS.vua;
    const rand = opts.random || Math.random;
    const plies = opts.plies || 0;
    const moves = this.legalRootMoves();
    if (moves.length === 0) return null;
    this.nodes = 0;
    this.aborted = false;
    this.deadline = this.clock() + (opts.timeMs ?? lv.timeMs);
    const baseStack = this.stack.length;
    const done = (m, score, depth) => ({ from: m & 127, to: m >> 7, score, depth, nodes: this.nodes });
    if (moves.length === 1) return done(moves[0], 0, 0);

    const pickNoisy = (depth, noise, window) => {
      let sc = this.rootScores(depth, moves);
      if (!sc) return null;
      if (noise > 0) sc = sc.map((x) => ({ m: x.m, score: x.score + (rand() * 2 - 1) * noise }));
      sc.sort((a, b) => b.score - a.score);
      if (window > 0) {
        const pool = sc.filter((x) => x.score >= sc[0].score - window);
        const pick = pool[Math.floor(rand() * pool.length)];
        return done(pick.m, pick.score, depth);
      }
      return done(sc[0].m, sc[0].score, depth);
    };

    if (levelKey === 'de') {
      // đôi khi đi một nước "tạm được" ngẫu nhiên: không quá ngu để thua trong 1 nước, nhưng hay sai
      if (rand() < lv.blunder) {
        const sc = this.rootScores(1, moves);
        if (sc) {
          sc.sort((a, b) => b.score - a.score);
          const top = sc.slice(0, Math.max(3, Math.ceil(sc.length / 3)));
          const pick = top[Math.floor(rand() * top.length)];
          return done(pick.m, pick.score, 1);
        }
      }
      this.deadline = this.clock() + lv.timeMs;
      const r = pickNoisy(lv.maxDepth, lv.noise, 0);
      if (r) return r;
      return done(moves[Math.floor(rand() * moves.length)], 0, 0);
    }

    if (levelKey === 'kho' && plies < lv.opening) {
      const r = pickNoisy(3, 0, 25);
      if (r) return r;
    }

    // làm sâu dần
    let best = moves[0];
    let bestScore = 0;
    let reached = 0;
    for (let d = 1; d <= lv.maxDepth; d++) {
      let alpha = -INF;
      let curBest = 0;
      let curScore = -INF;
      // đặt nước tốt nhất lần trước lên đầu
      const order = moves.slice().sort((a, b) => (a === best ? -1 : b === best ? 1 : 0));
      const scored = [];
      for (const m of order) {
        this.make(m);
        const sc = -this.negamax(d - 1, -INF, -alpha, 1);
        this.unmake(m);
        if (this.aborted) break;
        scored.push({ m, score: sc });
        if (sc > curScore) {
          curScore = sc;
          curBest = m;
          if (sc > alpha) alpha = sc;
        }
      }
      if (this.aborted) {
        // dùng kết quả dở dang nếu nó đã tìm ra nước tốt hơn nước cũ
        if (curBest && curScore > bestScore - 50 && d > 1 && scored.length > 0 && scored[0].m === best) {
          best = curBest;
          bestScore = curScore;
        }
        break;
      }
      best = curBest;
      bestScore = curScore;
      reached = d;
      if (Math.abs(bestScore) > MATE - 100) break;
      if (this.clock() > this.deadline) break;
    }
    void baseStack;
    return done(best, bestScore, reached);
  }
}

// Bộ băm tạm dùng cho lịch sử
Engine.Hasher = class {
  constructor(board, turn) {
    let h1 = 0;
    for (let i = 0; i < 90; i++) {
      const p = toCode(board[i]);
      if (p) h1 ^= Z1[p * 90 + i];
    }
    if (turn === 'b') h1 ^= ZS1;
    this.h1 = h1;
  }
};

// Hàm tiện dụng: state theo xiangqi.js (có history) -> nước đi cho máy.
export function chooseMove(state, levelKey, opts = {}) {
  const eng = opts.engine || new Engine();
  eng.set(state.board, state.turn);
  // các thế đã qua của ván (dựng lại từ lịch sử) để tránh/nhận biết lặp
  const positions = [];
  const hist = state.history || [];
  if (hist.length) {
    const b = state.board.slice();
    for (let i = hist.length - 1; i >= 0; i--) {
      b[hist[i].from] = hist[i].piece;
      b[hist[i].to] = hist[i].captured || '.';
    }
    // b là thế ban đầu; phát lại từng bước, lưu từng thế (trừ thế hiện tại)
    const turn0 = hist[0].piece === hist[0].piece.toUpperCase() ? 'r' : 'b';
    let t = turn0;
    for (let i = 0; i < hist.length; i++) {
      positions.push({ board: b.slice(), turn: t });
      b[hist[i].to] = hist[i].piece;
      b[hist[i].from] = '.';
      t = t === 'r' ? 'b' : 'r';
    }
  }
  eng.stack = positions.map((p) => new Engine.Hasher(p.board, p.turn).h1);
  eng.stack.push(eng.h1);
  return eng.think(levelKey, { ...opts, plies: hist.length });
}
