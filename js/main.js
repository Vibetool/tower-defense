// 主流程：载入、首页、地图列表、进编辑器/进对战、结算、主循环
TD.ui = (() => {
  const $ = (id) => document.getElementById(id);
  let toastT = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), 2200);
  }
  return { toast, $ };
})();

TD.main = (() => {
  const $ = TD.ui.$;
  const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  let screen = 'loading', last = performance.now();

  function show(id, on) { $(id).classList.toggle('hidden', !on); }
  function setScreen(s) {
    screen = s;
    show('home', s === 'home');
    show('editorUI', s === 'editor');
    show('hud', s === 'game');
    show('result', false);
    show('mapList', false);
    document.body.dataset.screen = s;
    if (s !== 'game') document.body.classList.remove('fp');
  }

  async function boot() {
    document.body.classList.toggle('touch', touch);
    TD.world.init($('view'));
    TD.input.init(TD.world.renderer.domElement, TD.world.camera);
    requestAnimationFrame(loop);
    try {
      await TD.assets.loadAll(TD.MODEL_LIST, (p) => { $('loadPct').textContent = Math.round(p * 100) + '%'; $('loadBar').style.width = p * 100 + '%'; });
    } catch (e) {
      $('loadPct').textContent = '载入失败：' + e.message + '（需要用本地服务器打开，不能直接双击 html）';
      return;
    }
    TD.world.initMarkers();
    TD.editor.buildUI();
    TD.game.bindUI();
    bindUI();
    $('loading').classList.add('hidden');
    $('fpHelp').textContent = touch
      ? '左半屏拖动走路 · 右半屏拖动转头 · 点塔位建塔'
      : 'WASD 走 · Shift 跑 · 鼠标看 · 准星对准塔位点左键建塔 · 数字 1-5 快速建 · V 回上帝视角 · Esc 放开鼠标';
    goHome();
  }

  function goHome() {
    TD.game.stop();
    TD.editor.close();
    setScreen('home');
    const m = TD.maps.get('sample-1');
    TD.world.setSky(m.sky);
    TD.world.buildMap(m);
    TD.input.setMode('god');
    TD.input.frameMap(m.w, m.h);
    TD.input.god.gdist *= 1.08; TD.input.god.dist = TD.input.god.gdist;
    TD.input.setEnabled(false);
  }

  function openList() {
    const maps = TD.maps.list();
    $('mapListBody').innerHTML = maps.map((m) => {
      const b = TD.maps.best(m.id);
      const stars = b ? '★'.repeat(b.stars) + '☆'.repeat(3 - b.stars) : '<span class="dim">未通关</span>';
      return `<div class="mrow">
        <div class="mname"><b>${esc(m.name)}</b>${m.builtin ? '<span class="tag">示例</span>' : ''}
          <small>${m.w}×${m.h} · ${m.theme === 'snow' ? '雪地' : '草地'} · ${m.waves} 波 · 💰${m.gold} · ❤${m.lives}</small></div>
        <div class="mstars">${stars}</div>
        <div class="mbtns">
          <button class="btn sm go" data-act="play" data-id="${m.id}">挑战</button>
          <button class="btn sm alt" data-act="edit" data-id="${m.id}">${m.builtin ? '复制编辑' : '编辑'}</button>
          ${m.builtin ? '' : `<button class="btn sm ghost" data-act="del" data-id="${m.id}">删除</button>`}
        </div></div>`;
    }).join('');
    show('mapList', true);
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function editMap(id) {
    const m = id ? TD.maps.get(id) : TD.maps.blank('m');
    if (!m) { TD.ui.toast('找不到这张地图'); return; }
    TD.game.stop();
    setScreen('editor');
    TD.input.setEnabled(true);
    TD.editor.open(m);
  }

  function startGame(id, opts = {}) {
    const m = TD.maps.get(id);
    if (!m) { TD.ui.toast('找不到这张地图'); return; }
    TD.editor.close();
    setScreen('game');
    TD.input.setEnabled(true);
    if (!TD.game.start(m, opts)) { editMap(id); return; }
    TD.game.setSpeed(1);
  }

  function showResult(r) {
    $('resTitle').textContent = r.win ? '守住了！' : '城堡失守';
    $('resTitle').className = r.win ? 'win' : 'lose';
    $('resStars').innerHTML = r.win ? '<span>★</span>'.repeat(r.stars) + '<span class="off">★</span>'.repeat(3 - r.stars) : '';
    $('resInfo').innerHTML = (r.win
      ? `打完全部 ${r.total} 波 · 剩余生命 ${r.lives}/${r.max} · 击落 ${r.kills} 架`
      : `撑到第 ${r.wave}/${r.total} 波 · 击落 ${r.kills} 架`) + (r.record ? '<br><b class="rec">新纪录！</b>' : '');
    $('resEdit').textContent = TD.maps.get(r.mapId) && TD.maps.get(r.mapId).builtin ? '复制编辑' : '编辑地图';
    $('resAgain').onclick = () => startGame(r.mapId, { from: r.from });
    $('resEdit').onclick = () => editMap(r.mapId);
    $('resHome').onclick = goHome;
    show('result', true);
  }

  function bindUI() {
    $('btnPlay').onclick = openList;
    $('btnEdit').onclick = () => editMap(null);
    $('mapListClose').onclick = () => show('mapList', false);
    $('mapListNew').onclick = () => editMap(null);
    $('mapListBody').onclick = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'play') startGame(id, { from: 'list' });
      else if (b.dataset.act === 'edit') editMap(id);
      else if (b.dataset.act === 'del') {
        const m = TD.maps.get(id);
        if (m && confirm(`删除「${m.name}」？删了找不回来。`)) { TD.maps.remove(id); openList(); }
      }
    };
    window.addEventListener('keydown', (e) => {
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'SELECT' || tg.tagName === 'TEXTAREA')) return;
      if (screen === 'game') TD.game.key(e);
      else if (screen === 'editor') TD.editor.key(e);
    });
    TD.input.on('joy', (on, x, y, vx, vy) => {
      const j = $('joy');
      j.classList.toggle('hidden', !on);
      if (!on) return;
      j.style.left = x + 'px'; j.style.top = y + 'px';
      $('joyKnob').style.transform = `translate(${vx * 40}px, ${vy * 40}px)`;
    });
    TD.input.on('lockChange', (locked) => document.body.classList.toggle('locked', locked));
    document.addEventListener('visibilitychange', () => {
      const S = TD.game.state;
      if (document.hidden && screen === 'game' && S && !S.paused && !S.over) TD.game.setSpeed(0);
    });
    window.addEventListener('beforeunload', (e) => {
      if (screen === 'editor' && TD.editor.unsaved) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (screen === 'home') TD.input.god.gyaw += dt * 0.06;
    TD.input.update(dt);
    if (screen === 'game') { TD.game.update(dt); TD.game.tickHUD(dt); }
    else if (screen === 'editor') TD.editor.update(dt);
    TD.world.update(dt);
    TD.world.render();
    requestAnimationFrame(loop);
  }

  window.addEventListener('DOMContentLoaded', boot);
  return { goHome, editMap, startGame, showResult, openList, get screen() { return screen; } };
})();
