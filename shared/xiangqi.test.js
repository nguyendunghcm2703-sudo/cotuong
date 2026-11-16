import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_FEN,
  createGame,
  toFen,
  legalMoves,
  applyMove,
  getResult,
  isInCheck,
  sq,
  fromICCS,
  toICCS,
} from './xiangqi.js';

const targetsFrom = (state, from) =>
  legalMoves(state)
    .filter((m) => m.from === from)
    .map((m) => m.to)
    .sort((a, b) => a - b);

const sorted = (arr) => [...arr].sort((a, b) => a - b);

function perft(state, depth) {
  const moves = legalMoves(state);
  if (depth === 1) return moves.length;
  let total = 0;
  for (const m of moves) total += perft(applyMove(state, m), depth - 1);
  return total;
}

test('FEN: đọc rồi ghi lại thế khai cuộc không đổi', () => {
  assert.equal(toFen(createGame()), INITIAL_FEN);
});

test('ICCS: đổi qua lại và đúng ô', () => {
  const m = fromICCS('h2e2');
  assert.equal(m.from, sq(7, 7));
  assert.equal(m.to, sq(7, 4));
  assert.equal(toICCS(m), 'h2e2');
});

test('Khai cuộc: Đỏ đi trước, không bị chiếu, ván chưa kết thúc', () => {
  const g = createGame();
  assert.equal(g.turn, 'r');
  assert.equal(isInCheck(g, 'r'), false);
  assert.equal(isInCheck(g, 'b'), false);
  assert.deepEqual(getResult(g), { over: false });
});

test('Perft từ thế khai cuộc khớp số chuẩn (44, 1920, 79666)', () => {
  const g = createGame();
  assert.equal(perft(g, 1), 44);
  assert.equal(perft(g, 2), 1920);
  assert.equal(perft(g, 3), 79666);
});

test('Cản mã: chân mã bị chặn thì không đi được theo hướng đó', () => {
  // Mã Đỏ ở (5,4), tốt Đỏ ở (4,4) chặn chân phía trên
  const g = createGame('4k4/9/9/9/4P4/4N4/9/9/9/3K5 w');
  const t = targetsFrom(g, sq(5, 4));
  assert.ok(!t.includes(sq(3, 3)));
  assert.ok(!t.includes(sq(3, 5)));
  assert.ok(t.includes(sq(7, 3)));
  assert.ok(t.includes(sq(7, 5)));
  assert.ok(t.includes(sq(4, 2)));
  assert.ok(t.includes(sq(6, 6)));
});

test('Cản tượng: mắt tượng bị chặn thì không đi được', () => {
  const g = createGame('4k4/9/9/9/9/9/9/9/3P5/2BK5 w');
  assert.deepEqual(targetsFrom(g, sq(9, 2)), [sq(7, 0)]);
});

test('Tượng không được qua sông', () => {
  const g = createGame('4k4/9/9/9/9/2B6/9/9/9/3K5 w');
  assert.deepEqual(targetsFrom(g, sq(5, 2)), sorted([sq(7, 0), sq(7, 4)]));
});

test('Pháo: ăn phải có đúng một ngòi, đi thường không được nhảy qua quân', () => {
  const g = createGame('4k4/1r7/9/9/1p7/9/9/1C7/9/3K5 w');
  const t = targetsFrom(g, sq(7, 1));
  assert.ok(t.includes(sq(1, 1)), 'ăn xe qua ngòi');
  assert.ok(!t.includes(sq(4, 1)), 'không ăn thẳng quân đầu tiên');
  assert.ok(!t.includes(sq(3, 1)));
  assert.ok(!t.includes(sq(2, 1)));
  assert.ok(t.includes(sq(5, 1)));
  assert.ok(t.includes(sq(6, 1)));
});

test('Tốt: chưa qua sông chỉ đi thẳng, qua sông được đi ngang', () => {
  const before = createGame('3k5/9/9/9/9/9/4P4/9/9/5K3 w');
  assert.deepEqual(targetsFrom(before, sq(6, 4)), [sq(5, 4)]);

  const after = createGame('3k5/9/9/9/4P4/9/9/9/9/5K3 w');
  assert.deepEqual(
    targetsFrom(after, sq(4, 4)),
    sorted([sq(3, 4), sq(4, 3), sq(4, 5)])
  );
});

test('Hai tướng không được đối mặt: xe che giữa không được rời cột', () => {
  const g = createGame('4k4/9/9/9/9/9/9/9/4R4/4K4 w');
  const rookMoves = targetsFrom(g, sq(8, 4));
  assert.ok(rookMoves.length > 0);
  assert.ok(rookMoves.every((to) => to % 9 === 4), 'xe chỉ được đi dọc cột 4');
});

test('Không được tự để tướng bị chiếu', () => {
  // Xe Đen (0,3) chiếu dọc cột 3 tới tướng Đỏ (9,3); tốt Đỏ (5,3) che. Tốt đi ngang thì lộ tướng.
  const g = createGame('3rk4/9/9/9/9/3P5/9/9/9/3K5 w');
  const t = targetsFrom(g, sq(5, 3));
  assert.deepEqual(t, [sq(4, 3)]);
});

test('Chiếu bí: Đen hết nước đi, Đỏ thắng', () => {
  const g = createGame('R3k4/8R/9/9/9/9/9/9/9/3K5 b');
  assert.equal(isInCheck(g, 'b'), true);
  assert.equal(legalMoves(g).length, 0);
  assert.deepEqual(getResult(g), { over: true, winner: 'r', reason: 'checkmate' });
});

test('Nước đi sai bị từ chối', () => {
  const g = createGame();
  // Xe Đỏ (9,0) bị tốt (6,0) chặn
  assert.throws(() => applyMove(g, { from: sq(9, 0), to: sq(5, 0) }));
  // Không được đi quân của đối phương
  assert.throws(() => applyMove(g, { from: sq(0, 0), to: sq(1, 0) }));
});

test('Đổi lượt, ghi lịch sử, ăn quân đặt lại bộ đếm không ăn quân', () => {
  let g = createGame();
  g = applyMove(g, fromICCS('h2e2'));
  assert.equal(g.turn, 'b');
  assert.equal(g.halfmoveClock, 1);
  assert.equal(g.history[0].iccs, 'h2e2');
  g = applyMove(g, fromICCS('h9g7'));
  g = applyMove(g, fromICCS('h0g2'));
  g = applyMove(g, fromICCS('i9h9'));
  // Pháo Đỏ e2 ăn tốt Đen e6 (e5 là quân tốt Đen ở hàng 3 -> rank 6)
  g = applyMove(g, fromICCS('e2e6'));
  assert.equal(g.history.at(-1).captured, 'p');
  assert.equal(g.halfmoveClock, 0);
});

test('Hòa khi lặp thế lần thứ 3', () => {
  let g = createGame('3k5/9/9/9/9/9/9/9/R8/4K4 w');
  const cycle = ['a1a2', 'd9d8', 'a2a1', 'd8d9'];
  for (const m of cycle) g = applyMove(g, fromICCS(m));
  assert.deepEqual(getResult(g), { over: false });
  for (const m of cycle) g = applyMove(g, fromICCS(m));
  assert.deepEqual(getResult(g), { over: true, winner: null, reason: 'repetition' });
});
