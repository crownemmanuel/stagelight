# Full-bleed app icon from the StageLight tile art. Usage: python3 scripts/make-app-icon.py <master.png> <app-icon.png> <preview.png>
# Keeps the spotlight and beam and repaints the navy background as the tile's own vertical gradient, edge to edge.
import sys
from PIL import Image, ImageFilter, ImageDraw
import numpy as np
src,out_png,preview=sys.argv[1:]
im=np.array(Image.open(src).convert('RGBA')).astype(float)
a=im[:,:,3];ys,xs=np.where(a>8);x0,x1,y0,y1=xs.min(),xs.max(),ys.min(),ys.max()
t=im[y0:y1+1,x0:x1+1];H,W=t.shape[:2]
rgb=t[:,:,:3];opaque=t[:,:,3]>250
inside=np.array(Image.fromarray(opaque.astype(np.uint8)*255).filter(ImageFilter.MinFilter(51)))>0
bright=(rgb.sum(axis=2)>200)&inside
m=Image.fromarray(np.where(bright,0,255).astype(np.uint8)).copy();ImageDraw.floodfill(m,(0,0),128)
content=np.array(m)!=128
# Background colour per row: navy pixels well away from the art and the tile edge.
near=np.array(Image.fromarray(content.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(41)))>0
navy=inside&~near&(rgb[:,:,2]>rgb[:,:,0]+20)
bg=np.zeros((H,3));prev=None
for y in range(H):
    m=navy[y]
    if m.sum()>20:prev=np.median(rgb[y][m],axis=0)
    bg[y]=prev if prev is not None else np.nan
ok=~np.isnan(bg[:,0]);idx=np.arange(H)
for c in range(3):bg[:,c]=np.interp(idx,idx[ok],bg[ok,c])
k=25;pad=np.vstack([np.repeat(bg[:1],k,0),bg,np.repeat(bg[-1:],k,0)]);bg=np.array([pad[i:i+2*k+1].mean(axis=0) for i in range(H)])
print('content fraction',round(float(content.mean()),3))
cm=Image.fromarray(content.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(1.5))
w=(np.array(cm)/255.0)[...,None]
out=rgb*w+bg[:,None,:]*(1-w)
side=max(H,W);canvas=np.zeros((side,side,3));oy,ox=(side-H)//2,(side-W)//2
canvas[:]=bg[-1];canvas[:oy+1]=bg[0];canvas[oy:oy+H,:]=bg[:,None,:];canvas[oy:oy+H,ox:ox+W]=out
img=Image.fromarray(np.clip(canvas,0,255).astype(np.uint8),'RGB')
img.resize((1024,1024),Image.LANCZOS).save(out_png)
img.resize((400,400),Image.LANCZOS).save(preview)
