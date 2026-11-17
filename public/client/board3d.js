// Cảnh 3D bàn cờ tướng: bàn, quân, ánh sáng, camera góc "ngồi đánh cờ", hiệu ứng.
// Module này chỉ lo phần hiển thị; luật cờ nằm ở shared/xiangqi.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { rowOf, colOf } from '../shared/xiangqi.js';
import { BOARD_W, BOARD_D, BOARD_H, cellToWorld, worldToCell, fitDistance } from './geometry.js';
import { makeBoardTexture, makeTableTexture, pieceTexture } from './textures.js';

const SEAT_POLAR = (33 * Math.PI) / 180; // góc từ phương thẳng đứng: nhìn xiên ~57 độ so với mặt bàn
const TOP_POLAR = 0.14;
const TARGET = new THREE.Vector3(0, 0, 0.3);
const PIECE_H = 0.28;
const MARK_Y = 0.012;

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

export function createView(container) {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b130c);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

  // ---------- ánh sáng ----------
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x5a3d22, 0.85));
  const key = new THREE.DirectionalLight(0xfff0d8, 1.7);
  key.position.set(4, 13, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(coarse ? 1024 : 2048, coarse ? 1024 : 2048);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 32 });
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
    new THREE.MeshStandardMaterial({ color: 0xb47e3e, roughness: 0.7 })
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
    [0.001, 0], [0.4, 0], [0.44, 0.03], [0.45, 0.06],
    [0.45, 0.22], [0.43, 0.26], [0.39, PIECE_H], [0.001, PIECE_H],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const latheGeo = new THREE.LatheGeometry(profile, 40);
  const discGeo = new THREE.CircleGeometry(0.375, 40).rotateX(-Math.PI / 2);
  const sideMat = new THREE.MeshStandardMaterial({
    color: 0xd2a566,
    roughness: 0.55,
    side: THREE.DoubleSide,
  });
  const topMats = new Map();

  const pieceGroup = new THREE.Group();
  boardGroup.add(pieceGroup);
  const meshes = new Array(90).fill(null);

  function createPiece(ch) {
    if (!topMats.has(ch)) {
      topMats.set(
        ch,
        new THREE.MeshStandardMaterial({ map: pieceTexture(ch, renderer), roughness: 0.5 })
      );
    }
    const g = new THREE.Group();
    const side = new THREE.Mesh(latheGeo, sideMat);
    side.castShadow = true;
    side.receiveShadow = true;
    const top = new THREE.Mesh(discGeo, topMats.get(ch));
    top.position.y = PIECE_H + 0.001;
    g.add(side, top);
    return g;
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
  const selRingGeo = ringGeo(0.47, 0.58);
  const capRingGeo = ringGeo(0.42, 0.54);
  const lastRingGeo = ringGeo(0.48, 0.53);
  const dotGeo = new THREE.CircleGeometry(0.16, 24).rotateX(-Math.PI / 2);
  const greenMat = basic(0x2e9e6b, 0.9);
  const dotMat = basic(0x2e9e6b, 0.75);
  const redMat = basic(0xd8332a, 0.9);
  const yellowMat = basic(0xf5c542, 0.8);
  const checkMat = basic(0xd8332a, 0.8);

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
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = 1.3;
  controls.minAzimuthAngle = -0.9;
  controls.maxAzimuthAngle = 0.9;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.target.copy(TARGET);

  function cameraPosition(polar, scale = 1) {
    const d = fitDistance(camera.aspect, camera.fov) * scale;
    return new THREE.Vector3(
      TARGET.x,
      TARGET.y + d * Math.cos(polar),
      TARGET.z + d * Math.sin(polar)
    );
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
    const d = fitDistance(camera.aspect, camera.fov);
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

  function sync(board) {
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
      m.position.y = 0.16;
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
        mesh.position.y = startY * (1 - e) + 0.5 * Math.sin(Math.PI * e);
      },
      () => {
        mesh.position.set(b.x, 0, b.z);
        if (captured) pieceGroup.remove(captured);
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
  function frame(now) {
    requestAnimationFrame(frame);
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
    for (const p of pieceGroup.children) p.children[1].rotation.y = -boardGroup.rotation.y;
    controls.update();
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', resize);
  setQuality(false);
  resize();
  requestAnimationFrame(frame);

  return {
    domElement: renderer.domElement,
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
  };
}
