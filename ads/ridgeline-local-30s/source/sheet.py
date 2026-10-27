import sys, glob
from PIL import Image, ImageDraw
files=sorted(glob.glob(sys.argv[1]+'/t*.png'), key=lambda f: float(f.split('/t')[-1][:-4]))
cols=int(sys.argv[3]) if len(sys.argv)>3 else 4; w,h=360,640
rows=(len(files)+cols-1)//cols
sheet=Image.new('RGB',(cols*w,rows*h),'black'); d=ImageDraw.Draw(sheet)
for i,f in enumerate(files):
    im=Image.open(f).resize((w,h),Image.LANCZOS); x,y=(i%cols)*w,(i//cols)*h; sheet.paste(im,(x,y)); d.rectangle([x,y,x+90,y+26],fill='black'); d.text((x+6,y+6),f.split('/t')[-1][:-4]+'s',fill='yellow')
sheet.save(sys.argv[2]); print(sheet.size)
