#!/usr/bin/env python3
"""Generate prospek bulanan: NAMA | NO HP | REFERRAL, anti-dobel mandiri."""
import argparse, json, random, re, sys
from pathlib import Path
import pandas as pd

BASE=Path(__file__).resolve().parent
DB=BASE/'gudang'/'DATABASE_GABUNGAN.xlsx'
OUTPUT=BASE/'output'
TRACK=OUTPUT/'monthly_used.json'
REFERRALS=['64045515203','67309215203','65890015203','63405015203','64859215203','55085915203']
NON_PERSON=['UD','CV','PT','PTS','YAYASAN','UPTD','KANTOR','DINAS','KELURAHAN','DESA','KOPERASI','KUD','BUMDES','BADAN','KECAMATAN','SEKRETARIAT','PEMERINTAH','UPT','BKKBN','PUSKESMAS','SDN','SMPN','SMAN','SMKN','TK','PAUD','PKK','POLSEK','KORAMIL','KUA','MTS','MIS','MIN','PONPES','RSUD','RS','PERTAMINA','TELKOM','PLN','BANK','KPRI','BNI','BRI','MANDIRI','BTN','BPD']

def clean_hp(v):
    s=re.sub(r'\D','',str(v))
    return s if 11<=len(s)<=13 else None

def person(v):
    n=str(v).strip().upper()
    return bool(n) and not any(n.startswith(x) for x in NON_PERSON)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--jumlah',type=int,required=True);ap.add_argument('--out',required=True);ap.add_argument('--referral',choices=REFERRALS);a=ap.parse_args()
    if not 1<=a.jumlah<=300: sys.exit('Jumlah harus 1-300')
    if not DB.exists(): sys.exit('DATABASE_GABUNGAN.xlsx tidak ada')
    track=json.loads(TRACK.read_text()) if TRACK.exists() else {'used_hp':[],'batches':[]}
    df=pd.read_excel(DB,dtype=str);df.columns=[str(c).strip().upper() for c in df.columns]
    df=df[df['NAMA'].map(person)].copy();df['__hp']=df['NO_HP'].map(clean_hp);df=df[df['__hp'].notna()].drop_duplicates('__hp')
    avail=df[~df['__hp'].isin(set(track.get('used_hp',[])))];n=min(a.jumlah,len(avail))
    if n<a.jumlah: print(f'PERINGATAN: sisa pool {n}',file=sys.stderr)
    sample=avail.sample(n=n,random_state=random.randint(0,999999))
    refs=[a.referral]*n if a.referral else (REFERRALS*((n+len(REFERRALS)-1)//len(REFERRALS)))[:n]
    if not a.referral: random.shuffle(refs)
    out=BASE/a.out;out.parent.mkdir(exist_ok=True)
    lines=[f"{str(r['NAMA']).strip().upper()} | {r['__hp']} | {ref}" for (_,r),ref in zip(sample.iterrows(),refs)]
    out.write_text('\n'.join(lines)+'\n',encoding='utf-8')
    hps=sample['__hp'].tolist();track['used_hp']=sorted(set(track.get('used_hp',[]))|set(hps));track.setdefault('batches',[]).append({'file':str(out.relative_to(BASE)),'count':n,'hps':hps});OUTPUT.mkdir(exist_ok=True);TRACK.write_text(json.dumps(track,indent=2))
    print(f'OK {n} data -> {out}')
if __name__=='__main__': main()
