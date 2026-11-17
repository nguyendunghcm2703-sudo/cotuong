// Khay quân bị ăn: quân đặt ngoài bàn cờ như ngoài đời. Thuần số học, test được bằng Node.
//
// Tọa độ trong hệ của bàn cờ (không xoay). Quân Đỏ bị ăn nằm ở phía người cầm Đen và ngược lại
// (quân bị ăn đặt bên phía người đã ăn). Với bàn lật, cả bàn và khay xoay cùng nhau.

import { BOARD_W, BOARD_D } from './geometry.js';

export const TRAY_SCALE = 0.8;
const PER_ROW = 8;
const ROW_GAP = 0.85;
const COL_GAP = 0.9;

// Màn hình dọc (aspect < 1) đặt khay trên/dưới, màn hình ngang đặt trái/phải.
export function layoutFor(aspect) {
  return aspect < 1 ? 'tb' : 'lr';
}

// Từ lịch sử nước đi: quân nào đã bị ăn. history[i] = { from, to, piece, captured } hoặc tương tự.
// Trả về { r: [...quân Đỏ bị ăn], b: [...quân Đen bị ăn] } theo thứ tự bị ăn.
export function capturedFromHistory(history) {
  const out = { r: [], b: [] };
  for (const h of history || []) {
    const ch = h && h.captured;
    if (!ch || ch === '.') continue;
    (ch === ch.toUpperCase() ? out.r : out.b).push(ch);
  }
  return out;
}

// Vị trí ô thứ index của khay bên side ('r' hoặc 'b' = quân của bên đó bị ăn). Trả về { x, z }.
// Quân Đỏ bị ăn nằm phía Đen (z âm, xa camera ban đầu), quân Đen bị ăn nằm phía Đỏ (z dương, gần).
export function traySlot(side, index, layout) {
  const row = Math.floor(index / PER_ROW);
  const col = index % PER_ROW;
  const sign = side === 'r' ? -1 : 1;
  if (layout === 'lr') {
    const x = sign * (BOARD_W / 2 + 0.9 + row * ROW_GAP);
    const z = (col - (PER_ROW - 1) / 2) * COL_GAP * 1.0;
    return { x, z };
  }
  const z = sign * (BOARD_D / 2 + 0.85 + row * ROW_GAP);
  const x = (col - (PER_ROW - 1) / 2) * COL_GAP;
  return { x, z };
}

// Hình chữ nhật tấm khay (nền gỗ) cho mỗi bên: { cx, cz, w, d }.
export function trayBase(side, layout) {
  const sign = side === 'r' ? -1 : 1;
  const rows = 2;
  if (layout === 'lr') {
    const d = PER_ROW * COL_GAP + 0.4;
    const w = rows * ROW_GAP + 0.6;
    return { cx: sign * (BOARD_W / 2 + 0.9 + ((rows - 1) * ROW_GAP) / 2), cz: 0, w, d };
  }
  const w = PER_ROW * COL_GAP + 0.4;
  const d = rows * ROW_GAP + 0.6;
  return { cx: 0, cz: sign * (BOARD_D / 2 + 0.85 + ((rows - 1) * ROW_GAP) / 2), w, d };
}
