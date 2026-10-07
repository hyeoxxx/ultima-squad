"""원작 사운드(스킬, 몬스터, 게임 효과음, 맵 BGM)를 maplestory.io (KMS 389 Sound.wz) 에서 받아 assets/sound/ 에 저장한다.

    python tools/fetch_sounds.py
"""
import base64, json, os, re, struct, sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))
from fetch_assets import wz, get, OUT, API, REG, VER, MAPS  # noqa: E402
from fetch_skills import SKILL_IDS  # noqa: E402

SND = os.path.join(OUT, 'sound')
GAME = ['LevelUp', 'PickUpItem', 'DropItem', 'Portal', 'Tombstone', 'QuestClear', 'EnchantSuccess', 'EnchantFailure', 'Buff']


def sound_bytes(path):
    """WZ 사운드 노드 → 재생 가능한 파일 바이트 (mp3 또는 wav)."""
    n = wz(path)
    v = n.get('value')
    if not isinstance(v, str) or not v:
        return None, None
    b = base64.b64decode(v)
    # WZ 사운드 헤더: 51바이트 뒤에 WAVEFORMATEX 길이(1바이트)와 본체가 오고, 그 뒤가 오디오 데이터
    size = b[51]
    fmt = b[52:52 + size]
    tag, ch, rate, byterate, align, bits = struct.unpack('<HHIIHH', fmt[:16])
    data = b[52 + size:]
    if tag == 0x55:  # MP3
        return data, 'mp3'
    if tag == 1:  # PCM → WAV 로 감싼다
        hdr = b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, ch, rate, byterate, align, bits) + b'data' + struct.pack('<I', len(data))
        return hdr + data, 'wav'
    return None, None


def save(path, out_base):
    try:
        data, ext = sound_bytes(path)
    except Exception:
        return None
    if not data:
        return None
    os.makedirs(os.path.dirname(out_base), exist_ok=True)
    open(f'{out_base}.{ext}', 'wb').write(data)
    return f'{os.path.relpath(out_base, OUT).replace(os.sep, "/")}.{ext}'


def main():
    man = {'skill': {}, 'mob': {}, 'game': {}, 'bgm': {}}
    jobs = []
    for key, sid in SKILL_IDS.items():
        for kind in ('Use', 'Hit'):
            jobs.append(('skill', key, kind, f'Sound/Skill.img/{sid:07d}/{kind}', os.path.join(SND, 'skill', f'{key}_{kind}')))
    mobs = json.load(open(os.path.join(OUT, 'manifest.json'), encoding='utf-8')).get('mobs', {})
    for mid in mobs:
        for kind in ('Damage', 'Die'):
            jobs.append(('mob', mid, kind, f'Sound/Mob.img/{int(mid):07d}/{kind}', os.path.join(SND, 'mob', f'{mid}_{kind}')))
    for g in GAME:
        jobs.append(('game', g, None, f'Sound/Game.img/{g}', os.path.join(SND, 'game', g)))
    # 맵 BGM
    for r, region in enumerate(MAPS):
        for m, (mid, _, _) in enumerate(region):
            try:
                bgm = get(f'{API}/{REG}/{VER}/map/{mid}', binary=False).get('backgroundMusic')
            except Exception:
                bgm = None
            if bgm and '/' in bgm:
                img, name = bgm.split('/', 1)
                jobs.append(('bgm', f'{r}_{m}', bgm, f'Sound/{img}.img/{name}', os.path.join(SND, 'bgm', re.sub(r'[^A-Za-z0-9_.-]', '', bgm.replace('/', '_').replace(' ', '_')))))

    def one(j):
        cat, key, kind, path, out = j
        return cat, key, kind, save(path, out)

    with ThreadPoolExecutor(8) as ex:
        for cat, key, kind, f in ex.map(one, jobs):
            if not f:
                continue
            if cat in ('skill', 'mob'):
                man[cat].setdefault(key, {})[kind] = f
            elif cat == 'game':
                man['game'][key] = f
            else:
                man['bgm'][key] = f
    json.dump(man, open(os.path.join(SND, 'sounds.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print({k: len(v) for k, v in man.items()})


if __name__ == '__main__':
    main()
