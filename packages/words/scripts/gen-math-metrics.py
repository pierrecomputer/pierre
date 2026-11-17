# Write tables/math-metrics.txt from STIX Two Math (SIL Open Font License 1.1):
#   python3 scripts/gen-math-metrics.py <path to STIXTwoMath.otf>
# It needs fontTools. Each line: code point, then depth, height, italic
# correction, advance width, and top accent position less half the width, in
# thousandths of an em.
import pathlib
import re
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

font = TTFont(sys.argv[1])
cmap = font.getBestCmap()
glyphs = font.getGlyphSet()
math = font['MATH'].table.MathGlyphInfo
italic = dict(zip(math.MathItalicsCorrectionInfo.Coverage.glyphs,
                  (v.Value for v in math.MathItalicsCorrectionInfo.ItalicsCorrection)))
accent = dict(zip(math.MathTopAccentAttachment.TopAccentCoverage.glyphs,
                  (v.Value for v in math.MathTopAccentAttachment.TopAccentAttachment)))

here = pathlib.Path(__file__).parent
wanted = set(range(0x20, 0x7f)) | set(range(0x391, 0x3f6)) | set(range(0x2c6, 0x2dd))
wanted |= {0xa0, 0xa3, 0xa5, 0xa7, 0xa8, 0xac, 0xaf, 0xb0, 0xb1, 0xb4, 0xb6, 0xb7,
           0xd7, 0xf0, 0xf7, 0x127, 0x131, 0x237}
wanted |= set(range(0x2016, 0x2038)) | set(range(0x2100, 0x2150)) | set(range(0x2190, 0x2300))
wanted |= set(range(0x2308, 0x230c)) | set(range(0x27e8, 0x27f0)) | set(range(0x27f5, 0x27fd))
# bold, italic, bold italic, script, fraktur, double-struck, sans-serif and
# monospace letters; bold, italic and bold italic Greek; styled digits
for start, end in [(0x1d400, 0x1d4d0), (0x1d504, 0x1d56c), (0x1d5a0, 0x1d5d4),
                   (0x1d670, 0x1d6a4), (0x1d6a8, 0x1d756), (0x1d7ce, 0x1d7ec),
                   (0x1d7f6, 0x1d800)]:
    wanted |= set(range(start, end))
for value in re.findall(r':([0-9a-f]+)', (here / '../tables/math.txt').read_text()):
    if int(value, 16) >= 0x80:
        wanted.add(int(value, 16))

lines = []
for cp in sorted(wanted):
    name = cmap.get(cp)
    if name is None:
        continue
    pen = BoundsPen(glyphs)
    glyphs[name].draw(pen)
    _, y0, _, y1 = pen.bounds or (0, 0, 0, 0)
    width = font['hmtx'][name][0]
    lines.append(f'{cp} {-y0} {y1} {italic.get(name, 0)} {width} '
                 f'{accent.get(name, width // 2) - width // 2}')
(here / '../tables/math-metrics.txt').write_text('\n'.join(lines) + '\n')
