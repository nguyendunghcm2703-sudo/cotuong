// Chạy máy đánh cờ trong luồng riêng để giao diện không bị đứng khi máy suy nghĩ.
import { chooseMove } from '../shared/engine.js';

self.onmessage = (e) => {
  const { id, board, turn, history, level } = e.data;
  try {
    const mv = chooseMove({ board, turn, history }, level);
    self.postMessage({ id, move: mv ? { from: mv.from, to: mv.to } : null });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
