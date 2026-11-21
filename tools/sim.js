// 数值测试：在页面控制台里载入后跑 TD_SIM.run()。
// 用一个简单的「AI 玩家」按 order 轮流建塔（优先覆盖路线最多的塔位），没塔位了就升级最低级的塔。
window.TD_SIM = (() => {
  function sim(mapId, order, opt = {}) {
    TD.main.startGame(mapId, { from: 'list' });
    const S = TD.game.state;
    S.speed = 4;
    const m = S.map;
    const cover = (i, r) => {
      const c = TD.maps.center(m, i % m.w, (i / m.w) | 0);
      let n = 0;
      for (const cv of S.curves) for (let k = 0; k < cv.pts.length; k += 2) if (Math.hypot(cv.pts[k] - c.x, cv.pts[k + 1] - c.z) <= r) n++;
      return n;
    };
    const slots = m.cells.map((t, i) => (t === TD.C.SLOT ? i : -1)).filter((i) => i >= 0).sort((a, b) => cover(b, 3) - cover(a, 3));
    let k = 0;
    const log = [];
    const spend = () => {
      for (let guard = 0; guard < 60; guard++) {
        const free = slots.filter((i) => !S.towers.has(i));
        const ups = [...S.towers.values()].filter((t) => t.level < 3).sort((a, b) => a.level - b.level || cover(b.i, 3) - cover(a.i, 3));
        const nextType = order[k % order.length];
        const canBuild = free.length && S.gold >= TD.TOWERS[nextType].cost;
        const up = ups[0];
        const canUp = up && S.gold >= TD.upgradeCost(up.type, up.level);
        if (opt.maxTowers && S.towers.size >= opt.maxTowers) { if (canUp) { TD.game._upgrade(up.i); continue; } break; }
        if (canBuild) { TD.game._build(free[0], nextType); k++; continue; }
        // 造不起下一座时先升级（像真人一样不囤钱）；没空位了就一直升级
        if (canUp && (S.towers.size >= 4 || !free.length)) { TD.game._upgrade(up.i); continue; }
        break;
      }
    };
    for (let w = 1; w <= S.total && !S.over; w++) {
      spend();
      TD.game.startWave();
      let guard = 0;
      while (S.running && !S.over && guard++ < 30000) { TD.game.update(0.1); if (guard % 20 === 0) spend(); }
      log.push(S.lives);
    }
    const r = { map: mapId, order: order.join('/') + (opt.maxTowers ? ' 最多' + opt.maxTowers + '座' : ''), win: S.lives > 0, wave: S.wave, lives: S.lives, gold: S.gold,
      towers: [...S.towers.values()].map((t) => t.type[0] + t.level).join(' '), livesByWave: log.join(',') };
    TD.game.stop();
    return r;
  }
  // 带草地台子的打法：grass = 塔位用完后在草地上建「台子 + 塔」；barrel = 只铺带炮台的台子；barrelTop = 先铺炮台台子再往上放塔
  function simPads(mapId, mode, order = MIX) {
    TD.main.startGame(mapId, { from: 'list' });
    const S = TD.game.state;
    S.speed = 4;
    const m = S.map;
    const cover = (i, r) => {
      const c = TD.maps.center(m, i % m.w, (i / m.w) | 0);
      let n = 0;
      for (const cv of S.curves) for (let k = 0; k < cv.pts.length; k += 2) if (Math.hypot(cv.pts[k] - c.x, cv.pts[k + 1] - c.z) <= r) n++;
      return n;
    };
    const byCover = (list) => list.sort((a, b) => cover(b, 2.6) - cover(a, 2.6));
    const slots = byCover(m.cells.map((t, i) => (t === TD.C.SLOT ? i : -1)).filter((i) => i >= 0));
    const grass = byCover(m.cells.map((t, i) => (t === TD.C.GRASS ? i : -1)).filter((i) => i >= 0));
    const spots = mode === 'grass' ? slots : byCover([...slots, ...grass]);
    let k = 0;
    const log = [];
    const spend = () => {
      for (let g = 0; g < 80; g++) {
        const ups = [...S.towers.values()].filter((t) => t.level < 3).sort((a, b) => a.level - b.level);
        const up = ups[0], canUp = up && S.gold >= TD.upgradeCost(up.type, up.level);
        const nextType = order[k % order.length], wc = TD.TOWERS[nextType].cost;
        if (mode === 'grass') {
          const freeSlot = slots.find((i) => !S.towers.has(i));
          if (freeSlot != null && S.gold >= wc) { TD.game._build(freeSlot, nextType); k++; continue; }
          const g2 = grass.find((i) => !S.pads.has(i));
          if (freeSlot == null && g2 != null && S.gold >= 30 + wc) { TD.game._buildPad(g2, 'plain'); TD.game._build(g2, nextType); k++; continue; }
          if (canUp && S.towers.size >= 4) { TD.game._upgrade(up.i); continue; }
          break;
        }
        const freePad = spots.find((i) => !S.pads.has(i) && !S.towers.has(i));
        if (freePad != null && S.gold >= 50) { TD.game._buildPad(freePad, 'barrel'); continue; }
        if (mode === 'barrelTop') {
          const bare = [...S.pads.values()].find((p) => !S.towers.has(p.i));
          if (bare && S.gold >= wc) { TD.game._build(bare.i, nextType); k++; continue; }
          if (canUp) { TD.game._upgrade(up.i); continue; }
        }
        break;
      }
    };
    for (let w = 1; w <= S.total && !S.over; w++) {
      spend();
      TD.game.startWave();
      let guard = 0;
      while (S.running && !S.over && guard++ < 30000) { TD.game.update(0.1); if (guard % 20 === 0) spend(); }
      log.push(S.lives);
    }
    const r = { map: mapId, order: '草地打法:' + mode, win: S.lives > 0, wave: S.wave, lives: S.lives, gold: S.gold, livesByWave: log.join(','), pads: S.pads.size, towers: S.towers.size };
    TD.game.stop();
    return r;
  }

  const MIX = ['ballista', 'cannon', 'ballista', 'turret', 'frost', 'catapult'];
  function run() {
    const out = [];
    for (const id of ['sample-1', 'sample-2']) {
      out.push(simPads(id, 'grass'));
      out.push(simPads(id, 'barrel'));
      out.push(simPads(id, 'barrelTop'));
      out.push(sim(id, MIX));
      out.push(sim(id, ['ballista']));
      out.push(sim(id, ['turret']));
      out.push(sim(id, ['cannon']));
      out.push(sim(id, ['catapult']));
      out.push(sim(id, ['ballista', 'cannon']));
    }
    document.getElementById('result').classList.add('hidden');
    return out.map((r) => `${r.map} ${r.order.padEnd(44)} ${r.win ? '赢' : '输'} 波${r.wave} 命${r.lives} 余金${r.gold} | ${r.livesByWave}`).join('\n');
  }
  return { sim, simPads, run };
})();
