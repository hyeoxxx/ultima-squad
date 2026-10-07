"""UI 아이콘(메소, 큐브, 코인, 상자, 훈장, 묘비 등)을 메이플 리소스에서 받아 assets/icons/ 에 저장한다.

    python tools/fetch_icons.py
"""
import base64, io, os, sys
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from fetch_assets import get, wz, API, REG, VER, OUT  # noqa: E402

ICON = os.path.join(OUT, 'icons')
# 이름: 아이템 ID 또는 ('wz', 경로)
ICONS = {
    'meso': ('wz', 'Item/Special/0900.img/09000003/iconRaw/0'),
    'meso_s': ('wz', 'Item/Special/0900.img/09000000/iconRaw/0'),
    'cube': 2711000,            # 수상한 큐브
    'squad_coin': 4001129,      # 메이플 코인
    'chaos_coin': 4036068,      # 드림 코인
    'box': 4001102,             # 보물상자
    'bag': 1102815,             # 복덩이 가방
    'medal': 1142000,           # 성실한 모험가의 훈장
    'medal_best': 1142296,      # 카오스를 깨달은 자의 훈장
    'exp': 2437585,             # 경험치 2배 쿠폰 교환권
    'hp': 2000000,              # 빨간 포션
    'clock': 1162001,           # 회중시계
    'gift': 4031137,            # 푸짐한 선물상자
    'heart': 4031111,           # 하트 상자
    'tomb': ('wz', 'Effect/Tomb.img/land/0'),
    'poison': ('wz', 'Skill/211.img/skill/2111003/icon'),   # 포이즌 미스트
    'rage': ('wz', 'Skill/110.img/skill/1101006/icon'),     # 분노
    'portal': ('wz', 'Map/MapHelper.img/portal/game/pv/default/0'),
}


def save_png(data, name):
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    im.save(os.path.join(ICON, f'{name}.png'), optimize=True)
    return im.size


if __name__ == '__main__':
    os.makedirs(ICON, exist_ok=True)
    for name, src in ICONS.items():
        try:
            if isinstance(src, tuple):
                v = wz(src[1]).get('value')
                data = base64.b64decode(v)
            else:
                data = get(f'{API}/{REG}/{VER}/item/{src}/iconRaw')
            print(name, save_png(data, name))
            if name == 'chaos_coin':  # 일반 코인과 구분되게 보라색으로
                im = Image.open(os.path.join(ICON, 'chaos_coin.png')).convert('RGBA')
                r, g, b, a = im.split()
                hsv = Image.merge('RGB', (r, g, b)).convert('HSV')
                h, sat, val = hsv.split()
                h = h.point(lambda x: (x + 150) % 256)
                im = Image.merge('RGBA', (*Image.merge('HSV', (h, sat, val)).convert('RGB').split(), a))
                im.save(os.path.join(ICON, 'chaos_coin.png'))
        except Exception as e:  # noqa
            print(name, 'FAIL', e)
