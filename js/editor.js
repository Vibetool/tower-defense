// 地图编辑器：在格子上画道路、塔位、起点、终点、装饰
TD.editor = (() => {
  const C = TD.C;
  const $ = (id) => document.getElementById(id);
  let map = null, tool = TD.TOOLS[0], dirty = false, unsaved = false, active = false;
  let stroke = null; // {mode:'paint'|'erase', last:{c,r}}
  let analysis = null;

  function buildUI() {
    const tb = $('edTools');
    tb.innerHTML = '';
    for (const t of TD.TOOLS) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.dataset.tool = t.id;
      b.title = `${t.name}（${t.key}）`;
      b.innerHTML = (t.icon ? `<img src="${t.icon}" alt="">` : `<span class="emo">${t.emoji}</span>`) + `<span>${t.name}</span>`;
      b.onclick = () => setTool(t.id);
      tb.appendChild(b);
    }
    $('edSize').innerHTML = TD.SIZES.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    $('edSky').innerHTML = TD.SKIES.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    $('edName').oninput = () => { map.name = $('edName').value.slice(0, 20) || '未命名'; unsaved = true; };
    $('edSize').onchange = () => {
      const s = TD.SIZES.find((z) => z.id === $('edSize').value);
      if (s.w < map.w || s.h < map.h) {
        if (!confirm(`缩小到 ${s.w}×${s.h} 会裁掉四周的格子，继续吗？`)) { $('edSize').value = sizeId(); return; }
      }
      TD.maps.resize(map, s.w, s.h);
      TD.input.frameMap(map.w, map.h);
      changed();
    };
    $('edTheme').onchange = () => { map.theme = $('edTheme').value; changed(); };
    $('edSky').onchange = () => { map.sky = $('edSky').value; TD.world.setSky(map.sky); unsaved = true; };
    $('edWaves').onchange = () => { map.waves = +$('edWaves').value; unsaved = true; };
    $('edGold').onchange = () => { map.gold = Math.max(50, Math.min(5000, +$('edGold').value || 220)); $('edGold').value = map.gold; unsaved = true; };
    $('edLives').onchange = () => { map.lives = Math.max(1, Math.min(100, +$('edLives').value || 20)); $('edLives').value = map.lives; unsaved = true; };
    $('edClear').onclick = () => { if (confirm('把整张地图清成草地？')) { map.cells.fill(C.GRASS); changed(); } };
    $('edSave').onclick = save;
    $('edTest').onclick = () => {
      if (!analysis || !analysis.ok) { TD.ui.toast(analysis ? analysis.errors[0] : '地图还不能玩'); return; }
      if (!save()) return;
      TD.main.startGame(map.id, { from: 'editor' });
    };
    $('edBack').onclick = () => { if (confirmLeave()) TD.main.goHome(); };
    $('edRotL').onclick = () => TD.input.rotate(Math.PI / 4);
    $('edRotR').onclick = () => TD.input.rotate(-Math.PI / 4);
    $('edZoomIn').onclick = () => TD.input.zoom(0.8);
    $('edZoomOut').onclick = () => TD.input.zoom(1.25);
  }

  function sizeId() {
    const s = TD.SIZES.find((z) => z.w === map.w && z.h === map.h);
    return s ? s.id : 'm';
  }

  function open(m) {
    map = m;
    if (map.builtin) {
      map = JSON.parse(JSON.stringify(m));
      delete map.builtin;
      map.id = TD.maps.newId();
      map.name = m.name + ' 副本';
      unsaved = true;
    } else unsaved = false;
    active = true;
    $('edName').value = map.name;
    $('edSize').value = sizeId();
    $('edTheme').value = map.theme || 'grass';
    $('edSky').value = map.sky || 'day';
    $('edWaves').value = String(map.waves || 15);
    $('edGold').value = map.gold || 220;
    $('edLives').value = map.lives || 20;
    TD.world.setSky(map.sky);
    TD.world.setGrid(true);
    TD.world.buildMap(map);
    TD.input.setMode('god');
    TD.input.setLeft('paint');
    TD.input.frameMap(map.w, map.h);
    TD.input.on('paint', onPaint);
    TD.input.on('hover', onHover);
    TD.input.on('tap', null);
    setTool(tool.id);
    refresh();
  }

  function close() {
    active = false;
    TD.world.setGrid(false);
    TD.world.showRoutes(null);
    TD.world.setHover(null);
    TD.input.setHand(false);
    TD.input.on('paint', null);
    TD.input.on('hover', null);
  }

  function setTool(id) {
    tool = TD.TOOLS.find((t) => t.id === id) || TD.TOOLS[0];
    document.querySelectorAll('#edTools .tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool.id));
    TD.input.setHand(tool.id === 'hand');
  }

  function cellFromScreen(x, y) { return TD.world.pickGround(TD.world.rayAt(x, y)); }

  function apply(c, r) {
    const i = r * map.w + c;
    const want = stroke.mode === 'erase' ? C.GRASS : tool.cell;
    if (map.cells[i] === want) return;
    if (want === C.END) map.cells.forEach((t, k) => { if (t === C.END) map.cells[k] = C.GRASS; }); // 终点只有一个
    map.cells[i] = want;
    changed();
  }

  function onPaint(phase, x, y, erase) {
    if (!active) return;
    if (phase === 'end') { stroke = null; return; }
    const cell = cellFromScreen(x, y);
    if (phase === 'start') {
      if (tool.cell == null && !erase) return;
      stroke = { mode: erase ? 'erase' : 'paint', last: null };
    }
    if (!stroke || !cell) return;
    // 4 连通插值，快速拖动也不会断路
    let { c, r } = stroke.last || cell;
    if (!stroke.last) apply(c, r);
    while (c !== cell.c || r !== cell.r) {
      if (Math.abs(cell.c - c) >= Math.abs(cell.r - r)) c += Math.sign(cell.c - c); else r += Math.sign(cell.r - r);
      apply(c, r);
      if (stroke.mode === 'paint' && (tool.cell === C.END || tool.cell === C.SPAWN)) break;
    }
    stroke.last = { c: cell.c, r: cell.r };
  }

  function onHover(x, y) {
    if (!active) return;
    const cell = x == null ? null : cellFromScreen(x, y);
    TD.world.setHover(tool.cell == null ? null : cell);
  }

  function changed() { dirty = true; unsaved = true; }

  function refresh() {
    TD.world.buildMap(map);
    analysis = TD.maps.analyze(map);
    TD.world.showRoutes(analysis.routes.map((r) => TD.maps.curve(map, r)));
    const st = $('edStatus');
    if (analysis.ok) {
      st.className = 'ok';
      st.textContent = `✔ 可以玩了 · 路线 ${analysis.routes.length} 条，最短 ${analysis.minLen} 格 · 免费塔位 ${analysis.slots} 个（草地上也能花钱建台子）`;
    } else {
      st.className = 'bad';
      st.textContent = '✘ ' + analysis.errors.join('；');
    }
    $('edTest').classList.toggle('dim', !analysis.ok);
  }

  function save() {
    map.name = ($('edName').value || '').trim().slice(0, 20) || '我的地图';
    if (!TD.maps.save(map)) { TD.ui.toast('保存失败：浏览器存储不可用'); return false; }
    unsaved = false;
    TD.ui.toast('已保存「' + map.name + '」');
    return true;
  }

  function confirmLeave() { return !unsaved || confirm('有修改还没保存，确定离开？'); }

  function update() {
    if (!active) return;
    if (dirty) { dirty = false; refresh(); }
  }

  function key(e) {
    if (!active) return false;
    const t = TD.TOOLS.find((x) => x.key === e.key);
    if (t) { setTool(t.id); return true; }
    if ((e.metaKey || e.ctrlKey) && e.code === 'KeyS') { e.preventDefault(); save(); return true; }
    return false;
  }

  return { buildUI, open, close, update, key, confirmLeave, get map() { return map; }, get unsaved() { return active && unsaved; } };
})();
