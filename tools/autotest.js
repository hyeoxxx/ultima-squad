// 자동 기능만 켜고 손대지 않았을 때 진행되는지 확인
//   node tools/autotest.js [시간]
'use strict';
for (const f of ['data', 'monsters', 'engine', 'auto']) require(`../js/${f}.js`);
const D = globalThis.USData, US = globalThis.US, AU = globalThis.USAuto;
US.setRandom(US.mulberry32(3));
const HOURS = +(process.argv[2] || 100);
let now = Date.UTC(2026, 6, 23, 1);
const st = US.newState(now);
Object.assign(st.auto, { cube: true });
let b = US.createBattle(st, now), t = 0, lastDuring = 0, evCount = {};
const rep = (l) => console.log(`${(t / 3600).toFixed(1).padStart(6)}h ${l.padEnd(14)} 전${st.mercs.war.lv} 궁${st.mercs.arch.owned ? st.mercs.arch.lv : '-'} 마${st.mercs.mage.owned ? st.mercs.mage.lv : '-'} 골드 ${US.fmt(st.gold)} 인벤 ${st.inventory.length}/${st.invSize} 큐브 ${st.cubes} 슬롯 ${st.util.slots} 장비 ${D.CLASSES.map((c) => D.SLOTS.map((s) => (st.mercs[c].equip[s] ? st.mercs[c].equip[s].tier : 0)).join('')).join('/')}`);
while (t < HOURS * 3600) {
  US.stepBattle(st, b, US.DT); t += US.DT; now += US.DT * 1000;
  if (b.events.length > 3000) b.events.length = 0;
  if (t - lastDuring > 3) { lastDuring = t; AU.during(st); US.refreshMercStats(st, b); if (st.auto.box && US.boxStatus(st, b, now).ok) US.summonBox(st, b, now); }
  if (b.done) {
    const was = US.isCleared(st, b.mode, b.idx);
    US.finishBattle(st, b, now);
    if (!was && US.isCleared(st, b.mode, b.idx)) rep(`${b.mode === 'chaos' ? 'C' : 'N'} ${b.info.label}`);
    for (const e of AU.between(st, now)) { const k = e.msg.split(':')[0].split(' ')[0]; evCount[k] = (evCount[k] || 0) + 1; }
    b = US.createBattle(st, now);
  }
}
rep('끝'); console.log(evCount);
