// 봇이 계속 접속한 채로 플레이했을 때 진행 속도 확인
//   node tools/playtest.js [시간(h)] [하루 오프라인 시간(h)]
'use strict';
require('../js/data.js'); require('../js/engine.js'); require('../js/monsters.js');
const D = globalThis.USData, US = globalThis.US;
US.setRandom(US.mulberry32(7));

const HOURS = +(process.argv[2] || 72);
const OFF_PER_DAY = +(process.argv[3] || 0);
let now = Date.UTC(2026, 6, 23, 1, 0, 0);
const st = US.newState(now);

const score = (it, cls) => it.slot === 'weapon'
  ? it.atk + it.pot.reduce((s, p) => s + ((cls === 'mage' ? p.k === 'matk' : p.k === 'atk') ? p.v : 0) + ((cls === 'mage' ? p.k === 'matkp' : p.k === 'atkp') ? p.v * 4 : 0), 0)
  : it.hp + it.def * 3 + it.pot.reduce((s, p) => s + (p.k === 'hp' ? p.v : p.k === 'def' ? p.v * 3 : 0), 0);

function pickSkills(cls, lv, slots, mode, idx) {
  const s = idx % 10, r = Math.floor(idx / 10), boss = s === 9;
  let pri;
  if (cls === 'war') pri = ['demon_bane', 'divide', 'aura_blade', 'blessed_hammer', 'iron_body'];
  if (cls === 'arch') pri = boss ? ['storm_arrow', 'dragon_burst', 'vortex_sphere', 'charged_arrow'] : ['dragon_burst', 'vortex_sphere', 'charged_arrow', 'storm_arrow', 'soul_contract'];
  if (cls === 'mage') pri = boss && r === 1 ? ['heavens_door', 'heal', 'chain_lightning'] : ['zodiac_ray', 'pray', 'flame_sweep', 'chain_lightning', 'heavens_door', 'heal'];
  const got = pri.filter((id) => D.SKILLS[id].lv <= lv).slice(0, slots);
  while (got.length < 3) got.push(null);
  return got;
}

function manage() {
  for (const c of ['arch', 'mage']) US.recruit(st, c);
  for (const k of ['slots', 'gold', 'drop']) US.buyUtil(st, k);
  if (st.invSize < 60) US.expandInv(st, 60 - st.invSize);
  // 합성 → 장착 → 정리
  let g; while ((g = US.autoSynthGroup(st))) US.synthesize(st, g);
  for (const c of US.ownedMercs(st)) {
    const m = st.mercs[c];
    for (const slot of D.SLOTS) {
      const cands = st.inventory.filter((it) => it.cls === c && it.slot === slot && US.canEquip(st, c, it));
      if (!cands.length) continue;
      const best = cands.reduce((a, b) => (score(b, c) > score(a, c) ? b : a));
      if (!m.equip[slot] || score(best, c) > score(m.equip[slot], c)) US.equipItem(st, best.id);
    }
    m.skills = pickSkills(c, m.lv, st.util.slots, st.mode, st.stage);
  }
  // 큐브: 무기에 공격 잠재가 없으면 돌림
  for (const c of US.ownedMercs(st)) {
    const w = st.mercs[c].equip.weapon;
    while (w && w.tier >= 3 && st.cubes > 0 && !w.pot.some((p) => p.k === (c === 'mage' ? 'matk' : 'atk'))) { const r = US.cubeRoll(st, w.id); US.cubeApply(st, w.id, r.after); }
  }
  if (st.inventory.length > st.invSize * 0.7) {
    const keepTier = Math.max(...st.inventory.map((x) => x.tier));
    const counts = {};
    for (const it of st.inventory) counts[it.tier] = (counts[it.tier] || 0) + 1;
    // 합성 재료로 모으는 중인 최고 단계 근처는 남기고, 개수가 적은 낮은 단계를 분해
    US.dismantle(st, st.inventory.filter((x) => x.tier < keepTier - 1 && counts[x.tier] < 9).map((x) => x.id));
    if (st.inventory.length >= st.invSize - 2) US.dismantle(st, st.inventory.filter((x) => x.tier <= 2).map((x) => x.id));
  }
}

const firsts = [];
let b = US.createBattle(st, now);
let lastTry = 0, lastBoxDay = '';
const endT = HOURS * 3600;
let t = 0, offlineLeft = 0;
let nextDay = 24 * 3600;
const before = {};
const report = (label) => console.log(`${(t / 3600).toFixed(1).padStart(6)}h  ${label.padEnd(16)} 전${st.mercs.war.lv} 궁${st.mercs.arch.owned ? st.mercs.arch.lv : '-'} 마${st.mercs.mage.owned ? st.mercs.mage.lv : '-'}  골드 ${US.fmt(st.gold)}  큐브 ${st.cubes}  인벤 ${st.inventory.length}/${st.invSize}  장비 ${D.CLASSES.map((c) => D.SLOTS.map((s) => (st.mercs[c].equip[s] ? st.mercs[c].equip[s].tier : 0)).join('')).join('/')}`);
manage();
while (t < endT) {
  // 하루 중 오프라인 구간
  if (OFF_PER_DAY && t >= nextDay - OFF_PER_DAY * 3600 && t < nextDay) {
    st.lastSeen = now;
    now += OFF_PER_DAY * 3600 * 1000; t += OFF_PER_DAY * 3600; nextDay += 24 * 3600;
    US.applyOffline(st, now);
    manage(); b = US.createBattle(st, now);
    continue;
  }
  US.stepBattle(st, b, US.DT); t += US.DT; now += US.DT * 1000;
  if (b.events.length > 3000) b.events.length = 0;
  const day = US.today(now);
  if (day !== lastBoxDay && b.spawned > 0 && b.spawned < 50) { if (US.summonBox(st, b, now).ok) lastBoxDay = day; }
  if (b.done) {
    const was = US.isCleared(st, b.mode, b.idx);
    US.finishBattle(st, b, now);
    if (!was && US.isCleared(st, b.mode, b.idx)) { report(`${b.mode === 'chaos' ? 'C' : 'N'} ${b.info.label} 클리어`); }
    manage();
    // 반복 중이면 10분마다 다음 스테이지 재도전
    if (st.repeat && t - lastTry > 600) {
      lastTry = t;
      const mode = US.chaosUnlocked(st) ? 'chaos' : 'normal';
      const f = US.frontier(st, mode);
      if (!(mode === 'chaos' && US.isCleared(st, 'chaos', 29)) && US.canEnter(st, mode, f)) { st.mode = mode; st.stage = f; st.repeat = false; manage(); }
    }
    b = US.createBattle(st, now);
  }
}
report('종료');
