# PRD Integrasi Modul Motorku X ke Portal Tools

**Status:** Draft responsif untuk persetujuan — belum untuk implementasi produksi
**Tanggal:** 14 September 2026
**Produk:** Portal Tools / Prospek Bot Web
**Modul baru:** Operasional Motorku X
**Sumber perilaku:** Bot Telegram `@Motorkux_bot` yang berjalan di `motorkux-bot.service`

---

## 1. Ringkasan

Memindahkan kemampuan operasional yang saat ini tersedia di `@Motorkux_bot` ke Portal Tools sebagai modul web tersendiri. Tujuannya bukan mengganti atau menghentikan bot, tetapi menyediakan antarmuka web yang lebih terstruktur, aman, dapat dipantau, dan nyaman dipakai di desktop maupun ponsel.

Modul ditempatkan terpisah dari Prospek dan ASSIST agar konteks pelanggan Motorku X, token customer, dan mutasi motor tidak tercampur dengan JWT/prospek ASSIST.

## 2. Prinsip Pengembangan

1. **Bot tetap hidup dan tidak diubah pada fase integrasi awal.**
2. **Tidak ada migrasi data otomatis saat rilis pertama.** Import 16 akun lama membutuhkan proses terpisah, preview, backup, dan persetujuan.
3. **Fail closed.** Jika status token, referral, motor, event, atau respons API tidak jelas, jangan mengirim mutasi.
4. **Preview sebelum mutasi.** Semua operasi pendaftaran, tambah/hapus/transfer motor, dan bulk wajib memiliki ringkasan dan konfirmasi eksplisit.
5. **Idempotent.** Tombol ganda, refresh, atau jaringan putus tidak boleh membuat pendaftaran/mutasi ganda.
6. **Rahasia dipisahkan.** Token customer Motorku X tidak boleh diperlakukan sebagai JWT ASSIST dan tidak boleh dikirim ke browser/log.
7. **Satu operasi satu status.** Status `DRAFT → PREVIEWED → CONFIRMED → PROCESSING → SUCCESS/FAILED/UNKNOWN` disimpan agar dapat dipulihkan setelah restart.
8. **Fitur yang belum tersedia ditampilkan jujur.** Test Ride tetap terkunci selama feature flag/event resmi belum memenuhi syarat.

## 3. Pengguna dan Hak Akses

| Role portal | Akses modul | Cakupan |
|---|---:|---|
| Owner | Ya | Semua Sales, semua operasi, audit dan retensi |
| Admin | Ya | Semua operasi; data mengikuti profil Sales yang dipilih |
| Sales | Ya | Pendaftaran, akun, motor, dan riwayat miliknya sendiri |
| Team Leader/user non-operasional | Tidak | Menu disembunyikan dan API wajib memberi 403 |

Sales tidak memperoleh Batch Teks, Bulk Excel, audit global, retensi log, atau akses ke akun milik Sales lain. Transfer/hapus motor untuk Sales mengikuti kebijakan persetujuan Admin; sampai kontrak persetujuan selesai, aksi tersebut ditampilkan sebagai pengajuan atau tetap nonaktif. Pemisahan kepemilikan ditegakkan oleh server session/JWT, bukan parameter browser.

## 4. Arsitektur Informasi

Navigasi utama Portal Tools:

- Dashboard
- Prospek
- ASSIST
- **Motorku X** (baru)
- Akun Sales / Pengguna (sesuai role)
- Audit Log

Di dalam Motorku X:

1. **Ringkasan**
2. **Akun Customer**
   - Daftar 1 Akun
   - Daftar + Motor
   - Login Ulang Akun
3. **Kelola Motor**
   - Tambah Motor Saja
   - Transfer Motor
   - Hapus Motor
4. **Proses Massal**
   - Batch dari Teks
   - Bulk Excel
5. **Riwayat & Bantuan**
   - Lihat Hasil
   - Cara Pakai
   - Hapus Log (diganti menjadi aksi terkontrol pada halaman riwayat)
6. **Test Ride**
   - Status terkunci bila feature flag `iconRidingTest.isShow=false`

## 5. Pemetaan Menu Bot ke Web

| Menu bot | Lokasi web | Bentuk UI | Pengaman utama |
|---|---|---|---|
| Daftar 1 Akun | Akun Customer | Wizard bertahap | Validasi HP/referral, preview, idempotency |
| Daftar + Motor | Akun Customer | Wizard akun lalu motor | Pendaftaran akun tidak diulang bila tambah motor gagal |
| Tambah Motor Saja | Kelola Motor | Form akun default + data motor | Preflight engine dan daftar motor terbaru |
| Booking Test Ride | Test Ride | Status/empty state | Feature flag + event live + motor resmi |
| Batch dari Teks | Proses Massal | Paste/import + tabel preview | Maks. baris, validasi per baris, konfirmasi |
| Bulk Excel | Proses Massal | Dropzone + tabel preview | Header persis, 10 MB, dedup HP/engine, checkpoint |
| Lihat Hasil | Riwayat | Tabel berfilter | Masking PII, status per operasi, pagination |
| Login Ulang Akun | Akun Customer | Pemilih akun + konfirmasi | Token baru disimpan atomik; hasil login tampil |
| Cara Pakai | Bantuan | Panduan kontekstual | Tidak ada mutasi |
| Transfer Motor | Kelola Motor | Wizard dan unggah STNK | Verifikasi pasangan motor, preview, status proses |
| Hapus Motor | Kelola Motor | Daftar motor + dialog destruktif | Ketik konfirmasi, refresh sebelum hapus, verifikasi hilang |
| Hapus Log | Riwayat | Aksi admin sekunder | Rentang tanggal, preview jumlah, konfirmasi, audit permanen |

## 6. Alur Utama

### 6.1 Daftar 1 Akun

1. Admin/Owner/Sales membuka **Akun Customer → Daftar Akun**.
2. Mengisi nama, nomor HP, referral, provinsi, kabupaten/kota, dan persetujuan customer.
3. Provinsi dan kota dibaca dari master resmi Motorku X; kota difilter berdasarkan rantai induk yang valid.
4. Server memvalidasi format, referral, persetujuan, serta pasangan `province_id/province_code/city_id/city_code`.
5. Halaman menampilkan preview tanpa token/password sensitif.
6. Pengguna menekan **Konfirmasi & Daftarkan** satu kali.
7. Server membuat operasi persisten dan memanggil API Motorku X.
8. Hasil dibedakan:
   - `AKUN BERHASIL DIBUAT`
   - `GAGAL` dengan alasan aman
   - `STATUS BELUM DIKETAHUI` bila timeout setelah request
9. Token hasil registrasi disimpan secara atomik untuk operasi Motorku X berikutnya.

**Keputusan produk:** alur web mengikuti bot saat ini dan berhenti setelah akun berhasil dibuat. Pengiriman, input, dan konsumsi OTP tidak menjadi bagian dari Portal Tools. UI tidak menyebut akun "terverifikasi" dan tidak mencoba melewati mekanisme OTP milik aplikasi Motorku X.

### 6.1.1 Kontrak wilayah Motorku X

Sumber authoritative:

- `GET /api/location/province`
- `GET /api/location/regional_city/{regional_id}`

API Motorku X **tidak menyediakan UUID wilayah**. Kontrak aktualnya:

- Provinsi: integer `id`, string `province_code`, `name`.
- Kabupaten/kota: integer `id`, integer `province_id`, string `city_code`, string `province_code`, `name`, dan `pivot.regional_id`.

Snapshot analisis 14 September 2026 berisi 39 provinsi dan 421 kabupaten/kota. UUID ASSIST dilarang masuk ke UI, database master Motorku X, atau payload registrasi.

Anomali wajib fail closed:

- Papua Pegunungan (`id=38`, kode `9500`) belum memiliki kota dari endpoint Motorku X.
- Kota Sungai Penuh (`city_id=98`) memiliki konflik `province_id=4` dan `province_code=1500`; tidak boleh dipilih sampai upstream konsisten.

### 6.2 Daftar + Motor

- Menjalankan alur pendaftaran akun lebih dulu.
- Setelah akun berhasil, jalankan preflight motor.
- Bila motor gagal, akun tetap ditandai berhasil dan tersedia tombol **Coba Lagi Tambah Motor**.
- Tombol coba lagi tidak pernah mendaftarkan akun untuk kedua kali.

### 6.3 Tambah / Hapus / Transfer Motor

- Ambil token customer di server, tidak pernah dikirim ke browser.
- Refresh daftar motor sebelum preview dan sebelum konfirmasi.
- Engine/frame/referral divalidasi server-side.
- Hapus motor menggunakan konfirmasi destruktif dan memeriksa bahwa motor benar-benar hilang setelah API menjawab.
- Transfer menyimpan status unggah/proses dan tidak menyimpulkan berhasil hanya dari HTTP 200.

### 6.4 Bulk

- Input teks atau `.xlsx` maksimal 10 MB.
- Excel wajib memakai kolom: `NAMA | HP | ENGINE | 5 RANGKA | REFERRAL | FOTO`.
- Sistem memeriksa duplikat HP dan engine dalam file maupun database.
- Preview membagi baris menjadi **Siap**, **Perlu diperbaiki**, dan **Duplikat**.
- Hanya baris valid yang dapat diproses setelah konfirmasi.
- Progress menampilkan selesai/total, sukses, gagal, dan estimasi; refresh tidak mengulang baris sukses.
- Hasil dapat diunduh sebagai Excel/CSV tanpa token atau password.

### 6.5 Test Ride

Test Ride tidak langsung diaktifkan. UI membaca status server:

- Global feature flag harus aktif.
- Event harus live dan memiliki `is_riding_test=1`.
- `riding_test_motorcycle` harus berisi motor yang dipilih.
- Tanggal, waktu, event ID, dealer, dan motorcycle ID berasal dari data API terbaru.
- Submit satu kali lalu verifikasi booking ID/status.

Jika syarat tidak terpenuhi, tampilkan halaman status dengan pesan **Belum tersedia dari Motorku X**, bukan tombol yang seolah-olah bekerja.

## 7. Struktur Halaman Desain

### Ringkasan Motorku X

- Header modul dan indikator kesehatan koneksi.
- Empat angka operasional yang bersumber dari database, bukan angka rekaan:
  - akun tersimpan,
  - token perlu login ulang,
  - proses hari ini,
  - proses perlu ditinjau.
- **Lanjutkan pekerjaan** untuk draft/proses yang belum selesai.
- Empat kelompok menu berdasarkan tugas.
- Aktivitas terbaru dengan status teks dan warna.
- Status Test Ride.

### Web/Desktop (≥1024 px)

- Sidebar Portal Tools tetap terlihat dan modul Motorku X aktif.
- Workspace Daftar Akun memakai dua area: form utama dan panel **Ringkasan pendaftaran** di kanan.
- Identitas dan wilayah dapat memakai grid dua kolom tanpa memisahkan label dari kontrol.
- Panel preview dapat sticky, tetapi tidak menutupi footer atau tombol.
- Picker wilayah memakai searchable popover/side sheet; seluruh daftar tidak dirender sebagai dropdown native yang sangat panjang.

### Tablet (600–1023 px)

- Sidebar berubah menjadi navigation rail ringkas.
- Form memakai dua kolom bila ruang cukup; panel preview turun menjadi baris penuh.
- Picker wilayah tampil sebagai side sheet/modal lebar dengan pencarian dan target sentuh minimal 44 px.
- Pada orientasi portrait, aksi berada di bawah konten dan tidak menutupi persetujuan.

### Mobile (360–599 px)

- Navigation rail/sidebar berubah menjadi bottom navigation Portal Tools.
- Form, wilayah, preview, dan hasil menjadi satu kolom.
- Pemilihan provinsi/kota memakai layar/sheet khusus, bukan nested scrolling panjang.
- Semua target sentuh minimal 44 px.
- Aksi destruktif tidak ditempatkan berdekatan dengan aksi utama.
- Sticky action bar memperhitungkan safe area dan tinggi navigasi bawah.

### State responsif bersama

- Loading master wilayah.
- Wilayah kosong atau tidak tersedia.
- Validasi field dan konflik rantai wilayah.
- Preview siap dikonfirmasi.
- Processing, success, failed, dan unknown.
- Persetujuan tidak dicentang selalu mengunci tombol lanjut/konfirmasi.

## 8. Data Model SQLite (Usulan)

Tidak menggunakan file JSON sebagai sumber transaksi baru.

- `motorkux_accounts`
  - `id`, `name`, `phone_normalized`, `email`, `is_default_motor`
  - `owner_user_id`, `province_id`, `province_code`, `city_id`, `city_code`
  - `token_ciphertext`, `token_expires_at`
  - `created_at`, `updated_at`
- `motorkux_region_snapshots`
  - `id`, `source`, `payload_hash`, `status`, `activated_at`
- `motorkux_provinces`
  - `snapshot_id`, `province_id`, `province_code`, `name`, `selectable`
- `motorkux_cities`
  - `snapshot_id`, `city_id`, `province_id`, `city_code`, `province_code`, `name`, `regional_id`, `selectable`, `anomaly_code`
- `motorkux_operations`
  - `id`, `type`, `status`, `idempotency_key`, `requested_by`
  - `request_summary_json`, `safe_result_json`, `error_code`
  - `created_at`, `confirmed_at`, `finished_at`
- `motorkux_operation_items`
  - item per baris bulk dengan checkpoint dan status
- `motorkux_uploads`
  - metadata file; file disimpan di direktori privat dengan batas ukuran/retensi
- `motorkux_audit_events`
  - actor, tindakan, target tersamarkan, outcome, waktu

Token dienkripsi menggunakan key server-side terpisah. Nomor HP pada audit/log dimasking.

## 9. API Portal (Usulan)

Prefix: `/api/motorkux`

### Read-only

- `GET /summary`
- `GET /regions/provinces`
- `GET /regions/provinces/:provinceId/cities`
- `GET /accounts`
- `GET /accounts/:id/motors`
- `GET /operations`
- `GET /feature-status/testride`
- `GET /operations/:id`

### Mutasi

- `POST /operations/register/preview`
- `POST /operations/register/confirm`
- `POST /operations/motor-add/preview|confirm`
- `POST /operations/motor-delete/preview|confirm`
- `POST /operations/transfer/preview|confirm`
- `POST /operations/bulk/preview|confirm`
- `POST /operations/testride/preview|confirm`

Semua mutasi wajib: session login, role check, CSRF, idempotency key, request body cap, audit, serta validasi ulang saat confirm.

## 10. Keamanan dan Privasi

- Token Bot Telegram tidak digunakan oleh portal.
- Token Motorku X tetap hanya di server dan dienkripsi saat disimpan.
- Password default tidak ditampilkan di dashboard atau log.
- Portal tidak meminta, menerima, menyimpan, atau mengirim OTP.
- Upload Excel/STNK berada di direktori privat, bukan `public/`.
- File divalidasi tipe, ukuran, struktur ZIP/XML, dan retensi.
- Pesan error ke browser dibersihkan dari request frame, token, dan detail internal.
- Role enforcement dilakukan server-side, bukan hanya menyembunyikan menu.
- Rate limit diterapkan pada login ulang, registrasi, dan bulk.

## 11. Non-Functional Requirements

- Mobile-first, lebar minimum 360 px tanpa horizontal overflow.
- Breakpoint target: Mobile 360/390 px, Tablet 768/1024 px, Web 1440 px.
- Semua kontrol utama minimal 44 × 44 px.
- Mendukung keyboard, focus-visible, label form, dan reduced motion.
- Satu operasi biasa memiliki deadline total dan dapat dibatalkan sebelum `PROCESSING`.
- Proses bulk dapat dipulihkan setelah restart service.
- Database SQLite memakai WAL, foreign keys, busy timeout, dan transaksi singkat.
- Monitoring: status API, error rate, operasi UNKNOWN, dan antrean tertunda.
- Modul baru tidak boleh mengubah data Prospek/ASSIST.

## 12. Fase Pengembangan

### Fase 0 — Safety baseline

- Backup source/data bot dan portal.
- Dokumentasikan kontrak endpoint yang telah terbukti.
- Tambahkan test kontrak bahwa portal tidak menyediakan endpoint/form OTP dan tidak mengklaim akun terverifikasi.
- Buat migrasi SQLite dan encryption boundary.

### Fase 1 — Read-only foundation

- Navigasi Motorku X, ringkasan, akun, daftar motor, riwayat, status Test Ride.
- Belum ada tombol mutasi aktif.
- Verifikasi role dan masking.

### Fase 2 — Mutasi tunggal

- Daftar akun mengikuti alur bot tanpa OTP.
- Login ulang.
- Tambah motor dengan preview/confirm.
- Pilot dengan satu operasi resmi dan verifikasi hasil.

### Fase 3 — Motor lanjutan

- Hapus dan transfer motor.
- Recovery status UNKNOWN dan audit lengkap.

### Fase 4 — Bulk

- Batch teks dan Excel.
- Checkpoint, progress, retry terpilih, ekspor hasil.

### Fase 5 — Test Ride

- Hanya setelah flag dan event resmi aktif serta kontrak live tervalidasi.

## 13. Acceptance Criteria

1. Bot Telegram tetap aktif dengan PID/restart count tidak berubah selama rollout web.
2. Menu Motorku X tidak terlihat oleh Team Leader/user non-operasional dan API memberi 403; Sales hanya melihat data miliknya.
3. Tidak ada token atau password dalam HTML, response JSON, log, dan export; portal tidak menerima OTP.
4. Hasil registrasi memakai status `AKUN BERHASIL DIBUAT` dan tidak menyebut `terverifikasi`.
5. Double-click dan refresh tidak membuat operasi ganda.
6. Tambah motor gagal tidak mengulang pendaftaran akun.
7. Hapus motor membutuhkan preview, konfirmasi, refresh pasangan ID-engine, dan verifikasi hasil.
8. Bulk berhenti sebelum API bila referral/header/duplikat tidak valid.
9. Test Ride tidak dapat disubmit ketika syarat feature/event/motor tidak lengkap.
10. Web 1440 px, Tablet 768/1024 px, dan Mobile 360–430 px tidak overflow; kontrol minimal 44 px.
11. Form registrasi mewajibkan provinsi, kota yang valid, dan persetujuan customer sebelum preview.
12. Master Motorku X memuat 39 provinsi/421 kota sebagai snapshot awal; anomali upstream tidak selectable.
13. Semua tes portal lama tetap lulus.
14. Deploy menggunakan backup/rollback dan pilot bertahap.

## 14. Di Luar Scope Fase Awal

- Menghentikan atau mengganti `@Motorkux_bot`.
- Migrasi otomatis seluruh 16 akun lama.
- Mengubah API/backend Motorku X.
- Pengiriman, input, konsumsi, atau bypass OTP; OTP sepenuhnya di luar scope portal.
- Mengaktifkan Test Ride ketika backend belum menyediakan event valid.
- Menyatukan token Motorku X dengan JWT ASSIST.

## 15. Risiko Utama

| Risiko | Mitigasi |
|---|---|
| Akun/motor terbuat dua kali | operasi persisten + idempotency + preflight |
| Timeout setelah mutasi membuat hasil ambigu | status UNKNOWN, jangan retry otomatis, lakukan rekonsiliasi read-only |
| Token customer bocor | enkripsi at-rest, server-only, masking, secret scan |
| Status akun disalahartikan sebagai terverifikasi | copy hanya menyatakan akun berhasil dibuat; tidak menampilkan klaim verifikasi |
| API Motorku X berubah | adapter terisolasi, schema validation, feature/status probe |
| Worktree bot saat ini kotor | snapshot dan cabang terpisah sebelum implementasi |
| Fitur web merusak portal lama | route/module terisolasi, feature flag internal, full regression |

## 16. Keputusan yang Diminta dari Pemilik

Sebelum implementasi, cukup setujui atau revisi tiga hal:

1. Navigasi memakai satu menu utama **Motorku X**, dengan submenu berdasarkan kelompok tugas.
2. Sales hanya memperoleh menu dan data miliknya; operasi massal tetap Admin/Owner.
3. Implementasi dilakukan bertahap mulai dari **read-only foundation**, lalu mutasi tunggal—bukan langsung semua fitur.
4. Layout responsif Web/Tablet/Mobile harus disetujui sebelum coding production.

---

Dokumen ini adalah rancangan produk. Tidak ada perubahan production yang menjadi bagian dari PRD ini.
