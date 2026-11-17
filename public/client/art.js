// Vẽ bàn, mặt bàn cờ và mặt quân bằng canvas 2D. Dùng chung cho 3D (làm texture) và 2D (vẽ thẳng).
// Chỉ phụ thuộc canvas context, không phụ thuộc Three.js.

import { CHARS } from '../shared/xiangqi.js';
import { PAL } from './palette.js';
import { BOARD_W, BOARD_D, GRID_MARGIN } from './geometry.js';

// Có phương án dự phòng cho Android (Noto/Droid/Source Han) và iOS (PingFang, Hiragino).
export const CJK_FONT =
  '"KaiTi","STKaiti","Kaiti TC","BiauKai","Noto Serif CJK TC","Noto Serif CJK SC","Noto Serif TC","Source Han Serif TC",' +
  '"PingFang TC","PingFang SC","Hiragino Mincho ProN","Hiragino Sans GB","Droid Sans Fallback","Noto Sans CJK TC",' +
  '"Microsoft JhengHei","PMingLiU","Songti TC","SimSun",serif';

// Bộ sinh số ngẫu nhiên có hạt giống: vân gỗ luôn giống nhau giữa các lần tải.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function paintWood(ctx, w, h, base, grain, seed, strokes) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  const rand = rng(seed);
  for (let i = 0; i < strokes; i++) {
    const y = rand() * h;
    const amp = 4 + rand() * 14;
    ctx.strokeStyle = grain.replace('A', (0.04 + rand() * 0.09).toFixed(3));
    ctx.lineWidth = 0.6 + rand() * 2.4;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(
      w * 0.3, y + amp * (rand() - 0.5) * 2,
      w * 0.65, y + amp * (rand() - 0.5) * 2,
      w, y + amp * (rand() - 0.5) * 2
    );
    ctx.stroke();
  }
}

export function paintTable(ctx, w = 512, h = 512) {
  paintWood(ctx, w, h, PAL.tableBase, PAL.tableGrain, 7, 120);
}

export function paintTray(ctx, w = 256, h = 256) {
  paintWood(ctx, w, h, PAL.trayBase, PAL.trayGrain, 23, 80);
}

export function boardSize(u) {
  return { W: Math.round(BOARD_W * u), H: Math.round(BOARD_D * u) };
}

// Mặt bàn cờ: 1 ô = u pixel. Dòng trên cùng là hàng 0 (đầu Đen, phía xa).
export function paintBoard(ctx, u = 160) {
  const { W, H } = boardSize(u);
  paintWood(ctx, W, H, PAL.boardBase, PAL.boardGrain, 11, 360);

  const gx = (c) => u * (GRID_MARGIN + c);
  const gy = (r) => u * (GRID_MARGIN + r);
  ctx.strokeStyle = PAL.line;
  ctx.fillStyle = PAL.line;
  ctx.lineCap = 'round';

  ctx.lineWidth = u * 0.045;
  const pad = u * 0.2;
  ctx.strokeRect(gx(0) - pad, gy(0) - pad, gx(8) - gx(0) + pad * 2, gy(9) - gy(0) + pad * 2);

  ctx.lineWidth = u * 0.026;
  ctx.beginPath();
  for (let r = 0; r < 10; r++) {
    ctx.moveTo(gx(0), gy(r));
    ctx.lineTo(gx(8), gy(r));
  }
  for (let c = 0; c < 9; c++) {
    if (c === 0 || c === 8) {
      ctx.moveTo(gx(c), gy(0));
      ctx.lineTo(gx(c), gy(9));
    } else {
      ctx.moveTo(gx(c), gy(0));
      ctx.lineTo(gx(c), gy(4));
      ctx.moveTo(gx(c), gy(5));
      ctx.lineTo(gx(c), gy(9));
    }
  }
  ctx.moveTo(gx(3), gy(0));
  ctx.lineTo(gx(5), gy(2));
  ctx.moveTo(gx(5), gy(0));
  ctx.lineTo(gx(3), gy(2));
  ctx.moveTo(gx(3), gy(7));
  ctx.lineTo(gx(5), gy(9));
  ctx.moveTo(gx(5), gy(7));
  ctx.lineTo(gx(3), gy(9));
  ctx.stroke();

  const gap = u * 0.07;
  const len = u * 0.17;
  const mark = (r, c) => {
    ctx.beginPath();
    for (const dx of [-1, 1]) {
      for (const dy of [-1, 1]) {
        if (c === 0 && dx === -1) continue;
        if (c === 8 && dx === 1) continue;
        const x = gx(c);
        const y = gy(r);
        ctx.moveTo(x + dx * gap, y + dy * (gap + len));
        ctx.lineTo(x + dx * gap, y + dy * gap);
        ctx.lineTo(x + dx * (gap + len), y + dy * gap);
      }
    }
    ctx.stroke();
  };
  for (const [r, c] of [[2, 1], [2, 7], [7, 1], [7, 7]]) mark(r, c);
  for (const r of [3, 6]) for (const c of [0, 2, 4, 6, 8]) mark(r, c);

  ctx.font = `bold ${Math.round(u * 0.52)}px ${CJK_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.9;
  const riverY = (gy(4) + gy(5)) / 2;
  ctx.fillText('楚  河', gx(2), riverY);
  ctx.fillText('漢  界', gx(6), riverY);
  ctx.globalAlpha = 1;
  return { W, H };
}

// Mặt quân: đĩa tròn đường kính size, tâm ở giữa canvas. Chữ luôn xuôi.
export function paintPiece(ctx, ch, size = 512) {
  const isRed = ch === ch.toUpperCase();
  const color = isRed ? PAL.red : PAL.black;
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(size / 256, size / 256);

  ctx.fillStyle = PAL.face;
  ctx.beginPath();
  ctx.arc(0, 0, 128, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(0, 0, 114, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, 0, 103, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.font = `bold 148px ${CJK_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(CHARS[ch], 0, 8);
  ctx.strokeText(CHARS[ch], 0, 8);
  ctx.restore();
}
