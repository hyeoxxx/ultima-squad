// 용병 관리 UI (탭 패널)
(function (G) {
  'use strict';
  const D = G.USData, US = G.US, RD = G.USRender, AS = G.USAssets;
  const skIcon = (sk) => `<img class="skic" src="${AS.skillIcon(sk.id)}" alt="${sk.icon}">`;
  const icon = (it) => `<img class="ic" src="${AS.iconSrc(it)}" alt="${SLOT_ICON[it.slot]}" loading="lazy">`;
  const avatarImg = (c, m) => `<img class="av" src="${AS.charSrc(c, RD.avatarStage(m.lv), m.equip.weapon ? m.equip.weapon.tier : 0, 'stand', 0)}" alt="${RD.AVATAR[c][RD.avatarStage(m.lv)]}">`;
  const $ = (id) => document.getElementById(id);
  const fmt = US.fmt;
  const SLOT_ICON = { weapon: '⚔️', hat: '🎩', glove: '🧤', shoe: '👢' };
  const CLS_ICON = { war: '<img class="ci" src="assets/items/war_1_weapon.png" alt="">', arch: '<img class="ci" src="assets/items/arch_1_weapon.png" alt="">', mage: '<img class="ci" src="assets/items/mage_1_weapon.png" alt="">' };
  const MI = (name) => `<img class="mi" src="assets/icons/${name}.png" alt="">`;
  const POT_KEY_NAME = { hp: 'HP', def: '방어력', atk: '공격력', matk: '마력', atkp: '공격력%', matkp: '마력%', crit: '크확', critdmg: '크뎀', speed: '공속', cdr: '쿨감', rage: '분노', love: '사랑', invinc: '무적', ignore: '데미지 무시' };

  const ui = { tab: 'merc', sel: null, skillSel: null, synth: new Set(), potItem: null, cube: null, disTier: 0, mapMode: null, dirty: true, view: { cls: 'all', slot: 'all', sort: 'new' } };
  let ctx = null; // { st, getBattle, onStageChange, save }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function res(r, okMsg) { if (r && r.ok === false) { if (r.why) toast(r.why); return false; } if (okMsg) toast(okMsg); ctx.save(); return true; }
  function modal(html) { $('modalBox').innerHTML = html; $('modal').hidden = false; }
  function closeModal() { $('modal').hidden = true; }
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal' || e.target.dataset.close != null) closeModal(); });

  const gradeOf = (it) => D.TIERS[it.tier].grade;
  function itemCell(it, extra = '') {
    const g = gradeOf(it);
    if (ctx && G.USAuto && ctx.st.inventory.includes(it) && G.USAuto.isUpgrade(ctx.st, it)) extra += ' up';
    return `<div class="item ${g ? 'g-' + g : ''} ${extra}" data-item="${it.id}" title="${esc(US.itemName(it))}">
      <span class="tier">${it.tier}</span>${icon(it)}<span class="cls">${CLS_ICON[it.cls]}</span>
      ${it.isNew ? '<span class="new"></span>' : ''}${it.lock ? '<span class="lock">잠금</span>' : ''}${extra.includes(' up') ? '<span class="upm">▲</span>' : ''}${/(^|\s)eq(\s|$)/.test(extra) ? '<span class="eqm">E</span>' : ''}${ui.view.sort === 'cp' && ['inv', 'pot', 'synth', 'dis'].includes(ui.tab) ? `<span class="cpv">${G.USAuto.itemPower(ctx.st, it).toLocaleString("ko-KR")}</span>` : ''}</div>`;
  }
  function potLines(it) {
    if (!it.pot.length) return '<div class="muted small">잠재능력 없음</div>';
    const g = gradeOf(it);
    return `<div class="gname" style="color:${D.GRADE_COLOR[g]}">${D.GRADE_NAME[g]}</div>` + it.pot.map((p) => `<div>${esc(D.POT_LABEL[p.k](p.v))}</div>`).join('');
  }
  function itemDetail(it, opts = {}) {
    const T = D.TIERS[it.tier];
    const st = ctx.st;
    const merc = st.mercs[it.cls];
    const base = it.slot === 'weapon' ? `${it.cls === 'mage' ? '마력' : '공격력'} +${it.atk}<br>공격속도 +${it.speed}단계` : `최대 HP +${it.hp}<br>방어력 +${it.def}`;
    let cmp = '';
    if (opts.compare && merc.owned) {
      const cur = merc.equip[it.slot];
      if (cur && cur.id !== it.id) {
        const d = (a, b) => { const v = a - b; return v === 0 ? '' : `<span class="diff ${v > 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${v}</span>`; };
        cmp = `<div class="small muted">착용 중: ${esc(US.itemName(cur))} (${cur.tier}단계)</div>` +
          (it.slot === 'weapon' ? `<div class="small">공/마 ${d(it.atk, cur.atk)}</div>` : `<div class="small">HP ${d(it.hp, cur.hp)} · 방어력 ${d(it.def, cur.def)}</div>`);
      } else if (!cur) cmp = '<div class="small muted">착용 중인 장비 없음</div>';
    }
    if (opts.compare && G.USAuto.canWear(st, it) && st.inventory.includes(it)) {
      const ratio = G.USAuto.upgradeRatio(st, it);
      if (ratio) cmp += `<div class="small" style="margin-top:4px">장착 시 전투력 <span class="diff ${ratio > 1.0001 ? 'up' : ratio < 0.9999 ? 'down' : ''}">${ratio >= 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(1)}%</span></div>`;
    }
    return `<div class="row">${icon(it)}<div class="name">${esc(US.itemName(it))}</div></div>
      <div class="small muted">${D.CLASS_NAME[it.cls]} ${D.SLOT_NAME[it.slot]} · ${it.tier}단계 · ${D.QUALITY_NAME[it.q]} · Lv.${T.req} 이상</div>
      <div class="cpline">장비 전투력 <b>${G.USAuto.itemPower(st, it).toLocaleString("ko-KR")}</b></div>
      <div style="margin-top:6px">${base}</div>
      <div class="pot">${potLines(it)}</div>${cmp}`;
  }

  // ───────── 패널 렌더 ─────────
  const panels = {};

  panels.merc = function () {
    const st = ctx.st, b = ctx.getBattle();
    const slots = US.skillSlots(st);
    return `<div class="squadcp">스쿼드 전투력 <b>${G.USAuto.squadPower(st).toLocaleString("ko-KR")}</b></div><div class="mercs">${D.CLASSES.map((c) => {
      const m = st.mercs[c];
      if (!m.owned) {
        const r = D.RECRUIT[c];
        const ok = US.isCleared(st, 'normal', r.need) && (c !== 'mage' || st.mercs.arch.owned);
        return `<div class="merc"><div class="merc-head"><div class="avatar" style="filter:grayscale(1)">${RD.AVATAR[c][0]}</div><div><b>${D.CLASS_NAME[c]}</b><div class="small muted">미영입</div></div></div>
          <p class="small muted">${US.stageInfo('normal', r.need).label} 스테이지 클리어${c === 'mage' ? ' + 궁수 영입' : ''} 후 영입 가능</p>
          <button class="btn primary" data-act="recruit" data-cls="${c}" ${ok && st.gold >= r.cost ? '' : 'disabled'}>${MI('meso')} ${fmt(r.cost)} 메소로 영입</button></div>`;
      }
      const s = US.mercStats(st, c);
      const stage = RD.avatarStage(m.lv);
      const pct = m.lv >= D.MAX_LEVEL ? 100 : (m.exp / US.expNeed(m.lv) * 100);
      const learned = D.SKILL_LIST(c);
      return `<div class="merc">
        <div class="merc-head"><div class="avatar t${stage}">${avatarImg(c, m)}</div>
          <div style="flex:1"><b>${D.CLASS_NAME[c]}</b> <span class="muted">Lv.${m.lv}${m.lv >= D.MAX_LEVEL ? ' (MAX)' : ''}</span> <span class="cpb">⚔ ${G.USAuto.mercPower(st, c).toLocaleString("ko-KR")}</span>
          <div class="lvbar"><div style="width:${pct.toFixed(1)}%"></div></div><div class="small muted">EXP ${pct.toFixed(2)}%</div></div></div>
        <div class="stats">
          <div><span>${c === 'mage' ? '마력' : '공격력'}</span><b>${fmt(s.atkTotal)}</b></div><div><span>최대 HP</span><b>${fmt(s.hp)}</b></div>
          <div><span>방어력</span><b>${fmt(s.def)}</b></div><div><span>공격 속도</span><b>${s.speed}단계</b></div>
          <div><span>크리티컬 확률</span><b>${s.crit}%</b></div><div><span>크리티컬 데미지</span><b>${s.critDmg}%</b></div>
          <div><span>재사용 감소</span><b>${s.cdr}초</b></div><div><span>피해 감소</span><b>${(Math.min(0.9, s.def * 0.0001) * 100).toFixed(1)}%</b></div>
        </div>
        <div class="small muted">장비</div>
        <div class="equip">${D.SLOTS.map((sl) => { const it = m.equip[sl]; return it ? `<div class="eslot ${gradeOf(it) ? 'g-' + gradeOf(it) : ''}" data-eq="${c}:${sl}" title="${esc(US.itemName(it))}"><span class="tier">${it.tier}</span>${icon(it)}</div>` : `<div class="eslot empty" data-eq="${c}:${sl}">${D.SLOT_NAME[sl]}</div>`; }).join('')}</div>
        <div class="small muted">스킬 슬롯 <span class="small">(슬롯을 고른 뒤 아래 스킬을 누르세요 · 앞 슬롯부터 사용)</span></div>
        <div class="skills">${[0, 1, 2].map((i) => {
          const id = m.skills[i];
          const locked = i >= slots;
          const sel = ui.skillSel && ui.skillSel[0] === c && ui.skillSel[1] === i;
          if (locked) return `<div class="sslot locked">${i === 1 ? '1-10' : '2-10'} 클리어 후 확장</div>`;
          return `<div class="sslot ${id ? 'filled' : ''} ${sel ? 'sel' : ''}" data-sslot="${c}:${i}">${id ? `${skIcon(D.SKILLS[id])} ${D.SKILLS[id].name}` : '비어 있음'}</div>`;
        }).join('')}</div>
        <div class="sklist">${learned.map((sk) => {
          const ok = m.lv >= sk.lv;
          const on = m.skills.slice(0, slots).includes(sk.id);
          const cd = sk.cd ? `${US.skillCd(sk, s.cdr).toFixed(1).replace('.0', '')}초` : sk.type === 'passive' ? '상시' : sk.type === 'trigger' ? '조건 발동' : sk.type === 'basic' ? '기본 공격 대체' : '';
          return `<div class="sk ${ok ? '' : 'locked'} ${on ? 'on' : ''}" data-skill="${c}:${sk.id}" title="${esc(sk.desc)}">${skIcon(sk)} ${sk.name}<small>${ok ? cd : `Lv.${sk.lv} 습득`}</small></div>`;
        }).join('')}</div>
      </div>`;
    }).join('')}</div>
    <p class="small muted">스킬에 마우스를 올리면 설명이 나와요. 스킬을 해제하면 3초 동안 다시 장착할 수 없고, 전투 중 새로 장착한 스킬은 재사용 대기시간이 지나야 사용돼요.</p>`;
  };

  // 장비 목록 보기: 직업/부위 하위 탭 + 정렬 (인벤토리·잠재능력·합성·분해 공용)
  const VIEW_CLS = [['all', '전체'], ['war', `${CLS_ICON.war} 전사`], ['arch', `${CLS_ICON.arch} 궁수`], ['mage', `${CLS_ICON.mage} 마법사`]];
  const VIEW_SLOT = [['all', '전체'], ['weapon', '무기'], ['hat', '모자'], ['glove', '장갑'], ['shoe', '신발']];
  const VIEW_SORT = [['new', '최근 획득'], ['tier', '단계'], ['cp', '전투력']];
  function viewBar(list) {
    const v = ui.view;
    const n = (val) => list.filter((it) => val === 'all' || it.cls === val).length;
    const sel = (key, opts) => `<select data-viewsel="${key}">${opts.map(([val, name]) => `<option value="${val}" ${v[key] === val ? 'selected' : ''}>${name}</option>`).join('')}</select>`;
    return `<nav class="subtabs">${VIEW_CLS.map(([val, name]) => `<button class="${v.cls === val ? 'on' : ''}" data-view="cls:${val}">${name} <small>${n(val)}</small></button>`).join('')}
      <span class="sub-right">${sel('slot', VIEW_SLOT.map(([k, nm]) => [k, k === 'all' ? '부위: 전체' : nm]))}${sel('sort', VIEW_SORT.map(([k, nm]) => [k, '정렬: ' + nm]))}</span></nav>`;
  }
  // 영입한 용병이 착용 중인 장비
  const equippedItems = () => D.CLASSES.filter((c) => ctx.st.mercs[c].owned).flatMap((c) => D.SLOTS.map((sl) => ctx.st.mercs[c].equip[sl]).filter(Boolean));
  // 탭별로 하위 탭에 셀 장비 목록
  function viewSource(tab) {
    const st = ctx.st;
    if (tab === 'pot') return [...st.inventory.filter((it) => it.tier >= 2), ...equippedItems()];
    if (tab === 'dis') return st.inventory.filter((x) => !x.lock);
    if (tab === 'inv') return [...st.inventory, ...equippedItems()];
    return st.inventory;
  }
  function view(list) {
    const v = ui.view;
    const out = list.filter((it) => (v.cls === 'all' || it.cls === v.cls) && (v.slot === 'all' || it.slot === v.slot));
    if (v.sort === 'tier') out.sort((a, b) => b.tier - a.tier || b.q - a.q);
    else if (v.sort === 'cp') { const cp = new Map(out.map((it) => [it, G.USAuto.itemPower(ctx.st, it)])); out.sort((a, b) => cp.get(b) - cp.get(a)); }
    else out.reverse();
    return out;
  }
  const sortedInv = () => view(ctx.st.inventory.slice());

  panels.inv = function () {
    const st = ctx.st;
    const sel = ui.sel && US.findItem(st, ui.sel);
    const nextCost = st.invSize < D.INV_MAX ? D.invSlotCost(st.invSize + 1) : null;
    const inInv = sel && st.inventory.includes(sel);
    return `<div class="inv-layout"><div>
      <div class="row" style="margin-bottom:8px"><b>인벤토리 ${st.inventory.length} / ${st.invSize}</b>
        <button class="btn sm" data-act="seenAll">새 표시 지우기</button></div>
      <div class="grid">${view(equippedItems()).map((it) => itemCell(it, 'eq' + (ui.sel === it.id ? ' sel' : ''))).join('')}${sortedInv().map((it) => itemCell(it, ui.sel === it.id ? 'sel' : '')).join('')}</div>
      ${st.inventory.length ? '' : '<p class="muted small">인벤토리가 비어 있어요. 몬스터를 처치하면 일정 확률로 장비를 얻어요 (접속 중에만).</p>'}
      <hr><div class="row"><b>인벤토리 확장</b>
        ${nextCost ? `<span class="small muted">다음 칸 ${fmt(nextCost)} 메소</span><button class="btn sm" data-act="expand" data-n="1">+1칸</button><button class="btn sm" data-act="expand" data-n="10">+10칸</button>` : '<span class="muted">최대</span>'}</div>
    </div>
    <div class="detail">${sel ? itemDetail(sel, { compare: true }) + `<div class="row" style="margin-top:10px">
        ${inInv ? `<button class="btn primary" data-act="equip">장착</button>` : `<button class="btn" data-act="unequipSel">장착 해제</button>`}
        <button class="btn" data-act="lock">${sel.lock ? '잠금 해제' : '잠금'}</button>
        ${inInv ? `<button class="btn danger" data-act="disOne" ${sel.lock ? 'disabled' : ''}>분해 (${fmt(D.TIERS[sel.tier].dis)} 메소)</button>` : ''}
        ${sel.tier >= 2 ? `<button class="btn" data-act="toPot">잠재 재설정</button>` : ''}</div>` : '<p class="muted">장비를 누르면 정보가 나와요.</p>'}</div></div>`;
  };

  panels.pot = function () {
    const st = ctx.st;
    const worn = view(equippedItems());
    const items = view(st.inventory.filter((it) => it.tier >= 2));
    const it = ui.potItem && US.findItem(st, ui.potItem);
    let right = '<p class="muted">잠재능력을 재설정할 장비를 고르세요. (착용 중인 장비 포함, 2단계 이상)</p>';
    if (it) {
      right = itemDetail(it);
      if (ui.cube && ui.cube.id === it.id) {
        const fake = Object.assign({}, it, { pot: ui.cube.after });
        right += `<hr><div class="row" style="align-items:stretch"><div class="pot" style="flex:1"><b class="small">BEFORE</b>${potLines(it)}</div><div class="pot" style="flex:1"><b class="small">AFTER</b>${potLines(fake)}</div></div>
          <div class="row"><button class="btn" data-act="cubeKeep">BEFORE 유지</button><button class="btn primary" data-act="cubeApply">AFTER 적용</button></div>`;
      } else right += `<button class="btn primary" data-act="cube" ${st.cubes > 0 ? '' : 'disabled'}>${MI('cube')} 훈련용 큐브 사용 (보유 ${st.cubes})</button>`;
    }
    return `<div class="inv-layout"><div>
      <div class="row" style="margin-bottom:8px"><b>훈련용 큐브 ${st.cubes}개</b><button class="btn sm" data-act="buyCube" data-n="1">1개 구매 (2만 메소)</button><button class="btn sm" data-act="buyCube" data-n="10">10개 구매 (20만 메소)</button></div>
      <p class="small muted">재설정해도 등급은 오르지 않고, 결과 중 전/후를 골라 적용할 수 있어요. 같은 잠재가 다시 나올 수도 있어요.</p>
      <h4 class="sec">착용 중</h4>
      <div class="grid">${worn.map((x) => itemCell(x, 'eq' + (x.tier < 2 ? ' dim' : '') + (ui.potItem === x.id ? ' sel' : ''))).join('') || '<p class="muted small">착용 중인 장비가 없어요.</p>'}</div>
      <h4 class="sec">인벤토리</h4>
      <div class="grid">${items.map((x) => itemCell(x, ui.potItem === x.id ? 'sel' : '')).join('') || '<p class="muted small">2단계 이상 장비가 없어요.</p>'}</div>
      <p class="small muted">1단계 장비는 원작처럼 잠재능력이 없어서 재설정할 수 없어요.</p>
    </div><div class="detail">${right}</div></div>`;
  };

  panels.synth = function () {
    const st = ctx.st;
    const selItems = [...ui.synth].map((id) => st.inventory.find((x) => x.id === id)).filter(Boolean);
    ui.synth = new Set(selItems.map((x) => x.id));
    const tier = selItems[0] && selItems[0].tier;
    return `<div class="row" style="margin-bottom:8px"><b>장비 합성</b><span class="small muted">같은 단계 장비 9개 → 한 단계 높은 장비 1개 (8단계는 8단계 1개)</span></div>
      <div class="row" style="margin-bottom:10px"><button class="btn" data-act="synthAuto">일괄 합성 등록</button><button class="btn sm" data-act="synthClear">선택 해제</button>
      <span>선택 <b>${selItems.length}</b> / 9 ${tier ? `(${tier}단계)` : ''}</span>
      <button class="btn primary" data-act="synth" ${selItems.length === 9 ? '' : 'disabled'}>합성</button>
      <button class="btn" data-act="synthAll">가능한 만큼 전부 합성</button></div>
      <div class="grid">${sortedInv().map((it) => itemCell(it, (ui.synth.has(it.id) ? 'sel ' : '') + ((tier && it.tier !== tier) || it.lock ? 'dim' : ''))).join('') || '<p class="muted">장비가 없어요.</p>'}</div>`;
  };

  panels.dis = function () {
    const st = ctx.st;
    const list = disTargets();
    const gold = list.reduce((s, x) => s + D.TIERS[x.tier].dis, 0);
    return `<div class="row" style="margin-bottom:8px"><b>장비 분해</b><span class="small muted">잠긴 장비는 분해되지 않아요</span></div>
      <div class="row" style="margin-bottom:10px">대상 <select id="disTier"><option value="0">전체</option>${[1, 2, 3, 4, 5, 6, 7].map((t) => `<option value="${t}" ${ui.disTier === t ? 'selected' : ''}>${t}단계 이하</option>`).join('')}</select>
        <span>${list.length}개 → ${MI('meso')} <b>${fmt(gold)}</b></span><button class="btn danger" data-act="disAll" ${list.length ? '' : 'disabled'}>분해</button></div>
      <table class="t"><tr><th>단계</th>${[1, 2, 3, 4, 5, 6, 7, 8].map((t) => `<th>${t}</th>`).join('')}</tr><tr><td class="muted">분해 메소</td>${[1, 2, 3, 4, 5, 6, 7, 8].map((t) => `<td>${fmt(D.TIERS[t].dis)}</td>`).join('')}</tr></table>
      <div class="grid" style="margin-top:10px">${list.map((it) => itemCell(it)).join('')}</div>
      <p class="small muted">위에서 고른 직업·부위의 장비만 분해 대상이에요.</p>`;
  };

  function disTargets() {
    return view(ctx.st.inventory.filter((x) => !x.lock && (ui.disTier === 0 || x.tier <= ui.disTier)));
  }

  panels.map = function () {
    const st = ctx.st;
    const mode = ui.mapMode || st.mode;
    const chaosOk = US.chaosUnlocked(st);
    const front = US.frontier(st, mode);
    const lb = US.offlineBase(st);
    return `<div class="row" style="margin-bottom:10px">
        <button class="btn ${mode === 'normal' ? 'primary' : ''}" data-act="mapMode" data-mode="normal">일반 모드</button>
        <button class="btn ${mode === 'chaos' ? 'primary' : ''}" data-act="mapMode" data-mode="chaos" ${chaosOk ? '' : 'disabled'} title="${chaosOk ? '' : '일반 3-10 클리어 시 입장 가능'}">카오스 모드 ${chaosOk ? '' : '(잠김)'}</button>
        <button class="chip ${st.repeat ? 'on' : ''}" data-act="repeat">반복 플레이 ${st.repeat ? 'ON' : 'OFF'}</button>
      </div>
      <div class="regions">${[0, 1, 2].map((r) => `<div class="region"><h4>${r + 1}지역 · ${D.REGION_MAPS[r].map((m) => m.name).join(' / ')}</h4><div class="stages">${Array.from({ length: 10 }, (_, s) => {
        const idx = r * 10 + s;
        const cleared = US.isCleared(st, mode, idx);
        const can = US.canEnter(st, mode, idx);
        const cur = st.mode === mode && st.stage === idx;
        const cls = ['stg', cleared ? 'clear' : '', idx === front && !cleared ? 'front' : '', cur ? 'cur' : '', can ? '' : 'locked', s === 9 ? 'boss' : ''].join(' ');
        return `<div class="${cls}" data-stage="${mode}:${idx}">${s === 9 ? '<span class="bossb">BOSS</span>' : ''}${r + 1}-${s + 1}${cleared ? ' ✓' : ''}<small>권장 ${D.REC_LEVEL[mode][r][s]}</small></div>`;
      }).join('')}</div></div>`).join('')}</div>
      <p class="small muted">클리어한 스테이지만 다시 입장할 수 있고, 보스 스테이지(10)는 최초 1회만 클리어할 수 있어요. 오프라인 보상 기준: <b>${lb ? `${lb.mode === 'chaos' ? '카오스 ' : ''}${US.stageInfo(lb.mode, lb.idx).label}` : '없음 (1-1을 먼저 클리어하세요)'}</b></p>
      ${chaosOk ? `<hr><div class="row"><b>작은 카오스 스쿼드 코인 ${st.smallChaosCoin}개</b><span class="small muted">카오스 모드 몬스터 처치 시 확률 획득</span>
        <input type="number" id="ccN" min="1" value="${st.smallChaosCoin || 1}" style="width:80px" class="btn sm"><button class="btn sm" data-act="convert">카오스 스쿼드 코인으로 이전</button></div>` : ''}`;
  };

  panels.util = function () {
    const st = ctx.st;
    const rows = Object.entries(D.UTIL).map(([k, U]) => {
      const next = US.utilNext(st, k);
      const needOk = !next || next.need == null || US.isCleared(st, 'normal', next.need);
      return `<tr><td><b>${U.name}</b></td><td>${U.fmt(st.util[k])}</td><td>${next ? `${U.fmt(next.v)}${next.need != null && !needOk ? ` <span class="small muted">(${US.stageInfo('normal', next.need).label} 클리어 필요)</span>` : ''}` : '<span class="muted">최대</span>'}</td>
        <td>${next ? `<button class="btn sm ${st.gold >= next.cost && needOk ? 'primary' : ''}" data-act="util" data-k="${k}" ${st.gold >= next.cost && needOk ? '' : 'disabled'}>${MI('meso')} ${fmt(next.cost)}</button>` : ''}</td></tr>`;
    }).join('');
    const nextCost = st.invSize < D.INV_MAX ? D.invSlotCost(st.invSize + 1) : null;
    return `<table class="t"><tr><th>유틸리티</th><th>현재</th><th>다음</th><th>가격</th></tr>${rows}
      <tr><td><b>인벤토리 슬롯 확장</b></td><td>${st.invSize}칸</td><td>${nextCost ? `${st.invSize + 1}칸` : '<span class="muted">최대</span>'}</td><td>${nextCost ? `<button class="btn sm" data-act="expand" data-n="1" ${st.gold >= nextCost ? '' : 'disabled'}>${MI('meso')} ${fmt(nextCost)}</button> <button class="btn sm" data-act="expand" data-n="10">+10</button>` : ''}</td></tr></table>
      <p class="small muted">장비 드롭률 증가는 장비에만 적용돼요. 메소 획득량 증가는 오프라인 보상에도 적용돼요.</p>`;
  };

  const UP_ICON = {
    exp: MI('exp'), cexp: MI('exp'), hp: MI('hp'), chp: MI('hp'), offline: MI('clock'), drop: MI('gift'), cube: MI('cube'), gold: MI('meso'),
    atk: '<img class="mi" src="assets/items/war_8_weapon.png" alt="">', catk: '<img class="mi" src="assets/items/arch_8_weapon.png" alt="">',
  };
  panels.shop = function () {
    const st = ctx.st;
    const row = (u) => {
      const lv = (st.coinUp || {})[u.id] || 0;
      const max = lv >= u.max;
      const cost = D.coinUpCost(u, lv);
      const have = u.cur === 'squad' ? st.squadCoin : st.chaosCoin;
      return `<tr><td>${UP_ICON[u.id]} <b>${u.name}</b></td><td>+${lv * u.per}${u.unit} <span class="small muted">(${lv}/${u.max})</span></td>
        <td>${max ? '<span class="muted">최대</span>' : `+${(lv + 1) * u.per}${u.unit}`}</td>
        <td>${max ? '' : `<button class="btn sm ${have >= cost ? 'primary' : ''}" data-act="coinup" data-id="${u.id}" ${have >= cost ? '' : 'disabled'}>${MI(u.cur === 'squad' ? 'squad_coin' : 'chaos_coin')} ${fmt(cost)}</button>`}</td></tr>`;
    };
    const ups = D.COIN_UP;
    return `<div class="row" style="margin-bottom:10px"><span>${MI('squad_coin')} 스쿼드 코인 <b>${fmt(st.squadCoin)}</b></span><span>${MI('chaos_coin')} 카오스 스쿼드 코인 <b>${fmt(st.chaosCoin)}</b></span></div>
      <h3>${MI('squad_coin')} 스쿼드 코인 강화 <span class="small muted">일반 모드 최초 클리어 보상 (총 8,000개)</span></h3>
      <table class="t"><tr><th>강화</th><th>현재</th><th>다음</th><th>가격</th></tr>${ups.filter((u) => u.cur === 'squad').map(row).join('')}</table>
      <h3 style="margin-top:16px">${MI('chaos_coin')} 카오스 스쿼드 코인 강화 <span class="small muted">카오스 몬스터 처치 시 작은 코인 → 맵 탭에서 이전</span></h3>
      <table class="t"><tr><th>강화</th><th>현재</th><th>다음</th><th>가격</th></tr>${ups.filter((u) => u.cur === 'chaos').map(row).join('')}</table>
      <p class="small muted">현재 보너스: 경험치 +${US.bonus(st, 'exp')}% · 공격력/마력 +${US.bonus(st, 'atk')}% · HP +${US.bonus(st, 'hp')}% · 장비 드롭 +${US.bonus(st, 'drop')}% · 큐브 드롭 +${US.bonus(st, 'cube')}% · 메소 +${US.bonus(st, 'gold')}% · 오프라인 효율 +${US.bonus(st, 'offline')}%p</p>
      <hr><h3>훈장</h3>
      <div class="row"><span><img class="mi ${st.medals.normal ? '' : 'gray'}" src="assets/icons/medal.png" alt=""> 울티마 스쿼드 훈장 <span class="small muted">(일반 3-10 클리어)</span></span>
      <span><img class="mi ${st.medals.chaos ? '' : 'gray'}" src="assets/icons/medal_best.png" alt=""> 울티마 베스트 스쿼드 훈장 <span class="small muted">(카오스 3-10 클리어)</span></span></div>`;
  };

  panels.auto = function () {
    const st = ctx.st, A = st.auto, AU = G.USAuto;
    const chk = (k, label, desc) => `<label class="chk"><input type="checkbox" data-auto="${k}" ${A[k] ? 'checked' : ''}> <b>${label}</b>${desc ? ` <span class="small muted">${desc}</span>` : ''}</label>`;
    const sel = (k, opts) => `<select data-autov="${k}">${Object.entries(opts).map(([v, n]) => `<option value="${v}" ${String(A[k]) === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    const num = (k, min, max, step = 1) => `<input type="number" class="btn sm num" data-autov="${k}" value="${A[k]}" min="${min}" max="${max}" step="${step}">`;
    const r = ctx.sessionReport();
    const ph = (v) => fmt(v / r.hours);
    const UTIL_NAME = { slots: '스킬 슬롯', gold: '메소 획득량', drop: '장비 드롭률', inv: '인벤토리', offline: '오프라인 시간' };
    return `<div class="auto-grid"><div>
      <h3>장비</h3>
      ${chk('equip', '좋은 장비 자동 장착', '더 강해지는 장비가 들어오면 바로 교체')}
      ${chk('sort', '인벤토리 자동 정리', '')}
      <div class="sub">인벤토리가 ${num('sortAt', 30, 100, 5)}% 이상 차면 →
        <label class="chk inline"><input type="checkbox" data-auto="synth" ${A.synth ? 'checked' : ''}> 9개 모인 단계 합성</label>
        → 그래도 차 있으면 ${sel('disMax', { 0: '분해 안 함', 1: '1단계 이하 분해', 2: '2단계 이하 분해', 3: '3단계 이하 분해', 4: '4단계 이하 분해', 5: '5단계 이하 분해', 6: '6단계 이하 분해' })}
        <div class="small muted">잠근 장비, 착용 중인 장비, 지금보다 좋은 장비, 나중에 낄 장비는 건드리지 않아요.</div></div>
      ${chk('cube', '자동 큐브', '착용 장비 잠재를 목표가 나올 때까지')}
      <div class="sub">무기 ${sel('cubeWeapon', AU.CUBE_WEAPON)} · 방어구 ${sel('cubeArmor', AU.CUBE_ARMOR)} 옵션 ${sel('cubeLines', { 1: '1줄 이상', 2: '2줄 이상', 3: '3줄' })} · 큐브 ${num('cubeKeep', 0, 9999)}개는 남겨두기</div>
      <h3>진행</h3>
      ${chk('retry', '자동 재도전', '일반 모드를 다 깨면 카오스로도 넘어가요')}
      <div class="sub">실패해서 아래 스테이지를 반복 중이면 ${num('retryMin', 1, 120)}분마다 다음 스테이지 재도전</div>
      ${chk('box', '에스페시아 상자 자동 소환', '하루 1회, 가능한 첫 타이밍에')}
      ${chk('skills', '스킬 자동 배치', '레벨업·보스 스테이지에 맞춰 추천 조합으로 (수동 배치를 덮어써요)')}
      ${chk('recruit', '용병 자동 영입', '조건과 메소가 되면 바로')}
      ${chk('util', '유틸리티 자동 구매', '')}
      <div class="sub">순서: ${A.utilOrder.map((k, i) => `<span class="ord">${i + 1}. ${UTIL_NAME[k]} <button class="btn sm" data-act="ordUp" data-i="${i}" ${i ? '' : 'disabled'}>▲</button></span>`).join(' ')}
        <div>인벤토리는 ${num('invTarget', 10, 256)}칸까지 · 영입할 메소는 남겨둬요</div></div>
      <h3>알림</h3>
      ${chk('notifyFull', '인벤토리 가득 참')} ${chk('notifyBoss', '보스 스테이지 도달')} ${chk('notifyFirst', '최초 클리어')} ${chk('notifyCube', '큐브 목표 달성')}
      <button class="btn sm" data-act="askNotify">윈도우 알림 허용하기</button>
    </div>
    <div class="detail">
      <h3>이번 접속 리포트</h3>
      <div class="small muted">${new Date(r.at).toLocaleTimeString('ko-KR', { hour12: false })}부터 · ${Math.floor(r.hours)}시간 ${Math.round((r.hours % 1) * 60)}분</div>
      <table class="t">
        <tr><td>몬스터 처치</td><td><b>${fmt(r.kills)}</b> <span class="small muted">(시간당 ${ph(r.kills)})</span></td></tr>
        <tr><td>획득 메소</td><td><b>${fmt(r.gold)}</b> <span class="small muted">(시간당 ${ph(r.gold)})</span></td></tr>
        <tr><td>획득 장비</td><td><b>${r.items}</b>개</td></tr>
        <tr><td>에스페시아 상자</td><td>${r.boxes}회</td></tr>
        ${r.mercs.map((m) => `<tr><td>${D.CLASS_NAME[m.cls]}</td><td>Lv.${m.fromLv} → <b>Lv.${m.toLv}</b> <span class="small muted">EXP +${fmt(m.exp)} (시간당 ${ph(m.exp)})</span></td></tr>`).join('')}
        <tr><td>최초 클리어</td><td>${r.clears.length ? r.clears.join(', ') : '-'}</td></tr>
      </table>
      <button class="btn sm" data-act="resetSession">리포트 초기화</button>
    </div></div>`;
  };

  panels.settings = function () {
    const a = ctx.st.audio;
    const sl = (k, label, icon) => `<div class="vrow"><span>${icon} ${label}</span><input type="range" min="0" max="100" step="5" value="${a[k]}" data-audio="${k}"><b>${a[k]}</b></div>`;
    const pm = ctx.st.pipMode;
    return `<div class="settings"><div>
      <h3>사운드</h3>
      ${sl('master', '전체 볼륨', '')}
      <div class="vrow"><span>배경음악</span><input type="range" min="0" max="100" step="5" value="${a.bgm}" data-audio="bgm"><b>${a.bgm}</b>
        <label class="chk inline"><input type="checkbox" data-audio="bgmOn" ${a.bgmOn ? 'checked' : ''}> 켜기</label></div>
      ${sl('skill', '스킬 효과음', '<img class="mi" src="assets/skills/aura_blade/icon.png" alt="">')}
      ${sl('mob', '몬스터 효과음', '<img class="mi" src="assets/mobs/1210102/stand0.png" alt="">')}
      ${sl('game', '게임 효과음 (레벨업·획득·알림)', MI('exp'))}
      <p class="small muted">브라우저 정책 때문에 페이지를 연 뒤 한 번 클릭해야 소리가 나기 시작해요.</p>
    </div><div>
      <h3>PIP 방식</h3>
      <label class="radio"><input type="radio" name="pipMode" value="video" ${pm !== 'doc' ? 'checked' : ''}> <b>영상 PIP</b> <span class="small muted">유튜브 PIP처럼 창 상단 바가 없어요. 화면은 보기만 돼요 (상자·반복은 자동 기능으로).</span></label>
      <label class="radio"><input type="radio" name="pipMode" value="doc" ${pm === 'doc' ? 'checked' : ''}> <b>문서 PIP</b> <span class="small muted">PIP 창 안에서 버튼을 누를 수 있어요. 대신 크롬이 창 위에 주소 바를 항상 붙여요.</span></label>
    </div></div>`;
  };

  panels.etc = function () {
    const st = ctx.st;
    const days = Math.floor((Date.now() - st.created) / 86400000);
    return `<div class="row" style="margin-bottom:12px"><button class="btn primary" data-act="tutorial">튜토리얼 다시 보기</button></div><h3>기록</h3><table class="t">
      <tr><td>시작한 지</td><td>${days}일</td></tr><tr><td>처치한 몬스터</td><td>${fmt(st.stats.kills)}</td></tr>
      <tr><td>처치한 보스</td><td>${fmt(st.stats.bossKills)}</td></tr><tr><td>에스페시아 상자</td><td>${st.stats.boxes}</td></tr></table>
      <hr><h3>${MI('box')} 에스페시아 상자 1회 초기화</h3>
      <p class="small muted">상자가 너무 멀리 생겨서 못 깨던 버그 보상이에요. 오늘 소환 기록을 지워서 한 번 더 소환할 수 있게 해요. 세이브당 1번만 쓸 수 있어요.</p>
      <button class="btn ${st.boxResetUsed ? '' : 'primary'}" data-act="boxReset" ${st.boxResetUsed ? 'disabled' : ''}>${st.boxResetUsed ? '이미 사용했어요' : '상자 소환 1회 초기화'}</button>
      <hr><h3>세이브</h3><p class="small muted">진행 기록은 이 브라우저(localStorage)에 저장돼요. 다른 기기로 옮기려면 내보내기 코드를 복사해서 불러오기에 붙여넣으세요.</p>
      <div class="row"><button class="btn" data-act="export">내보내기</button><button class="btn" data-act="import">불러오기</button><button class="btn danger" data-act="reset">처음부터 다시</button></div>
      <hr><h3>도움말</h3><ul class="small muted">
        <li>용병은 자동으로 싸워요. 탭이 다른 창에 가려져 있어도 접속 중으로 인정돼요. 탭을 닫으면 오프라인 보상(EXP·메소만)이 쌓여요 (기본 16시간).</li>
        <li>스테이지를 클리어하면 자동으로 다음 스테이지로 넘어가요. 실패하면 한 단계 아래 스테이지를 반복해요.</li>
        <li>1-10 핑크빈은 체력을 회복해요 → 궁수 15레벨 「폭풍의 시」가 필요해요.</li>
        <li>2-10 악화된 조화의 정령은 전원 중독 → 마법사 「힐」+「헤븐즈 도어」로 버티세요.</li>
        <li>3-10 오디움의 수호병은 15초마다 광역 즉사기 → 40레벨 극딜기로 그 전에 잡아야 해요.</li>
        <li>몬스터 능력치·드롭률 등 공개되지 않은 수치는 권장 레벨에 맞춰 추정했어요.</li></ul>`;
  };

  function render() {
    if (!ctx) return;
    ui.dirty = false;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
    const sub = ['inv', 'pot', 'synth', 'dis'].includes(ui.tab) ? viewBar(viewSource(ui.tab)) : '';
    $('panel').innerHTML = sub + panels[ui.tab]();
  }

  // ───────── 이벤트 ─────────
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    ui.tab = b.dataset.tab;
    if (ui.tab !== 'pot') ui.cube = null;
    render();
  });

  $('panel').addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.audio && t.type === 'range') { ctx.setAudio(t.dataset.audio, +t.value); t.nextElementSibling.textContent = t.value; }
  });
  $('panel').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.audio) { ctx.setAudio(t.dataset.audio, t.type === 'checkbox' ? t.checked : +t.value); return render(); }
    if (t.name === 'pipMode') { ctx.setPipMode(t.value); return; }
    if (t.dataset.viewsel) { ui.view[t.dataset.viewsel] = t.value; return render(); }
    if (t.dataset.auto) { ctx.st.auto[t.dataset.auto] = t.checked; ctx.save(); if (t.dataset.auto.startsWith('notify') && t.checked) ctx.askNotify(); return render(); }
    if (t.dataset.autov) {
      const k = t.dataset.autov, v = t.value;
      ctx.st.auto[k] = ['cubeWeapon', 'cubeArmor'].includes(k) ? v : Math.max(+t.min || 0, Math.min(+t.max || 1e9, +v || 0));
      ctx.save(); return render();
    }
    if (e.target.id === 'invSort') { ui.invSort = e.target.value; render(); }
    if (e.target.id === 'disTier') { ui.disTier = +e.target.value; render(); }
  });

  $('panel').addEventListener('click', (e) => {
    const st = ctx.st, b = ctx.getBattle();
    const t = e.target.closest('[data-act],[data-item],[data-eq],[data-sslot],[data-skill],[data-stage],[data-view]');
    if (!t) return;
    if (t.dataset.view) { const [k, v] = t.dataset.view.split(':'); ui.view[k] = v; return render(); }
    if (t.dataset.item) {
      const id = +t.dataset.item;
      if (ui.tab === 'inv') { ui.sel = id; const it = US.findItem(st, id); if (it) it.isNew = false; }
      else if (ui.tab === 'pot') {
        const it = US.findItem(st, id);
        if (it && it.tier < 2) { toast('1단계 장비는 잠재능력이 없어서 재설정할 수 없어요'); return; }
        if (ui.potItem !== id) ui.cube = null; ui.potItem = id;
      }
      else if (ui.tab === 'synth') {
        const it = st.inventory.find((x) => x.id === id);
        if (!it || it.lock) return toast('잠긴 장비는 합성할 수 없어요');
        if (ui.synth.has(id)) ui.synth.delete(id);
        else {
          const first = [...ui.synth].map((x) => st.inventory.find((y) => y.id === x)).find(Boolean);
          if (first && first.tier !== it.tier) return toast('같은 단계 장비만 선택할 수 있어요');
          if (ui.synth.size >= 9) return toast('9개까지 선택할 수 있어요');
          ui.synth.add(id);
        }
      }
      return render();
    }
    if (t.dataset.eq) {
      const [c, sl] = t.dataset.eq.split(':');
      const it = st.mercs[c].equip[sl];
      if (!it) { ui.tab = 'inv'; return render(); }
      modal(`${itemDetail(it)}<div class="row" style="margin-top:12px"><button class="btn" data-uneq="${c}:${sl}">장착 해제</button>${it.tier >= 2 ? `<button class="btn" data-gopot="${it.id}">잠재 재설정</button>` : ''}<button class="btn" data-close>닫기</button></div>`);
      return;
    }
    if (t.dataset.sslot) {
      const [c, i] = t.dataset.sslot.split(':');
      const cur = st.mercs[c].skills[+i];
      if (ui.skillSel && ui.skillSel[0] === c && ui.skillSel[1] === +i && cur) {
        res(US.setSkill(st, b, c, +i, null), '스킬을 해제했어요');
        ui.skillSel = null;
      } else ui.skillSel = [c, +i];
      return render();
    }
    if (t.dataset.skill) {
      const [c, id] = t.dataset.skill.split(':');
      const m = st.mercs[c];
      if (m.lv < D.SKILLS[id].lv) return toast(`Lv.${D.SKILLS[id].lv}에 습득해요`);
      let slot = ui.skillSel && ui.skillSel[0] === c ? ui.skillSel[1] : -1;
      if (slot < 0) {
        const cur = m.skills.indexOf(id);
        if (cur >= 0 && cur < US.skillSlots(st)) { res(US.setSkill(st, b, c, cur, null), `${D.SKILLS[id].name} 해제`); return render(); }
        slot = m.skills.slice(0, US.skillSlots(st)).indexOf(null);
        if (slot < 0) return toast('교체할 슬롯을 먼저 고르세요');
      }
      res(US.setSkill(st, b, c, slot, id), `${D.SKILLS[id].name} 장착`);
      ui.skillSel = null;
      return render();
    }
    if (t.dataset.stage) {
      const [mode, idx] = t.dataset.stage.split(':');
      if (!US.canEnter(st, mode, +idx)) return toast(+idx % 10 === 9 && US.isCleared(st, mode, +idx) ? '보스 스테이지는 다시 입장할 수 없어요' : US.invFull(st) && +idx % 10 === 9 ? '인벤토리가 가득 차서 보스 스테이지에 입장할 수 없어요' : '아직 입장할 수 없어요');
      st.mode = mode; st.stage = +idx;
      ctx.onStageChange();
      return render();
    }
    const act = t.dataset.act;
    switch (act) {
      case 'recruit': if (res(US.recruit(st, t.dataset.cls), `${D.CLASS_NAME[t.dataset.cls]} 영입 완료! 자동으로 전투에 배치됩니다`)) ctx.onRoster(); break;
      case 'tutorial': ctx.startTutorial(); return;
      case 'boxReset':
        if (st.boxResetUsed) break;
        if (st.boxDate !== US.today(Date.now())) { toast('오늘은 아직 상자를 소환하지 않았어요. 소환한 뒤에 쓰세요'); break; }
        st.boxDate = null; st.boxResetUsed = true; ctx.save(); toast('상자를 다시 소환할 수 있어요!'); break;
      case 'unequipSel': { const it = US.findItem(st, ui.sel); if (it && res(US.unequipItem(st, it.cls, it.slot), '장착 해제')) { b && US.refreshMercStats(st, b); } break; }
      case 'equip': if (ui.sel) { const it = US.findItem(st, ui.sel); if (res(US.equipItem(st, ui.sel), `${D.CLASS_NAME[it.cls]}에게 장착했어요`)) { b && US.refreshMercStats(st, b); } } break;
      case 'lock': { const it = US.findItem(st, ui.sel); if (it) { it.lock = !it.lock; ctx.save(); } break; }
      case 'disOne': { const r = US.dismantle(st, [ui.sel]); toast(`분해 완료 +${fmt(r.gold)} 메소`); ui.sel = null; ctx.save(); break; }
      case 'toPot': ui.potItem = ui.sel; ui.tab = 'pot'; break;
      case 'seenAll': st.inventory.forEach((x) => (x.isNew = false)); st.unseenDrops = 0; break;
      case 'expand': { const n = US.expandInv(st, +t.dataset.n); toast(n ? `인벤토리 ${n}칸 확장` : '메소가 부족해요'); ctx.save(); break; }
      case 'buyCube': { const n = US.buyCubes(st, +t.dataset.n); toast(n ? `훈련용 큐브 ${n}개 구매` : '메소가 부족해요'); ctx.save(); break; }
      case 'cube': { const r = US.cubeRoll(st, ui.potItem); if (r.ok) ui.cube = { id: ui.potItem, after: r.after }; else toast(r.why); ctx.save(); break; }
      case 'cubeApply': if (ui.cube) { US.cubeApply(st, ui.cube.id, ui.cube.after); b && US.refreshMercStats(st, b); ui.cube = null; toast('AFTER 잠재능력을 적용했어요'); ctx.save(); } break;
      case 'cubeKeep': ui.cube = null; break;
      case 'synthAuto': { const g = US.autoSynthGroup(st); if (g) ui.synth = new Set(g); else toast('같은 단계 장비가 9개 이상 없어요'); break; }
      case 'synthClear': ui.synth.clear(); break;
      case 'synth': { const r = US.synthesize(st, [...ui.synth]); if (res(r)) { ui.synth.clear(); synthResult([r.item]); } break; }
      case 'synthAll': {
        const made = [];
        let g;
        while ((g = US.autoSynthGroup(st)) && made.length < 100) { const r = US.synthesize(st, g); if (!r.ok) break; made.push(r.item); }
        ui.synth.clear();
        if (made.length) { ctx.save(); synthResult(made); } else toast('합성할 수 있는 장비가 없어요');
        break;
      }
      case 'disAll': {
        const list = disTargets().map((x) => x.id);
        if (!confirm(`${list.length}개 장비를 분해할까요?`)) return;
        const r = US.dismantle(st, list); toast(`${r.n}개 분해 +${fmt(r.gold)} 메소`); ctx.save(); break;
      }
      case 'mapMode': ui.mapMode = t.dataset.mode; break;
      case 'repeat': st.repeat = !st.repeat; st.repeatReason = null; ctx.save(); ctx.onRepeat(); break;
      case 'convert': { const n = US.convertChaosCoins(st, +$('ccN').value || 0); toast(`카오스 스쿼드 코인 ${n}개 이전`); ctx.save(); break; }
      case 'util': res(US.buyUtil(st, t.dataset.k), '강화 완료!'); break;
      case 'coinup': if (res(US.buyCoinUp(st, t.dataset.id), '강화 완료!')) { b && US.refreshMercStats(st, b); } break;
      case 'ordUp': { const i = +t.dataset.i, o = st.auto.utilOrder; [o[i - 1], o[i]] = [o[i], o[i - 1]]; ctx.save(); break; }
      case 'askNotify': ctx.askNotify(); toast('브라우저에서 알림을 허용해 주세요'); break;
      case 'resetSession': ctx.resetSession(); break;
      case 'export': modal(`<h3>세이브 내보내기</h3><textarea style="width:100%;height:140px" readonly>${esc(btoa(unescape(encodeURIComponent(JSON.stringify(st)))))}</textarea><div class="row"><button class="btn" data-close>닫기</button></div>`); return;
      case 'import': modal(`<h3>세이브 불러오기</h3><textarea id="impText" style="width:100%;height:140px" placeholder="내보내기 코드를 붙여넣으세요"></textarea><div class="row"><button class="btn primary" id="impGo">불러오기</button><button class="btn" data-close>취소</button></div>`);
        $('impGo').onclick = () => { try { const s = JSON.parse(decodeURIComponent(escape(atob($('impText').value.trim())))); if (!s.mercs) throw 0; ctx.replaceState(s); closeModal(); toast('불러왔어요'); } catch { toast('코드가 올바르지 않아요'); } };
        return;
      case 'reset': if (confirm('모든 진행 기록이 삭제돼요. 처음부터 다시 할까요?')) ctx.reset(); return;
    }
    render();
  });

  document.addEventListener('click', (e) => {
    const st = ctx && ctx.st;
    if (!st) return;
    const un = e.target.closest('[data-uneq]');
    if (un) { const [c, sl] = un.dataset.uneq.split(':'); if (res(US.unequipItem(st, c, sl), '장착 해제')) { const b = ctx.getBattle(); b && US.refreshMercStats(st, b); } closeModal(); render(); }
    const gp = e.target.closest('[data-gopot]');
    if (gp) { ui.potItem = +gp.dataset.gopot; ui.tab = 'pot'; ui.cube = null; closeModal(); render(); }
  });

  function synthResult(items) {
    modal(`<h3>합성 결과</h3><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(52px,1fr))">${items.map((x) => itemCell(x)).join('')}</div>
      ${items.length === 1 ? `<div class="detail" style="margin-top:10px">${itemDetail(items[0], { compare: true })}</div>` : `<p class="small muted">${items.length}번 합성했어요.</p>`}
      <div class="row" style="margin-top:10px"><button class="btn" data-close>확인</button></div>`);
  }

  function offlinePopup(r) {
    const h = Math.floor(r.secs / 3600), mi = Math.floor((r.secs % 3600) / 60);
    const ah = Math.floor(r.away / 3600), am = Math.floor((r.away % 3600) / 60);
    const rows = Object.entries(r.ups).map(([c, u]) => `<tr><td>${D.CLASS_NAME[c]}</td><td>Lv.${u.from} (${(u.fromPct * 100).toFixed(1)}%) → <b>Lv.${u.to}</b> (${(u.toPct * 100).toFixed(1)}%)</td></tr>`).join('');
    modal(`<h3>${MI('clock')} 오프라인 보상</h3>
      <p>접속하지 않은 시간 ${ah}시간 ${am}분 중 <b>${h}시간 ${mi}분</b>이 정산됐어요. <span class="small muted">(최대 ${ctx.st.util.offline}시간)</span></p>
      <p class="small muted">기준 스테이지: ${r.base.mode === 'chaos' ? '카오스 ' : ''}${US.stageInfo(r.base.mode, r.base.idx).label}</p>
      <table class="t"><tr><td>획득 메소</td><td>${MI('meso')} <b>${fmt(r.gold)}</b></td></tr><tr><td>용병별 EXP</td><td>+${fmt(r.exp)}</td></tr>${rows}</table>
      <p class="small muted">오프라인 중에는 장비·훈련용 큐브·작은 카오스 코인을 얻을 수 없어요.</p>
      <div class="row"><button class="btn primary" data-close>확인</button></div>`);
  }

  G.USUI = {
    init(c) { ctx = c; render(); },
    render, markDirty() { ui.dirty = true; }, isDirty: () => ui.dirty, tab: () => ui.tab,
    toast, modal, closeModal, offlinePopup, ui,
  };
})(window);
