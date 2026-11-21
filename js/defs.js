// 全局数据定义：地块、塔、敌人、编辑工具、要预载的模型
window.TD = {};

// 叠放在别的面上的东西一律抬高这么一点点（肉眼看不出），避免两个面重合闪烁（z-fighting）
TD.LIFT = 0.004;

TD.C = { GRASS: 0, PATH: 1, SLOT: 2, SPAWN: 3, END: 4, TREE: 5, ROCK: 6, CRYSTAL: 7, HILL: 8 };

// 编辑器工具（icon 用 Kenney 预览图）
TD.TOOLS = [
  { id: 'path', cell: TD.C.PATH, icon: 'assets/ui/tile-straight.png', name: '道路', key: '1' },
  { id: 'slot', cell: TD.C.SLOT, icon: 'assets/ui/spawn-square.png', name: '塔位', key: '2' },
  { id: 'spawn', cell: TD.C.SPAWN, icon: 'assets/ui/tile-spawn-end.png', name: '起点', key: '3' },
  { id: 'end', cell: TD.C.END, icon: 'assets/ui/tower-round-build-d.png', name: '终点', key: '4' },
  { id: 'tree', cell: TD.C.TREE, icon: 'assets/ui/tile-tree.png', name: '树', key: '5' },
  { id: 'rock', cell: TD.C.ROCK, icon: 'assets/ui/tile-rock.png', name: '石头', key: '6' },
  { id: 'crystal', cell: TD.C.CRYSTAL, icon: 'assets/ui/tile-crystal.png', name: '水晶', key: '7' },
  { id: 'hill', cell: TD.C.HILL, icon: 'assets/ui/tile-hill.png', name: '小山', key: '8' },
  { id: 'erase', cell: TD.C.GRASS, icon: 'assets/ui/tile.png', name: '橡皮', key: '9' },
  { id: 'hand', cell: null, icon: '', emoji: '✋', name: '拖动', key: '0' },
];

TD.SKIES = [
  { id: 'day', name: '白天' }, { id: 'morning', name: '清晨' }, { id: 'night', name: '夜晚' },
  { id: 'alien', name: '外星' }, { id: 'space', name: '太空' },
];
TD.SIZES = [
  { id: 's', name: '小 12×8', w: 12, h: 8 },
  { id: 'm', name: '中 16×10', w: 16, h: 10 },
  { id: 'l', name: '大 20×14', w: 20, h: 14 },
];

// 台子：草地上花钱建；地图上的塔位 = 免费台子。塔（武器）只能放在台子或塔位上
TD.TOWER_SCALE = 0.64;
TD.PADS = {
  plain: {
    name: '台子', icon: 'assets/ui/tower-round-bottom-a.png', model: 'tower-round-bottom-a', cost: 30, sell: 20,
    desc: '空台子，上面可以放塔',
  },
  barrel: {
    name: '带炮台的台子', icon: 'assets/ui/tower-round-middle-b.png', model: 'tower-round-middle-b', cost: 50, sell: 35,
    dmg: 22, rate: 1, range: 2.6, speed: 9, ammo: 'weapon-ammo-cannonball',
    desc: '自带炮管，每秒一发 22 伤害；上面还能再放塔',
  },
};

// 塔（武器）：升级只涨数值，不再往上叠塔身
TD.TOWERS = {
  ballista: {
    name: '弩车', icon: 'assets/ui/weapon-ballista.png', cost: 70, kind: 'direct',
    weapon: 'weapon-ballista', ammo: 'weapon-ammo-arrow', speed: 11,
    dmg: [22, 34, 50], rate: [0.9, 1.0, 1.2], range: [3.2, 3.5, 3.9],
    desc: '单体攻击，射程远，打重甲也不亏',
  },
  turret: {
    name: '机枪塔', icon: 'assets/ui/weapon-turret.png', cost: 80, kind: 'direct',
    weapon: 'weapon-turret', ammo: 'weapon-ammo-bullet', speed: 16,
    dmg: [7, 10, 14], rate: [4, 5, 6], range: [2.4, 2.6, 2.8],
    desc: '射速极快，但打重甲很吃亏',
  },
  cannon: {
    name: '加农炮', icon: 'assets/ui/weapon-cannon.png', cost: 110, kind: 'arc', arc: 0.7,
    weapon: 'weapon-cannon', ammo: 'weapon-ammo-cannonball', speed: 6,
    dmg: [38, 58, 88], rate: [0.65, 0.75, 0.9], range: [2.8, 3.1, 3.5], splash: [0.9, 1.0, 1.15],
    desc: '炮弹落地爆炸，打一片',
  },
  catapult: {
    name: '投石车', icon: 'assets/ui/weapon-catapult.png', cost: 140, kind: 'arc', arc: 1.8,
    weapon: 'weapon-catapult', ammo: 'weapon-ammo-boulder', speed: 5, minRange: 1.2,
    dmg: [65, 100, 155], rate: [0.33, 0.4, 0.48], range: [4.2, 4.8, 5.5], splash: [1.1, 1.25, 1.4],
    desc: '超远射程、大范围，脚下打不到',
  },
  frost: {
    name: '冰晶塔', icon: 'assets/ui/tower-round-crystals.png', cost: 90, kind: 'aura',
    weapon: 'tower-round-crystals',
    dmg: [4, 7, 11], slow: [0.35, 0.45, 0.55], range: [1.8, 2.1, 2.4],
    desc: '范围减速，顺带一点持续伤害',
  },
};
TD.TOWER_ORDER = ['ballista', 'turret', 'cannon', 'catapult', 'frost'];
TD.upgradeCost = (type, level) => Math.round(TD.TOWERS[type].cost * (level === 1 ? 0.75 : 1.25));

// 敌人：speed 单位是 格/秒，hover 是离路面的高度
TD.ENEMIES = {
  normal: { name: '飞碟', icon: 'assets/ui/enemy-ufo-a.png', model: 'enemy-ufo-a', hp: 80, speed: 1.2, reward: 5, dmg: 1, scale: 0.5, armor: 0, hover: 0.36 },
  scout: { name: '侦察机', icon: 'assets/ui/enemy-ufo-b.png', model: 'enemy-ufo-b', hp: 45, speed: 2.0, reward: 3, dmg: 1, scale: 0.42, armor: 0, hover: 0.44 },
  tank: { name: '重甲', icon: 'assets/ui/enemy-ufo-c.png', model: 'enemy-ufo-c', hp: 300, speed: 0.75, reward: 15, dmg: 2, scale: 0.62, armor: 4, hover: 0.34 },
  boss: { name: '母舰', icon: 'assets/ui/enemy-ufo-d-weapon.png', model: 'enemy-ufo-d-weapon', hp: 1000, speed: 0.5, reward: 100, dmg: 5, scale: 1.0, armor: 2, hover: 0.5 },
};

// 第 n 波的构成（共 total 波）
TD.waveDef = (n, total) => {
  const g = [];
  if (n % 5 === 0) {
    g.push({ type: 'normal', count: 4 + n, gap: 0.8 });
    g.push({ type: 'boss', count: Math.max(1, Math.floor(n / 10) + (n === total ? 1 : 0)), gap: 3 });
  } else {
    g.push({ type: 'normal', count: 5 + Math.floor(n * 1.2), gap: 0.8 });
    if (n >= 2) g.push({ type: 'scout', count: 2 + n, gap: 0.4 });
    if (n >= 4) g.push({ type: 'tank', count: Math.floor((n - 2) / 2), gap: 1.6 });
  }
  const k = n - 1;
  return { groups: g, hpMul: 1 + 0.1 * k + 0.02 * k * k };
};

TD.CASTLE_PARTS = ['tower-round-base', 'tower-round-bottom-c', 'tower-round-middle-c', 'tower-round-roof-c'];

TD.MODEL_LIST = (() => {
  const tiles = ['tile', 'tile-straight', 'tile-corner-round', 'tile-split', 'tile-crossing', 'tile-end', 'tile-end-round',
    'tile-spawn', 'tile-spawn-end', 'tile-dirt', 'tile-tree', 'tile-tree-double', 'tile-tree-quad', 'tile-rock', 'tile-crystal', 'tile-hill'];
  const list = [...tiles, ...tiles.map(t => 'snow-' + t), 'spawn-round', 'spawn-square', 'selection-a', 'selection-b', ...TD.CASTLE_PARTS];
  for (const t of Object.values(TD.TOWERS)) list.push(t.weapon, ...(t.ammo ? [t.ammo] : []));
  for (const p of Object.values(TD.PADS)) list.push(p.model, ...(p.ammo ? [p.ammo] : []));
  for (const e of Object.values(TD.ENEMIES)) list.push(e.model);
  return [...new Set(list)];
})();
