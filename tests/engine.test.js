import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, legalMoves, applyMove, getResult } from '../public/shared/xiangqi.js';
import { Engine, chooseMove } from '../public/shared/engine.js';

function seeded(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

test('sinh nước đi của máy khớp luật chuẩn trên nhiều thế ngẫu nhiên', () => {
  const rand = seeded(7);
  const eng = new Engine();
  let checked = 0;
  for (let g = 0; g < 40; g++) {
    let st = createGame();
    for (let ply = 0; ply < 90; ply++) {
      if (getResult(st).over) break;
      const ref = legalMoves(st).map((m) => `${m.from}-${m.to}`).sort();
      eng.set(st.board, st.turn);
      const mine = eng.legalRootMoves().map((m) => `${m & 127}-${m >> 7}`).sort();
      assert.deepEqual(mine, ref, `lệch ở ván ${g} nước ${ply}`);
      checked++;
      const mv = legalMoves(st);
      st = applyMove(st, mv[Math.floor(rand() * mv.length)]);
    }
  }
  assert.ok(checked > 1000);
});

test('máy tìm nước chiếu hết trong 1 nước', () => {
  // Đỏ: tướng e0? dùng FEN: Đen tướng d9->hàng 0; xe đỏ chiếu hết
  const st = createGame('3k5/R8/4b4/9/9/9/9/9/9/4K1R2 w'.replace('4K1R2', '3K1R3'));
  const mv = chooseMove(st, 'kho', { timeMs: 1500 });
  assert.ok(mv);
  const next = applyMove(st, mv);
  assert.ok(legalMoves(next).length === 0 || mv.score > 1000);
});

test('máy luôn trả nước hợp lệ ở cả ba cấp', () => {
  for (const lv of ['de', 'vua', 'kho']) {
    let st = createGame();
    for (let i = 0; i < 6; i++) {
      const mv = chooseMove(st, lv, { timeMs: 200 });
      assert.ok(legalMoves(st).some((m) => m.from === mv.from && m.to === mv.to), lv);
      st = applyMove(st, mv);
    }
  }
});
