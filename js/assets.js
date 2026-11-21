// 模型与天空盒载入。所有 Kenney 模型共用一张 colormap 贴图，载入后把材质按名字合并成一份
TD.assets = (() => {
  THREE.Cache.enabled = true;
  const loader = new THREE.GLTFLoader();
  const models = {};
  const mats = {};

  function shareMat(m) {
    const k = m.name || m.uuid;
    if (!mats[k]) mats[k] = m;
    return mats[k];
  }

  function loadOne(name) {
    return new Promise((resolve, reject) => {
      loader.load('assets/models/' + name + '.glb', (g) => {
        const scene = g.scene;
        scene.traverse((o) => {
          if (!o.isMesh) return;
          o.material = Array.isArray(o.material) ? o.material.map(shareMat) : shareMat(o.material);
          o.castShadow = true;
          o.receiveShadow = true;
        });
        scene.updateMatrixWorld(true);
        const parts = [];
        scene.traverse((o) => { if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() }); });
        const box = new THREE.Box3().setFromObject(scene);
        models[name] = { scene, parts, box, height: box.max.y - box.min.y };
        resolve();
      }, undefined, () => reject(new Error('模型载入失败：' + name)));
    });
  }

  async function loadAll(names, onProgress) {
    let done = 0;
    await Promise.all(names.map((n) => loadOne(n).then(() => onProgress && onProgress(++done / names.length))));
  }

  function get(name) { return models[name]; }
  function clone(name) {
    const m = models[name];
    if (!m) throw new Error('没有这个模型：' + name);
    return m.scene.clone(true);
  }
  function height(name) { return models[name] ? models[name].height : 0; }
  function materials() { return Object.values(mats); }

  const skies = {};
  function sky(id) {
    if (!skies[id]) {
      skies[id] = new Promise((resolve) => {
        new THREE.TextureLoader().load('assets/sky/' + id + '.jpg', (t) => {
          t.mapping = THREE.EquirectangularReflectionMapping;
          t.encoding = THREE.sRGBEncoding;
          resolve(t);
        }, undefined, () => resolve(null));
      });
    }
    return skies[id];
  }

  return { loadAll, get, clone, height, materials, sky };
})();
