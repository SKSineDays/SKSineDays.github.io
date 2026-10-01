"""Offline asset maintenance: python scripts/prepare-earth-assets.py NASA_SOURCE.jpg.
Source/rights: assets/globe/SOURCES.md. Requires Pillow 12.3.0. No AI imagery.
"""
from PIL import Image
import math,sys
if sys.argv[1] != '--fallback-only':
    im = Image.open(sys.argv[1]).convert('RGB').resize((2048,1024), Image.Resampling.LANCZOS)
    im.save('assets/globe/earth-july-2004.jpg', quality=84, optimize=True)
# Use the delivered JPEG for a faithful static fallback.
im = Image.open('assets/globe/earth-july-2004.jpg').convert('RGB')
out = Image.new('RGBA',(640,640)); src=im.load(); dst=out.load()
tilt=-23.4*math.pi/180; rot=-.8
for y in range(640):
    for x in range(640):
        sx=(x-319.5)/283; sy=-(y-319.5)/283; r=sx*sx+sy*sy
        if r>1:
            rim=max(0,1-(math.sqrt(r)-1)/.035)
            if rim: dst[x,y]=(48,120,220,int(55*rim*rim))
            continue
        sz=math.sqrt(1-r)
        xx=math.cos(tilt)*sx+math.sin(tilt)*sy; yy=-math.sin(tilt)*sx+math.cos(tilt)*sy
        X=math.cos(rot)*xx-math.sin(rot)*sz; Z=math.sin(rot)*xx+math.cos(rot)*sz
        lon=math.atan2(-Z,X); lat=math.asin(max(-1,min(1,yy)))
        u=int((lon/(2*math.pi)+.5)*im.width)%im.width; v=min(im.height-1,int((.5-lat/math.pi)*im.height))
        light=.52+.8*max(0,-.615*sx+.492*sy+.615*sz)
        dst[x,y]=tuple(min(255,int(c*light)) for c in src[u,v])+(255,)
out.save('assets/globe/earth-still.webp',quality=84,method=6)
