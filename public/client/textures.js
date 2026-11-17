// Texture vẽ bằng canvas: không cần tải file ảnh nên trang vào nhanh.

import * as THREE from 'three';
import { CHARS } from '../shared/xiangqi.js';

const CJK_FONT =
  '"KaiTi","STKaiti","Kaiti TC","Noto Serif CJK TC","Noto Serif TC","PMingLiU","Songti TC","SimSun",serif';

// Bộ sinh số ngẫu nhiên có hạt giống: vân gỗ luôn giống nhau giữa các lần tải.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function paintWood(ctx, w, h, base, grain, seed, strokes) {
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

function finish(canvas, renderer) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

export function makeTableTexture(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  paintWood(canvas.getContext('2d'), 512, 512, '#5b3b22', 'rgba(30,16,6,A)', 7, 120);
  const tex = finish(canvas, renderer);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 7);
  return tex;
}

// Mặt bàn cờ: 1 ô = u pixel. Dòng trên cùng của canvas là hàng 0 (đầu Đen, phía xa).
export function makeBoardTexture(renderer) {
  const u = 160;
  const W = Math.round(9.6 * u);
  const H = Math.round(10.6 * u);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  paintWood(ctx, W, H, '#d3a45e', 'rgba(110,68,22,A)', 11, 360);

  const gx = (c) => u * (0.8 + c);
  const gy = (r) => u * (0.8 + r);
  const ink = '#3a2210';
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';

  // viền ngoài
  ctx.lineWidth = u * 0.04;
  const pad = u * 0.2;
  ctx.strokeRect(gx(0) - pad, gy(0) - pad, gx(8) - gx(0) + pad * 2, gy(9) - gy(0) + pad * 2);

  // lưới
  ctx.lineWidth = u * 0.022;
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
  // hai cung
  ctx.moveTo(gx(3), gy(0));
  ctx.lineTo(gx(5), gy(2));
  ctx.moveTo(gx(5), gy(0));
  ctx.lineTo(gx(3), gy(2));
  ctx.moveTo(gx(3), gy(7));
  ctx.lineTo(gx(5), gy(9));
  ctx.moveTo(gx(5), gy(7));
  ctx.lineTo(gx(3), gy(9));
  ctx.stroke();

  // dấu vị trí pháo và tốt
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

  // sông
  ctx.font = `bold ${Math.round(u * 0.52)}px ${CJK_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 0.85;
  const riverY = (gy(4) + gy(5)) / 2;
  ctx.fillText('楚  河', gx(2), riverY);
  ctx.fillText('漢  界', gx(6), riverY);
  ctx.globalAlpha = 1;

  return finish(canvas, renderer);
}

// Mặt trên quân cờ. Chữ luôn vẽ xuôi; board3d.js tự xoay mặt quân ngược lại khi lật bàn
// để chữ luôn xuôi với người đang nhìn.
const pieceCache = new Map();
export function pieceTexture(ch, renderer) {
  if (pieceCache.has(ch)) return pieceCache.get(ch);
  const size = 512; // vẽ ở 512px nhưng tính toạ độ theo hệ 256px cho dễ chỉnh
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const isRed = ch === ch.toUpperCase();
  const color = isRed ? '#a8160f' : '#0d0d0d';

  ctx.translate(size / 2, size / 2);
  ctx.scale(size / 256, size / 256);

  ctx.fillStyle = '#f8ebc9';
  ctx.beginPath();
  ctx.arc(0, 0, 128, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(0, 0, 114, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 104, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5; // viền cùng màu làm nét chữ đậm hơn
  ctx.font = `bold 144px ${CJK_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(CHARS[ch], 0, 8);
  ctx.strokeText(CHARS[ch], 0, 8);

  const tex = finish(canvas, renderer);
  pieceCache.set(ch, tex);
  return tex;
}
