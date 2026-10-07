// 보정된 몬스터로 핵심 기믹/레벨 컷이 원작처럼 동작하는지 확인
'use strict';
require('../js/data.js'); require('../js/engine.js'); require('../js/monsters.js');
const MON = globalThis.USMonsters;
const { simulate } = require('./calibrate.js');
const D = globalThis.USData;
function run(label, mode, idx, tweak) {
  let ok = 0, time = 0;
  for (const sd of [1, 2, 3, 4, 5, 6]) { globalThis.USMonsters = MON; const r = simulate(mode, idx, null, sd, 400, tweak); if (r.clear) ok++; time += r.time; }
  console.log(label.padEnd(36), `${ok}/6 클리어`, `평균 ${(time / 6).toFixed(0)}s`);
}
const lv = (cls, d) => (st) => { st.mercs[cls].lv += d; };
const noSkill = (cls, id) => (st) => { st.mercs[cls].skills = st.mercs[cls].skills.map((s) => (s === id ? null : s)); };
const all = (...fs) => (st) => fs.forEach((f) => f(st));
const minus = (d) => (st) => { for (const c of D.CLASSES) st.mercs[c].lv = Math.max(1, st.mercs[c].lv - d); };
for (const [m, i] of [['normal', 2], ['normal', 5], ['normal', 7], ['normal', 13], ['normal', 22], ['normal', 27], ['chaos', 4], ['chaos', 25]]) {
  run(`${m} ${Math.floor(i / 10) + 1}-${i % 10 + 1} 권장`, m, i);
  run(`${m} ${Math.floor(i / 10) + 1}-${i % 10 + 1} 권장-3레벨`, m, i, minus(3));
  run(`${m} ${Math.floor(i / 10) + 1}-${i % 10 + 1} 권장+3레벨`, m, i, minus(-3));
}
run('1-10 핑크빈 (폭풍의 시)', 'normal', 9);
run('1-10 핑크빈 (폭풍의 시 없음)', 'normal', 9, all(noSkill('arch', 'storm_arrow'), (st) => { st.mercs.arch.lv = 14; st.mercs.arch.skills[0] = 'charged_arrow'; }));
run('2-10 정령 (헤븐즈 도어)', 'normal', 19);
run('2-10 정령 (도어 없음, 힐+체라)', 'normal', 19, (st) => { st.mercs.mage.skills = ['heal', 'chain_lightning', null]; });
run('3-10 수호병 (데몬 베인)', 'normal', 29);
run('3-10 수호병 (데몬 베인 없음)', 'normal', 29, (st) => { st.mercs.war.skills = ['divide', 'aura_blade', 'blessed_hammer']; st.mercs.war.lv = 39; });
