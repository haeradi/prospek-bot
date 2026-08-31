#!/usr/bin/env python3
"""
Prospek TG Bot — generate Excel prospek HOT/MEDIUM/LOW on demand.
Bot khusus Astra Motor Penajam. Jalan 24/7 via systemd --user (workhorse),
TIDAK tergantung Hermes online.

Perintah (dengan & tanpa slash):
  start / help          - menu utama
  generate 10 20 20     - 10 HOT, 20 MEDIUM, 20 LOW
  generate hot=10 medium=20 low=20
  status                - ringkasan pool
  list                  - daftar file output
"""
import datetime
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROSPEK_DIR = Path(os.getenv("PROSPEK_DIR", "/home/ubuntu/prospek-generator"))
VENV_PY = PROSPEK_DIR / "venv" / "bin" / "python"
DB_FILE = PROSPEK_DIR / "gudang" / "database_prospek.db"
OUTPUT_DIR = PROSPEK_DIR / "output"

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
ALLOWED = os.getenv("ALLOWED_CHAT_ID", "").strip()
POLL_TIMEOUT = 10
GEN_TIMEOUT = 240

DIVIDER = "━━━━━━━━━━━━━━━━━━━━"


def log(msg: str):
    print(f"[{datetime.datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


# ── Telegram API ──────────────────────────────────────────────
def tg_json(method: str, params: dict) -> dict:
    url = f"https://api.telegram.org/bot{TOKEN}/{method}"
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=data)
    timeout = POLL_TIMEOUT + 5 if method == "getUpdates" else 8
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode())
            elapsed = time.monotonic() - started
            if elapsed >= 2:
                log(f"SLOW {method}: {elapsed:.2f}s")
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        log(f"HTTP {e.code} {method}: {body[:300]}")
        return {"ok": False, "description": body}
    except Exception as e:
        log(f"ERR {method}: {e}")
        return {"ok": False, "description": str(e)}


def tg_send(chat_id, text: str, reply_markup=None, reply_keyboard=None) -> dict:
    params = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        params["reply_markup"] = json.dumps(reply_markup)
    elif reply_keyboard:
        params["reply_markup"] = json.dumps(reply_keyboard)
    res = tg_json("sendMessage", params)
    ok = res.get("ok")
    log(f"sendMessage -> ok={ok} chat={chat_id} len={len(text)}"
        + (f" mid={res.get('result',{}).get('message_id')}" if ok else f" err={str(res)[:150]}"))
    return res


def tg_edit(chat_id, message_id, text: str, reply_markup=None) -> dict:
    params = {
        "chat_id": chat_id,
        "message_id": message_id,
        "text": text,
        "parse_mode": "HTML",
    }
    if reply_markup:
        params["reply_markup"] = json.dumps(reply_markup)
    res = tg_json("editMessageText", params)
    log(f"editMessageText -> ok={res.get('ok')} mid={message_id}"
        + ("" if res.get("ok") else f" err={str(res)[:150]}"))
    return res


def tg_answer_cb(query_id, text: str = "") -> dict:
    return tg_json("answerCallbackQuery", {"callback_query_id": query_id, "text": text})


def tg_send_file(chat_id, file_path: str, caption: str = "", reply_markup=None, reply_keyboard=None) -> dict:
    """Kirim file pakai curl (multipart) — robust, tanpa lib eksternal."""
    cmd = [
        "curl", "-s", f"https://api.telegram.org/bot{TOKEN}/sendDocument",
        "-F", f"chat_id={chat_id}",
        "-F", f"document=@{file_path}",
    ]
    if caption:
        cmd += ["-F", f"caption={caption}"]
    if reply_markup:
        cmd += ["-F", f"reply_markup={json.dumps(reply_markup)}"]
    elif reply_keyboard:
        cmd += ["-F", f"reply_markup={json.dumps(reply_keyboard)}"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        if r.stdout.strip():
            return json.loads(r.stdout)
        return {"ok": False, "stderr": r.stderr[:300]}
    except Exception as e:
        return {"ok": False, "description": str(e)}


# ── Keyboard menu ─────────────────────────────────────────────
def menu_main():
    """Menu utama berbasis tombol."""
    return {
        "inline_keyboard": [
            [{"text": "🚀 Generate Prospek", "callback_data": "gen:menu"}],
            [{"text": "📊 Status Database", "callback_data": "status"},
             {"text": "📂 File Output", "callback_data": "list"}],
            [{"text": "📋 Follow-Up", "callback_data": "fu:menu"}],
            [{"text": "📅 Prospek Bulanan", "callback_data": "monthly:menu"}],
            [{"text": "❓ Bantuan", "callback_data": "help"}],
        ]
    }


def menu_quick():
    """Pilihan jumlah data cepat."""
    return {
        "inline_keyboard": [
            [{"text": "🟥 10 HOT / 20 MED / 20 LOW", "callback_data": "gen:10:20:20"}],
            [{"text": "🟥 5 HOT / 10 MED / 10 LOW", "callback_data": "gen:5:10:10"}],
            [{"text": "🟥 20 HOT / 30 MED / 30 LOW", "callback_data": "gen:20:30:30"}],
            [{"text": "🟥 1 HOT / 1 MED / 1 LOW (uji)", "callback_data": "gen:1:1:1"}],
            [{"text": "◀️ Kembali", "callback_data": "menu"}],
        ]
    }


def menu_fu():
    """Menu Follow-Up terpisah."""
    return {
        "inline_keyboard": [
            [{"text": "10", "callback_data": "fu:10"},
             {"text": "50", "callback_data": "fu:50"}],
            [{"text": "100", "callback_data": "fu:100"},
             {"text": "200", "callback_data": "fu:200"}],
            [{"text": "◀️ Kembali", "callback_data": "menu"}],
        ]
    }


MONTHLY_SALES = [("Reski","64045515203"),("Dewi","67309215203"),("Bella","65890015203"),("Maya","63405015203"),("Anggel","64859215203"),("Sri Wahyuni","55085915203")]

def menu_monthly():
    rows=[[{"text":name,"callback_data":f"monthly:sales:{code}"}] for name,code in MONTHLY_SALES]
    rows.append([{"text":"◀️ Kembali","callback_data":"menu"}])
    return {"inline_keyboard":rows}

def menu_monthly_amount(code):
    return {"inline_keyboard":[
        [{"text":"10","callback_data":f"monthly:run:{code}:10"},{"text":"50","callback_data":f"monthly:run:{code}:50"}],
        [{"text":"100","callback_data":f"monthly:run:{code}:100"},{"text":"200","callback_data":f"monthly:run:{code}:200"}],
        [{"text":"◀️ Pilih Sales","callback_data":"monthly:menu"}],
    ]}


def reply_kb_main():
    """Keyboard bawah (reply keyboard) — SELALU nempel di atas kolom ketik."""
    return {
        "keyboard": [
            [{"text": "🚀 Generate Prospek"}],
            [{"text": "📋 Follow-Up"}],
            [{"text": "📅 Prospek Bulanan"}],
            [{"text": "📊 Status"}, {"text": "📂 Output"}],
            [{"text": "❓ Bantuan"}],
        ],
        "resize_keyboard": True,
        "is_persistent": True,
        "input_field_placeholder": "Ketik perintah…",
    }


# ── Parser perintah ───────────────────────────────────────────
def parse_generate(text: str):
    """Terima berbagai format, kembalikan (hot, medium, low)."""
    t = text.strip()
    h = m = l = None
    pairs = re.findall(r"(hot|medium|low)\s*[:=]?\s*(\d+)|(\d+)\s*(hot|medium|low)", t, re.I)
    for g in pairs:
        if g[0]:
            k, v = g[0].lower(), int(g[1])
        else:
            k, v = g[3].lower(), int(g[2])
        if k == "hot":
            h = v
        elif k == "medium":
            m = v
        elif k == "low":
            l = v
    if h is None and m is None and l is None:
        nums = re.findall(r"\d+", t)
        if len(nums) >= 3:
            h, m, l = int(nums[0]), int(nums[1]), int(nums[2])
    h = h or 0
    m = m or 0
    l = l or 0
    return h, m, l


def is_allowed(chat_id) -> bool:
    if not ALLOWED:
        return True  # dev mode: semua boleh
    return str(chat_id) == ALLOWED


# ── Aksi ──────────────────────────────────────────────────────
def cmd_main_menu(chat_id, message_id=None):
    text = (
        f"{DIVIDER}\n"
        f"<b>🤖 Prospek Generator Bot</b>\n"
        f"<i>Astra Motor Penajam</i>\n"
        f"{DIVIDER}\n\n"
        f"Tombol di bawah keyboard siap dipakai 👇\n"
        f"Tekan <b>🚀 Generate Prospek</b>, atau ketik:\n"
        f"<code>generate 10 hot 20 medium 20 low</code>\n\n"
        f"File Excel langsung terkirim ke sini. ✅"
    )
    if message_id:
        # edit: hanya bisa inline keyboard
        tg_edit(chat_id, message_id, text, menu_main())
    else:
        # send baru: pasang reply keyboard PERSISTEN di bawah
        params = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "reply_markup": json.dumps(reply_kb_main()),
        }
        res = tg_json("sendMessage", params)
        log(f"send (menu+keyboard) -> ok={res.get('ok')}")
    return


def cmd_quick_menu(chat_id, message_id=None):
    text = (
        f"{DIVIDER}\n"
        f"<b>🚀 Generate Prospek</b>\n"
        f"{DIVIDER}\n\n"
        f"Pilih jumlah data, atau ketik sendiri:\n"
        f"<code>generate 10 hot 20 medium 20 low</code>"
    )
    kb = menu_quick()
    if message_id:
        tg_edit(chat_id, message_id, text, kb)
    else:
        tg_send(chat_id, text, kb)


def cmd_help(chat_id, message_id=None):
    text = (
        f"{DIVIDER}\n<b>❓ Bantuan</b>\n{DIVIDER}\n\n"
        f"<b>Perintah:</b>\n"
        f"<code>generate 10 20 20</code> — 10 HOT, 20 MED, 20 LOW\n"
        f"<code>generate hot=5 medium=10 low=10</code> — format lengkap\n"
        f"<code>status</code> — jumlah konsumen database\n"
        f"<code>list</code> — file output terakhir\n"
        f"<code>menu</code> — kembali ke menu utama\n\n"
        f"Slash (<code>/</code>) juga tetap jalan."
    )
    kb = menu_main()
    if message_id:
        tg_edit(chat_id, message_id, text, kb)
    else:
        tg_send(chat_id, text, kb)


def cmd_status(chat_id, message_id=None):
    total = 0
    kecs = {}
    try:
        c = sqlite3.connect(str(DB_FILE))
        total = c.execute("SELECT COUNT(*) FROM prospek").fetchone()[0]
        kecs = dict(c.execute("SELECT KECAMATAN, COUNT(*) FROM prospek GROUP BY KECAMATAN").fetchall())
        c.close()
    except Exception as e:
        log(f"status db err: {e}")
    parts = [f"{DIVIDER}\n<b>📊 Status Database</b>\n{DIVIDER}",
             f"Total: <b>{total:,}</b> konsumen"]
    for k in ("BABULU", "PENAJAM", "SEPAKU", "WARU"):
        if k in kecs:
            parts.append(f"• {k.title()}: {kecs[k]:,}")
    text = "\n".join(parts)
    kb = menu_main()
    if message_id:
        tg_edit(chat_id, message_id, text, kb)
    else:
        tg_send(chat_id, text, kb)


def cmd_list(chat_id, message_id=None):
    try:
        files = sorted(OUTPUT_DIR.glob("*.xlsx"), key=lambda p: p.stat().st_mtime, reverse=True)
    except OSError:
        files = []
    lines = [f"{DIVIDER}\n<b>📂 File Output</b>\n{DIVIDER}"]
    if not files:
        lines.append("(belum ada)")
    for f in files[:10]:
        sz = f.stat().st_size / 1024
        ts = datetime.datetime.fromtimestamp(f.stat().st_mtime).strftime("%d/%m %H:%M")
        lines.append(f"• <code>{f.name}</code>  ({sz:.0f} KB, {ts})")
    lines.append("\n<i>File juga tersimpan di server.</i>")
    text = "\n".join(lines)
    kb = menu_main()
    if message_id:
        tg_edit(chat_id, message_id, text, kb)
    else:
        tg_send(chat_id, text, kb)


def do_generate(chat_id, h, m, l, message_id=None):
    total = h + m + l
    if total <= 0:
        tg_send(chat_id, "⚠️ Contoh: <code>generate 10 hot 20 medium 20 low</code>")
        return
    if total > 300:
        tg_send(chat_id, "⚠️ Maksimal 300 baris per generate. Kurangi jumlahnya.")
        return
    if not VENV_PY.exists():
        tg_send(chat_id, f"❌ venv tidak ada: {VENV_PY}")
        return

    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    out_name = f"PROSPEK_H{h}_M{m}_L{l}_{ts}.xlsx"
    out_path = OUTPUT_DIR / out_name

    text_wait = f"⏳ Generate <b>{total}</b> data (H{h} M{m} L{l})...\nNama file: <code>{out_name}</code>"
    if message_id:
        tg_edit(chat_id, message_id, text_wait)
    else:
        tg_send(chat_id, text_wait)

    cmd = [
        str(VENV_PY), "generate_prospek.py",
        "--hot", str(h), "--medium", str(m), "--low", str(l),
        "--template", "template_prospek.xlsx",
        "--out", f"output/{out_name}",
    ]
    log("run: " + " ".join(cmd))
    try:
        r = subprocess.run(cmd, cwd=str(PROSPEK_DIR), capture_output=True,
                           text=True, timeout=GEN_TIMEOUT)
    except subprocess.TimeoutExpired:
        tg_edit(chat_id, message_id, "⏱️ Generate melebihi waktu (4 menit). Coba jumlah lebih kecil.")
        return

    if r.returncode != 0:
        err = (r.stderr or r.stdout or "")[-600:]
        log(f"generate fail: {err}")
        tg_edit(chat_id, message_id, f"❌ Gagal generate:\n<code>{err}</code>")
        return

    if out_path.exists() and out_path.stat().st_size > 0:
        log(f"OK {out_name}")
        if message_id:
            tg_edit(chat_id, message_id, "✅ Selesai! Kirim file...")
        caption = f"✅ {total} data — H{h} / M{m} / L{l}"
        res = tg_send_file(chat_id, str(out_path), caption=caption,
                           reply_keyboard=reply_kb_main())
        if not res.get("ok"):
            tg_send(chat_id, f"⚠️ File jadi tapi gagal kirim:\n<code>{str(res)[:200]}</code>")
    else:
        tg_edit(chat_id, message_id, "❌ File tidak ditemukan setelah generate.")


def cmd_generate(chat_id, args: str, message_id=None, cb_query_id=None):
    h, m, l = parse_generate(args)
    total = h + m + l
    if total <= 0:
        txt = "⚠️ Contoh: <code>generate 10 hot 20 medium 20 low</code>"
        if message_id:
            tg_edit(chat_id, message_id, txt, menu_quick())
        else:
            tg_send(chat_id, txt)
        return
    if cb_query_id:
        tg_answer_cb(cb_query_id)
    do_generate(chat_id, h, m, l, message_id)




# ── Follow-Up (terpisah dari prospek) ─────────────────────────
def do_followup(chat_id, n, message_id=None):
    """Generate N data follow-up (Nama | No HP) -> kirim .txt"""
    n = int(n)
    if n <= 0:
        tg_send(chat_id, "Contoh: <code>followup 100</code> (maks 300)")
        return
    if n > 300:
        tg_send(chat_id, "Maksimal 300 data per generate.")
        return
    if not VENV_PY.exists():
        tg_send(chat_id, f"venv tidak ada: {VENV_PY}")
        return

    ts = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    xlsx = OUTPUT_DIR / f"FOLLOWUP_{n}_{ts}.xlsx"
    txt = OUTPUT_DIR / f"FOLLOWUP_{n}_{ts}.txt"

    text_wait = f"⏳ Ambil <b>{n}</b> data follow-up (Nama | No HP)..."
    if message_id:
        tg_edit(chat_id, message_id, text_wait)
    else:
        tg_send(chat_id, text_wait)

    # 1) generate XLSX via generate_followup.py (anti-dobel, update used_hp)
    cmd = [str(VENV_PY), "generate_followup.py", "--jumlah", str(n),
           "--out", f"output/{xlsx.name}"]
    log("run: " + " ".join(cmd))
    try:
        r = subprocess.run(cmd, cwd=str(PROSPEK_DIR), capture_output=True,
                           text=True, timeout=GEN_TIMEOUT)
    except subprocess.TimeoutExpired:
        tg_edit(chat_id, message_id, "Waktu habis. Coba jumlah lebih kecil.")
        return

    if r.returncode != 0:
        err = (r.stderr or r.stdout or "")[-600:]
        log(f"followup gen fail: {err}")
        tg_edit(chat_id, message_id, f"Gagal generate: <code>{err}</code>")
        return

    if not xlsx.exists():
        tg_edit(chat_id, message_id, "File tidak ditemukan setelah generate.")
        return

    # 2) convert XLSX -> TXT (Nama | No HP) via helper script
    r2 = subprocess.run([str(VENV_PY), "xlsx_to_txt.py", str(xlsx), str(txt)],
                        cwd=str(PROSPEK_DIR), capture_output=True, text=True, timeout=60)
    log(f"convert: {(r2.stdout or '').strip()} {(r2.stderr or '').strip()}")
    if not txt.exists() or txt.stat().st_size == 0:
        tg_edit(chat_id, message_id, "Convert TXT gagal.")
        return

    # Kirim langsung sebagai TEKS (copy-friendly) — bukan file
    lines = txt.read_text(encoding="utf-8").rstrip("\n").split("\n")
    total = len(lines)

    # Pecah per ~3500 char (batas aman < 4096), potong di batas baris
    chunks, cur, curlen = [], [], 0
    for ln in lines:
        add = len(ln) + 1
        if cur and curlen + add > 3500:
            chunks.append("\n".join(cur))
            cur, curlen = [], 0
        cur.append(ln)
        curlen += add
    if cur:
        chunks.append("\n".join(cur))

    nch = len(chunks)
    for i, ch in enumerate(chunks, 1):
        esc = ch.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        head = f"FOLLOW-UP {total} data ({i}/{nch})\n" if nch > 1 else f"FOLLOW-UP {total} data\n"
        text_msg = head + "<pre>" + esc + "</pre>"
        # Keyboard hanya di pesan terakhir
        kb = reply_kb_main() if i == nch else None
        res = tg_send(chat_id, text_msg, reply_keyboard=kb)
        if not res.get("ok"):
            tg_send(chat_id, f"Gagal kirim: <code>{str(res)[:200]}</code>")
            break
    log(f"followup OK -> {total} baris teks, {nch} pesan")

def do_monthly(chat_id, n, referral=None, message_id=None):
    """Generate N prospek bulanan (Nama | No HP | Referral)."""
    n=int(n)
    if not 1 <= n <= 300:
        tg_send(chat_id, "Jumlah harus 1-300."); return
    ts=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    txt=OUTPUT_DIR / f"PROSPEK_BULANAN_{n}_{ts}.txt"
    wait=f"⏳ Ambil <b>{n}</b> prospek bulanan..."
    tg_edit(chat_id,message_id,wait) if message_id else tg_send(chat_id,wait)
    cmd=[str(VENV_PY),"generate_monthly.py","--jumlah",str(n),"--out",f"output/{txt.name}"]
    if referral: cmd += ["--referral", referral]
    try:
        r=subprocess.run(cmd,cwd=str(PROSPEK_DIR),capture_output=True,text=True,timeout=GEN_TIMEOUT)
    except subprocess.TimeoutExpired:
        tg_send(chat_id,"Waktu habis. Coba jumlah lebih kecil."); return
    if r.returncode != 0 or not txt.exists():
        err=(r.stderr or r.stdout or "Generate gagal")[-600:];log(f"monthly fail: {err}");tg_send(chat_id,f"Gagal generate: <code>{err}</code>");return
    lines=txt.read_text(encoding="utf-8").rstrip("\n").split("\n");chunks=[];cur=[];size=0
    for ln in lines:
        if cur and size+len(ln)+1>3500: chunks.append("\n".join(cur));cur=[];size=0
        cur.append(ln);size+=len(ln)+1
    if cur: chunks.append("\n".join(cur))
    for i,ch in enumerate(chunks,1):
        esc=ch.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")
        head=f"PROSPEK BULANAN {len(lines)} data ({i}/{len(chunks)})\n" if len(chunks)>1 else f"PROSPEK BULANAN {len(lines)} data\n"
        res=tg_send(chat_id,head+"<pre>"+esc+"</pre>",reply_keyboard=reply_kb_main() if i==len(chunks) else None)
        if not res.get("ok"): log(f"monthly send fail: {str(res)[:200]}");break
    log(f"monthly OK -> {len(lines)} baris")


def load_offset():
    """Baca offset terakhir dari file (robust thd restart)."""
    try:
        p = BASE_DIR / ".offset"
        if p.exists():
            return int(p.read_text().strip())
    except Exception:
        pass
    return 0


def save_offset(offset: int):
    try:
        (BASE_DIR / ".offset").write_text(str(offset))
    except Exception:
        pass


# ── Main loop ─────────────────────────────────────────────────
def main():
    if not TOKEN:
        log("FATAL: TELEGRAM_BOT_TOKEN kosong. Set di .env dulu.")
        sys.exit(1)

    log(f"Prospek TG Bot mulai. ALLOWED_CHAT_ID={ALLOWED}")
    offset = load_offset()
    log(f"offset awal: {offset}")
    while True:
        try:
            r = tg_json("getUpdates", {"timeout": POLL_TIMEOUT, "offset": offset})
            if not r.get("ok"):
                log(f"getUpdates gagal: {str(r)[:200]}")
                time.sleep(5)
                continue
            for upd in r.get("result", []):
                offset = upd["update_id"] + 1
                save_offset(offset)

                # --- Callback query (tombol ditekan) ---
                cb = upd.get("callback_query")
                if cb:
                    chat_id = cb["message"]["chat"]["id"]
                    mid = cb["message"]["message_id"]
                    data = (cb.get("data") or "")
                    if not is_allowed(chat_id):
                        tg_answer_cb(cb["id"], "⛔ Tidak diizinkan.")
                        continue
                    log(f"cb {chat_id}: {data}")
                    tg_answer_cb(cb["id"])
                    if data == "menu":
                        cmd_main_menu(chat_id, mid)
                    elif data == "gen:menu":
                        cmd_quick_menu(chat_id, mid)
                    elif data == "gen:10:20:20":
                        do_generate(chat_id, 10, 20, 20, mid)
                    elif data == "gen:5:10:10":
                        do_generate(chat_id, 5, 10, 10, mid)
                    elif data == "gen:20:30:30":
                        do_generate(chat_id, 20, 30, 30, mid)
                    elif data == "gen:1:1:1":
                        do_generate(chat_id, 1, 1, 1, mid)
                    elif data == "monthly:menu":
                        tg_edit(chat_id,mid,"Prospek Bulanan (Nama | No HP | Referral)\n\nPilih Sales referral.",menu_monthly())
                    elif data.startswith("monthly:sales:"):
                        code=data.split(":")[2]
                        name=next((n for n,c in MONTHLY_SALES if c==code),"Sales")
                        tg_edit(chat_id,mid,f"Sales: <b>{name}</b>\nReferral: <code>{code}</code>\n\nPilih jumlah data.",menu_monthly_amount(code))
                    elif data.startswith("monthly:run:"):
                        _,_,code,n=data.split(":")
                        if n.isdigit() and code in dict((c,nm) for nm,c in MONTHLY_SALES): do_monthly(chat_id,int(n),code,mid)
                    elif data == "fu:menu":
                        tg_edit(chat_id, mid,
                                "Follow-Up (Nama | No HP)\n\n"
                                "Kirim: <code>followup 100</code>\n"
                                "atau pilih jumlah di bawah.",
                                menu_fu())
                    elif data.startswith("fu:"):
                        n = data.split(":")[1]
                        if n.isdigit():
                            do_followup(chat_id, int(n), mid)
                        else:
                            tg_edit(chat_id, mid, "Format salah.")
                    elif data == "status":
                        cmd_status(chat_id, mid)
                    elif data == "list":
                        cmd_list(chat_id, mid)
                    elif data == "help":
                        cmd_help(chat_id, mid)
                    continue

                # --- Pesan teks ---
                msg = upd.get("message") or upd.get("edited_message")
                if not msg:
                    continue
                chat_id = msg["chat"]["id"]
                if not is_allowed(chat_id):
                    log(f"blok user {chat_id}")
                    tg_send(chat_id, "⛔ Tidak diizinkan.")
                    continue
                text = (msg.get("text") or "").strip()
                if not text:
                    continue
                log(f"dari {chat_id}: {text[:80]}")
                parts = text.split(maxsplit=1)
                cmd = parts[0].lower().lstrip("/")
                args = parts[1] if len(parts) > 1 else ""

                if cmd in ("start", "help"):
                    # start → menu utama; help → bantuan
                    if cmd == "start":
                        cmd_main_menu(chat_id)
                    else:
                        cmd_help(chat_id)
                elif cmd == "menu":
                    cmd_main_menu(chat_id)
                elif cmd == "status":
                    cmd_status(chat_id)
                elif cmd == "list":
                    cmd_list(chat_id)
                elif cmd in ("generate", "create", "buat"):
                    cmd_generate(chat_id, args)
                elif cmd in ("bulanan", "monthly", "prospekbulanan"):
                    bits=args.split(); n=int(bits[0]) if bits else 100; referral=bits[1] if len(bits)>1 else None
                    if referral and referral not in [c for _,c in MONTHLY_SALES]: tg_send(chat_id,"Kode referral tidak terdaftar.")
                    else: do_monthly(chat_id,n,referral)
                elif cmd in ("followup", "fu", "follow-up", "follow_up"):
                    n = int(args.split()[0]) if args.split() else 100
                    do_followup(chat_id, n)
                # --- Tombol reply keyboard (label) ---
                elif text.strip() == "📅 Prospek Bulanan":
                    tg_send(chat_id,"Prospek Bulanan (Nama | No HP | Referral)\n\nPilih Sales referral.",menu_monthly())
                elif text.strip() == "📋 Follow-Up":
                    tg_send(chat_id,
                            "Follow-Up (Nama | No HP)\n\n"
                            "Kirim: <code>followup 100</code>\n"
                            "atau pilih jumlah di bawah.",
                            menu_fu())
                elif "generate prospek" in text.lower():
                    cmd_quick_menu(chat_id)
                elif text.strip() == "📊 Status":
                    cmd_status(chat_id)
                elif text.strip() == "📂 Output":
                    cmd_list(chat_id)
                elif text.strip() == "❓ Bantuan":
                    cmd_help(chat_id)
                else:
                    tg_send(chat_id,
                            "Ketik <code>generate 10 hot 20 medium 20 low</code>\n"
                            "atau <code>menu</code> untuk tombol.",
                            menu_main())
        except KeyboardInterrupt:
            log("berhenti (KeyboardInterrupt)")
            break
        except Exception as e:
            log(f"loop err: {e}")
            time.sleep(5)


if __name__ == "__main__":
    main()