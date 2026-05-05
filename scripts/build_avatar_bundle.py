#!/usr/bin/env python3
from __future__ import annotations
from PIL import Image
from pathlib import Path
import json, sys, shutil

BG_RULE = {"g_min": 200, "r_max": 80, "b_max": 150}

# Usage: build_avatar_bundle.py <spec.json>
# Spec shape:
# {
#   "outputDir": "public/avatars/name",
#   "previewGif": "public/previews/name.gif",
#   "name": "Display Name",
#   "version": "0.1.0",
#   "description": "...",
#   "states": {"idle": ["img0.png", "img1.png"], ...},
#   "fps": {"idle": 5, ...}
# }

def crop_green(path: Path) -> Image.Image:
    im = Image.open(path).convert('RGBA')
    px = im.load(); w,h = im.size
    for y in range(h):
        for x in range(w):
            r,g,b,a = px[x,y]
            if g > BG_RULE['g_min'] and r < BG_RULE['r_max'] and b < BG_RULE['b_max']:
                px[x,y] = (0,0,0,0)
    bbox = im.getbbox()
    im = im.crop(bbox) if bbox else im
    scale = min(256 / im.size[0], 256 / im.size[1])
    nw, nh = max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))
    im = im.resize((nw, nh), Image.Resampling.NEAREST)
    canvas = Image.new('RGBA', (256,256), (0,0,0,0))
    canvas.alpha_composite(im, ((256-nw)//2, (256-nh)//2))
    return canvas

def main(spec_path: str) -> int:
    spec = json.loads(Path(spec_path).read_text())
    out = Path(spec['outputDir'])
    preview = Path(spec['previewGif'])
    shutil.rmtree(out, ignore_errors=True)
    (out / 'assets').mkdir(parents=True)
    (out / 'frames').mkdir(parents=True)
    processed = {}
    for state, frames in spec['states'].items():
        for i, img in enumerate(frames):
            key = f'{state}-{i:02d}'
            processed[key] = crop_green(Path(img))
        processed[f'{state}-00'].save(out/'assets'/f'{state}.png')
        for i in range(len(frames)):
            processed[f'{state}-{i:02d}'].save(out/'frames'/f'{state}-{i:02d}.png')
    manifest = {
        'schemaVersion': '0.5.0',
        'name': spec['name'],
        'version': spec['version'],
        'description': spec.get('description',''),
        'defaultState': 'idle',
        'states': {}
    }
    for state, frames in spec['states'].items():
        manifest['states'][state] = {
            'frames': [f'frames/{state}-{i:02d}.png' for i in range(len(frames))],
            'fps': spec['fps'][state],
            'loop': True,
            'fallbackAsset': f'assets/{state}.png'
        }
    (out/'avatar.json').write_text(json.dumps(manifest, indent=2)+'\n')
    seq = []
    for state, frames in spec['states'].items():
        for i in range(len(frames)):
            fr = Image.new('RGBA', (320,320), (12,14,22,255))
            fr.alpha_composite(processed[f'{state}-{i:02d}'].resize((256,256), Image.Resampling.NEAREST), (32,32))
            seq.append(fr.convert('P', palette=Image.Palette.ADAPTIVE))
    preview.parent.mkdir(parents=True, exist_ok=True)
    seq[0].save(preview, save_all=True, append_images=seq[1:], duration=160, loop=0, disposal=2)
    return 0

if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1]))
