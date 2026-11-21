// 输入与相机：上帝视角（平移/旋转/缩放）与第一人称（WASD + 鼠标，触屏摇杆）
TD.input = (() => {
  let el, cam;
  const god = { tx: 0, tz: 0, dist: 12, yaw: 0.55, pitch: 0.95, gtx: 0, gtz: 0, gdist: 12, gyaw: 0.55, gpitch: 0.95, bw: 8, bh: 6, minD: 3, maxD: 30 };
  const fp = { x: 0, z: 0, yaw: 0, pitch: -0.08, eye: 0.4, gy: 0.2, bob: 0, set: false };
  let mode = 'god';
  let leftAction = 'pan'; // pan | paint
  let handTool = false;
  let enabled = true;
  const keys = new Set();
  const cb = {};
  const ptrs = new Map();
  let drag = null, gesture = null, suppressTap = false;
  let joy = null, look = null;
  const joyVec = { x: 0, y: 0 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now();
  const isTyping = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

  function init(canvas, camera) {
    el = canvas; cam = camera;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !ptrs.size && cb.hover) cb.hover(null); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', (e) => { if (!isTyping(e.target)) keys.add(e.code); });
    window.addEventListener('keyup', (e) => keys.delete(e.code));
    window.addEventListener('blur', () => keys.clear());
    document.addEventListener('mousemove', (e) => {
      if (mode === 'fp' && document.pointerLockElement === el) {
        fp.yaw -= e.movementX * 0.0022;
        fp.pitch = clamp(fp.pitch - e.movementY * 0.0022, -1.35, 1.35);
      }
    });
    document.addEventListener('pointerlockchange', () => cb.lockChange && cb.lockChange(document.pointerLockElement === el));
  }

  // ---------- 指针 ----------
  function onDown(e) {
    if (!enabled) return;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* 有些浏览器不支持 */ }
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: now(), type: e.pointerType, button: e.button, moved: false };
    ptrs.set(e.pointerId, p);
    if (mode === 'fp') return fpDown(p, e);
    const painting = leftAction === 'paint' && !handTool && !keys.has('Space');
    if (e.pointerType === 'touch') {
      if (ptrs.size === 2) {
        if (drag && drag.kind === 'paint' && drag.started && cb.paint) cb.paint('end');
        drag = null;
        startGesture();
      } else if (ptrs.size === 1) {
        drag = { kind: painting ? 'paint' : 'pan', id: e.pointerId, started: false };
      }
      return;
    }
    if (e.button === 0) {
      drag = { kind: painting ? 'paint' : 'pan', id: e.pointerId, started: false };
      if (drag.kind === 'paint') { drag.started = true; cb.paint && cb.paint('start', p.x, p.y, false); }
    } else if (e.button === 2) {
      // 编辑器里右键 = 擦除；对战里右键 = 旋转视角
      if (leftAction === 'paint') { drag = { kind: 'paint', id: e.pointerId, started: true, erase: true }; cb.paint && cb.paint('start', p.x, p.y, true); }
      else drag = { kind: 'rot', id: e.pointerId };
    } else if (e.button === 1) drag = { kind: 'pan', id: e.pointerId };
  }

  function onMove(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse' && mode === 'god' && cb.hover) cb.hover(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 7) p.moved = true;
    if (mode === 'fp') return fpMove(p, dx, dy);
    if (gesture) return updateGesture();
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.kind === 'pan') panBy(dx, dy);
    else if (drag.kind === 'rot') {
      god.gyaw -= dx * 0.008;
      god.gpitch = clamp(god.gpitch + dy * 0.005, 0.4, 1.45);
    } else if (drag.kind === 'paint') {
      if (!drag.started && p.moved) { drag.started = true; cb.paint && cb.paint('start', p.sx, p.sy, false); }
      if (drag.started && cb.paint) cb.paint('move', p.x, p.y);
    }
    if (e.pointerType === 'mouse' && cb.hover) cb.hover(e.clientX, e.clientY);
  }

  function onUp(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    if (mode === 'fp') return fpUp(p, e);
    const quick = !p.moved && now() - p.t < 600 && e.type === 'pointerup';
    if (gesture) {
      if (ptrs.size < 2) { gesture = null; drag = null; suppressTap = true; }
      if (!ptrs.size) suppressTap = false;
      return;
    }
    if (drag && drag.id === e.pointerId) {
      if (drag.kind === 'paint') {
        if (!drag.started && quick && cb.paint) { cb.paint('start', p.x, p.y, false); drag.started = true; }
        if (drag.started && cb.paint) cb.paint('end');
      } else if (quick && !suppressTap && (p.button === 0 || p.type === 'touch') && cb.tap) cb.tap(p.x, p.y);
      drag = null;
    }
    if (!ptrs.size) suppressTap = false;
  }

  function startGesture() {
    const [a, b] = [...ptrs.values()];
    gesture = { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  function updateGesture() {
    const [a, b] = [...ptrs.values()];
    if (!a || !b) return;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const d = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    panBy(mx - gesture.mx, my - gesture.my);
    if (d > 10 && gesture.d > 10) god.gdist = clamp(god.gdist * gesture.d / d, god.minD, god.maxD);
    let da = ang - gesture.ang;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    god.gyaw += da;
    Object.assign(gesture, { mx, my, d, ang });
  }

  function panBy(dx, dy) {
    const wpp = 2 * god.dist * Math.tan(cam.fov * Math.PI / 360) / Math.max(1, el.clientHeight);
    const c = Math.cos(god.yaw), s = Math.sin(god.yaw), k = wpp / Math.max(0.5, Math.sin(god.pitch));
    god.gtx += -c * dx * wpp - s * dy * k;
    god.gtz += s * dx * wpp - c * dy * k;
    clampTarget();
  }
  function clampTarget() {
    god.gtx = clamp(god.gtx, -god.bw / 2 - 1, god.bw / 2 + 1);
    god.gtz = clamp(god.gtz, -god.bh / 2 - 1, god.bh / 2 + 1);
  }

  function onWheel(e) {
    e.preventDefault();
    if (mode !== 'god' || !enabled) return;
    // 触控板：捏合带 ctrlKey → 缩放；双指滑动（有横向量或增量很小）→ 平移。鼠标滚轮 → 缩放
    if (e.ctrlKey) { god.gdist = clamp(god.gdist * Math.exp(e.deltaY * 0.012), god.minD, god.maxD); return; }
    const pad = e.deltaMode === 0 && (e.deltaX !== 0 || Math.abs(e.deltaY) < 40);
    if (pad) { panBy(-e.deltaX, -e.deltaY); return; }
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    god.gdist = clamp(god.gdist * Math.exp(dy * 0.0016), god.minD, god.maxD);
  }

  // ---------- 第一人称 ----------
  function fpDown(p, e) {
    if (p.type === 'mouse') {
      if (document.pointerLockElement !== el) {
        p.lockClick = true;
        if (cb.fpCanLock && !cb.fpCanLock()) return;
        try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* 拒绝也无所谓 */ }
        return;
      }
      if (e.button === 0 && cb.fpUse) cb.fpUse(null);
      return;
    }
    if (p.x < window.innerWidth * 0.42 && !joy) {
      joy = { id: p.id, ox: p.x, oy: p.y };
      cb.joy && cb.joy(true, p.x, p.y, 0, 0);
    } else if (!look) look = { id: p.id };
  }
  function fpMove(p, dx, dy) {
    if (p.type === 'mouse') return;
    if (joy && joy.id === p.id) {
      let vx = (p.x - joy.ox) / 55, vy = (p.y - joy.oy) / 55;
      const l = Math.hypot(vx, vy);
      if (l > 1) { vx /= l; vy /= l; }
      joyVec.x = vx; joyVec.y = vy;
      cb.joy && cb.joy(true, joy.ox, joy.oy, vx, vy);
    } else if (look && look.id === p.id) {
      fp.yaw -= dx * 0.006;
      fp.pitch = clamp(fp.pitch - dy * 0.006, -1.35, 1.35);
    }
  }
  function fpUp(p, e) {
    const quick = !p.moved && now() - p.t < 450 && e.type === 'pointerup';
    if (joy && joy.id === p.id) { joy = null; joyVec.x = joyVec.y = 0; cb.joy && cb.joy(false); }
    if (look && look.id === p.id) look = null;
    if (p.type === 'touch' && quick && cb.fpUse) cb.fpUse({ x: p.x, y: p.y });
  }

  function setMode(m) {
    if (m === mode) return;
    if (m === 'fp') {
      if (!fp.set && cb.fpSpawn) Object.assign(fp, cb.fpSpawn(), { set: true });
      cam.fov = 72;
    } else {
      if (document.pointerLockElement === el) document.exitPointerLock();
      god.gtx = fp.x; god.gtz = fp.z; clampTarget();
      cam.fov = 50;
      joy = look = null; joyVec.x = joyVec.y = 0;
      cb.joy && cb.joy(false);
    }
    cam.updateProjectionMatrix();
    mode = m;
  }

  // 让上帝视角框住整张地图
  function frameMap(w, h, instant = true) {
    god.bw = w; god.bh = h;
    const aspect = window.innerWidth / window.innerHeight;
    // 竖屏时把镜头转 90°，让地图长边顺着屏幕竖向
    const portrait = aspect < 0.9 && w > h;
    const fw = portrait ? h : w, fh = portrait ? w : h;
    const need = Math.max(fh * 1.25, (fw * 1.3) / aspect) / 2 / Math.tan(25 * Math.PI / 180);
    god.maxD = Math.max(need * 1.6, 12);
    god.gdist = clamp(need, god.minD, god.maxD);
    god.gtx = portrait ? 0.3 : 0; god.gtz = portrait ? 0 : 0.3; god.gyaw = portrait ? Math.PI / 2 : 0; god.gpitch = 0.98;
    if (instant) Object.assign(god, { tx: god.gtx, tz: god.gtz, dist: god.gdist, yaw: god.gyaw, pitch: god.gpitch });
    fp.set = false;
  }

  function update(dt) {
    if (mode === 'god') {
      const k = Math.min(1, dt * 12);
      if (enabled) {
        const sp = 0.9 * god.dist * dt;
        const c = Math.cos(god.yaw), s = Math.sin(god.yaw);
        let f = 0, r = 0;
        if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) r += 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) r -= 1;
        if (f || r) { god.gtx += (-s * f + c * r) * sp; god.gtz += (-c * f - s * r) * sp; clampTarget(); }
        if (keys.has('KeyQ')) god.gyaw += dt * 1.6;
        if (keys.has('KeyE')) god.gyaw -= dt * 1.6;
        if (keys.has('Equal') || keys.has('NumpadAdd')) god.gdist = clamp(god.gdist * (1 - dt * 1.5), god.minD, god.maxD);
        if (keys.has('Minus') || keys.has('NumpadSubtract')) god.gdist = clamp(god.gdist * (1 + dt * 1.5), god.minD, god.maxD);
      }
      god.tx += (god.gtx - god.tx) * k; god.tz += (god.gtz - god.tz) * k;
      god.dist += (god.gdist - god.dist) * k; god.yaw += (god.gyaw - god.yaw) * k; god.pitch += (god.gpitch - god.pitch) * k;
      const cp = Math.cos(god.pitch);
      cam.position.set(god.tx + god.dist * cp * Math.sin(god.yaw), 0.2 + god.dist * Math.sin(god.pitch), god.tz + god.dist * cp * Math.cos(god.yaw));
      cam.lookAt(god.tx, 0.2, god.tz);
    } else {
      let f = 0, r = 0;
      if (enabled) {
        if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) r += 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) r -= 1;
        f -= joyVec.y; r += joyVec.x;
      }
      const l = Math.hypot(f, r);
      if (l > 1) { f /= l; r /= l; }
      const run = keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(joyVec.x, joyVec.y) > 0.95;
      const sp = (run ? 3.2 : 1.7) * dt;
      const s = Math.sin(fp.yaw), c = Math.cos(fp.yaw);
      const dx = (-s * f + c * r) * sp, dz = (-c * f - s * r) * sp;
      const blocked = cb.blocked || (() => false);
      if (dx && !blocked(fp.x + dx, fp.z)) fp.x += dx;
      if (dz && !blocked(fp.x, fp.z + dz)) fp.z += dz;
      const gy = cb.groundY ? cb.groundY(fp.x, fp.z) : 0.2;
      fp.gy += (gy - fp.gy) * Math.min(1, dt * 10);
      if (l > 0.05) fp.bob += dt * (run ? 13 : 9); else fp.bob *= 0.9;
      cam.position.set(fp.x, fp.gy + fp.eye + Math.sin(fp.bob) * 0.012, fp.z);
      cam.rotation.set(fp.pitch, fp.yaw, 0);
    }
  }

  return {
    init, update, setMode, frameMap, panBy,
    on(name, fn) { cb[name] = fn; },
    setLeft(a) { leftAction = a; },
    setHand(v) { handTool = v; },
    setEnabled(v) { enabled = v; if (!v) { drag = null; gesture = null; ptrs.clear(); } },
    rotate(d) { god.gyaw += d; },
    zoom(f) { god.gdist = clamp(god.gdist * f, god.minD, god.maxD); },
    lockPointer() { try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } },
    unlockPointer() { if (document.pointerLockElement === el) document.exitPointerLock(); },
    get locked() { return document.pointerLockElement === el; },
    get mode() { return mode; }, god, fp, keys,
  };
})();
