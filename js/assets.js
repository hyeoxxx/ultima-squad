// 게임 리소스 로더 (assets/ — tools/fetch_assets.py 로 maplestory.io 에서 받은 원작 리소스)
(function (G) {
  'use strict';
  const cache = {};
  const mobMeta = {};
  const skillMeta = {};
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
    await Promise.all(Object.keys(G.USData.SKILLS).map(async (k) => {
      try {
        const m = skillMeta[k] = await (await fetch(`assets/skills/${k}/meta.json`)).json();
        // 시전 이펙트가 keydown 에만 있는 스킬은 그걸 시전 이펙트로 쓴다
        if (!m.effect && m.keydown) { m.effect = m.keydown; m.effectKind = 'keydown'; }
      } catch { /* 없음 */ }
    }));
    G.USAssets.ready = true;
  }
  const charSrc = (cls, outfit, w, key, f) => `assets/chars/${cls}/o${outfit}w${w}/${key}${f}.png`;
  function preloadMob(id) {
    const meta = mobMeta[id];
    if (!meta || meta._pre) return;
    meta._pre = true;
    for (const [k, frames] of Object.entries(meta)) if (Array.isArray(frames)) frames.forEach((_, i) => img(`assets/mobs/${id}/${k}${i}.png`));
  }
  // ───────── 사운드 (원작 Sound.wz) ─────────
  let actx = null, sfxGain = null, bgmGain = null, sounds = null;
  const buffers = {}, loading = {};
  let bgmSrc = null, bgmPath = null, wantBgm = null;
  const vol = { sfx: 0.3, bgm: 0.3, bgmOn: true };
  async function initSound() {
    try { sounds = await (await fetch('assets/sound/sounds.json')).json(); } catch { sounds = { skill: {}, mob: {}, game: {}, bgm: {} }; }
  }
  function ctx() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
      sfxGain = actx.createGain(); sfxGain.connect(actx.destination);
      bgmGain = actx.createGain(); bgmGain.connect(actx.destination);
      applyVolume();
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  function applyVolume() {
    if (!actx) return;
    sfxGain.gain.value = vol.sfx;
    bgmGain.gain.value = vol.bgmOn ? vol.bgm : 0;
  }
  function load(path) {
    if (buffers[path] || loading[path] || !actx) return;
    loading[path] = fetch('assets/' + path).then((r) => r.arrayBuffer()).then((a) => actx.decodeAudioData(a))
      .then((buf) => { buffers[path] = buf; }).catch(() => { buffers[path] = null; });
  }
  const last = {};
  function play(path, gain = 1, gap = 0) {
    if (!path || !actx || vol.sfx <= 0) return false;
    const now = performance.now();
    if (gap && last[path] && now - last[path] < gap) return true;
    const buf = buffers[path];
    if (!buf) { load(path); return !!buffers[path]; }
    last[path] = now;
    const src = actx.createBufferSource(), g = actx.createGain();
    g.gain.value = gain;
    src.buffer = buf; src.connect(g).connect(sfxGain); src.start();
    return true;
  }
  function sfx(cat, key, kind, gain, gap) {
    if (!sounds || !actx) return false;
    const t = sounds[cat] && sounds[cat][key];
    const path = kind ? t && t[kind] : t;
    return play(path, gain, gap);
  }
  function preloadSounds(keys) {
    if (!sounds || !actx) return;
    for (const [cat, key] of keys) {
      const t = sounds[cat] && sounds[cat][key];
      if (!t) continue;
      if (typeof t === 'string') load(t); else Object.values(t).forEach(load);
    }
  }
  function bgm(mapKey) {
    wantBgm = mapKey;
    if (!sounds || !actx) return;
    const path = sounds.bgm[mapKey];
    if (!path || path === bgmPath) return;
    bgmPath = path;
    const start = () => {
      if (bgmPath !== path || !buffers[path]) return;
      if (bgmSrc) { try { bgmSrc.stop(); } catch { /* 이미 멈춤 */ } }
      bgmSrc = actx.createBufferSource();
      bgmSrc.buffer = buffers[path]; bgmSrc.loop = true; bgmSrc.connect(bgmGain); bgmSrc.start();
    };
    if (buffers[path]) start(); else { load(path); loading[path] && loading[path].then(start); }
  }
  // 브라우저 정책상 첫 클릭 이후에 소리를 켤 수 있다
  const readyCbs = [];
  document.addEventListener('pointerdown', () => { ctx(); if (wantBgm) { bgmPath = null; bgm(wantBgm); } readyCbs.forEach((f) => f()); }, { once: true });
  initSound();

  function preloadSkill(k) {
    const m = skillMeta[k];
    if (!m || m._pre) return;
    m._pre = true;
    for (const kind of ['effect', 'hit', 'ball']) (m[kind] || []).forEach((_, i) => img(`assets/skills/${k}/${kind === 'effect' ? (m.effectKind || 'effect') : kind}${i}.png`));
  }
  G.USAssets = {
    init, img, mobMeta, skillMeta, preloadMob, preloadSkill,
    sfx, bgm, preloadSounds, vol, applyVolume, audioReady: () => !!actx, onAudioReady: (f) => readyCbs.push(f),
    skill: (k, kind, i) => img(`assets/skills/${k}/${kind === 'effect' && skillMeta[k] && skillMeta[k].effectKind ? skillMeta[k].effectKind : kind}${i}.png`),
    skillIcon: (k) => `assets/skills/${k}/icon.png`,
    char: (cls, outfit, w, key, f) => img(charSrc(cls, outfit, w, key, f)),
    charSrc,
    mob: (id, key, i) => img(`assets/mobs/${id}/${key}${i}.png`),
    bg: (r, m) => img(`assets/maps/${r}_${m}.jpg`),
    iconSrc: (it) => `assets/items/${it.cls}_${it.tier}_${it.slot}.png`,
  };
  init();
})(window);
