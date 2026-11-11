"""Developer-only: reproduce the bundled OFL font (requires fonttools)."""
from io import BytesIO
from pathlib import Path
import hashlib
import urllib.request
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools import subset

REVISION = '5bb28733cec313b63fbd415b574b5ae35c8aa8b8'
BASE = f'https://raw.githubusercontent.com/google/fonts/{REVISION}/ofl/notosanssc/'
root = Path(__file__).resolve().parent.parent / 'assets' / 'panel'
root.mkdir(parents=True, exist_ok=True)
with urllib.request.urlopen(BASE + 'NotoSansSC%5Bwght%5D.ttf', timeout=60) as response:
    source = response.read(32 * 1024 * 1024)
font = instantiateVariableFont(TTFont(BytesIO(source)), {'wght': 400}, inplace=True)
options = subset.Options()
options.hinting = False
subsetter = subset.Subsetter(options=options)
subsetter.populate(unicodes=list(range(0x20, 0x7f)) + list(range(0x3000, 0x3040)) + list(range(0x4e00, 0xa000)) + list(range(0xff00, 0xfff0)) + [0x2026, 0x00b7])
subsetter.subset(font)
names = {1: 'Fatfish Panel Sans', 2: 'Regular', 4: 'Fatfish Panel Sans Regular', 6: 'FatfishPanelSans-Regular', 16: 'Fatfish Panel Sans', 17: 'Regular'}
for record in font['name'].names:
    if record.nameID in names:
        record.string = names[record.nameID].encode(record.getEncoding())
font.save(root / 'FatfishPanelSans.ttf')
with urllib.request.urlopen(BASE + 'OFL.txt', timeout=30) as response:
    (root / 'OFL.txt').write_bytes(('\n'.join(line.rstrip() for line in response.read().decode('utf-8').splitlines()) + '\n').encode('utf-8'))
(root / 'NOTICE.md').write_bytes(f'# Fatfish Panel Sans\n\nDerived from Noto Sans SC, Google Fonts commit `{REVISION}`.\nSource SHA-256: `{hashlib.sha256(source).hexdigest()}`.\n\nSubset to Latin, basic CJK and punctuation; instantiated at weight 400 and renamed.\nLicensed under SIL Open Font License 1.1; see OFL.txt.\nRebuild with `python scripts/build-panel-font.py` after installing fonttools.\n'.encode('utf-8'))
print(f'Bundled font: {(root / "FatfishPanelSans.ttf").stat().st_size} bytes')
