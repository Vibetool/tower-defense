// three.js 场景：渲染器、天空盒、光照、地图（静态地块用 InstancedMesh 合批）、选中/悬停标记、路线预览
TD.world = (() => {
  const C = TD.C;
  let renderer, scene, camera, sun, hemi, pmrem;
  let mapGroup, baseGroup, castles = [];
  let hover, selMark, rangeRing, routeDots = null, routeCurves = null;
  let curMap = null, skyId = null, time = 0;
  const envCache = {};

  const SKY_LIGHT = {
    day: { sun: 0xffffff, si: 1.55, hemi: 0.5, env: 0.55 },
    morning: { sun: 0xffd6b0, si: 1.45, hemi: 0.45, env: 0.55 },
    night: { sun: 0xa9b9ff, si: 0.85, hemi: 0.3, env: 0.9 },
    alien: { sun: 0xffd2f2, si: 1.35, hemi: 0.45, env: 0.55 },
    space: { sun: 0xe3e8ff, si: 1.3, hemi: 0.4, env: 0.6 },
  };

  function init(el) {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9cc3ee);
    camera = new THREE.PerspectiveCamera(50, 1, 0.05, 400);
    camera.rotation.order = 'YXZ';

    hemi = new THREE.HemisphereLight(0xffffff, 0x6b7a5a, 0.5);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.07;
    scene.add(sun, sun.target);

    mapGroup = new THREE.Group();
    baseGroup = new THREE.Group();
    scene.add(mapGroup, baseGroup);
    // 浮空岛的土台
    const dirt = new THREE.MeshStandardMaterial({ color: 0xb8714a, roughness: 1 });
    const dirt2 = new THREE.MeshStandardMaterial({ color: 0x8e5236, roughness: 1 });
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), dirt);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), dirt2);
    b1.receiveShadow = b2.receiveShadow = true;
    baseGroup.add(b1, b2);

    pmrem = new THREE.PMREMGenerator(renderer);
    resize();
    window.addEventListener('resize', resize);
  }

  function initMarkers() {
    hover = TD.assets.clone('selection-b');
    hover.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.castShadow = false; } });
    hover.visible = false;
    selMark = TD.assets.clone('selection-a');
    selMark.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    selMark.visible = false;
    rangeRing = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = disc.rotation.x = -Math.PI / 2;
    rangeRing.add(ring, disc);
    rangeRing.visible = false;
    rangeRing.userData = { ring, disc };
    scene.add(hover, selMark, rangeRing);
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  async function setSky(id) {
    if (!SKY_LIGHT[id]) id = 'day';
    skyId = id;
    const L = SKY_LIGHT[id];
    sun.color.setHex(L.sun); sun.intensity = L.si; hemi.intensity = L.hemi;
    const tex = await TD.assets.sky(id);
    if (skyId !== id || !tex) return;
    scene.background = tex;
    if (!envCache[id]) envCache[id] = pmrem.fromEquirectangular(tex).texture;
    scene.environment = envCache[id];
    for (const m of TD.assets.materials()) { m.envMapIntensity = L.env; m.needsUpdate = true; }
  }

  const NO_CAST = new Set(['spawn-square', 'spawn-round']);

  function makeCastle() {
    const g = new THREE.Group();
    let y = 0;
    for (const name of TD.CASTLE_PARTS) {
      const o = TD.assets.clone(name);
      o.position.y = y;
      g.add(o);
      y += name === 'tower-round-base' ? 0.1 : TD.assets.height(name);
    }
    g.scale.setScalar(0.62);
    TD.assets.castOnly(g);
    return g;
  }

  const _M = new THREE.Matrix4(), _T = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _P = new THREE.Vector3();
  const _S = new THREE.Vector3(1, 1, 1), _Y = new THREE.Vector3(0, 1, 0);

  function buildMap(m) {
    curMap = m;
    for (const ch of [...mapGroup.children]) {
      mapGroup.remove(ch);
      if (ch.isInstancedMesh) ch.dispose();
    }
    castles = [];
    const byModel = new Map();
    for (const it of TD.maps.layout(m)) {
      if (!byModel.has(it.model)) byModel.set(it.model, []);
      byModel.get(it.model).push(it);
    }
    for (const [name, list] of byModel) {
      const def = TD.assets.get(name);
      if (!def) { console.warn('缺模型', name); continue; }
      for (const part of def.parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        list.forEach((it, k) => {
          _P.set(it.x, it.y || 0, it.z);
          _Q.setFromAxisAngle(_Y, it.rot || 0);
          _M.compose(_P, _Q, _S);
          _T.multiplyMatrices(_M, part.matrix);
          im.setMatrixAt(k, _T);
        });
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = !NO_CAST.has(name);
        im.receiveShadow = true;
        im.frustumCulled = false; // r147 的 InstancedMesh 按单个几何体包围球裁剪，会误裁
        mapGroup.add(im);
      }
    }
    m.cells.forEach((t, i) => {
      if (t !== C.END) return;
      const p = TD.maps.center(m, i % m.w, (i / m.w) | 0);
      const g = makeCastle();
      g.position.set(p.x, 0.1 + TD.LIFT, p.z);
      g.userData.home = g.position.clone();
      mapGroup.add(g);
      castles.push(g);
    });
    if (gridOn) makeGrid(m);
    const [b1, b2] = baseGroup.children;
    b1.scale.set(m.w, 0.5, m.h); b1.position.y = -0.25 - 0.002;
    b2.scale.set(m.w - 0.6, 0.6, m.h - 0.6); b2.position.y = -0.8;
    // 阴影相机框住整张图
    const R = Math.max(m.w, m.h) * 0.62 + 1.5;
    const sc = sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 0.5; sc.far = R * 4;
    sc.updateProjectionMatrix();
    sun.position.set(R * 0.7, R * 1.6, R * 0.55);
    sun.target.position.set(0, 0, 0);
  }

  // 编辑器网格线
  let gridOn = false, grid = null;
  function makeGrid(m) {
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid = null; }
    if (!gridOn || !m) return;
    const v = [], x0 = -m.w / 2, z0 = -m.h / 2, y = 0.215;
    for (let c = 0; c <= m.w; c++) v.push(x0 + c, y, z0, x0 + c, y, z0 + m.h);
    for (let r = 0; r <= m.h; r++) v.push(x0, y, z0 + r, x0 + m.w, y, z0 + r);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    grid = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false }));
    grid.renderOrder = 2;
    scene.add(grid);
  }
  function setGrid(on) { gridOn = on; makeGrid(on ? curMap : null); }

  // ---------- 标记 ----------
  function cellY(i) {
    if (!curMap) return 0.2;
    return TD.maps.isWalk(curMap.cells[i]) ? 0.1 : 0.2;
  }
  function setHover(cell, color) {
    if (!hover) return;
    if (!cell) { hover.visible = false; return; }
    const p = TD.maps.center(curMap, cell.c, cell.r);
    hover.visible = true;
    hover.position.set(p.x, cellY(cell.i) + 0.005, p.z);
    hover.traverse((o) => { if (o.isMesh) o.material.color.setHex(color == null ? 0xffffff : color); });
  }
  function setSel(cell) {
    if (!selMark) return;
    if (!cell) { selMark.visible = false; return; }
    const p = TD.maps.center(curMap, cell.c, cell.r);
    selMark.visible = true;
    selMark.position.set(p.x, 0.22, p.z);
    selMark.userData.y = 0.22;
  }
  function setRange(x, z, r, color = 0xffffff) {
    if (!rangeRing) return;
    if (r == null) { rangeRing.visible = false; return; }
    rangeRing.visible = true;
    rangeRing.position.set(x, 0.23, z);
    rangeRing.scale.set(r, 1, r);
    rangeRing.userData.ring.material.color.setHex(color);
    rangeRing.userData.disc.material.color.setHex(color);
  }

  // 编辑器里沿路线流动的小光点
  function showRoutes(curves) {
    if (routeDots) { scene.remove(routeDots); routeDots.geometry.dispose(); routeDots.material.dispose(); routeDots = null; }
    routeCurves = curves && curves.length ? curves : null;
    if (!routeCurves) return;
    let n = 0;
    for (const cv of routeCurves) n += Math.ceil(cv.len / 0.5) + 1;
    routeDots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe14d }), n);
    routeDots.frustumCulled = false;
    scene.add(routeDots);
  }
  const _o = { x: 0, z: 0 };
  function updateRoutes() {
    if (!routeDots) return;
    let k = 0;
    const off = (time * 0.9) % 0.5;
    for (const cv of routeCurves) {
      for (let d = off; d < cv.len; d += 0.5) {
        TD.maps.pos(cv, d, _o);
        _M.makeTranslation(_o.x, 0.2, _o.z);
        routeDots.setMatrixAt(k++, _M);
      }
    }
    routeDots.count = k;
    routeDots.instanceMatrix.needsUpdate = true;
  }

  function shakeCastles() { for (const g of castles) g.userData.shake = 0.35; }

  function update(dt) {
    time += dt;
    updateRoutes();
    if (selMark && selMark.visible) {
      selMark.position.y = selMark.userData.y + Math.sin(time * 5) * 0.025;
      selMark.rotation.y += dt * 0.8;
    }
    for (const g of castles) {
      const s = g.userData.shake || 0;
      if (s > 0) {
        g.userData.shake = Math.max(0, s - dt);
        g.position.x = g.userData.home.x + Math.sin(time * 70) * 0.05 * s / 0.35;
      } else g.position.x = g.userData.home.x;
    }
  }

  function render() { renderer.render(scene, camera); }

  const _ray = new THREE.Raycaster(), _v = new THREE.Vector3(), _ndc = new THREE.Vector2();
  const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.2);
  function rayAt(sx, sy) {
    _ndc.set((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    _ray.setFromCamera(_ndc, camera);
    return _ray.ray;
  }
  function rayCenter() { _ndc.set(0, 0); _ray.setFromCamera(_ndc, camera); return _ray.ray; }
  // 射线打到 y=0.2 平面上的格子
  function pickGround(ray, maxDist = Infinity) {
    if (!curMap || !ray.intersectPlane(_plane, _v)) return null;
    if (_v.distanceTo(ray.origin) > maxDist) return null;
    return TD.maps.cellAt(curMap, _v.x, _v.z);
  }
  function toScreen(x, y, z) {
    _v.set(x, y, z).project(camera);
    if (_v.z > 1) return null;
    return { x: (_v.x + 1) / 2 * window.innerWidth, y: (1 - _v.y) / 2 * window.innerHeight };
  }

  return {
    init, initMarkers, setSky, buildMap, setGrid, setHover, setSel, setRange, showRoutes, shakeCastles, update, render,
    rayAt, rayCenter, pickGround, toScreen,
    get renderer() { return renderer; }, get scene() { return scene; }, get camera() { return camera; }, get map() { return curMap; },
  };
})();
