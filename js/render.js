// 전투 화면 캔버스 렌더러
(function (G) {
  'use strict';
  const D = G.USData;
  const W = 1000, H = 400, GROUND = 300, S = 1.35; // S: 스프라이트 배율
  const AVATAR = { war: ['🧔', '🤺', '🦸'], arch: ['🧝', '🦹', '🧚'], mage: ['🧙', '🧛', '🧞'] };
  const WEAPON_ICON = { war: '🗡️', arch: '🏹', mage: '🔱' };
  const TIER_COLOR = ['#aaa', '#d1d5db', '#60a5fa', '#60a5fa', '#c084fc', '#c084fc', '#fbbf24', '#4ade80', '#4ade80'];
  const avatarStage = (lv) => (lv >= 40 ? 2 : lv >= 20 ? 1 : 0); // 특정 레벨에서 외형 변경

  const A = G.USAssets;
  const anim = {};     // 용병별 애니메이션 상태 { atk, hit }
  const monHit = {};   // 몬스터 피격 시각
  const corpses = [];  // 사망 애니메이션
  const lastX = {};    // 몬스터 이동 감지
  const drops = [];  // 바닥에 떨어진 아이템/메소
  const floats = []; // 데미지 숫자
  const fx = [];     // 스킬 이펙트
  let flash = null;  // 극딜기 화면 연출

  function monY(m) { return GROUND + 4 - (m.kind === 'mob' ? m.y * 3 : 0); }

  function pushEvents(events, b) {
    for (const e of events) {
      if (e.t === 'dmg') {
        const y = GROUND - 60 - Math.random() * 20;
        floats.push({ x: e.x + (Math.random() * 30 - 15), y, v: e.v, crit: e.crit, life: 0.9, kind: 'dmg' });
        monHit[e.id] = performance.now();
      } else if (e.t === 'meso' || e.t === 'drop' || e.t === 'cube' || e.t === 'coin') {
        spawnDrop(e);
      } else if (e.t === 'kill') {
        if (e.mob && A.mobMeta[e.mob] && A.mobMeta[e.mob].die) corpses.push({ mob: e.mob, kind: e.kind, x: e.x, y: e.kind === 'mob' ? GROUND + 4 - e.y * 3 : GROUND + 4, start: performance.now() });
      } else if (e.t === 'hurt' || e.t === 'heal') {
        if (e.t === 'hurt') (anim[e.cls] = anim[e.cls] || {}).hit = performance.now();
        const m = b.mercs[e.cls];
        if (m) floats.push({ x: m.x, y: GROUND - 70, v: e.v, life: 0.9, kind: e.t });
      } else if (e.t === 'miss') {
        const m = b.mercs[e.cls];
        if (m) floats.push({ x: m.x, y: GROUND - 70, v: 'MISS', life: 0.8, kind: 'miss' });
      } else if (e.t === 'bossheal') {
        const boss = b.monsters.find((x) => x.id === e.id);
        if (boss) floats.push({ x: boss.x, y: GROUND - 120, v: e.v, life: 1.2, kind: 'heal' });
      } else if (e.t === 'skill') {
        const sk = D.SKILLS[e.skill];
        const m = b.mercs[e.cls];
        if (!sk || !m) continue;
        (anim[e.cls] = anim[e.cls] || {}).atk = performance.now();
        if (spawnSkillFx(e, m)) {
          if (sk.fx === 'ult') flash = { name: sk.name, color: sk.color, life: 1.0, icon: sk.icon, soft: true, skill: sk.id };
          if (sk.type !== 'basic') fx.push({ type: 'label', color: '#fff', from: [m.x, GROUND - 40], pos: [], life: 0.7, max: 0.7, cls: e.cls, name: sk.name, icon: sk.icon });
          continue;
        }
        if (sk.fx === 'ult') flash = { name: sk.name, color: sk.color, life: 1.4, icon: sk.icon, skill: sk.id };
        fx.push({ type: sk.fx || (sk.type === 'basic' ? 'basic' : sk.type), color: sk.color || '#fff', from: [m.x, GROUND - 40], pos: e.pos || [], life: sk.fx === 'ult' ? 1.2 : sk.spread ? sk.spread : 0.35, max: sk.fx === 'ult' ? 1.2 : sk.spread ? sk.spread : 0.35, cls: e.cls, name: sk.type !== 'basic' ? sk.name : null, icon: sk.icon });
      } else if (e.t === 'levelup') {
        const m = b.mercs[e.cls];
        if (m) floats.push({ x: m.x, y: GROUND - 110, v: 'LEVEL UP!', life: 1.6, kind: 'lvl' });
      }
    }
    if (floats.length > 70) floats.splice(0, floats.length - 70);
    if (fx.length > 60) fx.splice(0, fx.length - 60);
  }

  // ───────── 원작 스킬 이펙트 ─────────
  const sfx = [];
  const total = (fr) => fr.reduce((a, f) => a + (f.d || 90), 0);
  function spawnSkillFx(e, m) {
    const meta = A.skillMeta[e.skill];
    if (!meta || !(meta.effect || meta.hit || meta.ball)) return false;
    A.preloadSkill(e.skill);
    const now = performance.now();
    if (meta.effect) sfx.push({ k: e.skill, kind: 'effect', x: m.x, y: GROUND, start: now, flip: true });
    (e.pos || []).forEach(([px, py], i) => {
      const ty = GROUND - (py || 0) * 26;
      if (meta.ball) {
        sfx.push({ k: e.skill, kind: 'ball', x: m.x + 20, y: GROUND - 40, tx: px, ty: ty - 35, start: now + i * 25, dur: 220, flip: true });
        if (meta.hit) sfx.push({ k: e.skill, kind: 'hit', x: px, y: ty - 30, start: now + 220 + i * 25, flip: true });
      } else if (meta.hit) sfx.push({ k: e.skill, kind: 'hit', x: px, y: ty - 30, start: now + 60 + i * 30, flip: true });
    });
    if (sfx.length > 80) sfx.splice(0, sfx.length - 80);
    return true;
  }
  function drawSkillFx(ctx) {
    const now = performance.now();
    for (let i = sfx.length - 1; i >= 0; i--) {
      const f = sfx[i];
      const el = now - f.start;
      if (el < 0) continue;
      const meta = A.skillMeta[f.k], frames = meta && meta[f.kind];
      if (!frames) { sfx.splice(i, 1); continue; }
      let x = f.x, y = f.y, idx;
      if (f.kind === 'ball') {
        if (el > f.dur) { sfx.splice(i, 1); continue; }
        const k = el / f.dur; x = f.x + (f.tx - f.x) * k; y = f.y + (f.ty - f.y) * k;
        idx = pickFrame(frames, el, true);
      } else {
        if (el > total(frames)) { sfx.splice(i, 1); continue; }
        idx = pickFrame(frames, el, false);
      }
      const im = A.skill(f.k, f.kind, idx), fr = frames[idx];
      if (!im) continue;
      ctx.save();
      ctx.translate(x, y);
      if (f.flip) ctx.scale(-1, 1);
      ctx.drawImage(im, -fr.ox, -fr.oy);
      ctx.restore();
    }
  }

  // ───────── 드롭 / 흡수 ─────────
  function spawnDrop(e) {
    if (e.x == null) return;
    let kind = 'item', src = null, tier = 0;
    if (e.t === 'meso') { kind = 'meso'; tier = e.v < 60 ? 0 : e.v < 400 ? 1 : e.v < 2000 ? 2 : 3; }
    else if (e.t === 'drop') src = A.iconSrc(e.item);
    else if (e.t === 'cube') src = 'assets/icons/cube.png';
    else src = 'assets/icons/chaos_coin.png';
    if (drops.length > 70) drops.splice(0, drops.length - 70);
    drops.push({ kind, src, tier, x: e.x + (Math.random() * 40 - 20), y: GROUND - 50, vx: Math.random() * 120 - 60, vy: -300 - Math.random() * 80, state: 'fall', t0: performance.now(), rot: 0 });
  }
  function dropImg(d, now) {
    if (d.kind === 'meso') return A.img(`assets/icons/meso${d.tier}_${Math.floor(now / 130 + d.t0) % 4}.png`);
    return A.img(d.src);
  }
  function drawDrops(ctx, b, dt) {
    if (!drops.length) return;
    const now = performance.now();
    const floor = GROUND + 2;
    // 화면 안의 몬스터를 다 잡으면 떨어진 것들을 앞에 선 용병에게 흡수
    // 웨이브가 바뀌었거나(새 몬스터 등장), 화면에 남은 몬스터가 없거나, 스테이지가 끝나면 흡수
    const waveKey = b.spawned + (b.bossSpawned ? 1000 : 0);
    const newWave = drawDrops.wave !== undefined && drawDrops.wave !== waveKey;
    drawDrops.wave = waveKey;
    const alive = b.monsters.some((m) => m.hp > 0 && m.kind !== 'box' && m.x < 990);
    const front = ['war', 'arch', 'mage'].map((c) => b.mercs[c]).find((m) => m && m.alive) || Object.values(b.mercs)[0];
    if (newWave || !alive || b.done) drawDrops.until = now + 900; // 막 떨어지던 것도 착지하면 같이 흡수
    if (now < (drawDrops.until || 0) && front) {
      let k = 0;
      for (const d of drops) if (d.state === 'rest') { d.state = 'pull'; d.p0 = { x: d.x, y: d.y }; d.tp = now + (k++) * 35; }
    }
    let picked = 0;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      if (d.state === 'fall') {
        d.vy += 1100 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.rot += dt * 12;
        if (d.y >= floor) { d.y = floor; d.state = 'rest'; d.rest = now; }
      } else if (d.state === 'pull' && now >= d.tp) {
        const el = Math.min(1, (now - d.tp) / 380), e = el * el;
        const tx = front ? front.x : 300, ty = GROUND - 40;
        d.x = d.p0.x + (tx - d.p0.x) * e;
        d.y = d.p0.y + (ty - d.p0.y) * e - Math.sin(el * Math.PI) * 40;
        if (el >= 1) { drops.splice(i, 1); picked++; continue; }
      }
      const im = dropImg(d, now);
      if (!im) continue;
      const bob = d.state === 'rest' ? Math.sin((now - d.rest) / 250) * 3 - 3 : 0;
      ctx.save();
      ctx.translate(d.x, d.y + bob - im.height / 2);
      if (d.state === 'fall') ctx.rotate(Math.sin(d.rot) * 0.4);
      if (d.state === 'pull') ctx.globalAlpha = 0.9;
      ctx.drawImage(im, -im.width / 2, -im.height / 2);
      ctx.restore();
    }
    if (picked && G.USRender.onPickup) G.USRender.onPickup(picked);
  }

  function bg(ctx, info) {
    const pic = A.bg(info.r, G.USData.mapIndex(info.s));
    if (pic) {
      ctx.drawImage(pic, 0, 0, W, H);
      const ground = A.ground(info.r, G.USData.mapIndex(info.s));
      if (ground) {
        // 타일 윗면(보이는 발판 선)에 발이 닿도록 맞춘다
        const gi = A.groundInfo && A.groundInfo[`${info.r}_${G.USData.mapIndex(info.s)}`];
        const surface = gi && gi.surface != null ? gi.surface + 3 : 60;
        ctx.drawImage(ground, 0, GROUND + 4 - surface);
        return;
      }
      const g = ctx.createLinearGradient(0, GROUND - 10, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.25, 'rgba(0,0,0,.35)'); g.addColorStop(1, 'rgba(0,0,0,.6)');
      ctx.fillStyle = g; ctx.fillRect(0, GROUND - 10, W, H - GROUND + 10);
      return;
    }
    const [a, c, gnd] = info.map.bg;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, a); g.addColorStop(0.75, c);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 원경
    ctx.globalAlpha = 0.18; ctx.fillStyle = '#000';
    for (let i = 0; i < 7; i++) { const x = (i * 173) % W; ctx.beginPath(); ctx.ellipse(x, GROUND, 130, 90 + (i % 3) * 30, 0, Math.PI, 0); ctx.fill(); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = gnd; ctx.fillRect(0, GROUND + 10, W, H - GROUND);
    ctx.fillStyle = '#0003'; ctx.fillRect(0, GROUND + 10, W, 4);
  }

  function bar(ctx, x, y, w, h, frac, color) {
    ctx.fillStyle = '#000a'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#333'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  }

  function emoji(ctx, ch, x, y, size, flip) {
    ctx.save();
    ctx.font = `${size}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    if (flip) { ctx.translate(x, y); ctx.scale(-1, 1); ctx.fillText(ch, 0, 0); } else ctx.fillText(ch, x, y);
    ctx.restore();
  }

  function mercFrame(cls, stage, w, b, m) {
    const now = performance.now();
    const a = anim[cls] || {};
    let key = 'stand', f = [0, 1, 2, 1][Math.floor(now / 450 + m.x) % 4];
    if (a.atk && now - a.atk < 450) { key = 'attack'; f = Math.min(2, Math.floor((now - a.atk) / 150)); }
    else if (a.hit && now - a.hit < 250) { key = 'hit'; f = 0; }
    return A.char(cls, stage, w, key, f) || A.char(cls, stage, w, 'stand', 0);
  }

  function drawMerc(ctx, st, b, m, t) {
    const merc = st.mercs[m.cls];
    const stage = avatarStage(merc.lv);
    const bob = Math.sin(t * 4 + m.x) * 2;
    const y = GROUND + bob;
    // 그림자
    ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(m.x, GROUND + 6, 24, 6, 0, 0, Math.PI * 2); ctx.fill();
    if (!m.alive) {
      const tomb = A.img('assets/icons/tomb.png');
      if (tomb) ctx.drawImage(tomb, m.x - tomb.width * 0.6, GROUND + 4 - tomb.height * 1.2, tomb.width * 1.2, tomb.height * 1.2);
      else { ctx.globalAlpha = 0.4; emoji(ctx, '👻', m.x, y, 40); ctx.globalAlpha = 1; }
      if (m.reviveAt) bar(ctx, m.x - 22, y - 62, 44, 5, 1 - (m.reviveAt - b.time) / D.RATES.reviveTime, '#a3a3a3');
      return;
    }
    // 외형 단계 오라
    if (stage > 0) {
      ctx.save(); ctx.globalAlpha = 0.35 + Math.sin(t * 3) * 0.1;
      ctx.fillStyle = stage === 2 ? '#fbbf24' : '#38bdf8';
      ctx.beginPath(); ctx.ellipse(m.x, y - 26, 30, 36, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    if (m.invincUntil > b.time) { ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(m.x, y - 26, 34, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    const wpn = merc.equip.weapon;
    const sprite = mercFrame(m.cls, stage, wpn ? wpn.tier : 0, b, m);
    if (sprite) {
      ctx.save(); ctx.translate(m.x, 0); ctx.scale(-1, 1);
      ctx.drawImage(sprite, -sprite.width * S / 2, GROUND + 4 - sprite.height * S / 2, sprite.width * S, sprite.height * S);
      ctx.restore();
    } else emoji(ctx, AVATAR[m.cls][stage], m.x, y, 46, true);
    // 무기 (장착한 무기 외형만 반영) — 스프라이트가 없을 때만 따로 그림
    if (wpn && !sprite) {
      ctx.save(); ctx.shadowColor = TIER_COLOR[wpn.tier]; ctx.shadowBlur = 8 + wpn.tier * 2;
      emoji(ctx, WEAPON_ICON[m.cls], m.x + 22, y - 10, 22 + wpn.tier); ctx.restore();
    }
    // 블래스드 해머
    if (m.cls === 'war' && merc.skills.slice(0, st.util.slots).includes('blessed_hammer')) {
      for (let i = 0; i < 5; i++) {
        const a = t * 2.5 + i * Math.PI * 2 / 5;
        const hm = A.img('assets/skills/blessed_hammer/ball' + (Math.floor(t * 12 + i) % 8) + '.png');
        if (hm) ctx.drawImage(hm, m.x + Math.cos(a) * 46 - hm.width * 0.35, y - 30 + Math.sin(a) * 14 - hm.height * 0.35, hm.width * 0.7, hm.height * 0.7);
        else emoji(ctx, '🔨', m.x + Math.cos(a) * 42, y - 22 + Math.sin(a) * 14 + 8, 14);
      }
    }
    bar(ctx, m.x - 24, y - 84, 48, 5, m.hp / m.s.hp, m.hp / m.s.hp < 0.3 ? '#f43f5e' : '#22c55e');
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`Lv.${merc.lv}`, m.x, y - 88);
    // 상태 아이콘
    const icons = [];
    if (m.poison) icons.push('assets/icons/poison.png');
    if (m.buffs.soul_contract > b.time) icons.push('assets/skills/soul_contract/icon.png');
    if (m.buffs.elemental_ghost > b.time) icons.push('assets/skills/elemental_ghost/icon.png');
    if (b.prayUntil > b.time) icons.push('assets/skills/pray/icon.png');
    if (m.rageUntil > b.time) icons.push('assets/icons/rage.png');
    if (m.loveUntil > b.time) icons.push('assets/icons/heart.png');
    icons.forEach((src, i) => { const im = A.img(src); if (im) ctx.drawImage(im, m.x - icons.length * 9 + i * 18, y - 112, 16, 16); });
  }

  // 기절: 머리 위에서 도는 별
  function stars(ctx, x, y) {
    const t = performance.now() / 300;
    ctx.save(); ctx.fillStyle = '#fde047'; ctx.strokeStyle = '#a16207'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const a = t + i * 2.1, sx = x + Math.cos(a) * 14, sy = y + Math.sin(a) * 4;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) { const r = k % 2 ? 2.2 : 5, q = k * Math.PI / 5 - Math.PI / 2; ctx.lineTo(sx + Math.cos(q) * r, sy + Math.sin(q) * r); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  function drawMonster(ctx, b, m, t) {
    const big = m.kind !== 'mob';
    const size = m.kind === 'regionBoss' ? 110 : m.kind === 'boss' ? 80 : m.kind === 'box' ? 56 : 40;
    const y = monY(m) + (m.stunUntil > b.time ? 0 : Math.sin(t * 5 + m.id) * 2);
    ctx.fillStyle = '#0005'; ctx.beginPath(); ctx.ellipse(m.x, monY(m) + 6, size * 0.45, 7, 0, 0, Math.PI * 2); ctx.fill();
    const meta = m.mob && A.mobMeta[m.mob];
    if (meta && m.kind !== 'box') {
      const fr = mobFrame(b, m, meta);
      if (fr) {
        const [im, f] = fr;
        const gy = monY(m);
        const k = mobScale(m.mob, m.kind);
        ctx.drawImage(im, m.x - f.ox * k, gy - f.oy * k, im.width * k, im.height * k);
        const top = gy - Math.min(f.oy * k, 120);
        if (m.stunUntil > b.time) stars(ctx, m.x, top - 6);
        if (!big) bar(ctx, m.x - 22, top - 8, 44, 4, m.hp / m.maxHp, '#ef4444');
        return;
      }
    }
    if (m.kind === 'box') {
      const col = { rare: '#60a5fa', epic: '#c084fc', unique: '#fbbf24', legendary: '#4ade80' }[m.grade];
      const bx = A.img('assets/icons/box.png');
      ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 25;
      if (bx) ctx.drawImage(bx, m.x - bx.width, y - bx.height * 2, bx.width * 2, bx.height * 2); else emoji(ctx, '🎁', m.x, y, size);
      ctx.restore();
      ctx.fillStyle = col; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(D.GRADE_NAME[m.grade], m.x, y - size - 4);
    } else emoji(ctx, m.icon, m.x, y, size);
    if (m.stunUntil > b.time) stars(ctx, m.x, y - size + 2);
    if (!big || m.kind === 'box') bar(ctx, m.x - size * 0.4, y - size - (m.kind === 'box' ? 0 : 2), size * 0.8, 4, m.hp / m.maxHp, '#ef4444');
  }

  // 몬스터별 표시 배율: 원본이 큰 몬스터는 화면에 맞게 줄인다
  const mobScaleCache = {};
  function mobScale(id, kind) {
    const k = id + kind;
    if (mobScaleCache[k]) return mobScaleCache[k];
    const meta = A.mobMeta[id];
    const st = (meta && (meta.stand || meta.move)) || [];
    const h = Math.max(1, ...st.map((f) => f.h));
    const target = kind === 'regionBoss' ? 260 : kind === 'boss' ? 190 : 105;
    return (mobScaleCache[k] = Math.min(S, target / h));
  }
  function pickFrame(frames, elapsed, loop) {
    const total = frames.reduce((s, f) => s + (f.d || 120), 0) || 1;
    let t = loop ? elapsed % total : Math.min(elapsed, total - 1);
    for (let i = 0; i < frames.length; i++) { t -= frames[i].d || 120; if (t < 0) return i; }
    return frames.length - 1;
  }
  function mobFrame(b, m, meta) {
    const now = performance.now();
    const moving = lastX[m.id] != null && Math.abs(lastX[m.id] - m.x) > 0.01;
    lastX[m.id] = m.x;
    let key = moving && meta.move ? 'move' : 'stand', start = 0, loop = true;
    const atkEl = m.atkAt != null ? (b.time - m.atkAt) * 1000 : Infinity;
    if (meta.attack && atkEl < meta.attack.reduce((s, f) => s + (f.d || 120), 0)) { key = 'attack'; start = now - atkEl; loop = false; }
    else if (meta.hit && monHit[m.id] && now - monHit[m.id] < 200) { key = 'hit'; start = monHit[m.id]; loop = false; }
    const frames = meta[key] || meta.stand;
    if (!frames || !frames.length) return null;
    const i = pickFrame(frames, now - start + m.id * 37, loop);
    const im = A.mob(m.mob, meta[key] ? key : 'stand', i);
    return im ? [im, frames[i]] : null;
  }
  function drawCorpses(ctx) {
    const now = performance.now();
    for (let i = corpses.length - 1; i >= 0; i--) {
      const c = corpses[i], frames = A.mobMeta[c.mob].die;
      const el = now - c.start, total = frames.reduce((s, f) => s + (f.d || 120), 0);
      if (el > total || corpses.length > 40) { corpses.splice(i, 1); continue; }
      const k = pickFrame(frames, el, false), im = A.mob(c.mob, 'die', k);
      if (im) { const sc = mobScale(c.mob, c.kind); ctx.globalAlpha = Math.max(0, 1 - el / total * 0.6); ctx.drawImage(im, c.x - frames[k].ox * sc, c.y - frames[k].oy * sc, im.width * sc, im.height * sc); ctx.globalAlpha = 1; }
    }
  }

  function drawBossBar(ctx, b) {
    const boss = b.monsters.find((m) => m.kind === 'boss' || m.kind === 'regionBoss');
    if (!boss) return;
    const w = 560, x = (W - w) / 2, y = 14;
    bar(ctx, x, y, w, 14, boss.hp / boss.maxHp, boss.kind === 'regionBoss' ? '#a855f7' : '#ef4444');
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${boss.name}  ${Math.max(0, Math.round(boss.hp / boss.maxHp * 100))}%`, W / 2, y + 11);
    if (boss.mech === 'doom') {
      const left = Math.max(0, boss.mechAt);
      ctx.fillStyle = left < 5 ? '#f87171' : '#fde68a'; ctx.font = 'bold 14px sans-serif';
      ctx.fillText(`⚠ 광역 즉사기까지 ${left.toFixed(1)}초`, W / 2, y + 34);
    }
  }

  function drawFx(ctx, dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i];
      f.life -= dt;
      if (f.life <= 0) { fx.splice(i, 1); continue; }
      const k = f.life / f.max;
      ctx.save();
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.strokeStyle = f.color; ctx.fillStyle = f.color; ctx.lineWidth = 3;
      const [fx0, fy0] = f.from;
      for (const [px, py] of f.pos) {
        const tx = px, ty = GROUND - 25 - (py || 0) * 20;
        switch (f.type) {
          case 'basic': ctx.globalAlpha *= 0.7; ctx.lineWidth = 2; ctx.strokeStyle = { war: '#e5e7eb', arch: '#bbf7d0', mage: '#c7d2fe' }[f.cls]; line(ctx, fx0 + 20, fy0, fx0 + 20 + (tx - fx0 - 20) * (1 - k), fy0 + (ty - fy0) * (1 - k)); break;
          case 'beam': ctx.lineWidth = 5; line(ctx, fx0, fy0, tx, ty); break;
          case 'bolt': zigzag(ctx, fx0, fy0, tx, ty); break;
          case 'wave': ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(fx0 + (tx - fx0) * (1 - k), ty, 22, -1.2, 1.2); ctx.stroke(); break;
          case 'fire': ctx.globalAlpha *= 0.6; ctx.beginPath(); ctx.arc(tx, ty, 28 * (1.3 - k), 0, Math.PI * 2); ctx.fill(); break;
          case 'slash': ctx.lineWidth = 4; line(ctx, tx - 20, ty - 20, tx + 20, ty + 20); line(ctx, tx + 20, ty - 20, tx - 20, ty + 20); break;
          case 'vortex': ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(tx, ty, 24, k * 20, k * 20 + 4.5); ctx.stroke(); break;
          case 'ult': ctx.globalAlpha *= 0.5; ctx.beginPath(); ctx.arc(tx, ty, 40 + 30 * Math.sin(k * 20), 0, Math.PI * 2); ctx.fill(); break;
        }
      }
      if (f.name && f.life > f.max - 0.6) {
        ctx.globalAlpha = 1; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(f.name, fx0, fy0 - 70); ctx.fillStyle = '#fff'; ctx.fillText(f.name, fx0, fy0 - 70);
      }
      ctx.restore();
    }
  }
  function line(ctx, a, b, c, d) { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke(); }
  function zigzag(ctx, x0, y0, x1, y1) {
    ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let i = 1; i < 8; i++) { const k = i / 8; ctx.lineTo(x0 + (x1 - x0) * k + (Math.random() - 0.5) * 18, y0 + (y1 - y0) * k + (Math.random() - 0.5) * 18); }
    ctx.lineTo(x1, y1); ctx.stroke();
  }

  function drawFloats(ctx, dt) {
    ctx.save(); ctx.textAlign = 'center';
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life -= dt; f.y -= 40 * dt;
      if (f.life <= 0) { floats.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, f.life * 2);
      let color = '#fb923c', size = 16, text = typeof f.v === 'number' ? G.US.fmt(f.v) : f.v;
      if (f.kind === 'dmg' && f.crit) { color = '#f43f5e'; size = 19; text = '★' + text; }
      if (f.kind === 'hurt') { color = '#c084fc'; size = 16; }
      if (f.kind === 'heal') { color = '#4ade80'; size = 15; text = '+' + text; }
      if (f.kind === 'miss') { color = '#e5e7eb'; size = 14; }
      if (f.kind === 'lvl') { color = '#fde047'; size = 18; }
      ctx.font = `900 ${size}px "Malgun Gothic",sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = '#0009'; ctx.strokeText(text, f.x, f.y);
      ctx.fillStyle = color; ctx.fillText(text, f.x, f.y);
    }
    ctx.restore();
  }

  function drawFlash(ctx, dt) {
    if (!flash) return;
    flash.life -= dt;
    if (flash.life <= 0) { flash = null; return; }
    const k = flash.life / 1.4;
    ctx.save();
    ctx.globalAlpha = Math.min(flash.soft ? 0.15 : 0.45, k * 0.6); ctx.fillStyle = flash.color; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = Math.min(1, k * 2);
    ctx.font = '900 34px "Malgun Gothic",sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 6; ctx.strokeStyle = '#000a';
    const sic = flash.skill && A.img(`assets/skills/${flash.skill}/icon.png`);
    const tw = ctx.measureText(flash.name).width;
    if (sic) ctx.drawImage(sic, W / 2 - tw / 2 - 52, H / 2 - 64, 44, 44);
    ctx.strokeText(flash.name, W / 2, H / 2 - 40); ctx.fillStyle = '#fff'; ctx.fillText(flash.name, W / 2, H / 2 - 40);
    ctx.restore();
  }

  let last = 0, lastBattle = null;
  function render(ctx, st, b, now) {
    if (b !== lastBattle && A.ready) {
      lastBattle = b;
      for (const k of ['mob', 'boss']) if (b.info.mons[k]) A.preloadMob(b.info.mons[k][2]);
      for (const c of Object.keys(b.mercs)) { A.preloadSkill(G.USData.BASIC[c]); st.mercs[c].skills.forEach((id) => id && A.preloadSkill(id)); }
    }
    const t = now / 1000;
    const dt = last ? Math.min(0.1, t - last) : 0.016;
    last = t;
    ctx.imageSmoothingEnabled = false;
    bg(ctx, b.info);
    ctx.imageSmoothingEnabled = false;
    drawCorpses(ctx);
    drawDrops(ctx, b, dt);
    for (const m of b.monsters) drawMonster(ctx, b, m, t);
    for (const c of ['mage', 'arch', 'war']) if (b.mercs[c]) drawMerc(ctx, st, b, b.mercs[c], t);
    drawFx(ctx, dt);
    drawSkillFx(ctx);
    drawFloats(ctx, dt);
    drawBossBar(ctx, b);
    drawFlash(ctx, dt);
  }
  function clearFx() { floats.length = 0; fx.length = 0; corpses.length = 0; sfx.length = 0; drops.length = 0; flash = null; }

  G.USRender = { render, pushEvents, clearFx, AVATAR, WEAPON_ICON, avatarStage, _drops: drops };
})(window);
