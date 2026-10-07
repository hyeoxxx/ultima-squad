// 튜토리얼: 화면의 해당 부분을 비추면서 단계별로 설명한다
(function (G) {
  'use strict';
  const IC = (n) => `<img class="mi" src="assets/icons/${n}.png" alt="">`;
  const STEPS = [
    { title: '울티마 스쿼드에 오신 걸 환영해요!', body: `메이플스토리 <b>울티마 스쿼드</b> 이벤트를 재현한 방치형 게임이에요.<br>용병들이 <b>알아서 싸우면서</b> 스테이지를 깨고 성장해요. 재획하면서 켜두기만 하면 돼요.` },
    { target: '.canvas-wrap', title: '전투 화면', body: `용병이 자동으로 몬스터를 잡아요. 몬스터가 떨어뜨린 메소·장비는 웨이브를 다 잡으면 캐릭터에게 흡수돼요.<br><span class="small muted">화면을 한 번 클릭하면 원작 효과음과 BGM이 나와요.</span>` },
    { target: '.battle-bottom .gauge', title: '스테이지 진행도', body: `한 스테이지는 몬스터 60마리 + 스테이지 보스예요. 다 잡으면 다음 스테이지로 넘어가요.<br>실패하면 한 단계 아래 스테이지를 반복하면서 성장해요.` },
    { target: '#btnBox', title: `${IC('box')} 에스페시아 상자`, body: `하루 한 번 소환할 수 있는 보너스 상자예요. 때리다 보면 레어 → 에픽 → 유니크 → 레전드리로 성장하고, 깨면 경험치·장비·큐브·메소를 줘요.` },
    { target: '#btnPip', title: 'PIP 모드', body: `전투 화면을 <b>항상 위에 떠 있는 작은 창</b>으로 띄워요. 메이플 옆에 띄워두고 재획하면 딱이에요.<br><span class="small muted">설정 탭에서 영상 PIP(상단 바 없음) / 문서 PIP(버튼 조작 가능)를 고를 수 있어요.</span>` },
    { target: '.wallet', title: '재화', body: `${IC('meso')} 메소: 용병 영입·유틸리티·큐브 구매<br>${IC('cube')} 훈련용 큐브: 장비 잠재능력 재설정<br>${IC('squad_coin')} 스쿼드 코인 / ${IC('chaos_coin')} 카오스 코인: 코인 강화 탭에서 영구 강화` },
    { tab: 'merc', target: '#panel', title: '용병 설정', body: `전사로 시작하고, 1-6을 깨면 궁수, 2-6을 깨면 마법사를 메소로 영입할 수 있어요.<br>레벨이 오르면 스킬을 배우고, 스킬 슬롯을 고른 뒤 스킬을 눌러 장착해요. <b>앞 슬롯부터</b> 사용해요.` },
    { tab: 'inv', target: '#panel', title: '인벤토리와 장비', body: `장비는 1~8단계예요. 지금보다 좋은 장비엔 <b style="color:#34d399">▲</b>가 붙어요.<br>같은 단계 9개는 <b>장비 합성</b>으로 한 단계 높은 장비로, 남는 건 <b>장비 분해</b>로 메소로 바꿔요. 인벤토리가 가득 차면 장비를 못 얻고 보스에도 못 들어가니 주의!` },
    { tab: 'auto', target: '#panel', title: '자동 탭 (추천)', body: `<b>좋은 장비 자동 장착, 인벤토리 정리, 자동 재도전, 상자 소환, 스킬 배치, 유틸리티 구매</b>를 켜고 끌 수 있어요.<br>기본으로 거의 다 켜져 있어서, 그대로 두면 손대지 않아도 알아서 성장해요.` },
    { tab: 'map', target: '#panel', title: '맵과 보스', body: `각 지역 10 스테이지는 기믹이 있는 보스예요.<br>· 1-10 핑크빈: 체력 회복 → 궁수 15레벨 <b>폭풍의 시</b><br>· 2-10 악화된 조화의 정령: 전원 중독 → 마법사 <b>힐 + 헤븐즈 도어</b><br>· 3-10 오디움의 수호병: 15초마다 즉사기 → 40레벨 <b>극딜기</b><br>일반 3-10을 깨면 카오스 모드가 열려요.` },
    { tab: 'shop', target: '#panel', title: '코인 강화', body: `스테이지를 처음 깰 때 받는 스쿼드 코인, 카오스에서 모으는 카오스 코인으로 경험치·공격력·HP·드롭률 같은 <b>영구 강화</b>를 사요.` },
    { title: '준비 끝!', body: `탭을 닫아도 <b>오프라인 보상</b>(경험치·메소, 최대 16시간)이 쌓여요.<br>진행 기록은 이 브라우저에 저장되고, 게임은 <b>한 번에 한 탭</b>에서만 돌아가요.<br><span class="small muted">튜토리얼은 기타 탭에서 다시 볼 수 있어요.</span>` },
  ];

  let i = 0, root = null, ctx = null;
  function el(sel) { return sel ? document.querySelector(sel) : null; }

  function show() {
    const s = STEPS[i];
    if (s.tab) { const b = document.querySelector(`#tabs [data-tab="${s.tab}"]`); if (b) b.click(); }
    const target = el(s.target);
    const spot = root.querySelector('.tut-spot'), card = root.querySelector('.tut-card');
    card.innerHTML = `<div class="tut-step">${i + 1} / ${STEPS.length}</div><h3>${s.title}</h3><p>${s.body}</p>
      <div class="row"><button class="btn sm ghost" data-t="skip">건너뛰기</button><span style="flex:1"></span>
      ${i ? '<button class="btn sm" data-t="prev">이전</button>' : ''}<button class="btn sm primary" data-t="next">${i === STEPS.length - 1 ? '시작하기' : '다음'}</button></div>`;
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'instant' in window ? 'instant' : 'auto' });
      requestAnimationFrame(() => place(target, spot, card));
    } else {
      spot.style.cssText = 'left:50%;top:50%;width:0;height:0';
      card.style.cssText = 'left:50%;top:50%;transform:translate(-50%,-50%)';
    }
  }
  function place(target, spot, card) {
    const r = target.getBoundingClientRect(), pad = 6;
    spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    const cw = Math.min(380, window.innerWidth - 24);
    // 큰 영역(탭 패널 등)은 카드를 오른쪽 아래 구석에 둔다
    if (r.height > window.innerHeight * 0.5) { card.style.cssText = `right:16px;bottom:16px;width:${cw}px`; return; }
    const below = r.bottom + 14 + 220 < window.innerHeight;
    const top = below ? r.bottom + 14 : Math.max(12, r.top - 14 - card.offsetHeight);
    const left = Math.min(window.innerWidth - cw - 12, Math.max(12, r.left + r.width / 2 - cw / 2));
    card.style.cssText = `left:${left}px;top:${Math.min(top, window.innerHeight - card.offsetHeight - 12)}px;width:${cw}px`;
  }
  function close() {
    root.remove(); root = null;
    window.removeEventListener('resize', onResize);
    if (ctx) ctx.done();
  }
  function onResize() { if (root) show(); }

  function start(c) {
    ctx = c || ctx;
    if (root) return;
    i = 0;
    root = document.createElement('div');
    root.className = 'tut';
    root.innerHTML = '<div class="tut-spot"></div><div class="tut-card"></div>';
    document.body.appendChild(root);
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-t]');
      if (!t) return;
      if (t.dataset.t === 'skip') return close();
      if (t.dataset.t === 'prev') { i = Math.max(0, i - 1); return show(); }
      if (i >= STEPS.length - 1) return close();
      i++; show();
    });
    window.addEventListener('resize', onResize);
    show();
  }
  G.USTutorial = { start };
})(window);
