// Cảnh 3D bàn cờ tướng: bàn, quân, khay quân bị ăn, ánh sáng, camera góc "ngồi đánh cờ", hiệu ứng.
// Module này chỉ lo phần hiển thị; luật cờ nằm ở shared/xiangqi.js.
//
// Giao diện view dùng chung với board2d.js: sync(board, tray), select, setLastMove, setCheck, animateMove,
// setFlipped, pickCell, resetCamera, topView, setQuality, setRotateEnabled, dispose; onSlow, onContextLost.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { rowOf, colOf } from '../shared/xiangqi.js';
import { BOARD_W, BOARD_D, BOARD_H, cellToWorld, worldToCell, fitDistance } from './geometry.js';
import { makeBoardTexture, makeTableTexture, makeTrayTexture, pieceTexture, clearPieceTextures } from './textures.js';
import { PAL } from './palette.js';
import { TRAY_SCALE, layoutFor, traySlot, trayBase } from './tray.js';

const SEAT_POLAR = (33 * Math.PI) / 180; // nhìn xiên ~57 độ so với mặt bàn
const TOP_POLAR = 0.14;
const TARGET = new THREE.Vector3(0, 0, 0.3);
const PIECE_H = 0.34;
const PIECE_R = 0.475;
const FACE_R = 0.41;
const TRAY_H = 0.08;
const MARK_Y = 0.012;

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

export function createView(container) {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.background);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

  // ---------- ánh sáng ----------
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a3d22, 0.72));
  const key = new THREE.DirectionalLight(0xfff0d8, 1.45);
  key.position.set(4, 13, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 32 });
  key.shadow.bias = -0.0004;
  scene.add(key);

  // ---------- bàn và mặt bàn cờ ----------
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ map: makeTableTexture(renderer), roughness: 0.85 })
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = -BOARD_H;
  table.receiveShadow = true;
  scene.add(table);

  const boardGroup = new THREE.Group();
  scene.add(boardGroup);

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(BOARD_W, BOARD_H, BOARD_D),
    new THREE.MeshStandardMaterial({ color: PAL.slab, roughness: 0.7 })
  );
  slab.position.y = -BOARD_H / 2;
  slab.castShadow = true;
  slab.receiveShadow = true;
  boardGroup.add(slab);

  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD_W, BOARD_D),
    new THREE.MeshStandardMaterial({ map: makeBoardTexture(renderer), roughness: 0.6 })
  );
  face.rotation.x = -Math.PI / 2;
  face.position.y = 0.002;
  face.receiveShadow = true;
  boardGroup.add(face);

  // ---------- quân cờ ----------
  const profile = [
    [0.001, 0], [PIECE_R - 0.06, 0], [PIECE_R - 0.02, 0.035], [PIECE_R, 0.07],
    [PIECE_R, PIECE_H - 0.07], [PIECE_R - 0.025, PIECE_H - 0.03], [PIECE_R - 0.07, PIECE_H], [0.001, PIECE_H],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const latheGeo = new THREE.LatheGeometry(profile, 40);
  const discGeo = new THREE.CircleGeometry(FACE_R, 40).rotateX(-Math.PI / 2);
  const sideMat = new THREE.MeshStandardMaterial({ color: PAL.side, roughness: 0.55, side: THREE.DoubleSide });
  const topMats = new Map();

  const pieceGroup = new THREE.Group();
  boardGroup.add(pieceGroup);
  const trayGroup = new THREE.Group();
  boardGroup.add(trayGroup);
  const meshes = new Array(90).fill(null);

  function createPiece(ch, scale = 1) {
    if (!topMats.has(ch)) {
      topMats.set(ch, new THREE.MeshStandardMaterial({ map: pieceTexture(ch, renderer), roughness: 0.5 }));
    }
    const g = new THREE.Group();
    const side = new THREE.Mesh(latheGeo, sideMat);
    side.castShadow = true;
    side.receiveShadow = true;
    const top = new THREE.Mesh(discGeo, topMats.get(ch));
    top.position.y = PIECE_H + 0.001;
    g.add(side, top);
    g.scale.setScalar(scale);
    g.userData.ch = ch;
    return g;
  }

  // ---------- khay quân bị ăn ----------
  const trayMat = new THREE.MeshStandardMaterial({ map: makeTrayTexture(renderer), roughness: 0.8 });
  const trayY = -BOARD_H + TRAY_H;
  let layout = 'tb';
  let insetTop = 0;
  let insetBottom = 0;
  let lastTray = { r: [], b: [] };
  let trayMeshes = { r: [], b: [] };

  function buildTrays(tray) {
    trayGroup.clear();
    trayMeshes = { r: [], b: [] };
    for (const side of ['r', 'b']) {
      const base = trayBase(side, layout);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(base.w, TRAY_H, base.d), trayMat);
      plate.position.set(base.cx, -BOARD_H + TRAY_H / 2, base.cz);
      plate.receiveShadow = true;
      trayGroup.add(plate);
      tray[side].forEach((ch, i) => {
        const p = createPiece(ch, TRAY_SCALE);
        const s = traySlot(side, i, layout);
        p.position.set(s.x, trayY, s.z);
        trayGroup.add(p);
        trayMeshes[side].push(p);
      });
    }
  }

  // ---------- dấu hiệu trên bàn ----------
  const overlay = new THREE.Group();
  boardGroup.add(overlay);
  const selectLayer = new THREE.Group();
  const lastLayer = new THREE.Group();
  const checkLayer = new THREE.Group();
  overlay.add(lastLayer, selectLayer, checkLayer);

  const ringGeo = (inner, outer) => new THREE.RingGeometry(inner, outer, 40).rotateX(-Math.PI / 2);
  const basic = (color, opacity) =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const selRingGeo = ringGeo(0.5, 0.62);
  const capRingGeo = ringGeo(0.45, 0.58);
  const lastRingGeo = ringGeo(0.51, 0.56);
  const dotGeo = new THREE.CircleGeometry(0.17, 24).rotateX(-Math.PI / 2);
  const greenMat = basic(0x2e9e6b, 0.95);
  const dotMat = basic(0x2e9e6b, 0.8);
  const redMat = basic(0xe8352b, 0.95);
  const yellowMat = basic(0xffd23f, 0.9);
  const checkMat = basic(0xe8352b, 0.8);

  function placeMark(group, geo, mat, idx) {
    const m = new THREE.Mesh(geo, mat);
    const { x, z } = cellToWorld(rowOf(idx), colOf(idx));
    m.position.set(x, MARK_Y, z);
    m.renderOrder = 2;
    group.add(m);
    return m;
  }

  // ---------- hiệu ứng (tween) ----------
  const tweens = [];
  function tween(duration, onUpdate, onDone) {
    tweens.push({ t0: performance.now(), duration, onUpdate, onDone });
  }

  // ---------- camera ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableRotate = false; // mặc định khóa; nút "Xoay" trên thanh nút mới bật
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.3;
  controls.minAzimuthAngle = -0.9;
  controls.maxAzimuthAngle = 0.9;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.target.copy(TARGET);

  function dist() {
    // khung hình hiệu dụng: phần không bị thanh nút che
    const w = Math.max(1, container.clientWidth);
    const availH = Math.max(80, Math.max(1, container.clientHeight) - insetTop - insetBottom);
    return fitDistance(w / availH, camera.fov, layout);
  }

  function cameraPosition(polar, scale = 1) {
    const d = dist() * scale;
    return new THREE.Vector3(TARGET.x, TARGET.y + d * Math.cos(polar), TARGET.z + d * Math.sin(polar));
  }

  function moveCamera(pos, animate) {
    controls.target.copy(TARGET);
    if (!animate) {
      camera.position.copy(pos);
      return;
    }
    const from = camera.position.clone();
    tween(550, (p) => camera.position.lerpVectors(from, pos, ease(p)));
  }

  function resetCamera(animate = true) {
    moveCamera(cameraPosition(SEAT_POLAR), animate);
  }

  function topView() {
    moveCamera(cameraPosition(TOP_POLAR, 0.92), true);
  }

  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const dy = (insetTop - insetBottom) / 2; // dời hình xuống để bàn nằm giữa vùng trống
    if (dy) camera.setViewOffset(w, h, 0, -dy, w, h);
    else camera.clearViewOffset();
    const next = layoutFor(w / Math.max(80, h - insetTop - insetBottom));
    if (next !== layout) {
      layout = next;
      buildTrays(lastTray);
    }
    const d = dist();
    controls.minDistance = d * 0.45;
    controls.maxDistance = d * 1.6;
    resetCamera(false);
  }

  // ---------- chất lượng ----------
  function setQuality(low) {
    renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !low;
    key.castShadow = !low;
    scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
  }

  // ---------- giao diện công khai ----------
  let selectedMesh = null;
  let pendingFlight = null; // quân vừa bị ăn, sẽ bay vào khay ở lần sync kế tiếp

  function sync(board, tray = { r: [], b: [] }) {
    pieceGroup.clear();
    meshes.fill(null);
    selectedMesh = null;
    for (let i = 0; i < 90; i++) {
      const ch = board[i];
      if (ch === '.') continue;
      const p = createPiece(ch);
      const { x, z } = cellToWorld(rowOf(i), colOf(i));
      p.position.set(x, 0, z);
      pieceGroup.add(p);
      meshes[i] = p;
    }
    lastTray = tray;
    buildTrays(tray);

    const fl = pendingFlight;
    pendingFlight = null;
    if (fl && performance.now() - fl.at < 1500) {
      const side = fl.ch === fl.ch.toUpperCase() ? 'r' : 'b';
      const slotMesh = trayMeshes[side][tray[side].length - 1];
      if (slotMesh && tray[side][tray[side].length - 1] === fl.ch) {
        slotMesh.visible = false;
        const end = slotMesh.position.clone();
        const flight = createPiece(fl.ch, 1);
        flight.position.set(fl.x, 0.25, fl.z);
        trayGroup.add(flight);
        tween(
          520,
          (p) => {
            const e = ease(p);
            flight.position.x = fl.x + (end.x - fl.x) * e;
            flight.position.z = fl.z + (end.z - fl.z) * e;
            flight.position.y = 0.25 + (end.y - 0.25) * e + 1.1 * Math.sin(Math.PI * e);
            flight.scale.setScalar(1 + (TRAY_SCALE - 1) * e);
          },
          () => {
            trayGroup.remove(flight);
            slotMesh.visible = true;
          }
        );
      }
    }
  }

  // idx: ô đang chọn (hoặc null); targets: [{ to, capture }]
  function select(idx, targets = []) {
    selectLayer.clear();
    if (selectedMesh) {
      selectedMesh.position.y = 0;
      selectedMesh = null;
    }
    if (idx === null || idx === undefined) return;
    placeMark(selectLayer, selRingGeo, greenMat, idx);
    const m = meshes[idx];
    if (m) {
      m.position.y = 0.2;
      selectedMesh = m;
    }
    for (const t of targets) {
      if (t.capture) placeMark(selectLayer, capRingGeo, redMat, t.to);
      else placeMark(selectLayer, dotGeo, dotMat, t.to);
    }
  }

  function setLastMove(from, to) {
    lastLayer.clear();
    if (from === null || from === undefined) return;
    placeMark(lastLayer, lastRingGeo, yellowMat, from);
    placeMark(lastLayer, lastRingGeo, yellowMat, to);
  }

  function setCheck(idx) {
    checkLayer.clear();
    if (idx === null || idx === undefined || idx < 0) return;
    placeMark(checkLayer, selRingGeo, checkMat, idx);
  }

  // Nhấc quân lên, trượt sang ô mới, đặt xuống rồi gọi onLand.
  function animateMove(from, to, onLand) {
    const mesh = meshes[from];
    if (!mesh) {
      onLand();
      return;
    }
    const captured = meshes[to];
    const capturedCh = captured ? captured.userData.ch : null;
    const a = cellToWorld(rowOf(from), colOf(from));
    const b = cellToWorld(rowOf(to), colOf(to));
    const startY = mesh.position.y;
    selectLayer.clear();
    selectedMesh = null;
    tween(
      340,
      (p) => {
        const e = ease(p);
        mesh.position.x = a.x + (b.x - a.x) * e;
        mesh.position.z = a.z + (b.z - a.z) * e;
        mesh.position.y = startY * (1 - e) + 0.55 * Math.sin(Math.PI * e);
      },
      () => {
        mesh.position.set(b.x, 0, b.z);
        if (captured) {
          pieceGroup.remove(captured);
          pendingFlight = { ch: capturedCh, x: b.x, z: b.z, at: performance.now() };
        }
        onLand();
      }
    );
  }

  function setFlipped(flag, animate = true) {
    const target = flag ? Math.PI : 0;
    if (!animate) {
      boardGroup.rotation.y = target;
      return;
    }
    const from = boardGroup.rotation.y;
    tween(650, (p) => {
      boardGroup.rotation.y = from + (target - from) * ease(p);
    });
  }

  // Ô cờ dưới điểm chạm (toạ độ màn hình), hoặc null.
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.2);
  const hit = new THREE.Vector3();
  function pickCell(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    boardGroup.updateMatrixWorld(true);
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    const local = boardGroup.worldToLocal(hit.clone());
    return worldToCell(local.x, local.z);
  }

  // ---------- vòng lặp vẽ ----------
  let alive = true;
  let prevNow = 0;
  let slowSum = 0;
  let slowCount = 0;
  let slowStrikes = 0;

  function watchFps(now) {
    const dt = now - prevNow;
    prevNow = now;
    if (dt <= 0 || dt > 400 || document.hidden) return; // bỏ qua lúc tab bị ẩn hoặc treo
    slowSum += dt;
    slowCount++;
    if (slowCount >= 90) {
      const avg = slowSum / slowCount;
      slowSum = 0;
      slowCount = 0;
      slowStrikes = avg > 42 ? slowStrikes + 1 : 0; // dưới ~24 fps ba lần liên tiếp
      if (slowStrikes >= 3) {
        slowStrikes = 0;
        if (view.onSlow) view.onSlow();
      }
    }
  }

  function frame(now) {
    if (!alive) return;
    requestAnimationFrame(frame);
    watchFps(now);
    for (const tw of tweens.slice()) {
      const p = Math.min(1, (now - tw.t0) / tw.duration);
      tw.onUpdate(p);
      if (p >= 1) {
        tweens.splice(tweens.indexOf(tw), 1);
        if (tw.onDone) tw.onDone();
      }
    }
    checkMat.opacity = 0.55 + 0.35 * Math.sin(now / 180);
    // Giữ chữ trên mặt quân luôn xuôi với camera, kể cả khi bàn đang lật.
    const r = -boardGroup.rotation.y;
    for (const p of pieceGroup.children) p.children[1].rotation.y = r;
    for (const p of trayGroup.children) if (p.children.length === 2) p.children[1].rotation.y = r;
    controls.update();
    renderer.render(scene, camera);
  }

  const onContextLost = (e) => {
    e.preventDefault();
    if (view.onContextLost) view.onContextLost();
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  window.addEventListener('resize', resize);

  function dispose() {
    alive = false;
    window.removeEventListener('resize', resize);
    renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    controls.dispose();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    clearPieceTextures();
    renderer.dispose();
    try {
      renderer.forceContextLoss();
    } catch (_) {
      /* bỏ qua */
    }
    renderer.domElement.remove();
  }

  setQuality(false);
  resize();
  requestAnimationFrame(frame);

  const view = {
    kind: '3d',
    domElement: renderer.domElement,
    onSlow: null,
    onContextLost: null,
    sync,
    select,
    setLastMove,
    setCheck,
    animateMove,
    setFlipped,
    pickCell,
    resetCamera: () => resetCamera(true),
    topView,
    setQuality,
    setInsets(top, bottom) {
      insetTop = Math.max(0, top | 0);
      insetBottom = Math.max(0, bottom | 0);
      resize();
    },
    setRotateEnabled: (flag) => {
      controls.enableRotate = !!flag;
    },
    dispose,
  };
  return view;
}

