// Hình học bàn cờ 3D: thuần số học, không phụ thuộc Three.js nên test được bằng Node.
//
// Hệ tọa độ thế giới (đơn vị = một ô cờ):
//   x: cột trái -> phải (cột 4 ở giữa, x = 0)
//   z: hàng 0 (đầu Đen, phía xa) -> hàng 9 (đầu Đỏ, phía gần camera)
//   y: hướng lên, mặt bàn cờ ở y = 0

export const S = 1;
export const BOARD_W = 9.6; // tấm gỗ: 8 ô + lề
export const BOARD_D = 10.6; // tấm gỗ: 9 ô + lề
export const BOARD_H = 0.5;

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

// Khoảng cách camera để thấy trọn bàn cờ, tính theo tỉ lệ khung hình.
// Màn hình dọc (điện thoại) bị giới hạn bởi chiều ngang nên camera phải lùi xa hơn.
export function fitDistance(aspect, vfovDeg = 40) {
  const t = Math.tan((vfovDeg * Math.PI) / 360);
  const byWidth = 11 / (2 * t * aspect);
  const byHeight = 11.2 / (2 * t);
  return Math.max(byWidth, byHeight);
}
