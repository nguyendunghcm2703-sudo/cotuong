import test from 'node:test';
import assert from 'node:assert/strict';
import { traySlot, trayBase, capturedFromHistory, layoutFor } from '../public/client/tray.js';
import { BOARD_W, BOARD_D, fitDistance } from '../public/client/geometry.js';
import { createGame, applyMove, legalMoves } from '../public/shared/xiangqi.js';

test('layoutFor: dọc -> tb, ngang -> lr', () => {
  assert.equal(layoutFor(0.5), 'tb');
  assert.equal(layoutFor(1.6), 'lr');
});

test('Khay nằm ngoài tấm bàn cờ, không ô nào trùng nhau', () => {
  for (const layout of ['tb', 'lr']) {
    for (const side of ['r', 'b']) {
      const seen = new Set();
      for (let i = 0; i < 16; i++) {
        const { x, z } = traySlot(side, i, layout);
        assert.ok(Math.abs(x) > BOARD_W / 2 || Math.abs(z) > BOARD_D / 2, `${layout}${side}${i}`);
        const k = `${x.toFixed(2)},${z.toFixed(2)}`;
        assert.ok(!seen.has(k));
        seen.add(k);
      }
    }
  }
});

test('Quân Đỏ bị ăn nằm phía Đen (z âm), quân Đen bị ăn nằm phía Đỏ (z dương)', () => {
  assert.ok(traySlot('r', 0, 'tb').z < 0);
  assert.ok(traySlot('b', 0, 'tb').z > 0);
  assert.ok(traySlot('r', 0, 'lr').x < 0);
  assert.ok(traySlot('b', 0, 'lr').x > 0);
});

test('Khay nằm trong vùng camera nhìn thấy', () => {
  for (const side of ['r', 'b']) {
    for (let i = 0; i < 16; i++) {
      const tb = traySlot(side, i, 'tb');
      assert.ok(Math.abs(tb.z) <= 7.5 && Math.abs(tb.x) <= 4.95);
      const lr = traySlot(side, i, 'lr');
      assert.ok(Math.abs(lr.x) <= 7 && Math.abs(lr.z) <= 5.3);
    }
  }
  assert.ok(trayBase('r', 'tb').w > 0);
});

test('capturedFromHistory gom quân bị ăn theo bên', () => {
  let g = createGame();
  let n = 0;
  // chơi nước ăn quân tham lam cho tới khi có vài quân bị ăn
  while (n < 120) {
    const ms = legalMoves(g);
    if (!ms.length) break;
    const cap = ms.find((m) => g.board[m.to] !== '.');
    g = applyMove(g, cap || ms[(n * 7) % ms.length]);
    n++;
    if (capturedFromHistory(g.history).r.length >= 2 && capturedFromHistory(g.history).b.length >= 2) break;
  }
  const c = capturedFromHistory(g.history);
  assert.ok(c.r.every((ch) => ch === ch.toUpperCase()));
  assert.ok(c.b.every((ch) => ch === ch.toLowerCase()));
  assert.equal(c.r.length + c.b.length, g.history.filter((h) => h.captured).length);
});

test('fitDistance theo bố cục khay', () => {
  assert.ok(fitDistance(0.5, 40, 'tb') > 0);
  assert.ok(fitDistance(1.8, 40, 'lr') > 0);
  assert.ok(fitDistance(0.5, 40, 'tb') > fitDistance(1.6, 40, 'tb'));
});
