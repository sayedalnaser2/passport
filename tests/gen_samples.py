from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random, sys
random.seed(3)
B='/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
S='/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'
SB='/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
def cd(s):
    w=[7,3,1];t=0
    for i,c in enumerate(s):
        v=0 if c=='<' else int(c) if c.isdigit() else ord(c)-55
        t+=v*w[i%3]
    return str(t%10)
def make(sur,giv,no,dob,sex,exp,iss,cpr,pob,name):
    l1=('P<BHR'+sur+'<<'+giv.replace(' ','<')).ljust(44,'<')
    d=no.ljust(9,'<'); pn=cpr.ljust(14,'<')
    l2=d+cd(d)+'BHR'+dob+cd(dob)+sex+exp+cd(exp)+pn+cd(pn)
    l2+=cd(l2[:10]+l2[13:20]+l2[21:43])
    M=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
    f=lambda x:f"{x[4:6]} {M[int(x[2:4])-1]} / {M[int(x[2:4])-1]} {'19' if int(x[:2])>26 else '20'}{x[:2]}"
    im=Image.new('RGB',(1500,1050),(236,232,218)); dr=ImageDraw.Draw(im)
    dr.rectangle([60,120,360,490],fill=(150,150,160))  # photo
    lab=ImageFont.truetype(S,22); val=ImageFont.truetype(SB,34)
    dr.text((60,40),'KINGDOM OF BAHRAIN',font=ImageFont.truetype(SB,40),fill=(30,30,60))
    def fld(x,y,l,v):
        dr.text((x,y),l,font=lab,fill=(90,90,110)); dr.text((x,y+28),v,font=val,fill=(10,10,10))
    fld(420,120,'Type / النوع','P'); fld(620,120,'Code of State','BHR'); fld(920,120,'Passport No. / رقم الجواز',no)
    fld(420,210,'Surname / اللقب',sur); fld(420,300,'Given Names / الاسم',giv)
    fld(420,390,'Nationality / الجنسية','BAHRAINI'); fld(920,390,'Date of Birth / تاريخ الميلاد',f(dob))
    fld(420,480,'Sex / الجنس',sex); fld(920,480,'Place of Birth / مكان الميلاد',pob)
    fld(420,570,'Date of Issue / تاريخ الإصدار',f(iss)); fld(920,570,'Date of Expiry / تاريخ الانتهاء',f(exp))
    fld(420,660,'Authority / جهة الإصدار','MINISTRY OF INTERIOR'); fld(920,660,'Personal No. / الرقم الشخصي',cpr)
    mf=ImageFont.truetype(B,46)
    dr.text((30,880),l1,font=mf,fill=(10,10,10)); dr.text((30,950),l2,font=mf,fill=(10,10,10))
    im.save(name+'_clean.png')
    im.rotate(3.5,expand=True,fillcolor=(90,80,70),resample=Image.BICUBIC).filter(ImageFilter.GaussianBlur(1.2)).save(name+'_tilt.jpg',quality=60)
    im.rotate(180).save(name+'_upside.png')
    n=im.filter(ImageFilter.GaussianBlur(1.6)); px=n.load()
    for _ in range(60000):
        x=random.randrange(n.width);y=random.randrange(n.height);v=random.randint(80,255);px[x,y]=(v,v,v)
    n.save(name+'_noisy.jpg',quality=40)
    print(l1);print(l2)
make('ALNASER','SAYED AHMED','A1234567','900315','M','310422','210422','123456789','MANAMA','p1')
make('ALKHALIFA','FATIMA MOHAMMED ALI','B7654321','850907','F','290119','190119','850907123','MUHARRAQ','p2')
