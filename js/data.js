// 울티마 스쿼드 게임 데이터
// 출처: 메이플스토리 공식 업데이트 공지(7/23), 인벤·나무위키·공략 블로그 실측 자료.
// "추정" 표시가 있는 값은 공개 자료가 없어 직접 정한 값.
(function (G) {
  'use strict';

  const CLASSES = ['war', 'arch', 'mage'];
  const CLASS_NAME = { war: '전사', arch: '궁수', mage: '마법사' };
  const SLOTS = ['weapon', 'hat', 'glove', 'shoe'];
  const SLOT_NAME = { weapon: '무기', hat: '모자', glove: '장갑', shoe: '신발' };

  // 영입 비용 (본섭)
  const RECRUIT = { arch: { cost: 100000, need: 5 /* 1-6 클리어 */ }, mage: { cost: 2000000, need: 15 /* 2-6 클리어 */ } };
  const MAX_LEVEL = 60;

  // 기본 공격속도 단계 (전사 1, 궁수 5, 마법사 3) — 무기 +2, 최대 8
  const BASE_SPEED = { war: 1, arch: 5, mage: 3 };
  // 공격속도 단계 → 행동 간격(초) [추정]
  const speedInterval = (s) => 1.8 - 0.15 * (Math.min(8, Math.max(1, s)) - 1);

  // 레벨별 기본 스탯 [추정] — 전사: 탱커, 궁수: 딜러, 마법사: 서포터
  function baseStats(cls, lv) {
    const s = baseStatsRaw(cls, lv);
    // 40레벨 이후(카오스 구간)는 레벨 차이가 확실히 체감되도록 추가 성장
    const k = Math.pow(Math.max(0, lv - 40), 1.5);
    s.atk += k * { war: 3, arch: 4, mage: 3.8 }[cls];
    s.hp += k * { war: 70, arch: 35, mage: 40 }[cls];
    return s;
  }
  function baseStatsRaw(cls, lv) {
    switch (cls) {
      case 'war': return { atk: 8 + 2.2 * lv + 0.06 * lv * lv, hp: 150 + 45 * lv + 3 * lv * lv, def: 100 + 40 * lv };
      case 'arch': return { atk: 10 + 2.8 * lv + 0.08 * lv * lv, hp: 90 + 28 * lv + 1.6 * lv * lv, def: 30 + 15 * lv };
      case 'mage': return { atk: 10 + 2.7 * lv + 0.075 * lv * lv, hp: 100 + 30 * lv + 1.8 * lv * lv, def: 40 + 18 * lv };
    }
  }
  const BASE_CRIT = 5, BASE_CRIT_DMG = 35; // [추정]

  // ───────── 스킬 ─────────
  // type: basic | active | passive | trigger
  // hits: 타격 횟수, targets: 최대 대상 수, pct: 퍼센트 데미지, cd: 재사용 대기시간(초)
  const SKILLS = {
    // 전사
    slash_blast: { cls: 'war', name: '슬래시 블러스트', lv: 1, type: 'basic', targets: 2, pct: 200, hits: 1, icon: '⚔️', desc: '200% 데미지로 최대 2명의 적을 공격' },
    aura_blade: { cls: 'war', name: '오라 블레이드', lv: 2, type: 'active', targets: 3, pct: 700, hits: 1, cd: 6, icon: '🌙', fx: 'wave', color: '#7dd3fc', desc: '최대 3명의 적을 700%의 데미지로 공격하는 검기 발사' },
    iron_body: { cls: 'war', name: '아이언 바디', lv: 10, type: 'passive', icon: '🛡️', desc: '방어력 10%, 최대 HP 10% 증가' },
    blessed_hammer: { cls: 'war', name: '블래스드 해머', lv: 21, type: 'passive', icon: '🔨', desc: '주위를 회전하는 망치 5개 생성. 망치가 1초에 한 번씩 최대 2명의 적을 200%의 데미지로 공격, 공격 시 10% 확률로 최대 HP의 1% 회복' },
    divide: { cls: 'war', name: '디바이드', lv: 28, type: 'active', targets: 4, pct: 160, hits: 6, cd: 6, icon: '✖️', fx: 'slash', color: '#fca5a5', desc: '최대 4명의 적을 160%의 데미지로 6번 공격' },
    invincible_belief: { cls: 'war', name: '인빈서블 빌리프', lv: 38, type: 'trigger', icon: '💚', desc: 'HP가 30% 이하가 되면 자동 발동, 3초 동안 1초마다 최대 HP의 10% 회복. 스테이지당 1회' },
    demon_bane: { cls: 'war', name: '데몬 베인', lv: 40, type: 'active', targets: 6, pct: 12000, hits: 13, cd: 120, icon: '😈', fx: 'ult', color: '#a855f7', desc: '최대 6명의 적을 12000%의 데미지로 13번 연속 공격' },
    // 궁수
    arrow_blow: { cls: 'arch', name: '애로우 블로우', lv: 1, type: 'basic', targets: 2, pct: 170, hits: 1, icon: '🏹', desc: '최대 2명의 적을 170% 데미지로 공격하는 화살 발사' },
    charged_arrow: { cls: 'arch', name: '차지드 애로우', lv: 2, type: 'active', targets: 6, pct: 700, hits: 1, cd: 6, icon: '➶', fx: 'beam', color: '#86efac', desc: '최대 6명의 적을 700%의 데미지로 공격' },
    storm_arrow: { cls: 'arch', name: '폭풍의 시', lv: 15, type: 'basic', targets: 1, pct: 65, hits: 4, bossPct: 1000, icon: '🌪️', desc: '발당 65% 데미지로 공격. 각 지역 10 스테이지 보스 공격 시 1000% 데미지. 장착 시 기본 공격 대신 사용' },
    vortex_sphere: { cls: 'arch', name: '볼텍스 스피어', lv: 20, type: 'active', targets: 6, pct: 160, hits: 6, cd: 6, spread: 3, icon: '🌀', fx: 'vortex', color: '#5eead4', desc: '일정 간격마다 최대 6명의 적을 160%의 데미지로 6번 공격하는 볼텍스 스피어 생성' },
    soul_contract: { cls: 'arch', name: '소울 컨트랙트', lv: 31, type: 'buff', cd: 30, dur: 15, icon: '📜', desc: '15초 동안 데미지 50% 증가' },
    elemental_ghost: { cls: 'arch', name: '엘리멘탈 고스트', lv: 37, type: 'buff', cd: 30, dur: 15, icon: '👻', desc: '15초 동안 공격 스킬의 잔상이 최대 3번 추가 공격. 잔상 최종 데미지 30% (폭풍의 시 15%)' },
    dragon_burst: { cls: 'arch', name: '드래곤 버스트', lv: 40, type: 'active', targets: 6, pct: 10000, hits: 15, cd: 120, icon: '🐲', fx: 'ult', color: '#f59e0b', desc: '최대 6명의 적을 10000%의 데미지로 15번 연속 공격' },
    // 마법사
    energy_bolt: { cls: 'mage', name: '에너지 볼트', lv: 1, type: 'basic', targets: 2, pct: 150, hits: 1, icon: '✨', desc: '150% 데미지로 최대 2명의 적을 공격' },
    chain_lightning: { cls: 'mage', name: '체인 라이트닝', lv: 2, type: 'active', targets: 6, pct: 650, hits: 1, cd: 6, stun: 0.2, icon: '⚡', fx: 'bolt', color: '#fde047', desc: '최대 6명의 적을 650% 데미지로 공격, 20% 확률로 1초 간 기절' },
    heal: { cls: 'mage', name: '힐', lv: 7, type: 'heal', cd: 15, icon: '💖', desc: '자신을 포함한 파티원 각각의 최대 HP 2% 회복 및 상태 이상 치료' },
    heavens_door: { cls: 'mage', name: '헤븐즈 도어', lv: 16, type: 'trigger', icon: '🚪', desc: '가장 먼저 HP가 0이 된 파티원을 부활. 스테이지당 1회' },
    flame_sweep: { cls: 'mage', name: '플레임 스윕', lv: 24, type: 'active', targets: 6, pct: 950, hits: 1, cd: 6, icon: '🔥', fx: 'fire', color: '#fb923c', desc: '최대 6명의 적에게 950%의 데미지로 공격' },
    pray: { cls: 'mage', name: '프레이', lv: 32, type: 'buff', cd: 30, dur: 15, party: true, icon: '🙏', desc: '15초 동안 자신 및 파티원의 최종 데미지 30% 증가' },
    zodiac_ray: { cls: 'mage', name: '조디악 레이', lv: 40, type: 'active', targets: 6, pct: 12000, hits: 11, cd: 120, spread: 5, icon: '🌌', fx: 'ult', color: '#818cf8', desc: '5초 동안 최대 6명의 적을 12000%의 데미지로 11번 지속 공격' },
  };
  for (const [id, s] of Object.entries(SKILLS)) s.id = id;
  const BASIC = { war: 'slash_blast', arch: 'arrow_blow', mage: 'energy_bolt' };
  const SKILL_LIST = (cls) => Object.values(SKILLS).filter((s) => s.cls === cls && !(s.type === 'basic' && s.id === BASIC[cls]));

  // ───────── 장비 ─────────
  const ITEM_NAMES = {
    war: [
      ['울티마 왕푸', '울티마 브론즈 코이프', '울티마 강철 반장갑', '울티마 브론즈 그리브'],
      ['울티마 드래곤 클레이모어', '울티마 블루 드래곤 투구', '울티마 블루 드래곤 건틀렛', '울티마 블루 드래곤 부츠'],
      ['울티마 리버스 니플하임', '울티마 리버스 휀넬', '울티마 리버스 베르가못', '울티마 리버스 그라베'],
      ['울티마 라이온하트 배틀시미터', '울티마 라이온하트 배틀헬름', '울티마 라이온하트 배틀브레이서', '울티마 라이온하트 배틀부츠'],
      ['울티마 파프니르 페니텐시아', '울티마 하이네스 워리어헬름', '울티마 앤티크 루트 나이트글러브', '울티마 앤티크 루트 나이트슈즈'],
      ['울티마 앱솔랩스 브로드세이버', '울티마 앱솔랩스 나이트헬름', '울티마 앱솔랩스 나이트글러브', '울티마 앱솔랩스 나이트슈즈'],
      ['울티마 아케인셰이드 투핸드소드', '울티마 아케인셰이드 나이트햇', '울티마 아케인셰이드 나이트글러브', '울티마 아케인셰이드 나이트슈즈'],
      ['울티마 제네시스 투핸드소드', '울티마 에테르넬 나이트헬름', '울티마 에테르넬 나이트글러브', '울티마 에테르넬 나이트슈즈'],
    ],
    mage: [
      ['울티마 써클윈드 스태프', '울티마 갈색 낡은 고깔 모자', '울티마 레모나', '울티마 베이지 니티'],
      ['울티마 드래곤 스태프', '울티마 골드 드래곤 크라운', '울티마 블루 엘리멘탈 글로브', '울티마 블루 엘리멘탈 슈즈'],
      ['울티마 리버스 에아스 핸드', '울티마 리버스 코럴', '울티마 리버스 헤르모사', '울티마 리버스 카바티나'],
      ['울티마 드래곤테일 워스태프', '울티마 드래곤테일 메이지샐릿', '울티마 드래곤테일 메이지피스트', '울티마 드래곤테일 메이지슈즈'],
      ['울티마 파프니르 마나크라운', '울티마 하이네스 던위치햇', '울티마 앤티크 루트 메이지글러브', '울티마 앤티크 루트 메이지슈즈'],
      ['울티마 앱솔랩스 스펠링스태프', '울티마 앱솔랩스 메이지크라운', '울티마 앱솔랩스 메이지글러브', '울티마 앱솔랩스 메이지슈즈'],
      ['울티마 아케인셰이드 스태프', '울티마 아케인셰이드 메이지햇', '울티마 아케인셰이드 메이지글러브', '울티마 아케인셰이드 메이지슈즈'],
      ['울티마 제네시스 스태프', '울티마 에테르넬 메이지햇', '울티마 에테르넬 메이지글러브', '울티마 에테르넬 메이지슈즈'],
    ],
    arch: [
      ['울티마 라이덴', '울티마 초록색 고급 가죽 모자', '울티마 아르', '울티마 그린 우드탑'],
      ['울티마 드래곤 샤인보우', '울티마 레드 헌터', '울티마 레드 헌터 글로브', '울티마 레드 헌터 슈즈'],
      ['울티마 리버스 엔가우', '울티마 라피드', '울티마 리버스 프레스토', '울티마 리버스 론타노'],
      ['울티마 팔콘윙 컴포지트보우', '울티마 팔콘윙 센티널캡', '울티마 팔콘윙 센티널글러브', '울티마 팔콘윙 센티널부츠'],
      ['울티마 파프니르 윈드체이서', '울티마 하이네스 레인져베레', '울티마 앤티크 루트 아처글러브', '울티마 앤티크 루트 아처슈즈'],
      ['울티마 앱솔랩스 슈팅보우', '울티마 앱솔랩스 아처후드', '울티마 앱솔랩스 아처글러브', '울티마 앱솔랩스 아처슈즈'],
      ['울티마 아케인셰이드 보우', '울티마 아케인셰이드 아처햇', '울티마 아케인셰이드 아처글러브', '울티마 아케인셰이드 아처슈즈'],
      ['울티마 제네시스 보우', '울티마 에테르넬 아처햇', '울티마 에테르넬 아처글러브', '울티마 에테르넬 아처슈즈'],
    ],
  };

  // 단계별: 요구 레벨, 분해 골드, 무기 공/마(5품질), 방어구 HP(5품질), 방어력(5품질), 잠재 등급, 줄 수
  const TIERS = [
    null,
    { req: 1, dis: 660, atk: [9, 10, 11, 12, 13], hp: [45, 48, 50, 52, 55], def: [5, 6, 7, 8, 9], grade: null, lines: 0 },
    { req: 6, dis: 1400, atk: [14, 15, 16, 17, 18], hp: [74, 77, 80, 83, 86], def: [10, 11, 12, 13, 14], grade: 'rare', lines: 1 },
    { req: 12, dis: 2970, atk: [20, 21, 22, 23, 24], hp: [112, 116, 120, 124, 128], def: [15, 16, 17, 18, 19], grade: 'rare', lines: 2 },
    { req: 18, dis: 6300, atk: [25, 26, 28, 30, 31], hp: [158, 167, 175, 183, 192], def: [20, 21, 22, 23, 24], grade: 'epic', lines: 2 },
    { req: 24, dis: 13370, atk: [32, 33, 35, 37, 38], hp: [231, 240, 250, 260, 269], def: [128, 139, 150, 161, 172], grade: 'epic', lines: 2 },
    { req: 32, dis: 60140, atk: [65, 70, 75, 80, 85], hp: [762, 831, 900, 969, 1038], def: [267, 276, 285, 294, 303], grade: 'unique', lines: 2 },
    { req: 40, dis: 270640, atk: [111, 118, 125, 132, 139], hp: [1360, 1480, 1600, 1720, 1840], def: [362, 371, 380, 389, 398], grade: 'legendary', lines: 2 },
    { req: 40, dis: 1217890, atk: [165, 175, 185, 195, 205], hp: [2040, 2220, 2400, 2580, 2760], def: [407, 416, 425, 434, 443], grade: 'legendary', lines: 3 },
  ];
  const QUALITY_NAME = ['최하옵', '하옵', '중옵', '상옵', '최상옵'];
  const GRADE_NAME = { rare: '레어', epic: '에픽', unique: '유니크', legendary: '레전드리' };
  const GRADE_COLOR = { rare: '#60a5fa', epic: '#c084fc', unique: '#fbbf24', legendary: '#4ade80' };

  // ───────── 잠재능력 ─────────
  // 가중치 (나무위키 확률표) — key: 옵션, 값: [rare, epic, unique, legendary]
  const POT_WEIGHTS = {
    weapon: {
      hp: [44, 44, 44, 44], def: [44, 44, 44, 44], atk: [10, 10, 10, 14], matk: [10, 10, 10, 14],
      atkp: [0, 2, 3, 5], matkp: [0, 2, 3, 5], crit: [6, 6, 6, 10], critdmg: [0, 0, 0, 3],
      speed: [0, 0, 1, 1], cdr: [0, 0, 1, 1],
    },
    armor: {
      hp: [44, 44, 60, 88], def: [44, 44, 60, 88], atk: [4, 6, 6, 6], matk: [4, 6, 6, 6], crit: [4, 4, 2, 4],
    },
    hat: { rage: [6, 6, 6, 6], love: [4, 4, 4, 4] },
    glove: { invinc: [10, 10, 10, 10] },
    shoe: { ignore: [10, 10, 10, 10] },
  };
  const GRADE_IDX = { rare: 0, epic: 1, unique: 2, legendary: 3 };
  // 옵션 수치 후보 (인벤 수치표)
  const POT_VALUES = {
    hp: [[35, 50, 60, 75], [90, 110, 140, 170], [225, 280, 340, 400], [420, 525, 630, 735]],
    def: [[4, 6, 7, 10], [10, 13, 16, 20], [15, 22, 27, 32], [20, 28, 34, 40]],
    atk_w: [[2, 3, 4, 5], [5, 6, 8, 9], [11, 14, 16, 19], [19, 25, 30, 35]],
    atk_a: [[2, 3], [5, 6], [11, 14], [19, 25]],
    pct: [[0], [1, 2], [2, 3, 4], [3, 4, 5, 6]],
    crit_w: [[1, 2, 3], [1, 2, 3], [2, 3, 4], [2, 3, 4, 5]],
    crit_a: [[1], [2], [2], [2, 3]],
    critdmg: [[0], [0], [0], [8, 10, 12]],
    cdr: [[0], [0], [1], [2]],
  };
  const POT_LABEL = {
    hp: (v) => `최대 HP +${v}`, def: (v) => `방어력 +${v}`, atk: (v) => `공격력 +${v}`, matk: (v) => `마력 +${v}`,
    atkp: (v) => `공격력 +${v}%`, matkp: (v) => `마력 +${v}%`, crit: (v) => `크리티컬 확률 +${v}%`,
    critdmg: (v) => `크리티컬 데미지 +${v}%`, speed: () => '공격속도 1단계 증가', cdr: (v) => `스킬 재사용 대기시간 -${v}초`,
    rage: () => '피격 시 8% 확률로 3초간 분노를 느낀다', love: () => '피격 시 8% 확률로 3초간 사랑에 빠진다',
    invinc: () => '피격 시 2% 확률로 1초간 무적', ignore: () => '피격 시 5% 확률로 데미지의 10% 무시',
  };

  // ───────── 스테이지 ─────────
  const REGION_MAPS = [
    [{ name: '헤네시스 북쪽 언덕', bg: ['#7dd3fc', '#bbf7d0', '#4ade80'] }, { name: '리프레', bg: ['#93c5fd', '#e0e7ff', '#a3a3a3'] }, { name: '시간의 신전', bg: ['#c4b5fd', '#f5f3ff', '#e9d5ff'] }, { name: '시간의 신전 깊은 곳', bg: ['#4c1d95', '#7c3aed', '#312e81'] }],
    [{ name: '소멸의 여로', bg: ['#1e1b4b', '#4338ca', '#0f172a'] }, { name: '츄츄 아일랜드', bg: ['#38bdf8', '#fef08a', '#fb923c'] }, { name: '아르카나', bg: ['#064e3b', '#34d399', '#065f46'] }, { name: '아르카나 정령의 나무', bg: ['#14532d', '#86efac', '#166534'] }],
    [{ name: '세르니움', bg: ['#fde68a', '#fef3c7', '#d97706'] }, { name: '호텔 아르크스', bg: ['#7c2d12', '#fdba74', '#451a03'] }, { name: '오디움', bg: ['#450a0a', '#f87171', '#1c1917'] }, { name: '의지가 깃든 곳', bg: ['#0c0a09', '#a8a29e', '#292524'] }],
  ];
  // 지역/맵별 몬스터 (표시용)
  // 지역/맵별 몬스터 [이름, 대체 이모지, 리소스 ID] — 원작 맵에 실제로 나오는 몬스터
  const MAP_MONSTERS = [
    [{ mob: ['주황버섯', '🍄', 1210102], boss: ['머쉬맘', '🍄', 6130101] }, { mob: ['호브', '🐗', 7130600], boss: ['다크 와이번', '🐲', 8150302] }, { mob: ['추억의 수호병', '🗿', 8200003], boss: ['망각의 수호대장', '🗿', 8200012] }, { boss: ['핑크빈', '🐷', 8820001] }],
    [{ mob: ['기쁨의 에르다스', '👻', 8641000], boss: ['강인한 영혼의 에르다스', '👻', 8641006] }, { mob: ['설익은 울프룻', '🍓', 8642006], boss: ['잘익은 울프룻', '🍓', 8642007] }, { mob: ['햇살의 정령', '🧚', 8644001], boss: ['부조화의 정령', '🌳', 8644010] }, { boss: ['악화된 조화의 정령', '🌲', 8644011] }],
    [{ mob: ['흑태양 보병', '💂', 8645123], boss: ['우두머리 괴물 갈매기', '🦅', 8645135] }, { mob: ['모래칼날 약탈꾼', '🦂', 8645200], boss: ['세냐보그 알파버전', '🤖', 8645209] }, { mob: ['앵글러 로봇 A형', '🤖', 8645293], boss: ['오디움의 척후병', '⚔️', 8645307] }, { boss: ['오디움의 수호병', '👹', 8645300] }],
  ];
  const mapIndex = (s) => (s === 9 ? 3 : Math.floor(s / 3));

  // 권장 레벨 (인벤 정리, 전사 기준 1~9 스테이지)
  const REC_LEVEL = {
    normal: [[1, 1, 5, 6, 7, 10, 11, 14, 16, 16], [17, 20, 21, 24, 25, 28, 29, 31, 33, 28], [34, 36, 37, 38, 39, 40, 40, 40, 40, 40]],
    chaos: [[40, 40, 41, 41, 42, 42, 43, 43, 43, 44], [44, 45, 45, 46, 46, 47, 47, 48, 48, 49], [49, 50, 50, 51, 51, 52, 52, 53, 54, 55]],
  };

  // 드롭 장비 단계 범위 [최소, 최대]
  function dropRange(mode, idx) {
    const r = Math.floor(idx / 10), s = idx % 10;
    if (mode === 'normal') {
      if (r === 0) return s === 0 ? null : s === 9 ? [2, 2] : s >= 6 ? [1, 2] : [1, 1];
      if (r === 1) return s === 9 ? [3, 3] : s >= 6 ? [1, 4] : [1, 3];
      return s === 9 ? [4, 4] : s >= 6 ? [1, 6] : [1, 5];
    }
    if (r === 0) return s === 9 ? [6, 6] : [1, 6];
    if (r === 1) return s === 9 ? [7, 7] : s >= 2 ? [1, 7] : [1, 6];
    return s === 9 ? [8, 8] : s >= 3 ? [1, 8] : [1, 7];
  }

  // 몬스터 처치 골드 (블로그 실측)
  function goldPerKill(mode, idx) {
    if (mode === 'chaos') return 0;
    const r = Math.floor(idx / 10), s = idx % 10;
    if (s === 9) return 0;
    if (r === 0) return 10 + 20 * s;
    if (r === 1) return 400 + 30 * s;
    return 700 + 50 * s;
  }

  // 최초 클리어 보상
  function clearReward(mode, idx) {
    const r = Math.floor(idx / 10), s = idx % 10;
    if (mode === 'chaos') return idx === 29 ? { medal: 'chaos' } : null;
    const coin = s === 9 ? [500, 900, 1200][r] : [100, 200, 300][r];
    return idx === 29 ? { coin, medal: 'normal' } : { coin };
  }

  // ───────── 유틸리티 ─────────
  const UTIL = {
    slots: { name: '스킬 슬롯 확장', levels: [{ v: 2, cost: 250000, need: 9 }, { v: 3, cost: 3000000, need: 19 }], fmt: (v) => `${v}칸` },
    offline: { name: '오프라인 누적 시간 증가', levels: [[17, 300000], [18, 400000], [19, 500000], [20, 800000], [21, 1000000], [22, 1500000], [23, 1700000], [24, 2000000]].map(([v, cost]) => ({ v, cost })), fmt: (v) => `${v}시간` },
    drop: { name: '장비 드롭률 증가', levels: [[5, 300000], [10, 600000], [15, 1000000], [20, 1500000], [25, 10000000], [30, 20000000]].map(([v, cost]) => ({ v, cost })), fmt: (v) => `${v}%` },
    gold: { name: '골드 획득량 증가', levels: [[5, 300000], [10, 600000], [15, 1000000], [20, 1500000], [25, 10000000], [30, 20000000]].map(([v, cost]) => ({ v, cost })), fmt: (v) => `${v}%` },
  };
  // 인벤토리 칸당 확장 비용
  const INV_COST = [[29, 10000], [49, 60000], [69, 150000], [99, 200000], [129, 300000], [169, 400000], [209, 500000], [256, 1500000]];
  const invSlotCost = (nextSize) => (INV_COST.find(([max]) => nextSize <= max) || [0, Infinity])[1];
  const INV_MAX = 256;
  const CUBE_PRICE = 20000;

  // ───────── 코인 강화 (원작 코인샵 아이템 대신 영구 강화) ─────────
  // 스쿼드 코인은 일반 모드 최초 클리어로만 얻어서 총 8,000개 → 전부 사면 약 7,550개
  // 카오스 스쿼드 코인은 카오스 몬스터에게서 계속 나온다
  const COIN_UP = [
    { id: 'exp', name: '경험치 획득량', cur: 'squad', per: 5, max: 10, base: 50, step: 50, unit: '%', icon: '📗' },
    { id: 'atk', name: '공격력/마력', cur: 'squad', per: 4, max: 10, base: 40, step: 40, unit: '%', icon: '⚔️' },
    { id: 'hp', name: '최대 HP', cur: 'squad', per: 4, max: 10, base: 40, step: 40, unit: '%', icon: '❤️' },
    { id: 'offline', name: '오프라인 보상 효율', cur: 'squad', per: 5, max: 4, base: 100, step: 0, unit: '%p', icon: '🌙' },
    { id: 'cexp', name: '경험치 획득량', cur: 'chaos', per: 2, max: 50, base: 10, step: 5, unit: '%', icon: '📘' },
    { id: 'catk', name: '공격력/마력', cur: 'chaos', per: 2, max: 50, base: 10, step: 5, unit: '%', icon: '🗡️' },
    { id: 'chp', name: '최대 HP', cur: 'chaos', per: 2, max: 50, base: 10, step: 5, unit: '%', icon: '💗' },
    { id: 'drop', name: '장비 드롭률', cur: 'chaos', per: 3, max: 20, base: 15, step: 5, unit: '%', icon: '🎁' },
    { id: 'cube', name: '훈련용 큐브 드롭률', cur: 'chaos', per: 10, max: 20, base: 15, step: 5, unit: '%', icon: '🧊' },
    { id: 'gold', name: '골드 획득량', cur: 'chaos', per: 3, max: 20, base: 15, step: 5, unit: '%', icon: '💰' },
  ];
  const coinUpCost = (u, lv) => u.base + u.step * lv;

  // ───────── 확률 등 [추정] ─────────
  const RATES = {
    equipDrop: 0.03,       // 몬스터당 장비 드롭
    stageBossEquip: 0.5,   // 1~9 스테이지 보스 장비 드롭
    cubeNormal: 0.002, cubeChaos: 0.004,
    smallChaosCoin: 0.03,
    offlineRatio: 0.8,     // 오프라인 보상 비율
    reviveTime: 8, reviveHp: 0.5,
    mobsPerStage: 60, waveSize: 6,
    stageBossExp: 6, stageBossGold: 20,
    monsterAttackInterval: 2.0,
    unequipCooldown: 3,
  };

  G.USData = {
    CLASSES, CLASS_NAME, SLOTS, SLOT_NAME, RECRUIT, MAX_LEVEL, BASE_SPEED, speedInterval, baseStats, BASE_CRIT, BASE_CRIT_DMG,
    SKILLS, BASIC, SKILL_LIST, ITEM_NAMES, TIERS, QUALITY_NAME, GRADE_NAME, GRADE_COLOR,
    POT_WEIGHTS, GRADE_IDX, POT_VALUES, POT_LABEL, REGION_MAPS, MAP_MONSTERS, mapIndex, REC_LEVEL,
    dropRange, goldPerKill, clearReward, UTIL, invSlotCost, INV_MAX, CUBE_PRICE, COIN_UP, coinUpCost, RATES,
  };
})(typeof window !== 'undefined' ? window : globalThis);
