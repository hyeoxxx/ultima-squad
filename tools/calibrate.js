// 몬스터 능력치 보정: 각 스테이지의 "권장 레벨" 기준 스쿼드가 아슬아슬하게 깨도록
// 몬스터 HP / 공격력을 이분 탐색해서 js/monsters.js 로 저장한다.
//   node tools/calibrate.js
'use strict';
const fs = require('fs');
const path = require('path');
require('../js/data.js');
require('../js/engine.js');
const D = globalThis.USData, US = globalThis.US;

// 합성으로 장비 단계를 올리는 속도를 반영 (카오스는 8단계 풀셋 기준이라 레벨이 관건)
const NORMAL_TIER = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 7];
const CHAOS_TIER = () => 8;

function refState(mode, idx) {
  const st = US.newState(0);
  const L = D.REC_LEVEL[mode][Math.floor(idx / 10)][idx % 10];
  const chaos = mode === 'chaos';
  // 실측 공략 기록 기준: 궁수는 1-6 이후 Lv.1부터, 마법사는 2-6 이후 Lv.1부터 따라온다
  const levels = { war: L, arch: Math.max(1, L - 1), mage: 1 };
  if (!chaos && idx >= 6 && idx <= 8) levels.arch = Math.max(1, L - 5);
  if (!chaos && idx === 9) levels.arch = 15;
  if (chaos) levels.mage = L - 1;
  else if (idx >= 20) levels.mage = L - 6;
  else if (idx === 19) levels.mage = 21;
  else if (idx >= 16) levels.mage = L - 14;
  const owned = { war: true, arch: chaos || idx >= 6, mage: chaos || idx >= 16 };
  st.util.slots = chaos ? 3 : idx <= 9 ? 1 : idx <= 19 ? 2 : 3;
  const tierWanted = chaos ? CHAOS_TIER(idx) : NORMAL_TIER[idx];
  for (const c of D.CLASSES) {
    const m = st.mercs[c];
    m.owned = owned[c];
    m.lv = levels[c];
    if (!m.owned) continue;
    m.skills = pickSkills(c, m.lv, st.util.slots, mode, idx);
    if (!chaos && idx <= 1) continue; // 1-1 은 장비가 드롭되지 않아 맨몸으로 시작
    let tier = tierWanted;
    while (tier > 1 && D.TIERS[tier].req > m.lv) tier--;
    for (const slot of D.SLOTS) {
      const T = D.TIERS[tier];
      const it = { id: st.nextItemId++, tier, cls: c, slot, q: 2, pot: [], lock: false };
      if (slot === 'weapon') { it.atk = T.atk[2]; it.speed = 2; } else { it.hp = T.hp[2]; it.def = T.def[2]; }
      // 평범한 잠재: 무기는 공/마, 방어구는 HP 중간값
      if (T.grade) {
        const gi = D.GRADE_IDX[T.grade];
        for (let i = 0; i < T.lines; i++) {
          if (slot === 'weapon') it.pot.push({ k: c === 'mage' ? 'matk' : 'atk', v: D.POT_VALUES.atk_w[gi][1] });
          else it.pot.push({ k: 'hp', v: D.POT_VALUES.hp[gi][1] });
        }
      }
      m.equip[slot] = it;
    }
  }
  st.mode = mode; st.stage = idx;
  return st;
}

function pickSkills(cls, lv, slots, mode, idx) {
  const s = idx % 10, r = Math.floor(idx / 10);
  const boss = s === 9;
  let pri;
  if (cls === 'war') pri = boss && r === 2 ? ['demon_bane', 'divide', 'aura_blade'] : ['demon_bane', 'divide', 'aura_blade', 'blessed_hammer', 'iron_body'];
  if (cls === 'arch') pri = boss ? ['storm_arrow', 'dragon_burst', 'vortex_sphere', 'charged_arrow', 'soul_contract'] : ['dragon_burst', 'vortex_sphere', 'charged_arrow', 'storm_arrow', 'soul_contract', 'elemental_ghost'];
  if (cls === 'mage') pri = boss && r === 1 ? ['heavens_door', 'heal', 'chain_lightning'] : ['zodiac_ray', 'pray', 'flame_sweep', 'chain_lightning', 'heavens_door', 'heal'];
  const got = pri.filter((id) => D.SKILLS[id].lv <= lv).slice(0, slots);
  while (got.length < 3) got.push(null);
  return got;
}

function simulate(mode, idx, mon, seed, maxTime = 600, tweak) {
  US.setRandom(US.mulberry32(seed));
  if (mon) globalThis.USMonsters = { [mode]: { [idx]: mon } };
  const st = refState(mode, idx);
  if (tweak) tweak(st);
  const b = US.createBattle(st, 0);
  b.sim = true;
  let minFrac = 1;
  while (!b.done && b.time < maxTime) {
    US.stepBattle(st, b, US.DT);
    const w = b.mercs.war;
    if (w && w.alive) minFrac = Math.min(minFrac, w.hp / w.s.hp);
    if (b.events.length > 2000) b.events.length = 0;
  }
  return { clear: b.done === 'clear', time: b.time, minFrac };
}

function search(lo, hi, fn, iters) { // fn(x) true 이면 x 를 키워도 된다
  for (let i = 0; i < iters; i++) {
    const mid = Math.sqrt(lo * hi);
    if (fn(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

module.exports = { refState, simulate };
if (require.main === module) main();

function main() {
const SEEDS = [11, 22, 33, 44, 55];
const out = { normal: {}, chaos: {} };
const t0 = Date.now();
for (const mode of ['normal', 'chaos']) {
  for (let idx = 0; idx < 30; idx++) {
    const boss = idx % 10 === 9;
    const r = Math.floor(idx / 10);
    let mon;
    if (!boss) {
      // 1) 피해 0 으로 스테이지 시간 목표 (110초)
      const hp = search(5, 1e9, (h) => { const r = simulate(mode, idx, { hp: h, atk: 0, bossHp: h * 25, bossAtk: 0 }, 1); return r.clear && r.time < 110; }, 40);
      // 2) 5회 중 3회 이상 클리어되는 최대 공격력
      const atk = search(1, 1e9, (a) => SEEDS.filter((sd) => simulate(mode, idx, { hp, atk: a, bossHp: hp * 25, bossAtk: a * 2 }, sd).clear).length >= 5, 40);
      mon = { hp: Math.round(hp), atk: Math.round(atk * 0.97), bossHp: Math.round(hp * 25), bossAtk: Math.round(atk * 0.97 * 2) };
    } else {
      const target = [40, 30, 12][r];
      const healPct = 0.05;
      const bm = (h, a) => ({ hp: 1, atk: 1, bossHp: h, bossAtk: a, healPct });
      const hp = search(5, 1e12, (h) => { const s = simulate(mode, idx, bm(h, 0), 1, 300); return s.clear && s.time < target; }, 45);
      const atk = search(1, 1e10, (a) => SEEDS.filter((sd) => simulate(mode, idx, bm(hp * 0.85, a), sd, 300).clear).length >= 5, 40);
      // 즉사기 보스는 공격력과 무관하게 15초 안에 잡아야 하므로 직전 몬스터 기준으로 둔다
      const prev = out[mode][idx - 1];
      const bossAtk = atk > 1e8 ? prev.atk * 3 : Math.round(atk * 0.9);
      mon = { hp: 1, atk: 1, bossHp: Math.round(hp * 0.85), bossAtk, healPct };
    }
    out[mode][idx] = mon;
    console.log(mode, `${r + 1}-${(idx % 10) + 1}`, JSON.stringify(mon), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}

// 일반 몬스터는 스테이지가 오를수록 강해지도록 단조 증가 보정
for (const mode of ['normal', 'chaos']) {
  let ph = 0, pa = 0;
  for (let idx = 0; idx < 30; idx++) {
    const m = out[mode][idx];
    if (idx % 10 === 9) continue;
    m.hp = Math.max(m.hp, Math.round(ph * 1.005)); m.atk = Math.max(m.atk, Math.round(pa * 1.005));
    m.bossHp = m.hp * 25; m.bossAtk = m.atk * 2;
    ph = m.hp; pa = m.atk;
  }
}
const file = path.join(__dirname, '..', 'js', 'monsters.js');
fs.writeFileSync(file, `// tools/calibrate.js 로 생성됨 — 권장 레벨 기준 스쿼드가 아슬하게 깨도록 보정한 몬스터 능력치\n(function (G) { G.USMonsters = ${JSON.stringify(out)}; })(typeof window !== 'undefined' ? window : globalThis);\n`);
console.log('saved', file);
}
