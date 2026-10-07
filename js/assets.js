// 게임 리소스 로더 (assets/ — tools/fetch_assets.py 로 maplestory.io 에서 받은 원작 리소스)
(function (G) {
  'use strict';
  const cache = {};
  const mobMeta = {};
  function img(src) {
    let i = cache[src];
    if (!i) { i = new Image(); i.src = src; cache[src] = i; i.onerror = () => { i.failed = true; }; }
    return i.complete && i.naturalWidth ? i : null;
  }
  async function init() {
    try {
      const man = await (await fetch('assets/manifest.json')).json();
      await Promise.all(Object.keys(man.mobs || {}).map(async (id) => {
        try { mobMeta[id] = await (await fetch(`assets/mobs/${id}/meta.json`)).json(); } catch { /* 없음 */ }
      }));
    } catch { /* 리소스 없이도 이모지로 동작 */ }
    G.USAssets.ready = true;
  }
  const charSrc = (cls, outfit, w, key, f) => `assets/chars/${cls}/o${outfit}w${w}/${key}${f}.png`;
  function preloadMob(id) {
    const meta = mobMeta[id];
    if (!meta || meta._pre) return;
    meta._pre = true;
    for (const [k, frames] of Object.entries(meta)) if (Array.isArray(frames)) frames.forEach((_, i) => img(`assets/mobs/${id}/${k}${i}.png`));
  }
  G.USAssets = {
    init, img, mobMeta, preloadMob,
    char: (cls, outfit, w, key, f) => img(charSrc(cls, outfit, w, key, f)),
    charSrc,
    mob: (id, key, i) => img(`assets/mobs/${id}/${key}${i}.png`),
    bg: (r, m) => img(`assets/maps/${r}_${m}.jpg`),
    iconSrc: (it) => `assets/items/${it.cls}_${it.tier}_${it.slot}.png`,
  };
  init();
})(window);
