// 울티마 스쿼드 엔진: 상태, 전투 시뮬레이션, 장비/잠재, 오프라인 정산.
// DOM 에 의존하지 않아 node 에서도 돌아간다 (밸런스 시뮬레이션용).
(function (G) {
  'use strict';
  const D = G.USData;
  const R = D.RATES;

  // ───────── 난수 ─────────
  let rand = Math.random;
  function setRandom(fn) { rand = fn; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  const ri = (n) => Math.floor(rand() * n);
  const pick = (arr) => arr[ri(arr.length)];
  function weighted(entries) { // [[key, w], ...]
    let sum = 0;
    for (const [, w] of entries) sum += w;
    let x = rand() * sum;
    for (const [k, w] of entries) { if ((x -= w) < 0) return k; }
    return entries[entries.length - 1][0];
  }

  // ───────── 경험치 ─────────
  const gIndex = (mode, idx) => (mode === 'chaos' ? 30 : 0) + idx;
  const expPerKill = (mode, idx) => Math.round(4 * Math.pow(1.13, gIndex(mode, idx)));
  const KILLS_PER_HOUR_REF = 1400;
  const NEED = [0];
  (function buildExpTable() {
    const rec = [];
    for (const mode of ['normal', 'chaos']) for (let i = 0; i < 30; i++) if (i % 10 !== 9) rec.push([D.REC_LEVEL[mode][Math.floor(i / 10)][i % 10], mode, i]);
    for (let L = 1; L < D.MAX_LEVEL; L++) {
      let best = rec[0];
      for (const r of rec) if (r[0] <= L) best = r;
      // 실측(오프라인 기록) 기준 레벨당 약 3~8시간이 걸리도록, 기준 처치 속도 대비 1.45배 보정
      const hours = 1.45 * (Math.min(7.5, 1 + 0.45 * L) + Math.max(0, L - 40) * 0.1);
      // 초반 완화: 1~10레벨은 절반, 11~14레벨은 60~90%로 원래 값에 돌아온다
      const early = L <= 10 ? 0.5 : L <= 14 ? 0.5 + 0.1 * (L - 10) : 1;
      NEED[L] = Math.round(KILLS_PER_HOUR_REF * expPerKill(best[1], best[2]) * hours * early);
    }
    NEED[D.MAX_LEVEL] = Infinity;
  })();
  const expNeed = (lv) => NEED[lv];

  // ───────── 몬스터 ─────────
  function monsterStats(mode, idx) {
    const t = (G.USMonsters && G.USMonsters[mode] && G.USMonsters[mode][idx]) || fallbackMonster(mode, idx);
    return t;
  }
  function fallbackMonster(mode, idx) {
    const g = gIndex(mode, idx);
    const hp = Math.round(60 * Math.pow(1.19, g)), atk = Math.round(18 * Math.pow(1.17, g));
    return { hp, atk, bossHp: hp * 25, bossAtk: atk * 2 };
  }
  function stageInfo(mode, idx) {
    const r = Math.floor(idx / 10), s = idx % 10;
    const m = D.REGION_MAPS[r][D.mapIndex(s)];
    const mons = D.MAP_MONSTERS[r][D.mapIndex(s)];
    return { r, s, isBoss: s === 9, label: `${r + 1}-${s + 1}`, map: m, mons, mode };
  }

  // ───────── 상태 ─────────
  function newState(now) {
    const st = {
      v: 1, created: now, lastSeen: now,
      gold: 0, squadCoin: 0, chaosCoin: 0, smallChaosCoin: 0, cubes: 0,
      mercs: {},
      inventory: [], invSize: 10, nextItemId: 1,
      util: { slots: 1, offline: 16, drop: 0, gold: 0 },
      cleared: { normal: {}, chaos: {} },
      mode: 'normal', stage: 0, repeat: false,
      boxDate: null, shop: {}, medals: {},
      killRate: {}, stats: { kills: 0, bossKills: 0, boxes: 0 },
      lastBattle: { mode: 'normal', stage: 0, cleared: false },
      volume: 30,
      unseenDrops: 0,
      coinUp: {},
      auto: defaultAuto(),
      repeatReason: null,
    };
    for (const c of D.CLASSES) st.mercs[c] = { owned: c === 'war', lv: 1, exp: 0, equip: { weapon: null, hat: null, glove: null, shoe: null }, skills: [null, null, null] };
    return st;
  }

  const isCleared = (st, mode, idx) => !!st.cleared[mode][idx];
  // 코인 강화 보너스 (%)
  function bonus(st, key) {
    const up = st.coinUp || {};
    const lv = (id) => (up[id] || 0) * D.COIN_UP.find((u) => u.id === id).per;
    switch (key) {
      case 'exp': return lv('exp') + lv('cexp');
      case 'atk': return lv('atk') + lv('catk');
      case 'hp': return lv('hp') + lv('chp');
      default: return lv(key);
    }
  }
  const expMult = (st) => 1 + bonus(st, 'exp') / 100;
  const goldMult = (st) => 1 + (st.util.gold + bonus(st, 'gold')) / 100;
  function defaultAuto() {
    return {
      equip: true, sort: true, sortAt: 80, synth: true, disMax: 2, retry: true, retryMin: 10, box: true,
      skills: true, cube: false, cubeWeapon: 'pct', cubeArmor: 'def', cubeLines: 2, cubeKeep: 10,
      util: true, utilOrder: ['slots', 'gold', 'drop', 'inv', 'offline'], invTarget: 60, recruit: true,
      notifyFull: true, notifyBoss: true, notifyFirst: true, notifyCube: true,
    };
  }
  const chaosUnlocked = (st) => isCleared(st, 'normal', 29);
  const ownedMercs = (st) => D.CLASSES.filter((c) => st.mercs[c].owned);

  // ───────── 장비 ─────────
  function rollPotential(slot, grade) {
    const gi = D.GRADE_IDX[grade];
    const table = Object.assign({}, slot === 'weapon' ? D.POT_WEIGHTS.weapon : D.POT_WEIGHTS.armor, slot === 'weapon' ? {} : D.POT_WEIGHTS[slot]);
    const key = weighted(Object.entries(table).map(([k, w]) => [k, w[gi]]).filter(([, w]) => w > 0));
    const W = slot === 'weapon';
    let v;
    switch (key) {
      case 'hp': v = pick(D.POT_VALUES.hp[gi]); break;
      case 'def': v = pick(D.POT_VALUES.def[gi]); break;
      case 'atk': case 'matk': v = pick(W ? D.POT_VALUES.atk_w[gi] : D.POT_VALUES.atk_a[gi]); break;
      case 'atkp': case 'matkp': v = pick(D.POT_VALUES.pct[gi]); break;
      case 'crit': v = pick(W ? D.POT_VALUES.crit_w[gi] : D.POT_VALUES.crit_a[gi]); break;
      case 'critdmg': v = pick(D.POT_VALUES.critdmg[gi]); break;
      case 'cdr': v = pick(D.POT_VALUES.cdr[gi]); break;
      default: v = 1;
    }
    return { k: key, v };
  }
  function rollPotentials(slot, tier) {
    const T = D.TIERS[tier];
    const out = [];
    for (let i = 0; i < T.lines; i++) out.push(rollPotential(slot, T.grade));
    return out;
  }
  function makeItem(st, tier, cls, slot) {
    cls = cls || pick(ownedMercs(st).length ? ownedMercs(st) : D.CLASSES); // 영입한 용병 직업의 장비만 나온다
    slot = slot || pick(D.SLOTS);
    const q = ri(5);
    const T = D.TIERS[tier];
    const it = { id: st.nextItemId++, tier, cls, slot, q, pot: rollPotentials(slot, tier), lock: false, isNew: true };
    if (slot === 'weapon') { it.atk = T.atk[q]; it.speed = 2; } else { it.hp = T.hp[q]; it.def = T.def[q]; }
    return it;
  }
  const itemName = (it) => D.ITEM_NAMES[it.cls][it.tier - 1][D.SLOTS.indexOf(it.slot)];
  const invFull = (st) => st.inventory.length >= st.invSize;
  function addItem(st, it) {
    if (invFull(st)) return false;
    st.inventory.push(it);
    st.unseenDrops++;
    return true;
  }
  function rollDropTier(range) {
    const [lo, hi] = range;
    if (lo === hi) return lo;
    // 높은 단계일수록 드롭 확률이 낮다 [추정]
    const entries = [];
    for (let t = lo; t <= hi; t++) entries.push([t, Math.pow(0.45, hi - t) * (t === hi ? 0.6 : 1)]);
    return weighted(entries);
  }

  // ───────── 용병 스탯 ─────────
  function mercStats(st, cls) {
    const m = st.mercs[cls];
    const b = D.baseStats(cls, m.lv);
    const s = { atk: b.atk, hp: b.hp, def: b.def, atkFlat: 0, atkPct: 0, crit: D.BASE_CRIT, critDmg: D.BASE_CRIT_DMG, speed: D.BASE_SPEED[cls], cdr: 0, procs: { rage: 0, love: 0, invinc: 0, ignore: 0 } };
    const magic = cls === 'mage';
    for (const slot of D.SLOTS) {
      const it = m.equip[slot];
      if (!it) continue;
      if (it.atk) s.atkFlat += it.atk;
      if (it.speed) s.speed += it.speed;
      if (it.hp) s.hp += it.hp;
      if (it.def) s.def += it.def;
      for (const p of it.pot) {
        switch (p.k) {
          case 'hp': s.hp += p.v; break;
          case 'def': s.def += p.v; break;
          case 'atk': if (!magic) s.atkFlat += p.v; break;
          case 'matk': if (magic) s.atkFlat += p.v; break;
          case 'atkp': if (!magic) s.atkPct += p.v; break;
          case 'matkp': if (magic) s.atkPct += p.v; break;
          case 'crit': s.crit += p.v; break;
          case 'critdmg': s.critDmg += p.v; break;
          case 'speed': s.speed += 1; break;
          case 'cdr': s.cdr += p.v; break;
          default: s.procs[p.k]++;
        }
      }
    }
    const skills = m.skills.filter(Boolean);
    if (skills.includes('iron_body')) { s.hp *= 1.1; s.def *= 1.1; }
    s.speed = Math.min(8, s.speed);
    s.atkTotal = (s.atk + s.atkFlat) * (1 + s.atkPct / 100) * (1 + bonus(st, 'atk') / 100);
    s.hp = Math.round(s.hp * (1 + bonus(st, 'hp') / 100));
    s.def = Math.round(s.def);
    s.interval = D.speedInterval(s.speed);
    return s;
  }
  function skillCd(skill, cdr) {
    if (!skill.cd) return 0;
    // 6초 스킬은 감소량이 0.3배로 적용, 5초 미만 불가
    const red = skill.cd <= 6 ? cdr * 0.3 : cdr;
    return Math.max(5, skill.cd - red);
  }
  const skillSlots = (st) => st.util.slots;
  function canEquip(st, cls, it) {
    return it.cls === cls && st.mercs[cls].lv >= D.TIERS[it.tier].req;
  }
  function availableSkills(st, cls) {
    return D.SKILL_LIST(cls).filter((s) => st.mercs[cls].lv >= s.lv);
  }

  // ───────── 레벨업 ─────────
  function gainExp(st, cls, amount, events) {
    const m = st.mercs[cls];
    if (!m.owned || m.lv >= D.MAX_LEVEL) return 0;
    m.exp += amount;
    let ups = 0;
    while (m.lv < D.MAX_LEVEL && m.exp >= expNeed(m.lv)) {
      m.exp -= expNeed(m.lv);
      m.lv++;
      ups++;
      if (events) {
        events.push({ t: 'levelup', cls, lv: m.lv });
        const learned = D.SKILL_LIST(cls).filter((s) => s.lv === m.lv);
        for (const s of learned) events.push({ t: 'log', msg: `${D.CLASS_NAME[cls]}가 [${s.name}] 스킬을 배웠습니다!` });
      }
    }
    if (m.lv >= D.MAX_LEVEL) m.exp = 0;
    return ups;
  }

  // ───────── 전투 ─────────
  const POS = { war: 330, arch: 230, mage: 150 };
  const FRONT_ORDER = ['war', 'arch', 'mage'];

  function createBattle(st, now) {
    const mode = st.mode, idx = st.stage;
    const info = stageInfo(mode, idx);
    const mon = monsterStats(mode, idx);
    const b = {
      mode, idx, info, mon, time: 0,
      spawned: 0, killed: 0, total: info.isBoss ? 1 : R.mobsPerStage + 1,
      monsters: [], mercs: {}, projectiles: [], delayed: [],
      done: null, events: [], nextMonId: 1, box: null,
      bossSpawned: false, startedAt: now,
    };
    for (const c of ownedMercs(st)) {
      const s = mercStats(st, c);
      const m = st.mercs[c];
      const cds = {};
      // 장착된 스킬은 스테이지 시작 시 바로 사용 가능
      for (const id of m.skills) if (id) cds[id] = 0;
      b.mercs[c] = { cls: c, s, hp: s.hp, alive: true, reviveAt: 0, next: 0.3 + rand() * 0.3, cds, buffs: {}, hammerAt: 1, beliefUsed: false, invincUntil: 0, poison: null, rageUntil: 0, loveUntil: 0, x: POS[c] };
    }
    b.doorUsed = false;
    if (info.isBoss) spawnBoss(b, true);
    return b;
  }

  function refreshMercStats(st, b) {
    for (const c of ownedMercs(st)) {
      const s = mercStats(st, c);
      let bm = b.mercs[c];
      if (!bm) {
        bm = b.mercs[c] = { cls: c, s, hp: s.hp, alive: true, reviveAt: 0, next: 0.5, cds: {}, buffs: {}, hammerAt: 1, beliefUsed: false, invincUntil: 0, poison: null, rageUntil: 0, loveUntil: 0, x: POS[c] };
      } else {
        const ratio = bm.hp / bm.s.hp;
        bm.s = s;
        if (bm.alive) bm.hp = Math.max(1, Math.round(s.hp * ratio));
      }
    }
  }

  function spawnWave(b) {
    const n = Math.min(R.waveSize, R.mobsPerStage - b.spawned);
    for (let i = 0; i < n; i++) {
      b.monsters.push({ id: b.nextMonId++, kind: 'mob', hp: b.mon.hp, maxHp: b.mon.hp, atk: b.mon.atk, x: 1000 + i * 45 + rand() * 20, y: rand(), next: 1 + rand(), stunUntil: 0, name: b.info.mons.mob[0], icon: b.info.mons.mob[1], mob: b.info.mons.mob[2] });
      b.spawned++;
    }
  }
  function spawnBoss(b, stageBoss) {
    const mons = b.info.mons;
    const boss = {
      id: b.nextMonId++, kind: stageBoss ? 'regionBoss' : 'boss', x: 1000, y: 0.5, next: 1.5, stunUntil: 0,
      name: mons.boss[0], icon: mons.boss[1], mob: mons.boss[2],
    };
    if (stageBoss) {
      boss.hp = boss.maxHp = b.mon.bossHp;
      boss.atk = b.mon.bossAtk;
      boss.mech = ['heal', 'poison', 'doom'][b.info.r];
      boss.mechAt = boss.mech === 'heal' ? 5 : boss.mech === 'poison' ? 7 : 15;
    } else {
      boss.hp = boss.maxHp = b.mon.bossHp;
      boss.atk = b.mon.bossAtk;
    }
    b.monsters.push(boss);
    b.bossSpawned = true;
    b.events.push({ t: 'log', msg: `${boss.name} 등장!` });
  }

  function frontMerc(b) {
    for (const c of FRONT_ORDER) { const m = b.mercs[c]; if (m && m.alive) return m; }
    return null;
  }
  const aliveMercs = (b) => Object.values(b.mercs).filter((m) => m.alive);
  function targets(b, n, range, fromX) {
    const list = b.monsters.filter((m) => m.hp > 0 && m.x - fromX <= range);
    list.sort((a, c) => a.x - c.x);
    return list.slice(0, n);
  }
  const RANGE = { war: 220, arch: 800, mage: 650 };

  function finalDamageMult(b, m) {
    let mult = 1;
    if (m.buffs.soul_contract > b.time) mult *= 1.5;
    if (b.prayUntil > b.time) mult *= 1.3;
    if (m.rageUntil > b.time) mult *= 1.2; // 분노 [추정]
    return mult;
  }

  function dealHit(st, b, m, target, pct, opts) {
    if (target.hp <= 0) return;
    const s = m.s;
    let p = pct;
    if (opts && opts.bossPct && target.kind === 'regionBoss') p = opts.bossPct;
    const crit = rand() * 100 < s.crit;
    let dmg = s.atkTotal * p / 100 * finalDamageMult(b, m) * (0.9 + rand() * 0.2);
    if (crit) dmg *= 1 + s.critDmg / 100;
    if (opts && opts.echo) dmg *= opts.echo;
    dmg = Math.max(1, Math.round(dmg));
    target.hp -= dmg;
    // 에스페시아 상자: 체력 75%/50%/25% 지점을 지날 때마다 일정 확률로 다음 등급으로 성장 [추정]
    if (target.kind === 'box') {
      const frac = Math.max(0, target.hp) / target.maxHp;
      while (target.checks < 3 && frac <= 0.75 - 0.25 * target.checks) {
        target.checks++;
        const gi = BOX_GRADES.indexOf(target.grade);
        if (gi < 3 && rand() < BOX_GROW) { target.grade = BOX_GRADES[gi + 1]; b.events.push({ t: 'boxgrow', grade: target.grade }); }
      }
    }
    b.events.push({ t: 'dmg', id: target.id, v: dmg, crit, cls: m.cls, x: target.x, y: target.y, kind: target.kind, mob: target.mob });
    if (opts && opts.stun && rand() < opts.stun) target.stunUntil = b.time + 1;
    if (target.hp <= 0) onKill(st, b, target);
  }

  function useAttack(st, b, m, skill) {
    const range = RANGE[m.cls];
    const tg = targets(b, skill.targets, range, m.x);
    if (!tg.length) return false;
    const hits = skill.hits || 1;
    const spread = skill.spread || (hits > 1 ? Math.min(1.2, 0.08 * hits) : 0);
    const echoes = (m.buffs.elemental_ghost > b.time) ? 3 : 0;
    const echoMult = skill.id === 'storm_arrow' ? 0.15 : 0.3;
    b.events.push({ t: 'skill', cls: m.cls, skill: skill.id, ids: tg.map((t) => t.id), pos: tg.map((t) => [t.x, t.y]) });
    const opts = { bossPct: skill.bossPct, stun: skill.stun };
    for (let h = 0; h < hits; h++) {
      const at = b.time + (hits > 1 ? spread * h / hits : 0) + 0.15;
      for (const t of tg) b.delayed.push({ at, fn: () => dealHit(st, b, m, t, skill.pct, opts) });
      for (let e = 1; e <= echoes; e++) {
        for (const t of tg) b.delayed.push({ at: at + 0.2 * e, fn: () => dealHit(st, b, m, t, skill.pct, Object.assign({ echo: echoMult }, opts)) });
      }
    }
    return true;
  }

  function mercAct(st, b, m) {
    const merc = st.mercs[m.cls];
    const slots = merc.skills.slice(0, skillSlots(st));
    // 장착 순서대로, 대기시간이 끝난 액티브/버프/힐 사용
    for (const id of slots) {
      if (!id) continue;
      const sk = D.SKILLS[id];
      if (!sk.cd) continue;
      if ((m.cds[id] ?? Infinity) > b.time) continue;
      let used = false;
      if (sk.type === 'active') used = useAttack(st, b, m, sk);
      else if (sk.type === 'buff') {
        if (!b.monsters.some((x) => x.hp > 0)) continue;
        if (sk.party) b.prayUntil = b.time + sk.dur; else m.buffs[id] = b.time + sk.dur;
        b.events.push({ t: 'skill', cls: m.cls, skill: id, ids: [] });
        used = true;
      } else if (sk.type === 'heal') {
        const hurt = aliveMercs(b).some((x) => x.hp < x.s.hp || x.poison);
        if (!hurt) continue;
        for (const x of aliveMercs(b)) { x.hp = Math.min(x.s.hp, x.hp + x.s.hp * 0.02); x.poison = null; b.events.push({ t: 'heal', cls: x.cls, v: Math.round(x.s.hp * 0.02) }); }
        b.events.push({ t: 'skill', cls: m.cls, skill: id, ids: [] });
        used = true;
      }
      if (used) { m.cds[id] = b.time + skillCd(sk, m.s.cdr); return; }
    }
    // 기본 공격 (폭풍의 시 장착 시 대체)
    const basic = slots.includes('storm_arrow') ? D.SKILLS.storm_arrow : D.SKILLS[D.BASIC[m.cls]];
    useAttack(st, b, m, basic);
  }

  function damageMerc(st, b, m, raw, src) {
    if (!m.alive) return;
    if (m.invincUntil > b.time) { b.events.push({ t: 'miss', cls: m.cls }); return; }
    const s = m.s;
    let dmg = raw * (1 - Math.min(0.9, s.def * 0.0001));
    if (s.procs.ignore && rand() < 0.05 * s.procs.ignore) dmg *= 0.9;
    if (m.loveUntil > b.time) dmg *= 0.8; // 사랑 [추정]
    dmg = Math.max(1, Math.round(dmg * (0.9 + rand() * 0.2)));
    m.hp -= dmg;
    b.events.push({ t: 'hurt', cls: m.cls, v: dmg });
    if (src !== 'poison') {
      if (s.procs.invinc && rand() < 0.02 * s.procs.invinc) m.invincUntil = b.time + 1;
      if (s.procs.rage && rand() < 0.08 * s.procs.rage) m.rageUntil = b.time + 3;
      if (s.procs.love && rand() < 0.08 * s.procs.love) m.loveUntil = b.time + 3;
    }
    const merc = st.mercs[m.cls];
    const equipped = merc.skills.slice(0, skillSlots(st));
    if (m.hp > 0 && m.cls === 'war' && !m.beliefUsed && equipped.includes('invincible_belief') && m.hp <= s.hp * 0.3) {
      m.beliefUsed = true;
      for (let i = 1; i <= 3; i++) b.delayed.push({ at: b.time + i, fn: () => { if (m.alive) { m.hp = Math.min(s.hp, m.hp + s.hp * 0.1); b.events.push({ t: 'heal', cls: m.cls, v: Math.round(s.hp * 0.1) }); } } });
      b.events.push({ t: 'skill', cls: 'war', skill: 'invincible_belief', ids: [] });
    }
    if (m.hp <= 0) mercDown(st, b, m);
  }

  function mercDown(st, b, m) {
    m.hp = 0;
    const mage = b.mercs.mage;
    const doorOn = mage && st.mercs.mage.skills.slice(0, skillSlots(st)).includes('heavens_door');
    if (doorOn && !b.doorUsed) {
      b.doorUsed = true;
      m.hp = m.s.hp; m.poison = null;
      b.events.push({ t: 'skill', cls: 'mage', skill: 'heavens_door', ids: [] });
      b.events.push({ t: 'log', msg: `헤븐즈 도어! ${D.CLASS_NAME[m.cls]} 부활` });
      return;
    }
    m.alive = false;
    m.poison = null;
    b.events.push({ t: 'down', cls: m.cls });
    const others = aliveMercs(b);
    if (!others.length) { b.done = 'fail'; return; }
    m.reviveAt = b.time + R.reviveTime;
  }

  function onKill(st, b, mon) {
    b.events.push({ t: 'kill', id: mon.id, x: mon.x, y: mon.y, kind: mon.kind, mob: mon.mob });
    b.killed++;
    st.stats.kills++;
    const online = !b.sim;
    const isStageBoss = mon.kind === 'boss';
    const isRegionBoss = mon.kind === 'regionBoss';
    if (mon.kind === 'box') return onBoxKill(st, b, mon);
    // EXP / 메소
    const exp = expPerKill(b.mode, b.idx) * (isStageBoss ? R.stageBossExp : isRegionBoss ? 30 : 1) * expMult(st);
    for (const c of Object.keys(b.mercs)) gainExp(st, c, exp, b.events);
    const g = D.goldPerKill(b.mode, b.idx) * (isStageBoss ? R.stageBossGold : 1);
    if (g) { const gg = Math.round(g * goldMult(st)); st.gold += gg; b.goldGained = (b.goldGained || 0) + gg; b.events.push({ t: 'meso', v: gg, x: mon.x }); }
    // 드롭 (온라인 전용)
    if (online) {
      const range = D.dropRange(b.mode, b.idx);
      if (range) {
        const chance = isRegionBoss ? 1 : isStageBoss ? R.stageBossEquip : R.equipDrop * (1 + (st.util.drop + bonus(st, 'drop')) / 100);
        if (rand() < chance) {
          const it = makeItem(st, rollDropTier(range));
          if (addItem(st, it)) b.events.push({ t: 'drop', item: it, x: mon.x });
        }
      }
      if (rand() < (b.mode === 'chaos' ? R.cubeChaos : R.cubeNormal) * (1 + bonus(st, 'cube') / 100)) { st.cubes++; b.events.push({ t: 'cube', x: mon.x }); }
      if (b.mode === 'chaos' && rand() < R.smallChaosCoin) { st.smallChaosCoin++; b.events.push({ t: 'coin', x: mon.x }); }
    }
    if (isStageBoss || isRegionBoss) st.stats.bossKills++;
  }

  // ───────── 에스페시아 상자 ─────────
  const BOX_GRADES = ['rare', 'epic', 'unique', 'legendary'];
  const BOX_GROW = 0.35;
  const BOX_MULT = { rare: 1, epic: 2, unique: 3.5, legendary: 6 };
  const BOX_ITEMS = { rare: 1, epic: 2, unique: 3, legendary: 5 };
  const BOX_CUBES = { rare: 1, epic: 2, unique: 4, legendary: 8 };
  const today = (now) => { const d = new Date(now); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function boxStatus(st, b, now) {
    if (st.boxDate === today(now)) return { ok: false, why: '오늘은 이미 소환했어요 (자정 초기화)' };
    if (!b || b.done) return { ok: false, why: '전투 중에만 소환할 수 있어요' };
    if (b.info.isBoss) return { ok: false, why: '보스 스테이지에서는 소환할 수 없어요' };
    if (b.bossSpawned || b.spawned >= R.mobsPerStage) return { ok: false, why: '보스 등장 직전에는 소환할 수 없어요' };
    if (b.box || st.pendingBox) return { ok: false, why: '이미 상자가 소환되어 있어요' };
    if (invFull(st)) return { ok: false, why: '인벤토리가 가득 찼어요' };
    return { ok: true };
  }
  function summonBox(st, b, now) {
    const s = boxStatus(st, b, now);
    if (!s.ok) return s;
    st.boxDate = today(now);
    const hp = b.mon.hp * 40;
    b.box = { id: b.nextMonId++, kind: 'box', hp, maxHp: hp, atk: 0, x: POS.war + 110, // 모든 용병(전사 근접 포함) 사거리 안
       y: 0.5, next: 1e9, stunUntil: 0, grade: 'rare', checks: 0, name: '에스페시아 상자', icon: '🎁' };
    b.monsters.push(b.box);
    b.events.push({ t: 'log', msg: '에스페시아 상자 소환!' });
    return { ok: true };
  }
  // 전투가 끝날 때 남아 있던 상자는 다음 전투에서 이어서 나온다 (등급·남은 체력 유지)
  function respawnPendingBox(st, b) {
    const p = st.pendingBox;
    const maxHp = b.mon.hp * 40;
    b.box = { id: b.nextMonId++, kind: 'box', hp: Math.max(1, Math.round(maxHp * p.frac)), maxHp, atk: 0, x: POS.war + 110,
      y: 0.5, next: 1e9, stunUntil: 0, grade: p.grade, checks: p.checks || 0, name: '에스페시아 상자', icon: '🎁' };
    b.monsters.push(b.box);
    st.pendingBox = null;
    b.events.push({ t: 'log', msg: '에스페시아 상자가 다시 나타났어요!' });
  }
  function onBoxKill(st, b, box) {
    b.box = null;
    st.stats.boxes++;
    const g = box.grade, gm = BOX_MULT[g];
    const exp = Math.round(expPerKill(b.mode, b.idx) * 2700 * gm * expMult(st));
    for (const c of Object.keys(b.mercs)) gainExp(st, c, exp, b.events);
    const range = D.dropRange(b.mode, b.idx) || [1, 1];
    let items = 0;
    for (let i = 0; i < BOX_ITEMS[g]; i++) { const it = makeItem(st, rollDropTier(range)); if (addItem(st, it)) { items++; b.events.push({ t: 'drop', item: it, x: box.x }); } }
    let gold = 0, cubes = 0;
    if (b.mode !== 'chaos') {
      gold = Math.round(D.goldPerKill(b.mode, b.idx) * 200 * gm * goldMult(st));
      cubes = BOX_CUBES[g];
      st.gold += gold; st.cubes += cubes;
    }
    b.events.push({ t: 'box', grade: g, exp, items, gold, cubes });
    b.events.push({ t: 'log', msg: `${D.GRADE_NAME[g]} 에스페시아 상자 처치! EXP +${fmt(exp)}${gold ? `, 메소 +${fmt(gold)}` : ''}${cubes ? `, 큐브 +${cubes}` : ''}${items ? `, 장비 ${items}개` : ''}` });
  }

  // ───────── 전투 진행 ─────────
  const DT = 0.05;
  function stepBattle(st, b, dt) {
    if (b.done) return;
    b.time += dt;
    const t = b.time;
    // 지연 타격
    if (b.delayed.length) {
      const due = b.delayed.filter((d) => d.at <= t);
      if (due.length) {
        b.delayed = b.delayed.filter((d) => d.at > t);
        for (const d of due) d.fn();
      }
    }
    if (b.done) return;
    // 웨이브
    if (!b.info.isBoss) {
      const aliveMobs = b.monsters.filter((m) => m.hp > 0 && m.kind === 'mob').length;
      if (aliveMobs === 0 && b.spawned < R.mobsPerStage) spawnWave(b);
      else if (aliveMobs === 0 && b.spawned >= R.mobsPerStage && !b.bossSpawned) spawnBoss(b, false);
      if (st.pendingBox && !b.box && b.spawned > 0 && !b.bossSpawned) respawnPendingBox(st, b);
    }
    b.monsters = b.monsters.filter((m) => m.hp > 0);
    // 클리어 판정
    if (b.bossSpawned && !b.monsters.some((m) => m.kind !== 'box')) {
      b.done = 'clear';
      return;
    }
    // 용병
    const front = frontMerc(b);
    for (const m of Object.values(b.mercs)) {
      if (!m.alive) {
        if (m.reviveAt && t >= m.reviveAt) {
          m.alive = true; m.hp = Math.round(m.s.hp * R.reviveHp); m.reviveAt = 0; m.next = t + 0.5;
          b.events.push({ t: 'revive', cls: m.cls });
        }
        continue;
      }
      // 중독
      if (m.poison) {
        if (t >= m.poison.until) m.poison = null;
        else if (t >= m.poison.tick) { m.poison.tick += 2; damageMerc(st, b, m, m.s.hp * 0.15 / (1 - Math.min(0.9, m.s.def * 0.0001)), 'poison'); if (b.done) return; }
      }
      // 블래스드 해머
      if (m.cls === 'war' && st.mercs.war.skills.slice(0, skillSlots(st)).includes('blessed_hammer') && t >= m.hammerAt) {
        m.hammerAt = t + 1;
        const tg = targets(b, 2, RANGE.war + 40, m.x);
        for (const x of tg) {
          dealHit(st, b, m, x, 200);
          if (rand() < 0.1) { m.hp = Math.min(m.s.hp, m.hp + m.s.hp * 0.01); }
        }
        if (tg.length) b.events.push({ t: 'hammer' });
      }
      if (t >= m.next) {
        m.next = t + m.s.interval;
        mercAct(st, b, m);
      }
    }
    if (b.done) return;
    // 몬스터
    const tgt = frontMerc(b);
    for (const mon of b.monsters) {
      if (mon.kind === 'box') continue;
      if (mon.stunUntil > t) continue;
      const stopX = (tgt ? tgt.x : 300) + 70 + (mon.kind === 'mob' ? (mon.id % 5) * 24 : 40);
      if (mon.x > stopX) { mon.x = Math.max(stopX, mon.x - 140 * dt); continue; }
      // 지역 보스 기믹
      if (mon.kind === 'regionBoss') {
        mon.mechAt -= dt;
        if (mon.mechAt <= 0) {
          if (mon.mech === 'heal') {
            mon.mechAt = 5;
            const v = Math.round(mon.maxHp * b.mon.healPct);
            mon.hp = Math.min(mon.maxHp, mon.hp + v);
            b.events.push({ t: 'bossheal', id: mon.id, v });
          } else if (mon.mech === 'poison') {
            mon.mechAt = 7;
            for (const m of aliveMercs(b)) m.poison = { until: t + 10, tick: t + 2 };
            b.events.push({ t: 'log', msg: '모든 용병이 중독되었습니다!' });
          } else if (mon.mech === 'doom') {
            mon.mechAt = 15;
            b.events.push({ t: 'log', msg: '오디움의 수호병이 광역 즉사기를 시전했습니다!' });
            for (const m of aliveMercs(b)) { m.hp = 1; damageMerc(st, b, m, 1e12, 'doom'); if (b.done) return; }
          }
        }
      }
      if (t >= mon.next) {
        mon.next = t + R.monsterAttackInterval * (mon.kind === 'mob' ? 1 : 0.9);
        mon.atkAt = t;
        if (tgt) { damageMerc(st, b, tgt, mon.atk, 'hit'); if (b.done) return; }
      }
    }
    if (!tgt && !b.done) b.done = 'fail';
  }

  // 클리어/실패 처리 → 다음 스테이지 결정. events 에 결과를 남긴다.
  // 남은 상자를 다음 전투로 넘긴다 (전투 종료, 스테이지 이동 등 전투가 바뀌는 모든 경우)
  function stashBox(st, b) {
    if (!b || !b.box || b.box.hp <= 0) return false;
    st.pendingBox = { grade: b.box.grade, frac: b.box.hp / b.box.maxHp, checks: b.box.checks };
    b.monsters = b.monsters.filter((m) => m !== b.box);
    b.box = null;
    return true;
  }
  function finishBattle(st, b, now) {
    if (stashBox(st, b)) b.events.push({ t: 'log', msg: '에스페시아 상자는 다음 전투에서 이어서 나와요' });
    const key = `${b.mode}:${b.idx}`;
    const secs = b.time;
    if (b.done === 'clear') {
      const rate = b.killed / Math.max(1, secs);
      st.killRate[key] = st.killRate[key] ? st.killRate[key] * 0.6 + rate * 0.4 : rate;
      const first = !isCleared(st, b.mode, b.idx);
      st.cleared[b.mode][b.idx] = true;
      if (first) {
        const rw = D.clearReward(b.mode, b.idx);
        if (rw) {
          if (rw.coin) st.squadCoin += rw.coin;
          if (rw.medal) st.medals[rw.medal] = now;
          b.events.push({ t: 'firstclear', label: b.info.label, mode: b.mode, reward: rw });
        }
      }
      st.lastBattle = { mode: b.mode, stage: b.idx, cleared: true };
      // 다음 스테이지
      if (b.info.isBoss) {
        if (b.idx === 29) { st.stage = 28; st.repeat = true; st.repeatReason = null; }
        else { st.stage = b.idx + 1; }
      } else if (!st.repeat) {
        const next = b.idx + 1;
        if (next % 10 === 9 && invFull(st)) { st.repeat = true; st.repeatReason = 'inv'; b.events.push({ t: 'log', msg: '인벤토리가 가득 차서 보스 스테이지에 입장할 수 없어요.' }); }
        else st.stage = next;
      }
    } else {
      st.lastBattle = { mode: b.mode, stage: b.idx, cleared: isCleared(st, b.mode, b.idx) };
      // 이전에 클리어한 1단계 아래 스테이지로 이동 + 반복
      let back = Math.max(0, b.idx - 1);
      while (back > 0 && back % 10 === 9) back--;
      if (back === b.idx && !isCleared(st, b.mode, back)) back = b.idx;
      st.stage = back;
      st.repeat = true;
      st.repeatReason = 'fail';
      st.retryAt = now;
      b.events.push({ t: 'log', msg: `스테이지 ${b.info.label} 클리어 실패. ${stageInfo(b.mode, back).label} 스테이지를 반복합니다.` });
    }
  }

  // 입장 가능한 스테이지: 클리어한 일반 스테이지 + 다음 도전 스테이지
  function frontier(st, mode) {
    let i = 0;
    while (i < 30 && isCleared(st, mode, i)) i++;
    return Math.min(i, 29);
  }
  function canEnter(st, mode, idx) {
    if (mode === 'chaos' && !chaosUnlocked(st)) return false;
    if (idx % 10 === 9) return !isCleared(st, mode, idx) && idx === frontier(st, mode) && !invFull(st);
    return isCleared(st, mode, idx) || idx === frontier(st, mode);
  }

  // ───────── 오프라인 정산 ─────────
  function offlineBase(st) {
    const lb = st.lastBattle || { mode: 'normal', stage: 0, cleared: false };
    let idx = lb.stage;
    const mode = lb.mode;
    if (!lb.cleared || idx % 10 === 9) {
      idx = idx - 1;
      while (idx >= 0 && (idx % 10 === 9 || !isCleared(st, mode, idx))) idx--;
    }
    return idx < 0 ? null : { mode, idx };
  }
  function estimateKillRate(st, mode, idx) {
    const r = st.killRate[`${mode}:${idx}`];
    if (r) return r;
    return (R.mobsPerStage + 1) / 150; // 기본: 150초에 한 스테이지 [추정]
  }
  function applyOffline(st, now) {
    const away = Math.max(0, (now - st.lastSeen) / 1000);
    const cap = st.util.offline * 3600;
    const secs = Math.min(away, cap);
    const base = offlineBase(st);
    const res = { away, secs, gold: 0, exp: 0, ups: {}, base };
    if (secs < 60 || !base) return res;
    const kills = estimateKillRate(st, base.mode, base.idx) * secs * (R.offlineRatio + bonus(st, 'offline') / 100);
    const before = {};
    for (const c of ownedMercs(st)) before[c] = { lv: st.mercs[c].lv, exp: st.mercs[c].exp };
    const exp = Math.round(kills * expPerKill(base.mode, base.idx) * expMult(st));
    for (const c of ownedMercs(st)) gainExp(st, c, exp, null);
    const gold = Math.round(kills * D.goldPerKill(base.mode, base.idx) * goldMult(st));
    st.gold += gold;
    res.gold = gold; res.exp = exp; res.kills = Math.round(kills);
    for (const c of ownedMercs(st)) res.ups[c] = { from: before[c].lv, to: st.mercs[c].lv, fromPct: before[c].exp / expNeed(before[c].lv), toPct: st.mercs[c].lv >= D.MAX_LEVEL ? 1 : st.mercs[c].exp / expNeed(st.mercs[c].lv) };
    return res;
  }

  // ───────── 관리 액션 ─────────
  function equipItem(st, itemId) {
    const i = st.inventory.findIndex((x) => x.id === itemId);
    if (i < 0) return { ok: false, why: '아이템이 없어요' };
    const it = st.inventory[i];
    const m = st.mercs[it.cls];
    if (!m.owned) return { ok: false, why: `${D.CLASS_NAME[it.cls]}를 아직 영입하지 않았어요` };
    if (m.lv < D.TIERS[it.tier].req) return { ok: false, why: `Lv.${D.TIERS[it.tier].req} 이상 착용 가능` };
    st.inventory.splice(i, 1);
    const old = m.equip[it.slot];
    m.equip[it.slot] = it;
    it.isNew = false;
    if (old) st.inventory.splice(i, 0, old);
    return { ok: true };
  }
  function unequipItem(st, cls, slot) {
    const m = st.mercs[cls];
    const it = m.equip[slot];
    if (!it) return { ok: false };
    if (invFull(st)) return { ok: false, why: '인벤토리가 가득 찼어요' };
    m.equip[slot] = null;
    st.inventory.push(it);
    return { ok: true };
  }
  function setSkill(st, b, cls, slotIdx, skillId) {
    const m = st.mercs[cls];
    if (slotIdx >= skillSlots(st)) return { ok: false, why: '잠긴 슬롯이에요' };
    m.unequipCd = m.unequipCd || {};
    const now = b ? b.time : 0;
    if (skillId) {
      const sk = D.SKILLS[skillId];
      if (!sk || sk.cls !== cls || m.lv < sk.lv) return { ok: false, why: '배우지 않은 스킬이에요' };
      if (m.unequipCd[skillId] && b && m.unequipCd[skillId] > now) return { ok: false, why: `재장착 대기시간 ${(m.unequipCd[skillId] - now).toFixed(1)}초` };
      const dup = m.skills.indexOf(skillId);
      if (dup >= 0) m.skills[dup] = null;
    }
    const prev = m.skills[slotIdx];
    if (prev && prev !== skillId) m.unequipCd[prev] = now + R.unequipCooldown;
    m.skills[slotIdx] = skillId;
    // 전투 중 새로 장착하면 대기시간만큼 기다린 뒤 사용
    if (b && b.mercs[cls] && skillId) {
      const sk = D.SKILLS[skillId];
      if (sk.cd) b.mercs[cls].cds[skillId] = b.time + skillCd(sk, b.mercs[cls].s.cdr);
    }
    if (b) refreshMercStats(st, b);
    return { ok: true };
  }
  function recruit(st, cls) {
    const r = D.RECRUIT[cls];
    if (st.mercs[cls].owned) return { ok: false };
    if (!isCleared(st, 'normal', r.need)) return { ok: false, why: `${stageInfo('normal', r.need).label} 스테이지를 클리어해야 해요` };
    if (cls === 'mage' && !st.mercs.arch.owned) return { ok: false, why: '궁수를 먼저 영입해야 해요' };
    if (st.gold < r.cost) return { ok: false, why: '메소가 부족해요' };
    st.gold -= r.cost;
    st.mercs[cls].owned = true;
    st.mercs[cls].skills = [null, null, null];
    return { ok: true };
  }
  function buyUtil(st, key) {
    const U = D.UTIL[key];
    const cur = st.util[key];
    const lvIdx = key === 'slots' ? cur - 1 : key === 'offline' ? cur - 16 : U.levels.findIndex((l) => l.v === cur) + 1;
    const next = U.levels[lvIdx];
    if (!next) return { ok: false, why: '최대 단계예요' };
    if (next.need != null && !isCleared(st, 'normal', next.need)) return { ok: false, why: `${stageInfo('normal', next.need).label} 클리어 후 구매 가능` };
    if (st.gold < next.cost) return { ok: false, why: '메소가 부족해요' };
    st.gold -= next.cost;
    st.util[key] = next.v;
    return { ok: true };
  }
  function utilNext(st, key) {
    const U = D.UTIL[key];
    const cur = st.util[key];
    const lvIdx = key === 'slots' ? cur - 1 : key === 'offline' ? cur - 16 : U.levels.findIndex((l) => l.v === cur) + 1;
    return U.levels[lvIdx] || null;
  }
  function expandInv(st, n) {
    let done = 0;
    for (let i = 0; i < n; i++) {
      if (st.invSize >= D.INV_MAX) break;
      const c = D.invSlotCost(st.invSize + 1);
      if (st.gold < c) break;
      st.gold -= c; st.invSize++; done++;
    }
    return done;
  }
  function buyCubes(st, n) {
    const can = Math.min(n, Math.floor(st.gold / D.CUBE_PRICE));
    st.gold -= can * D.CUBE_PRICE; st.cubes += can;
    return can;
  }
  function findItem(st, id) {
    const inv = st.inventory.find((x) => x.id === id);
    if (inv) return inv;
    for (const c of D.CLASSES) for (const s of D.SLOTS) { const it = st.mercs[c].equip[s]; if (it && it.id === id) return it; }
    return null;
  }
  function cubeRoll(st, id) {
    const it = findItem(st, id);
    if (!it || it.tier < 2) return { ok: false, why: '2단계 이상 장비에만 사용할 수 있어요' };
    if (st.cubes <= 0) return { ok: false, why: '훈련용 큐브가 없어요' };
    st.cubes--;
    return { ok: true, before: it.pot, after: rollPotentials(it.slot, it.tier) };
  }
  function cubeApply(st, id, pot) { const it = findItem(st, id); if (it) it.pot = pot; }
  function synthesize(st, ids) {
    if (ids.length !== 9) return { ok: false, why: '같은 단계 장비 9개가 필요해요' };
    const items = ids.map((id) => st.inventory.find((x) => x.id === id));
    if (items.some((x) => !x || x.lock)) return { ok: false, why: '잠긴 장비나 없는 장비가 있어요' };
    const tier = items[0].tier;
    if (items.some((x) => x.tier !== tier)) return { ok: false, why: '같은 단계 장비만 합성할 수 있어요' };
    st.inventory = st.inventory.filter((x) => !ids.includes(x.id));
    const out = makeItem(st, Math.min(8, tier + 1));
    st.inventory.push(out);
    return { ok: true, item: out };
  }
  function autoSynthGroup(st) {
    const by = {};
    for (const it of st.inventory) if (!it.lock) (by[it.tier] = by[it.tier] || []).push(it.id);
    for (let t = 1; t <= 8; t++) if (by[t] && by[t].length >= 9) return by[t].slice(0, 9);
    return null;
  }
  function dismantle(st, ids) {
    let gold = 0, n = 0;
    st.inventory = st.inventory.filter((x) => {
      if (!ids.includes(x.id) || x.lock) return true;
      gold += D.TIERS[x.tier].dis; n++;
      return false;
    });
    st.gold += gold;
    return { n, gold };
  }
  function convertChaosCoins(st, n) {
    n = Math.min(n, st.smallChaosCoin);
    st.smallChaosCoin -= n; st.chaosCoin += n;
    return n;
  }
  function buyCoinUp(st, id) {
    const u = D.COIN_UP.find((x) => x.id === id);
    st.coinUp = st.coinUp || {};
    const lv = st.coinUp[id] || 0;
    if (lv >= u.max) return { ok: false, why: '최대 단계예요' };
    const cost = D.coinUpCost(u, lv);
    const key = u.cur === 'squad' ? 'squadCoin' : 'chaosCoin';
    if (st[key] < cost) return { ok: false, why: '코인이 부족해요' };
    st[key] -= cost;
    st.coinUp[id] = lv + 1;
    return { ok: true };
  }

  function fmt(n) {
    n = Math.round(n);
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(n >= 1e9 ? 0 : 1).replace(/\.0$/, '') + '억';
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + '만';
    return n.toLocaleString('ko-KR');
  }

  G.US = {
    setRandom, mulberry32, newState, createBattle, stepBattle, finishBattle, refreshMercStats, DT,
    mercStats, skillCd, expNeed, expPerKill, monsterStats, stageInfo, isCleared, chaosUnlocked, ownedMercs,
    makeItem, itemName, invFull, addItem, availableSkills, canEquip, gainExp, frontier, canEnter,
    applyOffline, offlineBase, boxStatus, summonBox, equipItem, unequipItem, setSkill, recruit, buyUtil, utilNext,
    expandInv, buyCubes, cubeRoll, cubeApply, findItem, synthesize, autoSynthGroup, dismantle, convertChaosCoins, buyCoinUp, bonus, defaultAuto, stashBox,
    skillSlots, fmt, today,
  };
})(typeof window !== 'undefined' ? window : globalThis);
