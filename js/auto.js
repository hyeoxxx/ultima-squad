// 자동 기능: 장비 자동 장착/정리, 자동 재도전, 상자, 스킬, 큐브, 유틸리티 구매, 영입
// 원작에 없는 편의 기능이라 st.auto 설정으로 각각 켜고 끈다.
(function (G) {
  'use strict';
  const D = G.USData, US = G.US;

  // ───────── 장비 평가 ─────────
  // 용병의 전투력 = 화력^a × 생존력^(1-a)  (전사는 생존, 궁수는 화력 비중이 큼)
  const WEIGHT = { war: 0.35, arch: 0.7, mage: 0.5 };
  function power(st, cls) {
    const s = US.mercStats(st, cls);
    const dps = s.atkTotal * (1 + (s.crit / 100) * (s.critDmg / 100)) / s.interval * (1 + s.cdr * 0.05);
    const ehp = s.hp / (1 - Math.min(0.9, s.def * 0.0001));
    const a = WEIGHT[cls];
    return Math.pow(dps, a) * Math.pow(ehp, 1 - a);
  }
  function powerWith(st, cls, it) {
    const m = st.mercs[cls];
    const prev = m.equip[it.slot];
    m.equip[it.slot] = it;
    const p = power(st, cls);
    m.equip[it.slot] = prev;
    return p;
  }
  function canWear(st, it) {
    const m = st.mercs[it.cls];
    return m.owned && m.lv >= D.TIERS[it.tier].req;
  }
  // 착용 중인 장비보다 좋은가 (비율, 1 이하면 아님)
  function upgradeRatio(st, it) {
    if (!canWear(st, it)) return 0;
    const m = st.mercs[it.cls];
    if (m.equip[it.slot] && m.equip[it.slot].id === it.id) return 0;
    return powerWith(st, it.cls, it) / power(st, it.cls);
  }
  const isUpgrade = (st, it) => upgradeRatio(st, it) > 1.0001;
  // 레벨이 모자라 아직 못 끼지만 곧 쓸 장비: 영입한 용병의 부위별로 가장 좋은 1개만 남긴다
  function futureUseful(st, it) {
    const m = st.mercs[it.cls];
    if (!m.owned || canWear(st, it)) return false;
    const cur = m.equip[it.slot];
    if (cur && it.tier <= cur.tier) return false;
    const rivals = st.inventory.filter((x) => x.cls === it.cls && x.slot === it.slot && !canWear(st, x));
    const best = rivals.reduce((a, x) => (x.tier > a.tier || (x.tier === a.tier && x.q > a.q) ? x : a), rivals[0]);
    return best === it;
  }

  function autoEquip(st) {
    const out = [];
    for (const c of US.ownedMercs(st)) {
      for (const slot of D.SLOTS) {
        let best = null, bestP = power(st, c) * 1.0001;
        for (const it of st.inventory) {
          if (it.cls !== c || it.slot !== slot || !canWear(st, it)) continue;
          const p = powerWith(st, c, it);
          if (p > bestP) { best = it; bestP = p; }
        }
        if (best && US.equipItem(st, best.id).ok) out.push(best);
      }
    }
    return out;
  }

  function autoSort(st) {
    const A = st.auto, res = { synth: 0, dis: 0, gold: 0 };
    const over = () => st.inventory.length >= st.invSize * A.sortAt / 100;
    if (!over()) return res;
    const keep = (it) => it.lock || isUpgrade(st, it) || futureUseful(st, it);
    if (A.synth) {
      for (let guard = 0; guard < 60; guard++) {
        const by = {};
        for (const it of st.inventory) if (!keep(it)) (by[it.tier] = by[it.tier] || []).push(it.id);
        const t = Object.keys(by).map(Number).sort((a, b) => a - b).find((x) => by[x].length >= 9);
        if (t == null) break;
        if (!US.synthesize(st, by[t].slice(0, 9)).ok) break;
        res.synth++;
      }
    }
    if (over() && A.disMax > 0) {
      const ids = st.inventory.filter((it) => !keep(it) && it.tier <= A.disMax).map((it) => it.id);
      const r = US.dismantle(st, ids);
      res.dis = r.n; res.gold = r.gold;
    }
    return res;
  }

  // ───────── 스킬 ─────────
  function recommendSkills(st, cls) {
    const m = st.mercs[cls];
    const r = Math.floor(st.stage / 10), boss = st.stage % 10 === 9;
    let pri;
    if (cls === 'war') pri = ['demon_bane', 'divide', 'aura_blade', 'blessed_hammer', 'iron_body'];
    if (cls === 'arch') pri = boss ? ['storm_arrow', 'dragon_burst', 'vortex_sphere', 'charged_arrow', 'soul_contract'] : ['dragon_burst', 'vortex_sphere', 'charged_arrow', 'storm_arrow', 'soul_contract', 'elemental_ghost'];
    if (cls === 'mage') pri = boss && r === 1 ? ['heavens_door', 'heal', 'chain_lightning', 'flame_sweep'] : ['zodiac_ray', 'pray', 'flame_sweep', 'chain_lightning', 'heavens_door', 'heal'];
    const got = pri.filter((id) => D.SKILLS[id].lv <= m.lv).slice(0, US.skillSlots(st));
    while (got.length < 3) got.push(null);
    return got;
  }
  function autoSkills(st) {
    let changed = false;
    for (const c of US.ownedMercs(st)) {
      const want = recommendSkills(st, c);
      if (want.join() !== st.mercs[c].skills.join()) { st.mercs[c].skills = want; changed = true; }
    }
    return changed;
  }

  // ───────── 큐브 ─────────
  const CUBE_WEAPON = { pct: '공/마 %', flat: '공/마 +', critdmg: '크리티컬 데미지', cdr: '재사용 감소' };
  const CUBE_ARMOR = { def: '방어력', hp: '최대 HP', atk: '공/마 +' };
  function goodLines(it, cls, target) {
    const magic = cls === 'mage';
    const keys = {
      pct: [magic ? 'matkp' : 'atkp'], flat: [magic ? 'matk' : 'atk'], critdmg: ['critdmg'], cdr: ['cdr'],
      def: ['def'], hp: ['hp'], atk: [magic ? 'matk' : 'atk'],
    }[target] || [];
    return it.pot.filter((p) => keys.includes(p.k)).length;
  }
  function autoCube(st) {
    const A = st.auto, done = [];
    for (const c of US.ownedMercs(st)) {
      for (const slot of D.SLOTS) {
        const it = st.mercs[c].equip[slot];
        if (!it || it.tier < 2) continue;
        const target = slot === 'weapon' ? A.cubeWeapon : A.cubeArmor;
        const need = Math.min(A.cubeLines, D.TIERS[it.tier].lines);
        let have = goodLines(it, c, target);
        let rolls = 0;
        while (have < need && st.cubes > A.cubeKeep && rolls < 40) {
          const r = US.cubeRoll(st, it.id);
          if (!r.ok) break;
          rolls++;
          const n = goodLines({ pot: r.after }, c, target);
          if (n >= have) { US.cubeApply(st, it.id, r.after); have = n; }
        }
        if (rolls && have >= need) done.push(`${D.CLASS_NAME[c]} ${D.SLOT_NAME[slot]} 잠재 목표 달성 (큐브 ${rolls}개)`);
      }
    }
    return done;
  }

  // ───────── 유틸리티 / 영입 ─────────
  function autoRecruit(st) {
    const got = [];
    for (const c of ['arch', 'mage']) if (US.recruit(st, c).ok) got.push(c);
    return got;
  }
  function recruitPending(st) {
    for (const c of ['arch', 'mage']) {
      const r = D.RECRUIT[c];
      if (!st.mercs[c].owned && US.isCleared(st, 'normal', r.need) && (c !== 'mage' || st.mercs.arch.owned)) return r.cost;
    }
    return 0;
  }
  function autoUtil(st) {
    const bought = [];
    const reserve = st.auto.recruit ? recruitPending(st) : 0;
    for (const key of st.auto.utilOrder) {
      if (key === 'inv') {
        while (st.invSize < Math.min(D.INV_MAX, st.auto.invTarget) && st.gold - D.invSlotCost(st.invSize + 1) >= reserve) {
          if (!US.expandInv(st, 1)) break;
          bought.push('inv');
        }
        continue;
      }
      const next = US.utilNext(st, key);
      if (!next || st.gold - next.cost < reserve) continue;
      if (US.buyUtil(st, key).ok) bought.push(key);
    }
    return bought;
  }

  // ───────── 자동 재도전 ─────────
  function autoRetry(st, now) {
    // 일반 모드를 다 깼으면 카오스 모드로 넘어간다
    if (st.mode === 'normal' && US.chaosUnlocked(st) && !US.isCleared(st, 'chaos', 29) && US.canEnter(st, 'chaos', US.frontier(st, 'chaos'))) {
      st.mode = 'chaos'; st.stage = US.frontier(st, 'chaos'); st.repeat = false; st.repeatReason = null; st.retryAt = now;
      return true;
    }
    if (!st.repeat || !st.repeatReason) return false;
    if (st.repeatReason === 'inv') {
      if (US.invFull(st)) return false;
    } else if (now - (st.retryAt || 0) < st.auto.retryMin * 60000) return false;
    const f = US.frontier(st, st.mode);
    if (US.isCleared(st, st.mode, f) || !US.canEnter(st, st.mode, f) || f === st.stage) return false;
    st.stage = f; st.repeat = false; st.repeatReason = null; st.retryAt = now;
    return true;
  }

  // 전투와 전투 사이에 실행. 다음 스테이지 입장 전에 장비/스킬을 정리한다.
  function between(st, now) {
    const A = st.auto, ev = [];
    if (A.recruit) for (const c of autoRecruit(st)) ev.push({ t: 'auto', msg: `${D.CLASS_NAME[c]} 자동 영입!` });
    if (A.util) { const b = autoUtil(st); if (b.length) ev.push({ t: 'auto', msg: `유틸리티 자동 구매: ${[...new Set(b)].map((k) => (k === 'inv' ? '인벤토리' : D.UTIL[k].name)).join(', ')}` }); }
    if (A.retry && autoRetry(st, now)) ev.push({ t: 'auto', msg: `${US.stageInfo(st.mode, st.stage).label} 스테이지 자동 재도전` });
    ev.push(...during(st));
    if (A.cube) for (const msg of autoCube(st)) ev.push({ t: 'auto', msg, notify: 'cube' });
    if (A.skills && autoSkills(st)) ev.push({ t: 'auto', msg: '스킬 자동 배치', quiet: true });
    return ev;
  }
  // 전투 중에도 주기적으로 실행해도 안전한 것들
  function during(st) {
    const A = st.auto, ev = [];
    if (A.equip) for (const it of autoEquip(st)) ev.push({ t: 'auto', msg: `자동 장착: ${US.itemName(it)} (${it.tier}단계)` });
    if (A.sort) {
      const r = autoSort(st);
      if (r.synth || r.dis) ev.push({ t: 'auto', msg: `인벤토리 자동 정리: 합성 ${r.synth}회, 분해 ${r.dis}개${r.gold ? ` (+${US.fmt(r.gold)} 메소)` : ''}` });
      if (A.equip && r.synth) for (const it of autoEquip(st)) ev.push({ t: 'auto', msg: `자동 장착: ${US.itemName(it)} (${it.tier}단계)` });
    }
    return ev;
  }

  // 표시용 전투력 (메이플처럼 큰 숫자로)
  const CP_SCALE = 10;
  const mercPower = (st, cls) => Math.round(power(st, cls) * CP_SCALE);
  const squadPower = (st) => US.ownedMercs(st).reduce((s, c) => s + mercPower(st, c), 0);
  // 장비 전투력: 해당 부위가 비어 있을 때 대비 이 장비를 꼈을 때 오르는 전투력
  // (영입 전이거나 레벨이 모자라면 착용 레벨 기준으로 계산)
  function itemPower(st, it) {
    const m = st.mercs[it.cls];
    const own = m.owned, lv = m.lv, prev = m.equip[it.slot];
    m.owned = true; m.lv = Math.max(lv, D.TIERS[it.tier].req);
    m.equip[it.slot] = null;
    const p0 = power(st, it.cls);
    m.equip[it.slot] = it;
    const p1 = power(st, it.cls);
    m.owned = own; m.lv = lv; m.equip[it.slot] = prev;
    return Math.max(0, Math.round((p1 - p0) * CP_SCALE));
  }

  G.USAuto = { mercPower, squadPower, itemPower, power, powerWith, upgradeRatio, isUpgrade, canWear, between, during, recommendSkills, CUBE_WEAPON, CUBE_ARMOR };
})(typeof window !== 'undefined' ? window : globalThis);
