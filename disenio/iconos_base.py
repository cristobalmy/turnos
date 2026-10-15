NAVY = "#0f2a4a"; NAVY2 = "#1a4170"; ORO = "#d9b45a"; ORO2 = "#f0d58a"; ROJO = "#c8102e"; AMA = "#f1bf00"
def rama(cx, cy, L, w, ang, color, nudos=2):
    o = [f'<g transform="rotate({ang} {cx} {cy})">', f'<rect x="{cx-w/2}" y="{cy-L/2}" width="{w}" height="{L}" rx="{w*0.22}" fill="{color}"/>']
    n = nudos * 2
    for i in range(n):
        t = (i + 0.8) / (n + 0.6)
        y = cy - L/2 + t * L
        s = -1 if i % 2 == 0 else 1
        x0 = cx + s * w/2 - s*2
        l = w * 0.48; a = w * 0.34; up = l * 0.55
        pts = [(x0, y + a), (x0, y - a), (x0 + s*l, y - a - up), (x0 + s*l, y + a*0.1 - up)]
        o.append('<polygon points="' + " ".join(f"{px:.1f},{py:.1f}" for px, py in pts) + f'" fill="{color}" stroke="{color}" stroke-width="{w*0.12}" stroke-linejoin="round"/>')
    o.append('</g>'); return "\n".join(o)
def cruz(cx, cy, L, w, color=ROJO): return rama(cx, cy, L, w, 45, color) + rama(cx, cy, L, w, -45, color)
fondo = f'<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{NAVY2}"/><stop offset="1" stop-color="{NAVY}"/></linearGradient></defs>'
franja = lambda x, y, w, h: f'<rect x="{x}" y="{y}" width="{w}" height="{h*.25}" fill="{ROJO}"/><rect x="{x}" y="{y+h*.25}" width="{w}" height="{h*.5}" fill="{AMA}"/><rect x="{x}" y="{y+h*.75}" width="{w}" height="{h*.25}" fill="{ROJO}"/>'
morrion = lambda tx, ty, k, c, borde: f'''<g transform="translate({tx} {ty}) scale({k})">
  <path d="M-30 -42 C-26 -100 26 -100 30 -42 C14 -56 -14 -56 -30 -42 Z" fill="{c}" stroke="{borde}" stroke-width="4"/>
  <path d="M-48 12 C-48 -40 -26 -64 0 -66 C26 -64 48 -40 48 12 Z" fill="{c}" stroke="{borde}" stroke-width="4"/>
  <path d="M-118 -22 C-96 20 -54 34 0 34 C54 34 96 20 118 -22 C90 4 52 14 0 14 C-52 14 -90 4 -118 -22 Z" fill="{c}" stroke="{borde}" stroke-width="4"/>
  <path d="M-48 10 C-20 16 20 16 48 10" fill="none" stroke="{borde}" stroke-width="4"/>
</g>'''
A = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{fondo}
<rect width="512" height="512" rx="112" fill="url(#g)"/>{franja(0, 74, 512, 52)}
<circle cx="256" cy="316" r="148" fill="#fdfbf5" stroke="{ORO}" stroke-width="12"/>{cruz(256, 316, 230, 36)}</svg>'''
B = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{fondo}
<rect width="512" height="512" rx="112" fill="#0b1f3a"/>
<path d="M92 64 H420 V246 C420 362 342 424 256 456 C170 424 92 362 92 246 Z" fill="url(#g)" stroke="{ORO}" stroke-width="12"/>
{franja(98, 70, 316, 44)}{cruz(256, 292, 296, 32)}{morrion(256, 300, 1.2, ORO2, "#8a6a22")}</svg>'''
C = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">{fondo}
<rect width="512" height="512" rx="112" fill="url(#g)"/>
<rect x="86" y="108" width="340" height="320" rx="34" fill="#fdfbf5"/>
<path d="M86 142 a34 34 0 0 1 34 -34 H392 a34 34 0 0 1 34 34 V176 H86 Z" fill="{ROJO}"/>
<rect x="86" y="148" width="340" height="16" fill="{AMA}"/>
<rect x="150" y="80" width="26" height="64" rx="13" fill="{ORO}"/><rect x="336" y="80" width="26" height="64" rx="13" fill="{ORO}"/>
{cruz(256, 300, 190, 32)}</svg>'''
for n, s in [("A", A), ("B", B), ("C", C)]: open(f"icono_{n}.svg", "w").write(s)
