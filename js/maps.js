// 地图数据：格子、道路自动拼接、路线计算、本地存档、内置示例
TD.maps = (() => {
  const C = TD.C;
  const KEY = 'td_maps_v1';
  const BEST_KEY = 'td_best_v1';
  const STEP = 0.05; // 路线重采样间距

  // 方向位：0=+Z(下) 1=+X(右) 2=-Z(上) 3=-X(左)，以 [dc, dr] 表示
  const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  // 模型绕 Y 转 +90° 会把 +Z 转到 +X，也就是方向位整体左移一位
  const rotl = (m, k) => ((m << k) | (m >> (4 - k))) & 15;
  const pop = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
  const fit = (base, want) => { for (let k = 0; k < 4; k++) if (rotl(base, k) === want) return k; return 0; };
  const isWalk = (t) => t === C.PATH || t === C.SPAWN || t === C.END;

  function at(m, c, r) { return c < 0 || r < 0 || c >= m.w || r >= m.h ? null : m.cells[r * m.w + c]; }
  function walkMask(m, c, r) {
    let k = 0;
    for (let i = 0; i < 4; i++) { const t = at(m, c + DIRS[i][0], r + DIRS[i][1]); if (t != null && isWalk(t)) k |= 1 << i; }
    return k;
  }
  function center(m, c, r) { return { x: c - (m.w - 1) / 2, z: r - (m.h - 1) / 2 }; }
  function cellAt(m, x, z) {
    const c = Math.round(x + (m.w - 1) / 2), r = Math.round(z + (m.h - 1) / 2);
    return c < 0 || r < 0 || c >= m.w || r >= m.h ? null : { c, r, i: r * m.w + c };
  }
  function hash(c, r) {
    let h = Math.imul(c + 101, 73856093) ^ Math.imul(r + 37, 19349663);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // 按四邻连通情况挑路块和旋转。基准开口：直路 +Z/-Z，弯道 +X/+Z，三岔 +Z/+X/-X，尽头 +Z
  function road(mask, kind) {
    const n = pop(mask);
    if (kind === 'spawn') {
      if (n <= 1) return { model: 'tile-spawn-end', k: n ? fit(1, mask) : 0 };
      if (mask === 5 || mask === 10) return { model: 'tile-spawn', k: mask === 5 ? 0 : 1 };
    }
    if (kind === 'end' && n === 1) return { model: 'tile-end-round', k: fit(1, mask) };
    if (n === 0) return { model: 'tile-dirt', k: 0 };
    if (n === 1) return { model: 'tile-end', k: fit(1, mask) };
    if (n === 2) return mask === 5 || mask === 10 ? { model: 'tile-straight', k: mask === 5 ? 0 : 1 } : { model: 'tile-corner-round', k: fit(3, mask) };
    if (n === 3) return { model: 'tile-split', k: fit(11, mask) };
    return { model: 'tile-crossing', k: 0 };
  }

  function themed(m, name) { return m.theme === 'snow' && /^tile/.test(name) ? 'snow-' + name : name; }

  // 地图 → 要摆的模型清单 [{model, x, z, y, rot}]
  function layout(m) {
    const out = [];
    const H = Math.PI / 2;
    for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) {
      const t = m.cells[r * m.w + c];
      const p = center(m, c, r);
      const h = hash(c, r);
      const put = (model, k = 0, y = 0) => out.push({ model: themed(m, model), x: p.x, z: p.z, y, rot: k * H });
      if (t === C.PATH || t === C.SPAWN || t === C.END) {
        const kind = t === C.SPAWN ? 'spawn' : t === C.END ? 'end' : 'path';
        const rd = road(walkMask(m, c, r), kind);
        put(rd.model, rd.k);
        if (t === C.SPAWN && !/spawn/.test(rd.model)) out.push({ model: 'spawn-round', x: p.x, z: p.z, y: 0.1, rot: 0 });
      } else if (t === C.SLOT) {
        put('tile');
        out.push({ model: 'spawn-square', x: p.x, z: p.z, y: 0.2, rot: 0 });
      } else if (t === C.TREE) {
        put(['tile-tree', 'tile-tree-double', 'tile-tree-quad'][h % 3], (h >> 4) & 3);
      } else if (t === C.ROCK) put('tile-rock', (h >> 4) & 3);
      else if (t === C.CRYSTAL) put('tile-crystal', (h >> 4) & 3);
      else if (t === C.HILL) put('tile-hill', (h >> 4) & 3);
      else put('tile');
    }
    return out;
  }

  // 校验 + 计算每个起点到终点的最短路线（从所有终点反向 BFS）
  function analyze(m) {
    const N = m.w * m.h;
    const dist = new Int32Array(N).fill(-1);
    const q = [], spawns = [], ends = [];
    let slots = 0;
    for (let i = 0; i < N; i++) {
      const t = m.cells[i];
      if (t === C.SPAWN) spawns.push(i);
      else if (t === C.END) { ends.push(i); dist[i] = 0; q.push(i); }
      else if (t === C.SLOT) slots++;
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h], c = i % m.w, r = (i / m.w) | 0;
      for (const [dc, dr] of DIRS) {
        const t = at(m, c + dc, r + dr);
        if (t == null || !isWalk(t)) continue;
        const ni = (r + dr) * m.w + c + dc;
        if (dist[ni] < 0) { dist[ni] = dist[i] + 1; q.push(ni); }
      }
    }
    const errors = [];
    if (!spawns.length) errors.push('还没有起点：用「起点」工具放一个飞碟出生口');
    if (!ends.length) errors.push('还没有终点：用「终点」工具放你要守的城堡');
    const routes = [];
    let broken = 0;
    for (const s of spawns) {
      if (dist[s] < 0) { broken++; continue; }
      const path = [s];
      let cur = s, pd = -1;
      while (dist[cur] > 0) {
        const c = cur % m.w, r = (cur / m.w) | 0;
        let best = -1, bd = -1;
        for (let d = 0; d < 4; d++) {
          const nc = c + DIRS[d][0], nr = r + DIRS[d][1];
          const t = at(m, nc, nr);
          if (t == null || !isWalk(t)) continue;
          const ni = nr * m.w + nc;
          if (dist[ni] === dist[cur] - 1 && (best < 0 || d === pd)) { best = ni; bd = d; }
        }
        path.push(best); pd = bd; cur = best;
      }
      routes.push(path);
    }
    if (broken && ends.length) errors.push(`有 ${broken} 个起点走不到终点：道路断了`);
    const lens = routes.map((r) => r.length - 1);
    return { ok: !errors.length, errors, routes, spawns, ends, slots, minLen: lens.length ? Math.min(...lens) : 0 };
  }

  // 格子路线 → 平滑曲线（弯道用二次贝塞尔贴合圆角路块），按 STEP 等距重采样
  function curve(m, cells) {
    const P = cells.map((i) => center(m, i % m.w, (i / m.w) | 0));
    const n = P.length - 1;
    if (n <= 0) return { pts: new Float32Array([P[0].x, P[0].z, P[0].x, P[0].z]), len: STEP };
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    const raw = [P[0], mid(P[0], P[1])];
    for (let i = 1; i < n; i++) {
      const a = mid(P[i - 1], P[i]), b = mid(P[i], P[i + 1]);
      const straight = P[i].x - P[i - 1].x === P[i + 1].x - P[i].x && P[i].z - P[i - 1].z === P[i + 1].z - P[i].z;
      if (straight) raw.push(b);
      else for (let s = 1; s <= 10; s++) {
        const t = s / 10, u = 1 - t;
        raw.push({ x: u * u * a.x + 2 * u * t * P[i].x + t * t * b.x, z: u * u * a.z + 2 * u * t * P[i].z + t * t * b.z });
      }
    }
    raw.push(P[n]);
    const out = [raw[0].x, raw[0].z];
    let px = raw[0].x, pz = raw[0].z, need = STEP;
    for (let i = 1; i < raw.length; i++) {
      let ax = px, az = pz;
      const bx = raw[i].x, bz = raw[i].z;
      let seg = Math.hypot(bx - ax, bz - az);
      while (seg >= need) {
        const t = need / seg;
        ax += (bx - ax) * t; az += (bz - az) * t;
        out.push(ax, az);
        seg -= need; need = STEP;
      }
      need -= seg; px = bx; pz = bz;
    }
    out.push(px, pz);
    const pts = new Float32Array(out);
    return { pts, len: (pts.length / 2 - 1) * STEP };
  }

  // 曲线上第 d 距离处的位置与前进方向
  function pos(cv, d, o) {
    const n = cv.pts.length / 2;
    const f = Math.max(0, Math.min(d / STEP, n - 1.0001));
    const i = f | 0, t = f - i, p = cv.pts;
    const x0 = p[i * 2], z0 = p[i * 2 + 1], x1 = p[i * 2 + 2], z1 = p[i * 2 + 3];
    o.x = x0 + (x1 - x0) * t; o.z = z0 + (z1 - z0) * t; o.dx = x1 - x0; o.dz = z1 - z0;
    return o;
  }

  // ---------- 存档 ----------
  function readAll() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function writeAll(o) { try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; } }

  const LEG = { '.': C.GRASS, '#': C.PATH, o: C.SLOT, S: C.SPAWN, E: C.END, T: C.TREE, R: C.ROCK, C: C.CRYSTAL, H: C.HILL };
  function fromAscii(rows) {
    const h = rows.length, w = rows[0].length, cells = [];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) cells.push(LEG[rows[r][c]] ?? C.GRASS);
    return { w, h, cells };
  }
  const SAMPLES = [
    Object.assign({ id: 'sample-1', builtin: true, name: '新手草原', theme: 'grass', sky: 'day', waves: 15, gold: 220, lives: 20 }, fromAscii([
      'TT....T.....TT.T',
      'S####.......o..T',
      '..o.#o..R#####..',
      '....#..T.#...#.T',
      '.C.o#.o.o#.o.#..',
      '..T.#....#R..#o.',
      'T...######...#.T',
      'TT.....o..o..#..',
      '.R....E#######..',
      'TTT......o..TT.C',
    ])),
    Object.assign({ id: 'sample-2', builtin: true, name: '雪原双线', theme: 'snow', sky: 'morning', waves: 20, gold: 320, lives: 20 }, fromAscii([
      'TT..T....T..TTTT',
      '....o...o..o...T',
      'S######...####..',
      '..o...#.o.#.o#.T',
      'R.....#...#..#o.',
      '..T.o.#####..#..',
      '...o..#..o...#.T',
      'S######.....o#E.',
      '..o..o...o.....R',
      'TT.....TT...TTTT',
    ])),
  ];
  const copy = (o) => JSON.parse(JSON.stringify(o));

  function list() {
    const user = Object.values(readAll()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
    return [...SAMPLES.map(copy), ...user];
  }
  function get(id) {
    const s = SAMPLES.find((m) => m.id === id);
    if (s) return copy(s);
    const m = readAll()[id];
    return m ? copy(m) : null;
  }
  function save(m) {
    if (m.builtin) return false;
    const all = readAll();
    m.updated = Date.now();
    all[m.id] = copy(m);
    return writeAll(all);
  }
  function remove(id) { const all = readAll(); delete all[id]; writeAll(all); }
  function newId() { return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }
  function blank(sizeId = 'm') {
    const s = TD.SIZES.find((z) => z.id === sizeId) || TD.SIZES[1];
    return { id: newId(), name: '我的地图', w: s.w, h: s.h, cells: new Array(s.w * s.h).fill(C.GRASS), theme: 'grass', sky: 'day', waves: 15, gold: 220, lives: 20 };
  }
  function resize(m, w, h) {
    const cells = new Array(w * h).fill(C.GRASS);
    const ox = Math.floor((w - m.w) / 2), oy = Math.floor((h - m.h) / 2);
    for (let r = 0; r < m.h; r++) for (let c = 0; c < m.w; c++) {
      const nc = c + ox, nr = r + oy;
      if (nc >= 0 && nr >= 0 && nc < w && nr < h) cells[nr * w + nc] = m.cells[r * m.w + c];
    }
    m.w = w; m.h = h; m.cells = cells;
  }

  function bests() { try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch (e) { return {}; } }
  function best(id) { return bests()[id] || null; }
  function setBest(id, rec) {
    const all = bests(), old = all[id];
    if (!old || rec.stars > old.stars || (rec.stars === old.stars && rec.lives > old.lives)) {
      all[id] = rec;
      try { localStorage.setItem(BEST_KEY, JSON.stringify(all)); } catch (e) { /* 存不下就算了 */ }
      return true;
    }
    return false;
  }

  return { at, center, cellAt, layout, analyze, curve, pos, list, get, save, remove, blank, resize, newId, best, setBest, isWalk, STEP };
})();
