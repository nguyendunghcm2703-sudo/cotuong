// Hình học bàn cờ: thuần số học, không phụ thuộc Three.js nên test được bằng Node.
//
// Hệ tọa độ thế giới (đơn vị = một ô cờ):
//   x: cột trái -> phải (cột 4 ở giữa, x = 0)
//   z: hàng 0 (đầu Đen, phía xa) -> hàng 9 (đầu Đỏ, phía gần camera)
//   y: hướng lên, mặt bàn cờ ở y = 0

export const S = 1;
export const BOARD_W = 9.4; // tấm gỗ: 8 ô + lề
export const BOARD_D = 10.4; // tấm gỗ: 9 ô + lề
export const BOARD_H = 0.5;
export const GRID_MARGIN = 0.7; // từ mép tấm gỗ tới đường kẻ ngoài cùng

export function cellToWorld(row, col) {
  return { x: (col - 4) * S, z: (row - 4.5) * S };
}

// Ô gần nhất với điểm (x, z), hoặc null nếu ngoài bàn cờ.
export function worldToCell(x, z) {
  const col = Math.round(x / S + 4);
  const row = Math.round(z / S + 4.5);
  if (col < 0 || col > 8 || row < 0 || row > 9) return null;
  return { row, col };
}

// Vùng cần nhìn thấy (bàn cờ + khay quân bị ăn), tính theo bố cục khay:
//   'tb': màn hình dọc, khay nằm phía trên và dưới bàn
//   'lr': màn hình ngang, khay nằm bên trái và phải
export const EXTENT = {
  tb: { w: 9.9, h: 15 },
  lr: { w: 14, h: 10.6 },
};

// Khoảng cách camera để thấy trọn vùng cần nhìn, tính theo tỉ lệ khung hình.
export function fitDistance(aspect, vfovDeg = 40, layout = 'tb') {
  const e = EXTENT[layout] || EXTENT.tb;
  const t = Math.tan((vfovDeg * Math.PI) / 360);
  const byWidth = e.w / (2 * t * aspect);
  const byHeight = e.h / (2 * t);
  return Math.max(byWidth, byHeight);
}
