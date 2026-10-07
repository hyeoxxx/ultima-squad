"""맵이 실제로 쓰는 발판 타일셋(Map.wz/Tile)으로 지면 띠 이미지를 만든다.

    python tools/fetch_tiles.py

결과: assets/maps/{지역}_{맵}_ground.png  (가로 1000, 발판 선은 위에서 FOOT px)
"""
import base64, io, json, os, sys
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from fetch_assets import wz, wz_val, OUT, MAPS  # noqa: E402

W, H, FOOT = 1000, 170, 60
# 타일 대신 오브젝트로 지형을 만든 맵은 분위기가 비슷한 타일셋으로 대신한다
FALLBACK = {'0_2': 'whiteMarble', '0_3': 'whiteMarble', '1_0': 'dryRock2', '1_1': 'goldBeach1', '2_0': 'cernium3', '2_1': 'dayDesert', '2_2': 'neoCity', '2_3': 'whiteMarble2'}


def tileset(mid):
    area = 'Map' + str(mid)[0]
    base = f'Map/Map/{area}/{mid:09d}.img'
    for layer in range(8):
        ts = wz_val(f'{base}/{layer}/info/tS')
        if ts:
            return ts
    return None


def frames(ts, kind):
    out = []
    try:
        kids = sorted([k for k in wz(f'Map/Tile/{ts}.img/{kind}').get('children', []) if k.isdigit()], key=int)
    except Exception:
        return out
    for k in kids:
        n = wz(f'Map/Tile/{ts}.img/{kind}/{k}')
        v = n.get('value')
        if not isinstance(v, str) or not v:
            continue
        im = Image.open(io.BytesIO(base64.b64decode(v))).convert('RGBA')
        o = wz_val(f'Map/Tile/{ts}.img/{kind}/{k}/origin', {'x': 0, 'y': 0}) or {'x': 0, 'y': 0}
        out.append((im, o['x'], o['y']))
    return out


def build(mid, out, key=None):
    ts = tileset(mid) or FALLBACK.get(key)
    if not ts:
        return None
    bsc, top = frames(ts, 'bsc'), frames(ts, 'enH0')
    if not top:
        return ts, False
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    if bsc:
        im0 = bsc[0][0]
        i = 0
        for y in range(FOOT, H, im0.height):
            for x in range(0, W, im0.width):
                im = bsc[i % len(bsc)][0]; i += 1
                canvas.alpha_composite(im, (x, y)) if x + im.width <= W and y + im.height <= H else canvas.paste(im, (x, y), im)
    x, i = 0, 0
    while x < W:
        im, ox, oy = top[i % len(top)]; i += 1
        px, py = x - ox, FOOT - oy
        canvas.paste(im, (px, py), im)
        x += im.width
    canvas.save(out, optimize=True)
    return ts, True


def surface(path):
    """보이는 발판 윗면: 가로의 60% 이상이 채워지는 첫 줄"""
    a = Image.open(path).convert('RGBA').getchannel('A')
    for y in range(a.height):
        row = [a.getpixel((x, y)) for x in range(0, a.width, 4)]
        if sum(1 for v in row if v > 128) / len(row) > 0.6:
            return y
    return FOOT


if __name__ == '__main__':
    info = {}
    for r, region in enumerate(MAPS):
        for m, (mid, _, _) in enumerate(region):
            res = build(mid, os.path.join(OUT, 'maps', f'{r}_{m}_ground.png'), f'{r}_{m}')
            info[f'{r}_{m}'] = {'tileset': res and res[0], 'ok': bool(res and res[1])}
            if res and res[1]:
                info[f'{r}_{m}']['surface'] = surface(os.path.join(OUT, 'maps', f'{r}_{m}_ground.png'))
            print(r, m, mid, info[f'{r}_{m}'], flush=True)
    json.dump({'foot': FOOT, 'maps': info}, open(os.path.join(OUT, 'maps', 'ground.json'), 'w'), indent=1)
