// 对战：波次、飞碟沿路线移动、塔位建塔/升级/出售、弹道、特效、HUD
TD.game = (() => {
  const C = TD.C, TW = TD.TOWERS, EN = TD.ENEMIES;
  const $ = (id) => document.getElementById(id);
  let S = null, root = null;
  const tp = { x: 0, z: 0, dx: 0, dz: 0 };
  const _box = new THREE.Box3(), _v = new THREE.Vector3();
  const FP_REACH = 5.5;

  // ---------- 开局 / 收尾 ----------
  function start(map, opts = {}) {
    const an = TD.maps.analyze(map);
    if (!an.ok) { TD.ui.toast(an.errors[0]); return false; }
    stop();
    root = new THREE.Group();
    TD.world.scene.add(root);
    S = {
      map, an, opts, curves: an.routes.map((r) => TD.maps.curve(map, r)),
      gold: map.gold || 220, lives: map.lives || 20, maxLives: map.lives || 20, wave: 0, total: map.waves || 15,
      running: false, queue: [], waveT: 0, rr: 0, enemies: [], dying: [], towers: new Map(), pads: new Map(), projs: [], fx: [], preview: null,
      speed: 1, paused: false, time: 0, over: false, sel: -1, aim: null, kills: 0, auto: false, autoT: 0, leaks: 0,
    };
    TD.world.setSky(map.sky);
    TD.world.buildMap(map);
    TD.input.setMode('god');
    TD.input.setLeft('pan');
    TD.input.frameMap(map.w, map.h);
    TD.input.on('tap', onTap);
    TD.input.on('hover', onHover);
    TD.input.on('paint', null);
    TD.input.on('fpUse', onFpUse);
    TD.input.on('fpSpawn', fpSpawn);
    TD.input.on('fpCanLock', () => { if (!S || S.over) return false; closePanel(); return true; });
    TD.input.on('blocked', blocked);
    TD.input.on('groundY', groundY);
    $('autoNext').checked = false;
    closePanel();
    setView('god');
    updateHUD();
    return true;
  }

  function stop() {
    if (root) { TD.world.scene.remove(root); root = null; }
    TD.world.setRange(null); TD.world.setSel(null); TD.world.setHover(null);
    TD.input.setMode('god');
    TD.input.on('fpUse', null); TD.input.on('blocked', null); TD.input.on('groundY', null);
    S = null;
  }

  // ---------- 波次 ----------
  function startWave() {
    if (!S || S.running || S.over || S.wave >= S.total) return;
    S.wave++;
    const w = TD.waveDef(S.wave, S.total);
    S.queue = [];
    let t = 0;
    for (const g of w.groups) {
      for (let k = 0; k < g.count; k++) { S.queue.push({ t, type: g.type, hpMul: w.hpMul, ri: S.rr++ }); t += g.gap; }
      t += 1.2;
    }
    S.waveT = 0;
    S.running = true;
    S.autoT = 0;
    if (S.sel >= 0) openPanel(S.sel);
    updateHUD();
  }

  function waveSummary(n) {
    const w = TD.waveDef(n, S.total);
    return w.groups.map((g) => `<span class="wv"><img src="${EN[g.type].icon}" alt="">${EN[g.type].name}×${g.count}</span>`).join('');
  }

  // ---------- 敌人 ----------
  function spawnEnemy(q) {
    const d = EN[q.type];
    const curve = S.curves[q.ri % S.curves.length];
    const g = new THREE.Group();
    const model = TD.assets.castOnly(TD.assets.clone(d.model));
    const mats = [];
    model.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); mats.push(o.material); } });
    model.scale.setScalar(d.scale);
    g.add(model);
    root.add(g);
    const bar = makeBar(d.scale);
    root.add(bar.group);
    const hp = Math.round(d.hp * q.hpMul);
    const e = { type: q.type, def: d, hp, maxHp: hp, s: 0, curve, slow: 0, spd: d.speed, g, model, mats, bar, flash: 0, alive: true, x: 0, y: 0, z: 0, phase: Math.random() * 6, born: 0 };
    TD.maps.pos(curve, 0, tp);
    e.x = tp.x; e.z = tp.z; e.y = 0.1 + d.hover;
    S.enemies.push(e);
  }

  function makeBar(scale) {
    const group = new THREE.Group();
    const w = 0.42 + scale * 0.25;
    const back = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x1b1d2b, depthWrite: false, transparent: true, opacity: 0.85 }));
    const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x5be37d, depthWrite: false }));
    back.center.set(0, 0.5); fg.center.set(0, 0.5);
    back.scale.set(w, 0.07, 1); fg.scale.set(w - 0.03, 0.04, 1);
    fg.position.x = 0; // 实际偏移每帧按相机右向量算
    back.renderOrder = 10; fg.renderOrder = 11;
    group.add(back, fg);
    group.visible = false;
    return { group, back, fg, w };
  }

  function damage(e, amount, pierceArmor) {
    if (!e.alive) return;
    const real = pierceArmor ? amount : Math.max(1, amount - e.def.armor);
    e.hp -= real;
    e.flash = 0.09;
    if (e.hp <= 0) kill(e);
  }

  function kill(e) {
    e.alive = false;
    S.gold += e.def.reward;
    S.kills++;
    popup(e.x, e.y + 0.3, e.z, '+' + e.def.reward, 'gold');
    puff(e.x, e.y, e.z, 0xffd27a, 0.25 + e.def.scale * 0.3, 7);
    e.bar.group.visible = false;
    root.remove(e.bar.group);
    e.dieT = 0;
    S.dying.push(e);
    updateHUD();
  }

  function leak(e) {
    e.alive = false;
    root.remove(e.g); root.remove(e.bar.group);
    S.lives = Math.max(0, S.lives - e.def.dmg);
    S.leaks += e.def.dmg;
    TD.world.shakeCastles();
    flashScreen();
    popup(e.x, e.y + 0.6, e.z, '-' + e.def.dmg + '❤', 'hurt');
    updateHUD();
    if (S.lives <= 0) finish(false);
  }

  // ---------- 台子与塔 ----------
  // 草地上花钱建台子（plain / barrel），地图塔位 = 免费台子（slot）；塔只能放在台子上。
  const SC = TD.TOWER_SCALE, PD = TD.PADS;
  const pipGeo = new THREE.OctahedronGeometry(0.04);
  const pipMat = new THREE.MeshStandardMaterial({ color: 0xffc83a, emissive: 0x6a3d00, roughness: 0.35, metalness: 0.3 });
  const cellXZ = (i) => TD.maps.center(S.map, i % S.map.w, (i / S.map.w) | 0);
  function padKind(i) {
    const p = S.pads.get(i);
    if (p) return p.kind;
    return S.map.cells[i] === C.SLOT ? 'slot' : null;
  }
  // 叠放的东西都比下面的面高 TD.LIFT，避免两个面重合闪烁
  const slotTop = () => 0.2 + TD.LIFT + TD.assets.height('spawn-square');
  function padBase(i) { return S.map.cells[i] === C.SLOT ? slotTop() + TD.LIFT : 0.2 + TD.LIFT; }
  function padTop(i) {
    const k = padKind(i);
    return k === 'plain' || k === 'barrel' ? padBase(i) + TD.assets.height(PD[k].model) * SC : slotTop();
  }
  const canInteract = (i) => !!padKind(i) || S.map.cells[i] === C.GRASS;
  const fullRefund = () => S.wave === 0 && !S.running;
  const sellValue = (t) => (fullRefund() ? t.invested : Math.floor(t.invested * 0.7));
  const padValue = (p) => (fullRefund() ? p.paid : PD[p.kind].sell);

  // 这一格能建什么（面板卡片和数字快捷键共用这个顺序）
  function buildOptions(i) {
    const kind = padKind(i);
    if (!kind) return S.map.cells[i] === C.GRASS ? [{ pad: 'plain' }, { pad: 'barrel' }] : [];
    if (S.towers.has(i)) return [];
    const opts = TD.TOWER_ORDER.map((type) => ({ type }));
    if (kind === 'slot') opts.push({ pad: 'barrel' });
    return opts;
  }
  function doOption(i, o) {
    if (!o) return;
    if (o.pad) buildPad(i, o.pad); else build(i, o.type);
  }

  function buildPad(i, kind) {
    const d = PD[kind];
    if (!S || S.over || S.pads.has(i)) return;
    const cell = S.map.cells[i];
    if (cell !== C.GRASS && !(cell === C.SLOT && kind === 'barrel' && !S.towers.has(i))) return;
    if (S.gold < d.cost) { TD.ui.toast('金币不够'); return; }
    S.gold -= d.cost;
    const p = cellXZ(i);
    const pad = { i, c: i % S.map.w, r: (i / S.map.w) | 0, x: p.x, z: p.z, kind, paid: d.cost, kills: 0, cd: 0.5, aim: Math.random() * 6, recoil: 0, mode: 'first' };
    const g = new THREE.Group(), inner = new THREE.Group();
    pad.piece = TD.assets.castOnly(TD.assets.clone(d.model));
    pad.piece.rotation.y = pad.aim;
    inner.add(pad.piece);
    inner.scale.setScalar(SC);
    g.add(inner);
    pad.base = padBase(i);
    g.position.set(p.x, pad.base, p.z);
    root.add(g);
    pad.g = g;
    S.pads.set(i, pad);
    puff(p.x, 0.3, p.z, 0xffffff, 0.5, 8);
    updateHUD();
    afterAction(i, `${d.name}建好了`);
  }

  function weaponVisual(t) {
    const d = TW[t.type];
    const g = new THREE.Group(), inner = new THREE.Group();
    const w = TD.assets.castOnly(TD.assets.clone(d.weapon));
    inner.add(w);
    inner.scale.setScalar(SC);
    g.add(inner);
    // 等级用台面上的小金块表示，塔的高度不变
    for (let k = 0; k < t.level; k++) {
      const pip = new THREE.Mesh(pipGeo, pipMat);
      const a = Math.PI / 2 + (k - (t.level - 1) / 2) * 0.5;
      pip.position.set(Math.cos(a) * 0.27, 0.04, Math.sin(a) * 0.27);
      pip.castShadow = true;
      g.add(pip);
    }
    const base = padTop(t.i) + TD.LIFT;
    g.position.set(t.x, base, t.z);
    const wh = TD.assets.height(d.weapon);
    const moving = w.getObjectByName('barrel') || w.getObjectByName('arrow') || w.getObjectByName('catapult');
    if (moving) moving.userData.rest = { p: moving.position.clone(), r: moving.rotation.clone() };
    return { g, weapon: w, moving, muzzle: base + wh * 0.55 * SC, height: base - 0.2 + wh * SC };
  }

  function build(i, type) {
    const d = TW[type];
    if (!S || S.over || S.towers.has(i) || !padKind(i)) return;
    if (S.gold < d.cost) { TD.ui.toast('金币不够'); return; }
    S.gold -= d.cost;
    const p = cellXZ(i);
    const t = { i, c: i % S.map.w, r: (i / S.map.w) | 0, x: p.x, z: p.z, type, level: 1, cd: 0.3, mode: 'first', invested: d.cost, kills: 0, aim: Math.random() * 6, recoil: 0, pulse: 0 };
    setTowerVisual(t);
    S.towers.set(i, t);
    puff(p.x, t.v.muzzle, p.z, 0xffffff, 0.5, 8);
    updateHUD();
    afterAction(i, `${d.name} 建好了`);
  }

  // 第一人称锁着鼠标时点不到面板，就只飘个提示
  function afterAction(i, msg) {
    if (TD.input.mode === 'fp' && TD.input.locked) { closePanel(); TD.ui.toast(msg); }
    else openPanel(i);
  }

  function setTowerVisual(t) {
    if (t.v) root.remove(t.v.g);
    t.v = weaponVisual(t);
    t.v.weapon.rotation.y = t.aim;
    root.add(t.v.g);
  }

  function upgrade(i) {
    const t = S && S.towers.get(i);
    if (!t || t.level >= 3) return;
    const cost = TD.upgradeCost(t.type, t.level);
    if (S.gold < cost) { TD.ui.toast('金币不够'); return; }
    S.gold -= cost;
    t.invested += cost;
    t.level++;
    setTowerVisual(t);
    puff(t.x, t.v.muzzle, t.z, 0xfff2a0, 0.6, 10);
    updateHUD();
    afterAction(i, `${TW[t.type].name} 升到 Lv${t.level}`);
  }

  function sell(i) {
    const t = S && S.towers.get(i);
    if (!t) return;
    const back = sellValue(t);
    S.gold += back;
    root.remove(t.v.g);
    S.towers.delete(i);
    puff(t.x, t.v.muzzle, t.z, 0xc8b8ff, 0.5, 9);
    popup(t.x, t.v.muzzle + 0.3, t.z, '+' + back, 'gold');
    updateHUD();
    openPanel(i);
  }

  // 拆台子：连同上面的塔一起卖
  function removePad(i) {
    const p = S && S.pads.get(i);
    if (!p) return;
    let back = padValue(p);
    const t = S.towers.get(i);
    if (t) { back += sellValue(t); root.remove(t.v.g); S.towers.delete(i); }
    S.gold += back;
    root.remove(p.g);
    S.pads.delete(i);
    puff(p.x, 0.4, p.z, 0xc8b8ff, 0.5, 9);
    popup(p.x, 0.8, p.z, '+' + back, 'gold');
    updateHUD();
    openPanel(i);
  }

  function findTarget(x, z, R, minR, mode) {
    const R2 = R * R, mn = minR * minR;
    let best = null, bv = -Infinity;
    for (const e of S.enemies) {
      if (!e.alive) continue;
      const dx = e.x - x, dz = e.z - z, q = dx * dx + dz * dz;
      if (q > R2 || q < mn) continue;
      const v = mode === 'first' ? -(e.curve.len - e.s) : mode === 'strong' ? e.hp : -q;
      if (v > bv) { bv = v; best = e; }
    }
    return best;
  }

  function fire(t, e) {
    const d = TW[t.type], L = t.level - 1;
    const mesh = TD.assets.clone(d.ammo);
    mesh.scale.setScalar(0.75);
    mesh.traverse((o) => { o.castShadow = false; });
    root.add(mesh);
    const fx = Math.sin(t.aim), fz = Math.cos(t.aim);
    const sx = t.x + fx * 0.18, sy = t.v.muzzle, sz = t.z + fz * 0.18;
    mesh.position.set(sx, sy, sz);
    if (d.kind === 'direct') {
      S.projs.push({ kind: 'direct', mesh, x: sx, y: sy, z: sz, target: e, lx: e.x, ly: e.y, lz: e.z, speed: d.speed, dmg: d.dmg[L], tower: t });
    } else {
      const dist = Math.hypot(e.x - sx, e.z - sz);
      const T = Math.max(0.4, dist / d.speed + d.arc * 0.25);
      TD.maps.pos(e.curve, e.s + e.spd * T, tp);
      S.projs.push({ kind: 'arc', mesh, sx, sy, sz, tx: tp.x, ty: 0.35, tz: tp.z, t: 0, T, arc: d.arc, dmg: d.dmg[L], splash: d.splash[L], tower: t, spin: (Math.random() - 0.5) * 12 });
    }
    t.recoil = 1;
  }

  // 带炮台的台子：炮管朝 +Z，整块台身转向目标
  function fireBarrel(p, e) {
    const d = PD.barrel;
    const mesh = TD.assets.clone(d.ammo);
    mesh.scale.setScalar(0.6);
    mesh.traverse((o) => { o.castShadow = false; });
    root.add(mesh);
    const fx = Math.sin(p.aim), fz = Math.cos(p.aim);
    const sx = p.x + fx * 0.68 * SC, sy = p.base + 0.3 * SC, sz = p.z + fz * 0.68 * SC;
    mesh.position.set(sx, sy, sz);
    S.projs.push({ kind: 'direct', mesh, x: sx, y: sy, z: sz, target: e, lx: e.x, ly: e.y, lz: e.z, speed: d.speed, dmg: d.dmg, tower: p });
    puff(sx, sy, sz, 0xe8e8e8, 0.15, 3);
    p.recoil = 1;
  }

  function splash(x, z, R, dmg, tower) {
    for (const e of S.enemies) {
      if (!e.alive) continue;
      const q = Math.hypot(e.x - x, e.z - z);
      if (q > R) continue;
      const wasAlive = e.alive;
      damage(e, dmg * (1 - 0.5 * q / R));
      if (wasAlive && !e.alive && tower) tower.kills++;
    }
  }

  // ---------- 主循环 ----------
  function update(dtReal) {
    if (!S) return;
    TD.world.setHover(null);
    updateAim();
    if (!S.paused && !S.over) {
      let dt = Math.min(dtReal, 0.1) * S.speed;
      while (dt > 0) { const h = Math.min(dt, 1 / 40); step(h); dt -= h; }
    } else if (S.over) {
      stepVisual(dtReal);
    }
    updateBars();
    if (S.sel >= 0) {
      const t = S.towers.get(S.sel), pad = S.pads.get(S.sel), c = cellXZ(S.sel);
      if (S.preview) TD.world.setRange(c.x, c.z, S.preview.r, 0xffe59a);
      else if (t) TD.world.setRange(t.x, t.z, TW[t.type].range[t.level - 1], 0xffffff);
      else if (pad && pad.kind === 'barrel') TD.world.setRange(pad.x, pad.z, PD.barrel.range, 0xffffff);
      else TD.world.setRange(null);
    }
  }

  function step(dt) {
    S.time += dt;
    // 出怪
    if (S.running) {
      S.waveT += dt;
      while (S.queue.length && S.queue[0].t <= S.waveT) spawnEnemy(S.queue.shift());
    }
    // 冰晶塔：减速 + 持续伤害
    for (const e of S.enemies) e.slow = 0;
    for (const t of S.towers.values()) {
      const d = TW[t.type], L = t.level - 1;
      if (d.kind !== 'aura') continue;
      const R2 = d.range[L] ** 2;
      let any = false;
      for (const e of S.enemies) {
        if (!e.alive) continue;
        if ((e.x - t.x) ** 2 + (e.z - t.z) ** 2 > R2) continue;
        any = true;
        e.slow = Math.max(e.slow, d.slow[L]);
        const was = e.alive;
        damage(e, d.dmg[L] * dt, true);
        e.flash = 0;
        if (was && !e.alive) t.kills++;
      }
      t.pulse += dt * (any ? 3 : 1);
      t.v.weapon.rotation.y += dt * (any ? 2.2 : 0.5);
      const s = 1 + Math.sin(t.pulse * 2) * (any ? 0.05 : 0.02);
      t.v.weapon.scale.set(s, s, s);
    }
    // 敌人移动
    for (const e of S.enemies) {
      if (!e.alive) continue;
      e.spd = e.def.speed * (1 - e.slow);
      e.s += e.spd * dt;
      if (e.s >= e.curve.len) { leak(e); continue; }
      TD.maps.pos(e.curve, e.s, tp);
      e.x = tp.x; e.z = tp.z;
      e.born = Math.min(1, e.born + dt * 2);
      e.y = 0.1 + e.def.hover + Math.sin(S.time * 3 + e.phase) * 0.03 + (1 - e.born) * 1.2;
      e.g.position.set(e.x, e.y, e.z);
      e.model.rotation.y += dt * 1.8;
      e.g.rotation.z = Math.sin(S.time * 2 + e.phase) * 0.06;
      const f = e.flash > 0 ? 1 : 0;
      e.flash -= dt;
      for (const m of e.mats) m.emissive.setRGB(0.9 * f, 0.9 * f + e.slow * 0.25, 0.9 * f + e.slow * 0.9);
    }
    S.enemies = S.enemies.filter((e) => e.alive);
    // 塔
    for (const t of S.towers.values()) {
      const d = TW[t.type];
      if (d.kind === 'aura') continue;
      t.cd -= dt;
      t.recoil = Math.max(0, t.recoil - dt * 4);
      const L = t.level - 1;
      const e = findTarget(t.x, t.z, d.range[L], d.minRange || 0, t.mode);
      if (e) {
        const want = Math.atan2(e.x - t.x, e.z - t.z);
        let da = want - t.aim;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        t.aim += da * Math.min(1, dt * 14);
        if (t.cd <= 0 && Math.abs(da) < 0.5) { fire(t, e); t.cd = 1 / d.rate[t.level - 1]; }
      }
      t.v.weapon.rotation.y = t.aim;
      animateWeapon(t);
    }
    // 带炮台的台子
    for (const p of S.pads.values()) {
      if (p.kind !== 'barrel') continue;
      const d = PD.barrel;
      p.cd -= dt;
      p.recoil = Math.max(0, p.recoil - dt * 3);
      const e = findTarget(p.x, p.z, d.range, 0, p.mode);
      if (e) {
        const want = Math.atan2(e.x - p.x, e.z - p.z);
        const da = Math.atan2(Math.sin(want - p.aim), Math.cos(want - p.aim));
        p.aim += da * Math.min(1, dt * 8);
        if (p.cd <= 0 && Math.abs(da) < 0.35) { fireBarrel(p, e); p.cd = 1 / d.rate; }
      }
      p.piece.rotation.y = p.aim;
      p.piece.position.set(-Math.sin(p.aim) * 0.1 * p.recoil, 0, -Math.cos(p.aim) * 0.1 * p.recoil);
    }
    // 弹道
    for (const p of S.projs) {
      if (p.kind === 'direct') {
        if (p.target.alive) { p.lx = p.target.x; p.ly = p.target.y; p.lz = p.target.z; }
        const dx = p.lx - p.x, dy = p.ly - p.y, dz = p.lz - p.z;
        const dist = Math.hypot(dx, dy, dz), stepLen = p.speed * dt;
        if (dist <= stepLen + 0.04) {
          if (p.target.alive) {
            damage(p.target, p.dmg);
            if (!p.target.alive) p.tower.kills++;
            spark(p.lx, p.ly, p.lz);
          }
          p.done = true;
        } else {
          p.x += dx / dist * stepLen; p.y += dy / dist * stepLen; p.z += dz / dist * stepLen;
          p.mesh.position.set(p.x, p.y, p.z);
          p.mesh.lookAt(p.lx, p.ly, p.lz);
        }
      } else {
        p.t += dt;
        const u = Math.min(1, p.t / p.T);
        const x = p.sx + (p.tx - p.sx) * u, z = p.sz + (p.tz - p.sz) * u;
        const y = p.sy + (p.ty - p.sy) * u + p.arc * 4 * u * (1 - u);
        p.mesh.position.set(x, y, z);
        p.mesh.rotation.x += p.spin * dt;
        p.mesh.rotation.z += p.spin * 0.6 * dt;
        if (u >= 1) {
          splash(p.tx, p.tz, p.splash, p.dmg, p.tower);
          boom(p.tx, p.ty, p.tz, p.splash);
          p.done = true;
        }
      }
      if (p.done) root.remove(p.mesh);
    }
    S.projs = S.projs.filter((p) => !p.done);
    S.enemies = S.enemies.filter((e) => e.alive);
    stepVisual(dt);
    // 波次结束
    if (S.running && !S.queue.length && !S.enemies.length && !S.over) {
      S.running = false;
      const bonus = 8 + S.wave * 2;
      S.gold += bonus;
      if (S.wave >= S.total) { finish(true); return; }
      TD.ui.toast(`第 ${S.wave} 波清空 · 奖励 ${bonus} 金币`);
      updateHUD();
    }
    if (!S.running && S.auto && !S.over && S.wave < S.total) {
      S.autoT += dt;
      if (S.autoT > 2.5) startWave();
    }
  }

  // 只做特效与死亡动画（结束后也继续播）
  function stepVisual(dt) {
    for (const e of S.dying) {
      e.dieT += dt;
      const k = e.dieT / 0.45;
      e.g.position.y = e.y - k * 0.4;
      e.g.rotation.z += dt * 9;
      e.g.scale.setScalar(Math.max(0.01, 1 - k));
      if (k >= 1) { root.remove(e.g); e.gone = true; }
    }
    S.dying = S.dying.filter((e) => !e.gone);
    for (const f of S.fx) {
      f.t += dt;
      const k = f.t / f.life;
      if (f.kind === 'bit') {
        f.vy -= 6 * dt;
        f.m.position.x += f.vx * dt; f.m.position.y += f.vy * dt; f.m.position.z += f.vz * dt;
        f.m.scale.setScalar(f.s * (1 - k));
      } else if (f.kind === 'ring') {
        f.m.scale.setScalar(0.2 + k * f.r);
        f.m.material.opacity = 0.7 * (1 - k);
      } else if (f.kind === 'ball') {
        f.m.scale.setScalar(f.r * (0.3 + k * 0.9));
        f.m.material.opacity = 0.9 * (1 - k);
      }
      if (k >= 1) { root.remove(f.m); f.m.material.dispose(); f.gone = true; }
    }
    S.fx = S.fx.filter((f) => !f.gone);
  }

  function animateWeapon(t) {
    const m = t.v.moving;
    if (!m || !m.userData.rest) return;
    const rest = m.userData.rest, k = t.recoil;
    if (t.type === 'catapult') m.rotation.x = rest.r.x - Math.sin(Math.min(1, (1 - k) * 2) * Math.PI) * 1.1 * (k > 0 ? 1 : 0);
    else if (t.type === 'ballista') m.visible = k < 0.4 || t.cd < 1 / TW.ballista.rate[t.level - 1] * 0.5;
    else m.position.z = rest.p.z - 0.1 * k;
  }

  // ---------- 特效 ----------
  const bitGeo = new THREE.IcosahedronGeometry(0.06, 0);
  const ballGeo = new THREE.IcosahedronGeometry(1, 1);
  const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  function puff(x, y, z, color, size, n) {
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(bitGeo, new THREE.MeshBasicMaterial({ color }));
      m.position.set(x, y, z);
      root.add(m);
      const a = Math.random() * Math.PI * 2, sp = 0.6 + Math.random() * 1.4;
      S.fx.push({ kind: 'bit', m, t: 0, life: 0.45 + Math.random() * 0.3, vx: Math.cos(a) * sp * size, vy: 1 + Math.random() * 1.5, vz: Math.sin(a) * sp * size, s: 0.8 + Math.random() * 0.8 });
    }
  }
  function spark(x, y, z) { puff(x, y, z, 0xfff1b0, 0.2, 3); }
  function boom(x, y, z, r) {
    const ball = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color: 0xffa24a, transparent: true, opacity: 0.9, depthWrite: false }));
    ball.position.set(x, y, z);
    root.add(ball);
    S.fx.push({ kind: 'ball', m: ball, t: 0, life: 0.3, r: r * 0.55 });
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.24, z);
    root.add(ring);
    S.fx.push({ kind: 'ring', m: ring, t: 0, life: 0.4, r });
    puff(x, y, z, 0x8a6a55, 0.5, 6);
  }

  function popup(x, y, z, text, cls) {
    const pos = TD.world.toScreen(x, y, z);
    if (!pos) return;
    const d = document.createElement('div');
    d.className = 'popup ' + (cls || '');
    d.textContent = text;
    d.style.left = pos.x + 'px';
    d.style.top = pos.y + 'px';
    $('popups').appendChild(d);
    setTimeout(() => d.remove(), 900);
  }

  function flashScreen() {
    const f = $('hurt');
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  const _right = new THREE.Vector3();
  function updateBars() {
    const cam = TD.world.camera;
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    for (const e of S.enemies) {
      const b = e.bar;
      const show = e.alive && e.hp < e.maxHp;
      b.group.visible = show;
      if (!show) continue;
      const k = Math.max(0, e.hp / e.maxHp);
      b.fg.scale.x = (b.w - 0.03) * k;
      b.fg.material.color.setHSL(0.33 * k, 0.75, 0.55);
      const h = e.y + 0.32 * e.def.scale + 0.12;
      b.back.position.set(e.x - _right.x * b.w / 2, h, e.z - _right.z * b.w / 2);
      b.fg.position.set(e.x - _right.x * (b.w / 2 - 0.015), h, e.z - _right.z * (b.w / 2 - 0.015));
    }
  }

  // ---------- 选择与面板 ----------
  function pickCell(ray, maxDist = Infinity) {
    let best = null, bd = maxDist;
    for (const t of S.towers.values()) {
      _box.min.set(t.x - 0.38, 0.2, t.z - 0.38);
      _box.max.set(t.x + 0.38, 0.2 + t.v.height, t.z + 0.38);
      if (ray.intersectBox(_box, _v)) {
        const d = _v.distanceTo(ray.origin);
        if (d < bd) { bd = d; best = { c: t.c, r: t.r, i: t.i }; }
      }
    }
    for (const p of S.pads.values()) {
      if (S.towers.has(p.i)) continue;
      _box.min.set(p.x - 0.36, 0.2, p.z - 0.36);
      _box.max.set(p.x + 0.36, padTop(p.i), p.z + 0.36);
      if (ray.intersectBox(_box, _v)) {
        const d = _v.distanceTo(ray.origin);
        if (d < bd) { bd = d; best = { c: p.c, r: p.r, i: p.i }; }
      }
    }
    if (best) return best;
    return TD.world.pickGround(ray, maxDist);
  }

  function onTap(x, y) {
    if (!S || S.over) return;
    const cell = pickCell(TD.world.rayAt(x, y));
    if (cell && canInteract(cell.i)) openPanel(cell.i);
    else closePanel();
  }

  function onHover(x, y) {
    if (!S) return;
    S.hoverCell = x == null ? null : pickCell(TD.world.rayAt(x, y));
  }

  function updateAim() {
    if (TD.input.mode === 'fp') {
      const cell = pickCell(TD.world.rayCenter(), FP_REACH);
      S.aim = cell && canInteract(cell.i) ? cell : null;
      const hint = $('aimHint');
      if (S.aim && $('towerPanel').classList.contains('hidden')) {
        const i = S.aim.i, t = S.towers.get(i), kind = padKind(i);
        hint.textContent = t ? `${TW[t.type].name} Lv${t.level} · 点击查看 · U 升级`
          : kind ? `${kind === 'slot' ? '塔位' : PD[kind].name} · 点击放塔（1-5 快捷）`
          : `草地 · 点击建台子（1 台子 ${PD.plain.cost} · 2 带炮台 ${PD.barrel.cost}）`;
        hint.classList.remove('hidden');
      } else hint.classList.add('hidden');
      if (S.aim) TD.world.setHover(S.aim, 0xffffff);
    } else {
      S.aim = null;
      $('aimHint').classList.add('hidden');
      const h = S.hoverCell;
      if (h && canInteract(h.i) && h.i !== S.sel) TD.world.setHover(h, 0xffffff);
    }
  }

  function onFpUse(pt) {
    if (!S || S.over) return;
    let cell;
    if (pt) cell = pickCell(TD.world.rayAt(pt.x, pt.y), FP_REACH);
    else cell = S.aim;
    if (cell && canInteract(cell.i)) {
      openPanel(cell.i);
      TD.input.unlockPointer();
    } else if (pt) closePanel();
  }

  function fpSpawn() {
    // 第一人称出生在城堡旁边、面朝路线
    const m = S.map;
    const end = S.an.ends[0];
    const ec = end % m.w, er = (end / m.w) | 0;
    let best = null, bd = Infinity;
    for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) {
      const t = m.cells[r * m.w + c];
      if (t !== C.GRASS && t !== C.PATH) continue;
      const d = Math.abs(c - ec) + Math.abs(r - er);
      if (d >= 2 && d < bd) { bd = d; best = { c, r }; }
    }
    best = best || { c: 0, r: 0 };
    const p = TD.maps.center(m, best.c, best.r);
    const cv = S.curves[0];
    TD.maps.pos(cv, cv.len * 0.6, tp);
    return { x: p.x, z: p.z, yaw: Math.atan2(-(tp.x - p.x), -(tp.z - p.z)), pitch: -0.12 };
  }

  function blocked(x, z) {
    const m = S.map, R = 0.14;
    const here = TD.maps.cellAt(m, TD.input.fp.x, TD.input.fp.z);
    for (const [ox, oz] of [[R, R], [R, -R], [-R, R], [-R, -R]]) {
      const cell = TD.maps.cellAt(m, x + ox, z + oz);
      if (!cell) return true;
      const t = m.cells[cell.i];
      if (t === C.TREE || t === C.ROCK || t === C.CRYSTAL || t === C.HILL || t === C.END) return true;
      if (here && cell.i === here.i) continue;
      if (S.pads.has(cell.i) || (t === C.SLOT && S.towers.has(cell.i))) return true;
    }
    return false;
  }
  function groundY(x, z) {
    const cell = TD.maps.cellAt(S.map, x, z);
    return cell && TD.maps.isWalk(S.map.cells[cell.i]) ? 0.1 : 0.2;
  }

  function cardsHTML(opts) {
    if (!opts.length) return '';
    const first = opts[0].pad ? PD[opts[0].pad] : TW[opts[0].type];
    return `<div class="tp-cards">${opts.map((o, n) => {
      const d = o.pad ? PD[o.pad] : TW[o.type];
      return `<button class="tcard" data-act="opt" data-n="${n}" data-cost="${d.cost}" title="${d.desc}">
        <img src="${d.icon}" alt=""><span class="tn">${d.name}</span><span class="tc">💰${d.cost}</span><span class="tk">${n + 1}</span></button>`;
    }).join('')}</div><div class="tp-desc" id="tpDesc">${first.name}：${first.desc}</div>`;
  }

  function openPanel(i) {
    if (!S) return;
    S.sel = i;
    S.preview = null;
    const c = i % S.map.w, r = (i / S.map.w) | 0;
    TD.world.setSel({ c, r, i });
    const t = S.towers.get(i), pad = S.pads.get(i), kind = padKind(i);
    const el = $('towerPanel');
    el.classList.remove('hidden');
    let head, body = '';
    if (t) {
      const d = TW[t.type], L = t.level - 1;
      const stat = d.kind === 'aura'
        ? `减速 ${Math.round(d.slow[L] * 100)}% · 伤害 ${d.dmg[L]}/秒 · 范围 ${d.range[L]}`
        : `伤害 ${d.dmg[L]} · 射速 ${d.rate[L]}/秒 · 射程 ${d.range[L]}${d.splash ? ' · 溅射 ' + d.splash[L] : ''}`;
      const up = t.level < 3 ? TD.upgradeCost(t.type, t.level) : 0;
      const next = t.level < 3 ? (d.kind === 'aura'
        ? `→ 减速 ${Math.round(d.slow[L + 1] * 100)}%，范围 ${d.range[L + 1]}`
        : `→ 伤害 ${d.dmg[L + 1]}，射程 ${d.range[L + 1]}`) : '';
      head = `<img src="${d.icon}" alt=""><b>${d.name}</b><span class="lv">Lv${t.level}</span>`;
      body += `<div class="tp-stat">${stat}<br><span class="dim">击落 ${t.kills} · ${d.desc}</span></div>
        ${d.kind === 'aura' ? '' : `<div class="tp-mode">目标：${[['first', '最前'], ['strong', '最强'], ['near', '最近']].map(([k, n]) => `<button data-act="mode" data-mode="${k}" class="${t.mode === k ? 'on' : ''}">${n}</button>`).join('')}</div>`}
        <div class="tp-btns">
          ${t.level < 3 ? `<button class="up" data-act="up" data-cost="${up}">升级 💰${up}<small>${next}</small></button>` : '<button class="up" disabled>已满级</button>'}
          <button class="sell" data-act="sell">卖塔 +${sellValue(t)}</button>
        </div>`;
    } else if (kind) {
      const icon = kind === 'slot' ? 'assets/ui/spawn-square.png' : PD[kind].icon;
      head = `<img src="${icon}" alt=""><b>${kind === 'slot' ? '塔位' : PD[kind].name}</b><span class="tp-sub">${kind === 'slot' ? '免费台子，' : ''}选一座塔放上去</span>`;
    } else {
      head = `<img src="assets/ui/tile.png" alt=""><b>草地</b><span class="tp-sub">先建台子，塔放在台子上</span>`;
    }
    if (pad && pad.kind === 'barrel') {
      body += `<div class="tp-stat pad"><b>炮管</b> 伤害 ${PD.barrel.dmg} · 每 ${+(1 / PD.barrel.rate).toFixed(1)} 秒一发 · 射程 ${PD.barrel.range}<span class="dim"> · 击落 ${pad.kills}</span></div>`;
    }
    body += cardsHTML(buildOptions(i));
    if (pad) {
      const back = padValue(pad) + (t ? sellValue(t) : 0);
      body += `<div class="tp-btns"><button class="sell wide" data-act="unpad">拆掉${PD[pad.kind].name} +${back}${t ? '<small>连同上面的塔一起卖</small>' : ''}</button></div>`;
    }
    if (fullRefund() && (t || pad)) body += `<div class="tp-note">第一波开始前出售，全额退款</div>`;
    el.innerHTML = `<div class="tp-head">${head}<button class="tp-x" data-act="close">✕</button></div>${body}`;
    refreshPanel();
  }

  function closePanel() {
    if (S) S.sel = -1;
    $('towerPanel').classList.add('hidden');
    TD.world.setSel(null);
    TD.world.setRange(null);
  }

  function refreshPanel() {
    if (!S) return;
    $('towerPanel').querySelectorAll('[data-cost]').forEach((b) => b.classList.toggle('poor', S.gold < +b.dataset.cost));
  }

  function panelClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || !S) return;
    const act = b.dataset.act;
    if (act === 'close') closePanel();
    else if (act === 'opt') doOption(S.sel, buildOptions(S.sel)[+b.dataset.n]);
    else if (act === 'up') upgrade(S.sel);
    else if (act === 'sell') sell(S.sel);
    else if (act === 'unpad') removePad(S.sel);
    else if (act === 'mode') { const t = S.towers.get(S.sel); if (t) { t.mode = b.dataset.mode; openPanel(S.sel); } }
  }
  function panelHover(e) {
    if (!S || S.sel < 0) return;
    const b = e.target.closest('.tcard');
    if (!b) { S.preview = null; return; }
    const o = buildOptions(S.sel)[+b.dataset.n];
    if (!o) return;
    const d = o.pad ? PD[o.pad] : TW[o.type];
    const r = o.pad ? d.range : d.range[0];
    S.preview = r ? { r } : null;
    const desc = $('tpDesc');
    if (desc) desc.textContent = `${d.name}：${d.desc}`;
  }

  // ---------- HUD ----------
  function updateHUD() {
    if (!S) return;
    $('hLives').textContent = S.lives;
    $('hGold').textContent = S.gold;
    $('hWave').textContent = `${S.wave}/${S.total}`;
    const wb = $('waveBox');
    if (S.over) wb.classList.add('hidden');
    else {
      wb.classList.remove('hidden');
      if (S.running) {
        $('waveInfo').innerHTML = `第 ${S.wave} 波进行中 · 还剩 ${S.queue.length + S.enemies.length} 架`;
        $('btnWave').classList.add('hidden');
      } else {
        $('waveInfo').innerHTML = `<span class="lbl">下一波</span>${waveSummary(S.wave + 1)}`;
        const b = $('btnWave');
        b.classList.remove('hidden');
        b.textContent = S.wave === 0 ? '▶ 开始第 1 波' : `▶ 第 ${S.wave + 1} 波`;
      }
    }
    refreshPanel();
  }
  let hudTick = 0;
  function tickHUD(dt) {
    hudTick += dt;
    if (hudTick > 0.25 && S && S.running) { hudTick = 0; updateHUD(); }
  }

  function setSpeed(v) {
    if (!S) return;
    if (v === 0) S.paused = !S.paused;
    else { S.speed = v; S.paused = false; }
    $('spPause').classList.toggle('on', S.paused);
    $('sp1').classList.toggle('on', !S.paused && S.speed === 1);
    $('sp2').classList.toggle('on', !S.paused && S.speed === 2);
    $('sp3').classList.toggle('on', !S.paused && S.speed === 3);
    $('pausedTag').classList.toggle('hidden', !S.paused);
  }

  function setView(v) {
    TD.input.setMode(v);
    const fpOn = v === 'fp';
    $('btnView').textContent = fpOn ? '🛰 上帝视角' : '👁 第一人称';
    $('crosshair').classList.toggle('hidden', !fpOn);
    $('fpHelp').classList.toggle('hidden', !fpOn);
    document.body.classList.toggle('fp', fpOn);
    if (!fpOn) TD.world.setHover(null);
    if (fpOn) closePanel();
  }

  function finish(win) {
    if (S.over) return;
    S.over = true;
    TD.input.unlockPointer();
    closePanel();
    let stars = 0;
    if (win) stars = S.lives >= S.maxLives ? 3 : S.lives >= S.maxLives * 0.5 ? 2 : 1;
    let record = false;
    if (win) record = TD.maps.setBest(S.map.id, { stars, lives: S.lives, max: S.maxLives, at: Date.now() });
    updateHUD();
    const res = { win, stars, record, wave: S.wave, total: S.total, lives: S.lives, max: S.maxLives, kills: S.kills, mapId: S.map.id, from: S.opts.from };
    const same = S;
    setTimeout(() => { if (S === same) TD.main.showResult(res); }, 900);
  }

  function key(e) {
    if (!S) return false;
    if (e.code === 'KeyV') { setView(TD.input.mode === 'fp' ? 'god' : 'fp'); return true; }
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); startWave(); return true; }
    if (e.code === 'KeyP') { setSpeed(0); return true; }
    if (e.code === 'Escape') { closePanel(); return true; }
    if (/^Digit[1-6]$/.test(e.code)) {
      const n = +e.code.slice(5) - 1;
      const i = S.sel >= 0 ? S.sel : S.aim ? S.aim.i : -1;
      if (i >= 0) doOption(i, buildOptions(i)[n]);
      return true;
    }
    if (e.code === 'KeyU') {
      const i = S.sel >= 0 ? S.sel : S.aim ? S.aim.i : -1;
      if (i >= 0) upgrade(i);
      return true;
    }
    return false;
  }

  function bindUI() {
    $('towerPanel').addEventListener('click', panelClick);
    $('towerPanel').addEventListener('mouseover', panelHover);
    $('towerPanel').addEventListener('mouseleave', () => { if (S) S.preview = null; });
    $('btnWave').onclick = startWave;
    $('spPause').onclick = () => setSpeed(0);
    $('sp1').onclick = () => setSpeed(1);
    $('sp2').onclick = () => setSpeed(2);
    $('sp3').onclick = () => setSpeed(3);
    $('btnView').onclick = () => setView(TD.input.mode === 'fp' ? 'god' : 'fp');
    $('autoNext').onchange = () => { if (S) { S.auto = $('autoNext').checked; S.autoT = 0; } };
    $('btnQuit').onclick = () => {
      if (S && !S.over && S.wave > 0 && !confirm('退出这一局？')) return;
      const from = S && S.opts.from, id = S && S.map.id;
      stop();
      if (from === 'editor') TD.main.editMap(id); else TD.main.goHome();
    };
  }

  return {
    start, stop, update, tickHUD, key, bindUI, setSpeed, setView, startWave,
    get state() { return S; },
    // 调试 / 测试用
    _build: build, _upgrade: upgrade, _buildPad: buildPad, _sell: sell, _removePad: removePad, _options: buildOptions,
  };
})();
