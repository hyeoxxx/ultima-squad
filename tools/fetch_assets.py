"""maplestory.io 에서 게임 리소스(아이콘, 캐릭터, 몬스터, 배경)를 받아 assets/ 에 저장한다.

    python tools/fetch_assets.py

KMS 389 데이터 기준 (울티마 스쿼드 전용 리소스는 이 버전에 없어서 원작과 같은 아이템/몬스터/맵을 쓴다).
"""
import base64, hashlib, io, json, os, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'assets')
CACHE = os.environ.get('MSIO_CACHE', os.path.join(ROOT, '.cache'))
API = 'https://maplestory.io/api'
REG, VER = 'KMS', '389'
os.makedirs(CACHE, exist_ok=True)


def get(url, binary=True, tries=4):
    key = os.path.join(CACHE, hashlib.md5(url.encode()).hexdigest())
    if os.path.exists(key):
        data = open(key, 'rb').read()
    else:
        for i in range(tries):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'ultima-squad-fan-game/1.0'})
                with urllib.request.urlopen(req, timeout=90) as r:
                    data = r.read()
                break
            except Exception as e:  # noqa
                if i == tries - 1:
                    raise
                time.sleep(2 * (i + 1))
        open(key, 'wb').write(data)
    return data if binary else json.loads(data.decode('utf-8'))


def wz(path):
    return get(f'{API}/wz/{REG}/{VER}/{urllib.parse.quote(path)}', binary=False)


def wz_val(path, default=None):
    try:
        return wz(path).get('value', default)
    except Exception:
        return default


def save_png(data, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    im.save(path, optimize=True)
    return im.size


# ───────── 장비 아이콘 ─────────
CLS = ['war', 'arch', 'mage']
SLOTS = ['weapon', 'hat', 'glove', 'shoe']
ITEM_IDS = {  # [cls][tier-1] = (weapon, hat, glove, shoe)
    'war': [(1402002, 1002043, 1082000, 1072050), (1402036, 1002551, 1082168, 1072273), (1402047, 1002790, 1082239, 1072361),
            (1402095, 1003172, 1082295, 1072485), (1402196, 1003797, 1082688, 1073138), (1402251, 1004422, 1082636, 1073030),
            (1402259, 1004808, 1082695, 1073158), (1402268, 1005980, 1082695, 1073158)],
    'mage': [(1382017, 1002017, 1082019, 1072023), (1382036, 1002773, 1082164, 1072268), (1382059, 1002791, 1082240, 1072362),
             (1382104, 1003173, 1082296, 1072486), (1382208, 1003798, 1082688, 1073138), (1382259, 1004423, 1082637, 1073032),
             (1382265, 1004809, 1082696, 1073159), (1382274, 1005981, 1082696, 1073159)],
    'arch': [(1452005, 1002057, 1082012, 1072016), (1452044, 1002547, 1082163, 1072269), (1452059, 1002792, 1082241, 1072363),
             (1452111, 1003174, 1082297, 1072487), (1452205, 1003799, 1082688, 1073138), (1452252, 1004424, 1082638, 1073033),
             (1452257, 1004810, 1082697, 1073160), (1452266, 1005982, 1082697, 1073160)],
}


def fetch_icons():
    jobs = []
    for c in CLS:
        for t, ids in enumerate(ITEM_IDS[c], 1):
            for s, iid in zip(SLOTS, ids):
                jobs.append((iid, os.path.join(OUT, 'items', f'{c}_{t}_{s}.png')))
    def one(j):
        iid, path = j
        save_png(get(f'{API}/{REG}/{VER}/item/{iid}/iconRaw'), path)
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(one, jobs))
    print('icons', len(jobs))


# ───────── 캐릭터 (용병) ─────────
LOOK = {
    'war': {'hair': 30030, 'face': 20005, 'outfits': [[1040002, 1060002], [1040002, 1060002, 1004422, 1082636, 1073030], [1005980, 1042433, 1062285, 1082695, 1073158]],
            'actions': {'stand': 'stand2', 'attack': 'swingT1', 'hit': 'alert'}},
    'arch': {'hair': 31000, 'face': 21000, 'outfits': [[1041002, 1061002], [1041002, 1061002, 1004424, 1082638, 1073033], [1005982, 1042435, 1062287, 1082697, 1073160]],
             'actions': {'stand': 'stand1', 'attack': 'shoot1', 'hit': 'alert'}},
    'mage': {'hair': 30000, 'face': 20000, 'outfits': [[1040002, 1060002], [1040002, 1060002, 1004423, 1082637, 1073032], [1005981, 1042434, 1062286, 1082696, 1073159]],
             'actions': {'stand': 'stand1', 'attack': 'swingO1', 'hit': 'alert'}},
}
FRAMES = {'stand': 3, 'attack': 3, 'hit': 3}


def char_url(ids, action, frame):
    seg = ','.join(urllib.parse.quote(json.dumps({'itemId': i, 'version': VER, 'region': REG}, separators=(',', ':'))) for i in ids)
    return f'{API}/character/{seg}/{action}/{frame}?showears=false&renderMode=FeetCenter'


def fetch_chars():
    jobs = []
    for c, L in LOOK.items():
        for o, outfit in enumerate(L['outfits']):
            for w in range(0, 9):
                ids = [2000, 12000, L['hair'], L['face']] + outfit + ([ITEM_IDS[c][w - 1][0]] if w else [])
                for key, act in L['actions'].items():
                    for f in range(FRAMES[key]):
                        jobs.append((char_url(ids, act, f), os.path.join(OUT, 'chars', c, f'o{o}w{w}', f'{key}{f}.png')))
    done = [0]
    def one(j):
        url, path = j
        if not os.path.exists(path):
            save_png(get(url), path)
        done[0] += 1
        if done[0] % 100 == 0:
            print('  chars', done[0], '/', len(jobs), flush=True)
    with ThreadPoolExecutor(6) as ex:
        list(ex.map(one, jobs))
    print('chars', len(jobs))


# ───────── 몬스터 ─────────
# 지역별 맵: (배경 맵 ID, 일반 몬스터 ID 또는 None=맵에서 자동, 스테이지 보스 ID)
MAPS = [
    [(100010000, None, 6130101), (240010200, None, 8150302), (270010100, 8200003, 8200012), (270010500, None, 8820001)],
    [(450001010, 8641000, 8641006), (450002006, 8642006, 8642007), (450005100, 8644001, 8644010), (450005000, None, 8644011)],
    [(410000520, 8645123, 8645135), (410003040, 8645200, 8645209), (410007006, None, 8645307), (410007010, None, 8645300)],
]
MOB_ACTIONS = {'stand': ['stand', 'move', 'fly'], 'move': ['move', 'fly', 'stand'], 'attack': ['attack1', 'attack2', 'skill1'], 'hit': ['hit1'], 'die': ['die1']}
MAX_FRAMES = 10


def map_mobs(mid):
    try:
        info = get(f'{API}/{REG}/{VER}/map/{mid}', binary=False)
    except Exception:
        return [], None
    seen = []
    for m in info.get('mobs') or []:
        if m['id'] not in seen:
            seen.append(m['id'])
    return seen, info


def fetch_mob(mid):
    base = f'Mob/{mid:07d}.img'
    try:
        node = wz(base)
    except Exception:
        return None
    kids = node.get('children', [])
    # info/link 로 다른 몹 리소스를 쓰는 경우
    link = wz_val(f'{base}/info/link') if 'info' in kids else None
    if link and not any(a in kids for a in ('stand', 'move', 'fly')):
        base = f'Mob/{int(link):07d}.img'
        kids = wz(base).get('children', [])
    meta = {}
    for key, cands in MOB_ACTIONS.items():
        act = next((a for a in cands if a in kids), None)
        if not act:
            continue
        frames = sorted([k for k in wz(f'{base}/{act}').get('children', []) if k.isdigit()], key=int)
        if len(frames) > MAX_FRAMES:
            step = len(frames) / MAX_FRAMES
            frames = [frames[int(i * step)] for i in range(MAX_FRAMES)]
        out = []
        for i, fr in enumerate(frames):
            n = wz(f'{base}/{act}/{fr}')
            data = n.get('value')
            png = base64.b64decode(data) if isinstance(data, str) and data else get(f'{API}/{REG}/{VER}/mob/{mid}/render/{act}/{fr}')
            path = os.path.join(OUT, 'mobs', str(mid), f'{key}{i}.png')
            w, h = save_png(png, path)
            o = wz_val(f'{base}/{act}/{fr}/origin', {'x': w // 2, 'y': h}) or {'x': w // 2, 'y': h}
            d = wz_val(f'{base}/{act}/{fr}/delay', 120) or 120
            out.append({'ox': o['x'], 'oy': o['y'], 'd': d, 'w': w, 'h': h})
        meta[key] = out
    if 'stand' not in meta and 'move' in meta:
        meta['stand'] = meta['move']
    json.dump(meta, open(os.path.join(OUT, 'mobs', str(mid), 'meta.json'), 'w'))
    return meta


# ───────── 배경 ─────────
VW, VH = 1000, 400


def back_image(bS, no, ani):
    kind = 'ani' if ani else 'back'
    path = f'Map/Back/{bS}.img/{kind}/{no}' + ('/0' if ani else '')
    n = wz(path)
    data = n.get('value')
    if not isinstance(data, str) or not data:
        return None, (0, 0)
    im = Image.open(io.BytesIO(base64.b64decode(data))).convert('RGBA')
    o = wz_val(f'{path}/origin', {'x': 0, 'y': 0}) or {'x': 0, 'y': 0}
    return im, (o['x'], o['y'])


def fetch_background(mid, out):
    area = 'Map' + str(mid)[0]
    base = f'Map/Map/{area}/{mid:09d}.img/back'
    try:
        layers = sorted([k for k in wz(base).get('children', []) if k.isdigit()], key=int)
    except Exception as e:
        print('  bg fail', mid, e)
        return False
    _, info = map_mobs(mid)
    vr = (info or {}).get('vrBounds') or {}
    fh = (info or {}).get('footholds') or {}
    # 카메라: 맵 가로 중앙, 지면이 화면 아래쪽(310px)에 오도록
    cam_x = ((vr.get('left', -500) + vr.get('right', 500)) // 2) if vr else 0
    ground = vr.get('bottom', 300) - 120 if vr else 200
    cam_y = ground - (310 - VH // 2)
    canvas = Image.new('RGBA', (VW, VH), (120, 170, 220, 255))
    for k in layers:
        p = f'{base}/{k}'
        def v(name, d=0):
            return wz_val(f'{p}/{name}', d)
        if v('front'):
            continue
        bS = v('bS', '')
        if not bS:
            continue
        try:
            im, (ox, oy) = back_image(bS, v('no'), v('ani'))
        except Exception:
            continue
        if im is None:
            continue
        if v('f'):
            im = im.transpose(Image.FLIP_LEFT_RIGHT); ox = im.width - ox
        a = v('a', 255)
        if a is not None and a < 255:
            alpha = im.getchannel('A').point(lambda x: x * a // 255)
            im.putalpha(alpha)
        x, y, rx, ry, cx, cy, t = v('x'), v('y'), v('rx'), v('ry'), v('cx'), v('cy'), v('type')
        # 시차: rx/ry 가 -100 이면 화면에 고정, 0 이면 월드에 고정 (근사)
        sx = VW / 2 + x - ox - cam_x * (100 + rx) / 100
        sy = VH / 2 + y - oy - cam_y * (100 + ry) / 100
        tw = cx or im.width
        th = cy or im.height
        htile = t in (1, 3, 4, 6)
        vtile = t in (2, 3, 5, 7)
        xs = [sx]
        ys = [sy]
        if htile and tw > 0:
            start = sx - ((sx // tw) + 1) * tw
            xs = [start + i * tw for i in range(int(VW / tw) + 3)]
        if vtile and th > 0:
            start = sy - ((sy // th) + 1) * th
            ys = [start + i * th for i in range(int(VH / th) + 3)]
        for yy in ys:
            for xx in xs:
                canvas.alpha_composite(im, (int(xx), int(yy))) if 0 <= int(xx) and 0 <= int(yy) else canvas.paste(im, (int(xx), int(yy)), im)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    canvas.convert('RGB').save(out, quality=85)
    return True


def main():
    os.makedirs(OUT, exist_ok=True)
    what = sys.argv[1:] or ['icons', 'chars', 'mobs', 'bgs']
    if 'icons' in what:
        fetch_icons()
    manifest = {'maps': []}
    if 'mobs' in what or 'bgs' in what:
        for r, region in enumerate(MAPS):
            row = []
            for m, (mid, mob, boss) in enumerate(region):
                found, info = map_mobs(mid)
                if mob is None and m < 3:
                    mob = found[0] if found else None
                if boss is None and m < 3:
                    boss = found[1] if len(found) > 1 else (found[0] if found else None)
                ent = {'map': mid, 'mapName': (info or {}).get('name'), 'mob': mob if m < 3 else None, 'boss': boss}
                if 'bgs' in what:
                    ent['bg'] = fetch_background(mid, os.path.join(OUT, 'maps', f'{r}_{m}.jpg'))
                row.append(ent)
                print('map', r, m, ent, flush=True)
            manifest['maps'].append(row)
        mobs = {}
        if 'mobs' in what:
            ids = sorted({e[k] for row in manifest['maps'] for e in row for k in ('mob', 'boss') if e.get(k)})
            names = {x['id']: x.get('name') for x in get(f'{API}/{REG}/{VER}/mob', binary=False) if x.get('name')}
            for mid in ids:
                meta = fetch_mob(mid)
                mobs[mid] = {'name': names.get(mid), 'ok': bool(meta)}
                print('mob', mid, names.get(mid), 'ok' if meta else 'FAIL', flush=True)
            manifest['mobs'] = mobs
        json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if 'chars' in what:
        fetch_chars()


if __name__ == '__main__':
    main()
