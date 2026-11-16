#!/usr/bin/env python3
"""Sync final masters, without encoding. Usage: python3 tools/sync-original-media.py MASTER_ROOT"""
import hashlib, json, pathlib, shutil, sys
site = pathlib.Path(__file__).resolve().parents[1]
master = pathlib.Path(sys.argv[1]).resolve()
manifest = next(p for p in (site/'manifest.json', site/'data.json', site/'player-data.json') if p.exists())
def refs(value):
    if isinstance(value, str): return {value} if value.endswith('.mp4') else set()
    if isinstance(value, dict): value = list(value.values())
    if isinstance(value, list): return set().union(*(refs(v) for v in value))
    return set()
rows = []
for rel in sorted(refs(json.loads(manifest.read_text()))):
    source = master / ('media/' + pathlib.Path(rel).name if manifest.name == 'player-data.json' else rel)
    target = site / rel
    if not source.is_file(): raise FileNotFoundError(source)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    assert hashlib.sha256(target.read_bytes()).hexdigest() == digest
    rows.append({'path': rel, 'bytes': source.stat().st_size, 'sha256': digest})
(site/'original-media.json').write_text(json.dumps({'quality':'original-final-master','reencoded':False,'files':rows},indent=2)+'\n')
print(f'{len(rows)} original files copied and verified; no transcoding.')
