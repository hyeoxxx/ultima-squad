"""원작 스킬 아이콘/이펙트를 maplestory.io (KMS 389 Skill.wz) 에서 받아 assets/skills/ 에 저장한다.

    python tools/fetch_skills.py
"""
import base64, io, json, os, sys
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from fetch_assets import wz, wz_val, OUT  # noqa: E402

# 울티마 스쿼드 스킬 → 같은 이름의 메이플 스킬 ID
SKILL_IDS = {
    'slash_blast': 1001005, 'aura_blade': 1111016, 'iron_body': 1000003, 'blessed_hammer': 400011052,
    'divide': 151121000, 'invincible_belief': 252, 'demon_bane': 400011110,
    'arrow_blow': 3001004, 'charged_arrow': 400031025, 'storm_arrow': 3121020, 'vortex_sphere': 400031058,
    'soul_contract': 60011219, 'elemental_ghost': 400031007, 'dragon_burst': 400031061,
    'energy_bolt': 2001008, 'chain_lightning': 2221006, 'heal': 2301002, 'heavens_door': 2321052,
    'flame_sweep': 2121006, 'pray': 400021003, 'zodiac_ray': 400021073,
}
KINDS = ['effect', 'hit', 'ball', 'keydown']
MAX_FRAMES = 14
MAX_SIDE = 420  # 너무 큰 이펙트는 줄인다


def canvas(path):
    try:
        n = wz(path)
    except Exception:
        return {}, None
    v = n.get('value')
    if isinstance(v, str) and v:
        return n, v
    return n, None


def frames_of(base):
    """base 아래에서 프레임 목록(경로)을 찾는다. effect/0.. 또는 hit/0/0.. 형태."""
    try:
        n = wz(base)
    except Exception:
        return []
    kids = sorted([k for k in n.get('children', []) if k.isdigit()], key=int)
    if not kids:
        return []
    _, v = canvas(f'{base}/{kids[0]}')
    if v:
        return [f'{base}/{k}' for k in kids]
    return frames_of(f'{base}/{kids[0]}')


def fetch_skill(key, sid):
    job = sid // 10000
    base = f'Skill/{job:03d}.img/skill/{sid:07d}' if sid < 10000000 else f'Skill/{job}.img/skill/{sid}'
    out = os.path.join(OUT, 'skills', key)
    os.makedirs(out, exist_ok=True)
    meta = {'id': sid}
    _, icon = canvas(f'{base}/icon')
    if icon:
        Image.open(io.BytesIO(base64.b64decode(icon))).save(os.path.join(out, 'icon.png'))
    for kind in KINDS:
        paths = frames_of(f'{base}/{kind}')
        if not paths:
            continue
        if len(paths) > MAX_FRAMES:
            step = len(paths) / MAX_FRAMES
            paths = [paths[int(i * step)] for i in range(MAX_FRAMES)]
        frames = []
        for i, p in enumerate(paths):
            _, v = canvas(p)
            if not v:
                continue
            im = Image.open(io.BytesIO(base64.b64decode(v))).convert('RGBA')
            o = wz_val(f'{p}/origin', {'x': im.width // 2, 'y': im.height // 2}) or {'x': im.width // 2, 'y': im.height // 2}
            d = wz_val(f'{p}/delay', 90) or 90
            k = min(1, MAX_SIDE / max(im.width, im.height))
            if k < 1:
                im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
            im.save(os.path.join(out, f'{kind}{len(frames)}.png'), optimize=True)
            frames.append({'ox': round(o['x'] * k), 'oy': round(o['y'] * k), 'd': d, 'w': im.width, 'h': im.height})
        if frames:
            meta[kind] = frames
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'))
    return key, {k: len(v) for k, v in meta.items() if isinstance(v, list)}


if __name__ == '__main__':
    with ThreadPoolExecutor(7) as ex:
        def safe(kv):
            try:
                return fetch_skill(*kv)
            except Exception as e:  # noqa
                return kv[0], f'FAIL {e}'
        for key, info in ex.map(safe, SKILL_IDS.items()):
            print(key, info, flush=True)
