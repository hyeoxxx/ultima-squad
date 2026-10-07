// 게임 루프, 저장/불러오기, 오프라인 정산, 전투 HUD
(function (G) {
  'use strict';
  const D = G.USData, US = G.US, RD = G.USRender, UI = G.USUI;
  // 전투 화면이 PIP 창으로 옮겨가 있으면 그쪽 문서에서도 찾는다
  const $ = (id) => document.getElementById(id) || (pipWin && pipWin.document.getElementById(id));
  const KEY = 'ultima-squad:save:v1';
  const MAX_CATCHUP = 120; // 이보다 오래 멈췄으면 (절전 등) 오프라인으로 정산

  let pipWin = null; // Document Picture-in-Picture 창
  let st = load();
  let battle = null;
  let nextBattleAt = 0;
  let lastReal = Date.now();
  let acc = 0;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (s && s.mercs) return migrate(s); }
    } catch { /* 새로 시작 */ }
    return US.newState(Date.now());
  }
  function migrate(s) {
    const base = US.newState(Date.now());
    for (const k of Object.keys(base)) if (s[k] === undefined) s[k] = base[k];
    s.auto = Object.assign(US.defaultAuto(), s.auto || {});
    s.coinUp = s.coinUp || {};
    return s;
  }
  function save() {
    st.lastSeen = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* 저장 공간 부족 등 */ }
  }

  // ───────── 사운드 ─────────
  let actx = null;
  function beep(freq, dur, type = 'square', vol = 1) {
    if (!actx || st.volume <= 0 || document.hidden) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    const v = (st.volume / 100) * 0.06 * vol, t = actx.currentTime;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  document.addEventListener('pointerdown', () => {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  }, { once: false });
  let lastHitSound = 0;
  function sounds(events) {
    const now = performance.now();
    for (const e of events) {
      if (e.t === 'dmg' && now - lastHitSound > 70) { lastHitSound = now; beep(e.crit ? 520 : 300 + Math.random() * 80, 0.05, 'square', 0.5); }
      else if (e.t === 'levelup') { beep(660, 0.12, 'triangle'); setTimeout(() => beep(880, 0.12, 'triangle'), 120); setTimeout(() => beep(1320, 0.2, 'triangle'), 240); }
      else if (e.t === 'drop') beep(1200, 0.08, 'sine');
      else if (e.t === 'skill' && D.SKILLS[e.skill] && D.SKILLS[e.skill].fx === 'ult') beep(110, 0.6, 'sawtooth', 1.5);
      else if (e.t === 'down') beep(160, 0.3, 'sawtooth');
    }
  }

  // ───────── 전투 ─────────
  function startBattle() {
    battle = US.createBattle(st, Date.now());
    if (battle.info.isBoss && !US.isCleared(st, st.mode, st.stage)) notify('boss', `${st.mode === 'chaos' ? '카오스 ' : ''}${battle.info.label} 보스 스테이지 도전! (${battle.info.mons.boss[0]})`);
    RD.clearFx();
    updateStageHud();
  }
  function updateStageHud() {
    const info = battle.info;
    $('stageMode').textContent = st.mode === 'chaos' ? '카오스' : '일반';
    $('stageMode').classList.toggle('chaos', st.mode === 'chaos');
    $('stageLabel').textContent = info.label;
    $('stageMap').textContent = info.map.name;
  }

  const tickerMsgs = [];
  const recentDrops = [];
  function ticker(msg, cls) {
    tickerMsgs.push({ msg, cls, at: Date.now() });
    if (tickerMsgs.length > 1) tickerMsgs.shift();
    $('ticker').innerHTML = `<span class="${cls || ''}">${msg}</span>`;
  }
  function banner(text, cls) {
    const b = $('banner');
    b.textContent = text; b.className = `banner show ${cls}`;
    clearTimeout(banner.h); banner.h = setTimeout(() => b.classList.remove('show'), 1100);
  }

  function handleEvents(events, visual) {
    let dirty = false;
    for (const e of events) {
      if (e.t === 'log') ticker(e.msg);
      else if (e.t === 'drop') { ticker(`획득: ${US.itemName(e.item)} (${e.item.tier}단계)`, 'drop'); recentDrops.unshift(e.item); recentDrops.length = Math.min(recentDrops.length, 6); dirty = true; }
      else if (e.t === 'levelup') { dirty = true; if (visual) ticker(`${D.CLASS_NAME[e.cls]} 레벨 업! Lv.${e.lv}`); }
      else if (e.t === 'firstclear') {
        const r = e.reward;
        ticker(`${e.mode === 'chaos' ? '카오스 ' : ''}${e.label} 최초 클리어!${r.coin ? ` 스쿼드 코인 +${r.coin}` : ''}${r.medal ? ' 훈장 교환권 획득!' : ''}`);
        if (r.medal) UI.toast(r.medal === 'normal' ? '🎖️ 울티마 스쿼드 훈장 획득! 카오스 모드가 열렸어요' : '🏅 울티마 베스트 스쿼드 훈장 획득!');
        dirty = true;
      } else if (e.t === 'box') { dirty = true; session.boxes++; session.gold += e.gold || 0; }
      else if (e.t === 'auto') { if (!e.quiet) ticker('⚙ ' + e.msg); if (e.notify) notify(e.notify, e.msg); dirty = true; }
      if (e.t === 'drop') session.items++;
      else if (e.t === 'kill' && e.kind !== 'box') session.kills++;
      else if (e.t === 'firstclear') { session.clears.push(`${e.mode === 'chaos' ? '카오스 ' : ''}${e.label}`); notify('first', `${e.mode === 'chaos' ? '카오스 ' : ''}${e.label} 최초 클리어!`); }
    }
    if (visual) { RD.pushEvents(events, battle); sounds(events); }
    if (dirty) UI.markDirty();
  }

  function simulate(seconds, visual) {
    let steps = Math.floor(seconds / US.DT);
    while (steps-- > 0) {
      if (!battle) startBattle();
      if (battle.done) {
        if (!nextBattleAt) {
          US.finishBattle(st, battle, Date.now());
          session.gold += battle.goldGained || 0;
          battle.events.push(...G.USAuto.between(st, Date.now()));
          if (visual) banner(battle.done === 'clear' ? 'STAGE CLEAR' : 'FAILED', battle.done === 'clear' ? 'clear' : 'fail');
          nextBattleAt = battle.time + (visual ? 1.5 : 0);
          UI.markDirty();
        }
        battle.time += US.DT;
        if (battle.time >= nextBattleAt) { handleEvents(battle.events, visual); battle.events = []; nextBattleAt = 0; startBattle(); }
        continue;
      }
      US.stepBattle(st, battle, US.DT);
      if (!visual && battle.events.length > 500) { handleEvents(battle.events, false); battle.events = []; }
    }
    handleEvents(battle.events, visual);
    battle.events = [];
  }

  function tick() {
    const now = Date.now();
    let dt = (now - lastReal) / 1000;
    lastReal = now;
    if (dt > MAX_CATCHUP) {
      // 절전 등으로 오래 멈춘 경우: 오프라인 정산
      st.lastSeen = now - dt * 1000;
      const r = US.applyOffline(st, now);
      if (r.secs >= 60 && r.base) UI.offlinePopup(r);
      save();
      dt = 0;
    }
    acc += dt;
    const run = Math.floor(acc / US.DT) * US.DT;
    if (run > 0) { acc -= run; simulate(run, (!document.hidden || !!pipWin) && run < 1); }
  }

  // ───────── 알림 ─────────
  const NOTIFY_KEY = { full: 'notifyFull', boss: 'notifyBoss', first: 'notifyFirst', cube: 'notifyCube' };
  function notify(kind, msg) {
    if (!st.auto[NOTIFY_KEY[kind]]) return;
    UI.toast(msg);
    beep(880, 0.15, 'triangle'); setTimeout(() => beep(1175, 0.2, 'triangle'), 150);
    if ('Notification' in window && Notification.permission === 'granted' && (document.hidden || pipWin)) {
      try { new Notification('울티마 스쿼드', { body: msg, tag: 'us-' + kind, silent: true }); } catch { /* 미지원 */ }
    }
  }
  let wasFull = false;
  function watchInventory() {
    const full = US.invFull(st);
    if (full && !wasFull) notify('full', '인벤토리가 가득 찼어요! 장비를 더 얻을 수 없어요');
    wasFull = full;
  }

  // ───────── 이번 접속 리포트 ─────────
  const totalExp = (lv, exp) => { let t = exp; for (let l = 1; l < lv; l++) t += US.expNeed(l); return t; };
  function newSession() {
    const start = {};
    for (const c of D.CLASSES) start[c] = { owned: st.mercs[c].owned, lv: st.mercs[c].lv, exp: totalExp(st.mercs[c].lv, st.mercs[c].exp) };
    return { at: Date.now(), start, gold: 0, items: 0, kills: 0, boxes: 0, clears: [] };
  }
  let session = newSession();
  function sessionReport() {
    const hours = Math.max(1 / 60, (Date.now() - session.at) / 3600000);
    const mercs = D.CLASSES.filter((c) => st.mercs[c].owned).map((c) => {
      const s0 = session.start[c];
      const gained = totalExp(st.mercs[c].lv, st.mercs[c].exp) - (s0.owned ? s0.exp : 0);
      return { cls: c, fromLv: s0.owned ? s0.lv : 1, toLv: st.mercs[c].lv, exp: gained };
    });
    return { ...session, hours, mercs };
  }

  // 전투 중 주기적 자동 처리 (장착/정리/상자)
  setInterval(() => {
    if (!battle || battle.done) return;
    const ev = G.USAuto.during(st);
    if (ev.length) { US.refreshMercStats(st, battle); handleEvents(ev, false); }
    if (st.auto.box && US.boxStatus(st, battle, Date.now()).ok) { US.summonBox(st, battle, Date.now()); ticker('⚙ 에스페시아 상자 자동 소환'); }
    watchInventory();
  }, 3000);

  // ───────── HUD ─────────
  function hud() {
    $('wGold').textContent = US.fmt(st.gold);
    $('wCube').textContent = st.cubes;
    $('wSquad').textContent = US.fmt(st.squadCoin);
    $('wChaos').textContent = US.fmt(st.chaosCoin);
    if (!battle) return;
    const prog = battle.info.isBoss ? (battle.monsters[0] ? 1 - battle.monsters[0].hp / battle.monsters[0].maxHp : 1) : battle.killed / battle.total;
    $('gaugeFill').style.width = `${Math.min(100, prog * 100)}%`;
    $('gaugeText').textContent = battle.info.isBoss ? `보스 ${Math.round(prog * 100)}%` : `${Math.min(battle.killed, battle.total)} / ${battle.total}`;
    $('btnRepeat').classList.toggle('on', st.repeat);
    $('bagInfo').textContent = `${st.inventory.length}/${st.invSize}`;
    $('btnBag').classList.toggle('full', US.invFull(st));
    $('bagNew').hidden = !st.inventory.some((x) => x.isNew);
    const bs = US.boxStatus(st, battle, Date.now());
    $('btnBox').classList.toggle('used', st.boxDate === US.today(Date.now()));
    $('btnBox').title = bs.ok ? '에스페시아 상자 소환 (하루 1회)' : bs.why;
    // 포탈: 반복 중이고 다음 스테이지로 갈 수 있을 때
    const next = st.stage + 1;
    const portal = st.repeat && next < 30 && US.isCleared(st, st.mode, st.stage) && US.canEnter(st, st.mode, next);
    $('btnPortal').hidden = !portal;
  }

  let lastHud = 0;
  // PIP 창 전용 정보줄: 인벤토리, 재화, 용병 레벨, 상자, 최근 획득 장비
  let lastPipInfo = '';
  function pipInfo() {
    const el = $('pipInfo');
    if (!el || !pipWin) return;
    const fresh = st.inventory.filter((x) => x.isNew).length;
    const full = US.invFull(st);
    const box = st.boxDate === US.today(Date.now());
    const mercs = US.ownedMercs(st).map((c) => {
      const m = st.mercs[c];
      const pct = m.lv >= D.MAX_LEVEL ? 'MAX' : (m.exp / US.expNeed(m.lv) * 100).toFixed(1) + '%';
      return `<span>${D.CLASS_NAME[c]} <b>Lv.${m.lv}</b> <small>${pct}</small></span>`;
    }).join('');
    const drops = recentDrops.map((it) => `<img src="${G.USAssets.iconSrc(it)}" title="${US.itemName(it)} (${it.tier}단계)"><i>${it.tier}</i>`).join('');
    const html = `<div class="pi-row">
        <span class="${full ? 'bad' : ''}">🎒 <b>${st.inventory.length}/${st.invSize}</b>${fresh ? ` <small class="new">새 장비 ${fresh}</small>` : ''}${full ? ' <small>가득 참!</small>' : ''}</span>
        <span>💰 <b>${US.fmt(st.gold)}</b></span><span>🧊 <b>${st.cubes}</b></span>
        <span class="${box ? 'dim' : 'ok'}">🎁 ${box ? '오늘 사용함' : '소환 가능'}</span>
      </div>
      <div class="pi-row">${mercs}</div>
      ${drops ? `<div class="pi-row drops"><small>최근 획득</small>${drops}</div>` : ''}`;
    if (html !== lastPipInfo) { el.innerHTML = html; lastPipInfo = html; }
  }

  function frame(now) {
    // PIP 창이 떠 있으면 그 창의 애니메이션 프레임으로 돌린다 (원래 탭이 가려져도 부드럽게)
    if (pipWin) { tick(); if (now - lastHud > 250) { lastHud = now; hud(); pipInfo(); } }
    if (battle) RD.render($('cv').getContext('2d'), st, battle, now);
    (pipWin || window).requestAnimationFrame(frame);
  }

  // ───────── PIP (Document Picture-in-Picture) ─────────
  async function togglePip() {
    if (pipWin) { pipWin.close(); return; }
    if (!('documentPictureInPicture' in window)) { UI.toast('이 브라우저는 PIP 창을 지원하지 않아요 (PC 크롬/엣지 116 이상)'); return; }
    const section = document.querySelector('.battle');
    let win;
    try { win = await documentPictureInPicture.requestWindow({ width: 640, height: 420 }); }
    catch (e) { UI.toast('PIP 창을 열 수 없어요: ' + e.message); return; }
    for (const node of document.querySelectorAll('link[rel=stylesheet], style')) win.document.head.appendChild(node.cloneNode(true));
    win.document.title = '울티마 스쿼드';
    win.document.body.classList.add('pip');
    win.document.body.appendChild(section);
    pipWin = win;
    $('btnPip').classList.add('on');
    placeholder.hidden = false;
    win.addEventListener('pagehide', () => {
      document.querySelector('.wrap').insertBefore(section, $('manage'));
      pipWin = null;
      placeholder.hidden = true;
      $('btnPip').classList.remove('on');
      requestAnimationFrame(frame);
    });
    win.requestAnimationFrame(frame);
  }
  const placeholder = document.createElement('div');
  placeholder.className = 'pip-placeholder';
  placeholder.hidden = true;
  placeholder.innerHTML = '📺 전투 화면이 PIP 창에 떠 있어요. <button class="btn sm">원래대로</button>';
  placeholder.querySelector('button').onclick = () => pipWin && pipWin.close();
  document.querySelector('.wrap').insertBefore(placeholder, $('manage'));
  $('btnPip').addEventListener('click', togglePip);

  // ───────── 버튼 ─────────
  $('btnBox').addEventListener('click', () => {
    const r = US.summonBox(st, battle, Date.now());
    if (!r.ok) UI.toast(r.why); else save();
  });
  $('btnPortal').addEventListener('click', () => { st.stage++; st.repeat = false; st.repeatReason = null; save(); startBattle(); UI.markDirty(); });
  $('btnRepeat').addEventListener('click', () => { st.repeat = !st.repeat; st.repeatReason = null; save(); UI.markDirty(); });
  $('btnBag').addEventListener('click', () => { UI.ui.tab = 'inv'; UI.render(); $('manage').scrollIntoView({ behavior: 'smooth' }); });
  $('vol').value = st.volume;
  $('vol').addEventListener('input', (e) => { st.volume = +e.target.value; save(); });

  // ───────── 시작 ─────────
  const off = US.applyOffline(st, Date.now());
  UI.init({
    get st() { return st; },
    getBattle: () => battle,
    sessionReport,
    resetSession() { session = newSession(); },
    askNotify() { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); },
    save,
    onStageChange() { save(); startBattle(); },
    onRoster() { if (battle) US.refreshMercStats(st, battle); },
    onRepeat() { },
    replaceState(s) { st = migrate(s); save(); startBattle(); UI.render(); },
    reset() { try { localStorage.removeItem(KEY); } catch { } st = US.newState(Date.now()); session = newSession(); save(); startBattle(); UI.render(); },
  });
  startBattle();
  save();
  if (off.secs >= 60 && off.base) UI.offlinePopup(off);

  setInterval(tick, 100);
  setInterval(hud, 250);
  setInterval(save, 5000);
  // 패널은 변화가 있을 때만 1초에 한 번 다시 그린다 (마우스를 누르고 있을 땐 미룸)
  let pointerDown = false;
  $('panel').addEventListener('pointerdown', () => (pointerDown = true));
  document.addEventListener('pointerup', () => setTimeout(() => (pointerDown = false), 50));
  setInterval(() => {
    const tab = UI.tab();
    if ((UI.isDirty() || tab === 'merc' || tab === 'util') && !pointerDown && $('modal').hidden && !document.hidden && !(document.activeElement && ['SELECT', 'INPUT', 'TEXTAREA'].includes(document.activeElement.tagName))) UI.render();
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  window.addEventListener('pagehide', save);
  window.addEventListener('beforeunload', save);
  requestAnimationFrame(frame);
  hud();
  G.USGame = { get st() { return st; }, get battle() { return battle; } }; // 디버그용
})(window);
