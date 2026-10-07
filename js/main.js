// 게임 루프, 저장/불러오기, 오프라인 정산, 전투 HUD
(function (G) {
  'use strict';
  const D = G.USData, US = G.US, RD = G.USRender, UI = G.USUI;
  // 전투 화면이 PIP 창으로 옮겨가 있으면 그쪽 문서에서도 찾는다
  const $ = (id) => document.getElementById(id) || (pipWin && pipWin.document.getElementById(id));
  const KEY = 'ultima-squad:save:v1';
  const MAX_CATCHUP = 120; // 이보다 오래 멈췄으면 (절전 등) 오프라인으로 정산

  let pipWin = null; // Document Picture-in-Picture 창
  let paused = false; // 다른 탭에서 실행 중이면 이 탭은 멈춘다
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
    return migrate(US.newState(Date.now()));
  }
  function migrate(s) {
    const base = US.newState(Date.now());
    for (const k of Object.keys(base)) if (s[k] === undefined) s[k] = base[k];
    s.auto = Object.assign(US.defaultAuto(), s.auto || {});
    s.coinUp = s.coinUp || {};
    s.audio = Object.assign({ master: s.volume ?? 60, bgm: 40, skill: 70, mob: 60, game: 80, bgmOn: s.bgmOn !== false }, s.audio || {});
    s.pipMode = s.pipMode || 'video';
    return s;
  }
  function save() {
    if (paused) return; // 다른 탭이 실행 중이면 저장하지 않는다 (덮어쓰기 방지)
    st.lastSeen = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* 저장 공간 부족 등 */ }
  }

  // ───────── 사운드 ─────────
  let actx = null;
  function beep(freq, dur, type = 'square', vol = 1) {
    if (!actx || st.audio.master <= 0 || st.audio.game <= 0 || document.hidden) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    const v = (st.audio.master / 100) * (st.audio.game / 100) * 0.08 * vol, t = actx.currentTime;
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  document.addEventListener('pointerdown', () => {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  }, { once: false });
  // 원작 효과음 (없으면 비프음으로 대신)
  const AS = G.USAssets;
  function sounds(events) {
    for (const e of events) {
      if (e.t === 'skill') {
        if (!AS.sfx('skill', e.skill, 'Use', 0.8, 90) && D.SKILLS[e.skill] && D.SKILLS[e.skill].fx === 'ult') beep(110, 0.6, 'sawtooth', 1.5);
        if (e.ids && e.ids.length) setTimeout(() => AS.sfx('skill', e.skill, 'Hit', 0.6, 90), 140);
      } else if (e.t === 'dmg') { if (e.mob) AS.sfx('mob', String(e.mob), 'Damage', 0.5, 110); }
      else if (e.t === 'kill') { if (e.mob) AS.sfx('mob', String(e.mob), 'Die', 0.7, 80); }
      else if (e.t === 'levelup') { if (!AS.sfx('game', 'LevelUp', null, 0.9)) { beep(660, 0.12, 'triangle'); setTimeout(() => beep(880, 0.12, 'triangle'), 120); } }
      else if (e.t === 'drop') { if (!AS.sfx('game', 'PickUpItem', null, 0.7, 120)) beep(1200, 0.08, 'sine'); }
      else if (e.t === 'down') { if (!AS.sfx('game', 'Tombstone', null, 0.8)) beep(160, 0.3, 'sawtooth'); }
      else if (e.t === 'firstclear') AS.sfx('game', 'QuestClear', null, 0.8);
      else if (e.t === 'box') AS.sfx('game', 'EnchantSuccess', null, 0.8);
    }
  }
  function preloadBattleSounds() {
    if (!battle) return;
    const keys = [['game', 'LevelUp'], ['game', 'PickUpItem'], ['game', 'Tombstone'], ['game', 'QuestClear'], ['game', 'EnchantSuccess']];
    for (const k of ['mob', 'boss']) if (battle.info.mons[k]) keys.push(['mob', String(battle.info.mons[k][2])]);
    for (const c of Object.keys(battle.mercs)) { keys.push(['skill', D.BASIC[c]]); st.mercs[c].skills.forEach((id) => id && keys.push(['skill', id])); }
    AS.preloadSounds(keys);
  }
  AS.onAudioReady(preloadBattleSounds);
  function syncVolume() {
    const a = st.audio;
    AS.vol.master = a.master / 100;
    AS.vol.bgm = a.bgm / 100 * 0.5;
    AS.vol.skill = a.skill / 100 * 0.7;
    AS.vol.mob = a.mob / 100 * 0.7;
    AS.vol.game = a.game / 100 * 0.8;
    AS.vol.bgmOn = a.bgmOn;
    if ($('vol')) $('vol').value = a.master;
    if ($('btnBgm')) $('btnBgm').classList.toggle('on', a.bgmOn);
    AS.applyVolume();
  }

  // ───────── 전투 ─────────
  function startBattle() {
    battle = US.createBattle(st, Date.now());
    AS.bgm(`${battle.info.r}_${D.mapIndex(battle.info.s)}`);
    preloadBattleSounds();
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
    if (paused) { lastReal = Date.now(); return; }
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
    if (run > 0) { acc -= run; simulate(run, (!document.hidden || !!pipWin || !!vpip) && run < 1); }
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
      const pct = m.lv >= D.MAX_LEVEL ? 100 : m.exp / US.expNeed(m.lv) * 100;
      return `<div class="pm"><span><b>${D.CLASS_NAME[c]}</b> Lv.${m.lv}</span><i><u style="width:${pct.toFixed(1)}%"></u></i><small>${m.lv >= D.MAX_LEVEL ? 'MAX' : pct.toFixed(1) + '%'}</small></div>`;
    }).join('');
    const drops = recentDrops.slice(0, 4).map((it, i) => `<div class="pd" style="opacity:${1 - i * 0.2}"><img src="${G.USAssets.iconSrc(it)}"><span>${US.itemName(it)} <small>(${it.tier}단계)</small></span></div>`).join('');
    const html = `<div class="po-res">
        <span class="${full ? 'bad' : ''}">🎒 ${st.inventory.length}/${st.invSize}${fresh ? ` <em>+${fresh}</em>` : ''}</span>
        <span>💰 ${US.fmt(st.gold)}</span><span>🧊 ${st.cubes}</span>
        <span class="${box ? 'dim' : 'ok'}">🎁 ${box ? '사용함' : '가능'}</span>
      </div>
      <div class="po-mercs">${mercs}</div>
      ${drops ? `<div class="po-drops">${drops}</div>` : ''}`;
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
    if (vpip) { document.exitPictureInPicture().catch(() => {}); return; }
    if (st.pipMode !== 'doc') return videoPip();
    if (!('documentPictureInPicture' in window)) { UI.toast('이 브라우저는 PIP 창을 지원하지 않아요 (PC 크롬/엣지 116 이상)'); return; }
    const section = document.querySelector('.battle');
    let win;
    try { win = await documentPictureInPicture.requestWindow({ width: 640, height: 360 }); }
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

  // ───────── 영상 PIP: 전투 화면 + HUD 를 영상으로 띄운다 (창 상단 바 없음, 보기 전용) ─────────
  let vpip = null;
  const ticker2 = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33)'], { type: 'text/javascript' })));
  ticker2.onmessage = () => {
    if (!vpip) return;
    tick();
    if (battle) RD.render($('cv').getContext('2d'), st, battle, performance.now());
    drawHud(vpip.cv);
  };
  async function videoPip() {
    if (!document.pictureInPictureEnabled) { UI.toast('이 브라우저는 영상 PIP를 지원하지 않아요. 설정에서 문서 PIP로 바꿔 보세요'); return; }
    const cv = document.createElement('canvas');
    cv.width = 1000; cv.height = 400;
    drawHud(cv);
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true;
    video.srcObject = cv.captureStream(30);
    try {
      await video.play();
      vpip = { cv, video };
      await video.requestPictureInPicture();
    } catch (e) { vpip = null; UI.toast('PIP를 열 수 없어요: ' + e.message); return; }
    $('btnPip').classList.add('on');
    video.addEventListener('leavepictureinpicture', () => {
      vpip = null;
      video.srcObject.getTracks().forEach((t) => t.stop());
      $('btnPip').classList.remove('on');
    }, { once: true });
  }
  function hudBox(x, l, t, w, h) {
    x.fillStyle = 'rgba(10,12,24,.66)'; x.strokeStyle = 'rgba(255,255,255,.16)'; x.lineWidth = 1;
    x.beginPath(); x.roundRect(l, t, w, h, 7); x.fill(); x.stroke();
  }
  function hudText(x, text, l, t, color = '#fff', font = '700 15px "Malgun Gothic",sans-serif') {
    x.font = font; x.fillStyle = color; x.textBaseline = 'middle';
    x.shadowColor = '#000'; x.shadowBlur = 3; x.fillText(text, l, t); x.shadowBlur = 0;
    return x.measureText(text).width;
  }
  function drawHud(cv) {
    const x = cv.getContext('2d'), W = cv.width, H = cv.height;
    x.drawImage($('cv'), 0, 0, W, H);
    if (!battle) return;
    // 상단 왼쪽: 자원
    const fresh = st.inventory.filter((i) => i.isNew).length;
    const box = st.boxDate === US.today(Date.now());
    const parts = [[`🎒 ${st.inventory.length}/${st.invSize}${fresh ? ` +${fresh}` : ''}`, US.invFull(st) ? '#fca5a5' : '#fff'], [`💰 ${US.fmt(st.gold)}`, '#fff'], [`🧊 ${st.cubes}`, '#fff'], [`🎁 ${box ? '사용함' : '가능'}`, box ? '#cbd5e1' : '#86efac']];
    x.font = '700 15px "Malgun Gothic",sans-serif';
    const widths = parts.map(([t]) => x.measureText(t).width);
    hudBox(x, 12, 10, widths.reduce((a, b) => a + b, 0) + 18 * parts.length + 6, 30);
    let lx = 24;
    parts.forEach(([t, c], i) => { hudText(x, t, lx, 25, c); lx += widths[i] + 18; });
    // 상단 오른쪽: 스테이지
    const label = `${st.mode === 'chaos' ? '카오스' : '일반'} ${battle.info.label}  ${battle.info.map.name}`;
    x.font = '700 15px "Malgun Gothic",sans-serif';
    const lw = x.measureText(label).width;
    hudBox(x, W - lw - 36, 10, lw + 24, 30); hudText(x, label, W - lw - 24, 25);
    // 하단 왼쪽: 용병 경험치
    const mercs = US.ownedMercs(st);
    mercs.forEach((c, i) => {
      const m = st.mercs[c], y = H - 18 - (mercs.length - i) * 30;
      const pct = m.lv >= D.MAX_LEVEL ? 1 : m.exp / US.expNeed(m.lv);
      hudBox(x, 10, y, 270, 26);
      hudText(x, `${D.CLASS_NAME[c]} Lv.${m.lv}`, 20, y + 13, '#fff', '700 14px "Malgun Gothic",sans-serif');
      x.fillStyle = 'rgba(255,255,255,.15)'; x.fillRect(130, y + 10, 90, 6);
      x.fillStyle = '#facc15'; x.fillRect(130, y + 10, 90 * pct, 6);
      hudText(x, m.lv >= D.MAX_LEVEL ? 'MAX' : (pct * 100).toFixed(1) + '%', 228, y + 13, '#fde68a', '700 13px "Malgun Gothic",sans-serif');
    });
    // 하단 오른쪽: 최근 획득
    recentDrops.slice(0, 4).forEach((it, i) => {
      const name = `${US.itemName(it)} (${it.tier}단계)`;
      x.font = '700 14px "Malgun Gothic",sans-serif';
      const w = x.measureText(name).width + 44, y = H - 46 - i * 32;
      x.globalAlpha = 1 - i * 0.2;
      hudBox(x, W - w - 10, y, w, 28);
      const ic = AS.img(AS.iconSrc(it));
      if (ic) x.drawImage(ic, W - w - 6, y + 2, 24, 24);
      hudText(x, name, W - w + 24, y + 14, '#fde68a', '700 14px "Malgun Gothic",sans-serif');
      x.globalAlpha = 1;
    });
    // 진행도
    const prog = battle.info.isBoss ? (battle.monsters[0] ? 1 - battle.monsters[0].hp / battle.monsters[0].maxHp : 1) : battle.killed / battle.total;
    x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(0, H - 6, W, 6);
    x.fillStyle = '#f59e0b'; x.fillRect(0, H - 6, W * Math.min(1, prog), 6);
    const pt = battle.info.isBoss ? `보스 ${Math.round(prog * 100)}%` : `${Math.min(battle.killed, battle.total)} / ${battle.total}`;
    x.font = '700 14px "Malgun Gothic",sans-serif';
    const pw = x.measureText(pt).width;
    hudBox(x, W / 2 - pw / 2 - 10, H - 36, pw + 20, 24); hudText(x, pt, W / 2 - pw / 2, H - 24);
  }

  // ───────── 버튼 ─────────
  $('btnBox').addEventListener('click', () => {
    const r = US.summonBox(st, battle, Date.now());
    if (!r.ok) UI.toast(r.why); else save();
  });
  $('btnPortal').addEventListener('click', () => { st.stage++; st.repeat = false; st.repeatReason = null; save(); startBattle(); UI.markDirty(); });
  $('btnRepeat').addEventListener('click', () => { st.repeat = !st.repeat; st.repeatReason = null; save(); UI.markDirty(); });
  $('btnBag').addEventListener('click', () => { UI.ui.tab = 'inv'; UI.render(); $('manage').scrollIntoView({ behavior: 'smooth' }); });
  $('vol').addEventListener('input', (e) => { st.audio.master = +e.target.value; syncVolume(); save(); UI.markDirty(); });
  $('btnBgm').addEventListener('click', () => { st.audio.bgmOn = !st.audio.bgmOn; syncVolume(); save(); UI.markDirty(); });
  syncVolume();

  // ───────── 시작 ─────────
  const off = US.applyOffline(st, Date.now());
  UI.init({
    get st() { return st; },
    getBattle: () => battle,
    sessionReport,
    setAudio(k, v) { st.audio[k] = v; syncVolume(); save(); },
    setPipMode(m) { st.pipMode = m; save(); },
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
  // ───────── 한 번에 한 탭에서만 실행 ─────────
  // 같은 게임을 여러 탭/창에서 열면 진행이 겹치고 저장이 서로 덮어써진다.
  // 새로 연(또는 '여기서 계속하기'를 누른) 탭이 실행권을 가져가고, 기존 탭은 저장 후 멈춘다.
  const myId = Math.random().toString(36).slice(2);
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('ultima-squad') : null;
  const lockEl = document.createElement('div');
  lockEl.className = 'tab-lock';
  lockEl.hidden = true;
  lockEl.innerHTML = '<div><b>다른 탭(창)에서 게임이 실행 중이에요</b><p>진행이 겹치거나 저장이 덮어써지지 않게 이 탭은 멈췄어요.</p><button class="btn primary">여기서 계속하기</button></div>';
  document.body.appendChild(lockEl);
  function pauseHere() {
    if (paused) return;
    save();
    paused = true;
    if (vpip) document.exitPictureInPicture().catch(() => {});
    if (pipWin) pipWin.close();
    AS.vol.master = 0; AS.applyVolume();
    lockEl.hidden = false;
    if (bc) bc.postMessage({ type: 'released', id: myId });
  }
  function resumeFromStorage() {
    st = load();
    paused = false;
    lockEl.hidden = true;
    lastReal = Date.now(); acc = 0;
    syncVolume(); startBattle(); UI.render();
  }
  function takeover() {
    if (!bc) return;
    bc.postMessage({ type: 'takeover', id: myId });
  }
  if (bc) {
    bc.onmessage = (e) => {
      const m = e.data || {};
      if (m.id === myId) return;
      if (m.type === 'takeover') pauseHere();
      else if (m.type === 'released' && !paused) resumeFromStorage(); // 다른 탭이 방금 저장한 최신 기록으로 이어서
    };
    takeover();
  }
  lockEl.querySelector('button').onclick = () => { takeover(); setTimeout(() => { if (paused) resumeFromStorage(); }, 300); };

  G.USGame = { get st() { return st; }, get battle() { return battle; } }; // 디버그용
})(window);
