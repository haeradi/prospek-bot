# Prospek Bot 🤖

Telegram bot untuk input prospek ke Star API (Astra Motor H704 Penajam).

## Fitur

- **Manual input** — kirim format pipe `|` langsung ke bot
- **Excel/CSV upload** — upload file Excel, bot parse & submit
- **Dedup** — cek HP duplikat sebelum create
- **Asal Prospek** — support 14 kode (1=Gathering, 3=Canvassing, 5b=Pameran, dll)
- **Status upgrade** — PROSPECT → MEDIUM → HOT → DEAL via follow-up

## Format Input

### Pipe format (manual):
```
individu|NO|NAMA|ALAMAT|PROVINSI|KABUPATEN|KECAMATAN|DESA|RT|RW|GENDER|AGAMA|PEKERJAAN|HP|STATUS|BAYAR|KODEMOTOR
```

Contoh:
```
individu|3|BUDI SANTOSO|JL MERDEKA|KALIMANTAN TIMUR|KABUPATEN PENAJAM PASER UTARA|PENAJAM|PENAJAM|001|000|LAKI-LAKI|ISLAM|WIRASWASTA|081234567890|tidak|tunai|LY2
```

### Excel:
Upload file `.xlsx` dengan sheet `MEDIUM` dan kolom:
Jenis Sales | kode asal prospek | Nama | Gender | Alamat | Kode Provinsi | Kode Kota | Kecamatan | Kelurahan | RT | RW | Agama | Pekerjaan | Nomor HP | preferensi tes ride | prefrensi pembelian | tipe motor

## Setup

```bash
npm install
cp .env.example .env
# Isi TG_TOKEN dan JWT
```

### Systemd service
```bash
mkdir -p ~/.config/systemd/user/
cp prospek-bot.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now prospek-bot.service
```

## Environment

- `TG_TOKEN` — Telegram Bot Token
- JWT token disimpan di `jwt.txt`

## API

Star API GraphQL endpoint: `https://api.star.astra.co.id/graphql/`
