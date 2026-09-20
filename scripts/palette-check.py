"""Validate the palettes in src/ui/theme.ts: WCAG contrast for every text-on-background pair the UI uses, and
pairwise colour difference of the four status hues under protan/deutan/tritan simulation
(Machado 2009, severity 1.0). Run: python3 scripts/palette-check.py  (CI runs it too). Fails loudly so a bad colour never ships by eye.
L* gaps are printed for information only; the hard rules are contrast >= 4.5 and dE >= 15 under every simulation."""
import sys, json

def hex2rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) / 255 for i in (0, 2, 4))
def lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def delin(c):
    c = max(0, min(1, c)); return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055
def luminance(rgb):
    r, g, b = (lin(c) for c in rgb); return 0.2126 * r + 0.7152 * g + 0.0722 * b
def contrast(a, b):
    la, lb = luminance(a), luminance(b); hi, lo = max(la, lb), min(la, lb); return (hi + 0.05) / (lo + 0.05)

MACHADO = {
    'protan': [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    'deutan': [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
    'tritan': [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
}
def simulate(rgb, kind):
    if kind == 'normal': return rgb
    l = [lin(c) for c in rgb]; m = MACHADO[kind]
    return tuple(delin(sum(m[i][j] * l[j] for j in range(3))) for i in range(3))

def to_lab(rgb):
    r, g, b = (lin(c) for c in rgb)
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 1.0
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = f(x), f(y), f(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))
def de76(a, b):
    la, lb = to_lab(a), to_lab(b); return sum((p - q) ** 2 for p, q in zip(la, lb)) ** 0.5

def check(name, P):
    ok = True
    print(f'== {name}')
    # text pairs the UI actually renders
    pairs = [
        ('ink on bg', P['ink'], P['bg']), ('ink on panel', P['ink'], P['panel']), ('ink2 on panel', P['ink2'], P['panel']),
        ('ink3 on panel (small text)', P['ink3'], P['panel']), ('ink3 on panelAlt', P['ink3'], P['panelAlt']),
        ('onAccent on accent (buttons)', P['onAccent'], P['accent']), ('accent on accentSoft', P['accent'], P['accentSoft']),
        ('accent on panel (quiet buttons)', P['accent'], P['panel']),
        ('indigo on indigoSoft', P['indigo'], P['indigoSoft']), ('amber on amberSoft', P['amber'], P['amberSoft']),
        ('teal on tealSoft', P['teal'], P['tealSoft']), ('slate on slateSoft', P['slate'], P['slateSoft']),
        ('indigo on panel', P['indigo'], P['panel']), ('amber on panel', P['amber'], P['panel']),
        ('teal on panel', P['teal'], P['panel']), ('slate on panel', P['slate'], P['panel']),
        ('ink on amberSoft', P['ink'], P['amberSoft']), ('ink on tealSoft', P['ink'], P['tealSoft']), ('ink on slateSoft', P['ink'], P['slateSoft']),
        ('ink on accentSoft', P['ink'], P['accentSoft']), ('ink2 on slateSoft', P['ink2'], P['slateSoft']),
    ]
    for label, fg, bg in pairs:
        c = contrast(hex2rgb(fg), hex2rgb(bg)); flag = 'ok ' if c >= 4.5 else 'LOW'
        if c < 4.5: ok = False
        print(f'  {flag} {label:36s} {c:5.2f}')
    hues = {k: hex2rgb(P[k]) for k in ('indigo', 'amber', 'teal', 'slate')}
    for kind in ('normal', 'protan', 'deutan', 'tritan'):
        sim = {k: simulate(v, kind) for k, v in hues.items()}
        worst = min((de76(sim[a], sim[b]), a, b) for a in sim for b in sim if a < b)
        flag = 'ok ' if worst[0] >= 15 else 'LOW'
        if worst[0] < 15: ok = False
        print(f'  {flag} status hues under {kind:7s} min dE {worst[0]:5.1f} ({worst[1]} vs {worst[2]})')
    # lightness ordering must also separate them (the second channel besides hue)
    Ls = sorted((to_lab(hex2rgb(P[k]))[0], k) for k in ('indigo', 'amber', 'teal', 'slate'))
    gaps = [(Ls[i + 1][0] - Ls[i][0], Ls[i][1], Ls[i + 1][1]) for i in range(3)]
    for g, a, b in gaps:
        flag = 'ok ' if g >= 6 else 'LOW'
        print(f'  {flag} L* gap {a}->{b} {g:5.1f}')
    return ok


import re, pathlib
src = pathlib.Path(__file__).resolve().parent.parent.joinpath('src/ui/theme.ts').read_text()
def read(name):
    block = re.search(name + r": \{(.*?)\n  \},", src, re.S).group(1)
    return dict(re.findall(r"(\w+): '(#[0-9A-Fa-f]{6})'", block))
ok = all([check('light', read('light')), check('dark', read('dark'))])
print('PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
