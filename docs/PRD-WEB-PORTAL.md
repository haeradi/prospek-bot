# PRD — Portal Prospek Astra Motor Penajam

**Dokumen:** Product Requirements Document
**Versi:** 1.0
**Status:** Draft siap implementasi
**Produk:** Portal web pendamping `@Rd_prospek_bot`
**Pemilik produk:** Admin Astra Motor Penajam

## 1. Ringkasan

Portal Prospek adalah aplikasi web internal yang memindahkan fungsi operasional utama `@Rd_prospek_bot` ke antarmuka multi-user. Setiap sales memiliki akun portal sendiri, tetapi akun baru berstatus **PENDING** dan tidak dapat mengakses data atau API ASSIST sebelum disetujui admin. Setelah disetujui, sales menghubungkan akun ASSIST miliknya sendiri melalui alur login Microsoft/MFA resmi. Token/JWT setiap sales disimpan terisolasi dan terenkripsi.

Portal bukan pengganti keamanan ASSIST dan tidak membagikan JWT antar-sales. Telegram bot tetap berjalan sebagai kanal alternatif selama migrasi bertahap.

## 2. Masalah yang diselesaikan

1. Bot Telegram memakai konteks bersama sehingga pemisahan pengguna dan hak akses terbatas.
2. Pengelolaan akun/JWT melalui chat sulit diaudit dan rawan salah pilih akun.
3. Input prospek bertahap, upload Excel, pencarian, dan approval lebih mudah dipahami dalam UI web.
4. Admin membutuhkan kontrol eksplisit untuk menyetujui, menangguhkan, atau mencabut akses sales.
5. Data aktivitas dan status token perlu terlihat tanpa membaca log server.
6. Wilayah ASSIST seluruh Indonesia perlu dipilih secara berantai dengan UUID yang tepat.

## 3. Tujuan produk

- Sales dapat mengelola prospek menggunakan identitas ASSIST masing-masing.
- Akun portal tidak aktif sebelum admin menyetujui.
- Admin dapat mengontrol lifecycle akun dan melihat audit trail.
- Tidak ada JWT, password ASSIST, token Telegram, atau data customer di frontend/log aplikasi.
- Mendukung input LOW, MEDIUM, HOT, batch Excel/CSV, dedup, pencarian, upgrade, leads, bulk not-deal, dan aktivitas.
- Memakai database wilayah ASSIST: 38 provinsi, 535 kota/kabupaten, 7.452 kecamatan, 83.507 kelurahan/desa.
- Telegram bot tetap aktif saat portal dikembangkan dan diuji.

## 4. Non-goals MVP

- Menggantikan Microsoft MFA atau melewati kontrol ASSIST.
- Menyediakan akses lintas dealer di luar scope akun ASSIST pengguna.
- Menyimpan password ASSIST dalam plaintext.
- Aplikasi mobile native.
- Booking Test Ride customer dari Motorku X.
- Menghapus bot Telegram pada peluncuran awal.

## 5. Pengguna dan role

### 5.1 Admin

- Login portal.
- Melihat permohonan akun baru.
- Approve/reject akun sales.
- Suspend/reactivate/revoke akun.
- Menetapkan dealer/team dan role.
- Melihat status koneksi ASSIST tanpa melihat token.
- Melihat audit log dan aktivitas keamanan.
- Memaksa logout seluruh sesi sales.
- Tidak dapat melihat password ASSIST atau JWT mentah.

### 5.2 Sales

- Registrasi akun portal.
- Melihat halaman “menunggu persetujuan” selama PENDING.
- Setelah APPROVED: login dan menghubungkan akun ASSIST sendiri.
- Menjalankan MFA resmi melalui flow login terkontrol.
- Membuat, mencari, dan upgrade prospek dalam scope identitasnya.
- Mengunggah Excel/CSV dan melihat preview/error sebelum submit.
- Melihat leads dan aktivitasnya sendiri.
- Tidak dapat mengakses user/admin lain atau token mentah.

### 5.3 Status akun

`PENDING → APPROVED → ACTIVE`

Transisi tambahan:

- `PENDING → REJECTED`
- `ACTIVE/APPROVED → SUSPENDED`
- `SUSPENDED → APPROVED`
- status apa pun → `REVOKED` (terminal, kecuali admin membuat akun baru)

Hanya admin dapat mengubah status selain proses registrasi awal.

## 6. Inventory fitur bot dan pemetaan web

| Fitur bot | Portal MVP | Bentuk UI |
|---|---|---|
| Prospek LOW | Ya | Form ringkas nama, HP, asal |
| Prospek MEDIUM | Ya | Form + motor + alamat wilayah berantai |
| Prospek HOT | Ya | Form + NIK + validasi ketat |
| Dedup nomor HP | Ya | Pemeriksaan otomatis sebelum submit |
| Asal prospek | Ya | Select katalog sumber prospek |
| Katalog motor | Ya | Searchable select kode/nama motor |
| Wilayah UUID | Ya | Provinsi → kab/kota → kecamatan → desa |
| Upload Excel/CSV/TXT | Ya | Upload, preview, validasi, konfirmasi |
| Cari prospek | Ya | Search nama/HP/nomor prospek |
| Upgrade status | Ya | Detail drawer + aksi sesuai transisi |
| Leads New/On Track | Ya | Tabel filter dan detail |
| Bulk Not Deal | Fase 2 | Wizard, alasan terkunci, konfirmasi dua tahap |
| Aktivitas POS/BTL | Ya | Ringkasan status dan tabel |
| Manajemen akun ASSIST | Ya | Halaman koneksi pribadi per sales |
| Relogin Microsoft MFA | Ya | Job login + status real-time |
| Set JWT manual | Tidak | Dihapus dari UI untuk keamanan |
| Audit bot | Ya | Audit terstruktur per user/request |
| Test Ride eksperimen | Tidak | Di luar scope portal prospek |

## 7. User journeys

### 7.1 Registrasi dan approval

1. Sales membuka halaman daftar.
2. Mengisi nama, email kantor, nomor HP, kode sales, dealer/team, dan password portal.
3. Sistem memvalidasi email/nomor/kode sales unik.
4. Password di-hash; akun dibuat `PENDING`.
5. Sales melihat halaman menunggu persetujuan dan tidak memperoleh akses aplikasi/API.
6. Admin menerima notifikasi dan membuka detail permohonan.
7. Admin mencocokkan identitas, dealer, dan kode sales.
8. Admin approve atau reject dengan alasan.
9. Approval membuat akun `APPROVED`, mencatat actor, timestamp, IP, dan alasan.
10. Sales login dan diminta menghubungkan ASSIST.

### 7.2 Menghubungkan ASSIST

1. Sales memilih “Hubungkan ASSIST”.
2. Backend membuat login job sekali pakai.
3. Password ASSIST diminta hanya pada form HTTPS dan tidak dicatat. Pilihan penyimpanan password default: tidak disimpan.
4. Login Microsoft berjalan di worker terisolasi sebagai user service terbatas.
5. Jika MFA number matching muncul, frontend menampilkan angka approval dan countdown.
6. Sales menyetujui di Microsoft Authenticator.
7. Backend menangkap token resmi, mengenkripsi, menyimpan dengan owner user ID, dan menghapus material sementara.
8. UI hanya menampilkan nama, email, expiry, dan status—tidak token mentah.

### 7.3 Input prospek

1. Sales memilih level LOW/MEDIUM/HOT.
2. Form menampilkan hanya field yang dibutuhkan.
3. Nomor HP dinormalisasi dan dicek duplikat.
4. Untuk MEDIUM/HOT, dropdown wilayah menggunakan parent UUID.
5. Preview menunjukkan data yang akan dikirim.
6. Sales konfirmasi.
7. Backend mengambil JWT milik sales, memeriksa expiry dan scope, lalu memanggil ASSIST.
8. Hasil dan correlation ID dicatat di audit log.

### 7.4 Upload Excel

1. Sales upload `.xlsx`, `.xls`, `.csv`, atau `.txt` dengan batas ukuran.
2. Backend melakukan MIME sniffing, nama file acak, dan parsing di area sementara.
3. Preview memisahkan valid, duplikat, dan error.
4. Sales memilih baris valid dan konfirmasi.
5. Job queue memproses idempotently, menampilkan progres dan ETA.
6. File sementara dihapus setelah retention singkat.

## 8. Kebutuhan fungsional

### Auth portal

- Email kantor + password.
- Password minimal 12 karakter; hash Argon2id atau scrypt.
- Session cookie `HttpOnly`, `Secure`, `SameSite=Lax/Strict`.
- Rotasi session ID setelah login/approval/perubahan role.
- Idle timeout 30 menit; absolute timeout 12 jam.
- Rate limit login dan lockout bertahap.
- Reset password dengan token satu kali dan expiry pendek.

### Approval admin

- Akun PENDING tidak dapat memanggil endpoint bisnis.
- Middleware memeriksa `account_status === ACTIVE/APPROVED` dan role.
- Approve/reject/suspend harus memakai POST dan CSRF protection.
- Semua aksi admin masuk append-only audit log.
- Admin tidak boleh menyetujui akun dirinya sendiri jika nanti ada multi-admin (four-eyes opsional fase 2).

### Prospek

- Validasi server-side untuk semua field.
- NIK hanya untuk HOT, tepat 16 digit.
- Nomor HP Indonesia dinormalisasi ke `62...`.
- Dedup dilakukan kembali server-side saat submit.
- Transisi status mengikuti aturan ASSIST; tidak boleh turun.
- Semua mutasi memiliki idempotency key.

### Wilayah

- Endpoint pencarian berbasis parent ID.
- Tidak boleh fallback diam-diam.
- Nama ambigu wajib disambiguasi dengan parent.
- Dataset dapat diperbarui oleh admin job, bukan request publik.

### Observability

- Health endpoint tanpa detail rahasia.
- Structured logs dengan request ID, actor ID, route, status, latency.
- Token/password/NIK/HP penuh tidak boleh masuk log.
- Alert untuk login gagal berulang, token refresh gagal, dan queue macet.

## 9. Arsitektur yang direkomendasikan

### Komponen

- **Web/API:** Node.js LTS, Fastify atau Express dengan TypeScript.
- **UI:** server-rendered templates + HTMX/Alpine untuk MVP, atau React bila interaksi berkembang.
- **Database:** SQLite WAL, foreign keys aktif, backup konsisten.
- **Worker:** proses terpisah untuk login Playwright dan batch jobs.
- **Reverse proxy:** Cloudflare Tunnel → Caddy/Nginx → aplikasi localhost.
- **Bot adapter:** logic ASSIST dipisah menjadi service module yang digunakan bot dan web.

### Prinsip

- Portal tidak membaca `jwt.txt` global.
- Token selalu dimiliki satu user (`owner_user_id`).
- Backend memilih token dari session user, bukan parameter client.
- Admin melihat metadata token, bukan token.
- Worker login hanya menerima job ID; secret diambil dari vault terisolasi.

## 10. Model data SQLite

### users

- `id TEXT PRIMARY KEY`
- `email TEXT UNIQUE NOT NULL`
- `phone TEXT UNIQUE`
- `full_name TEXT NOT NULL`
- `sales_code TEXT UNIQUE NOT NULL`
- `dealer_code TEXT NOT NULL`
- `team_name TEXT`
- `role TEXT CHECK(role IN ('ADMIN','SALES'))`
- `status TEXT CHECK(status IN ('PENDING','APPROVED','ACTIVE','REJECTED','SUSPENDED','REVOKED'))`
- `password_hash TEXT NOT NULL`
- `approved_by TEXT REFERENCES users(id)`
- `approved_at TEXT`
- `rejection_reason TEXT`
- `created_at`, `updated_at`, `last_login_at`

### sessions

- opaque session ID hash, user ID, CSRF secret hash, issued/expiry/last-seen, IP prefix, user-agent hash, revoked timestamp.

### assist_connections

- user ID UNIQUE, encrypted access/refresh token, nonce/tag/key version, subject UUID, display name, email, expiry, status, last refresh, last error.

### login_jobs

- user ID, status, MFA number, expiry, attempt count, worker PID reference, sanitized error, timestamps.

### prospect_jobs

- user ID, type, idempotency key UNIQUE per user, status, totals, sanitized result, timestamps.

### audit_logs

- immutable ID, actor user ID, action, target type/ID, request ID, result, IP prefix, user-agent hash, metadata JSON yang sudah disanitasi, timestamp.

## 11. Keamanan

- HTTPS wajib; HSTS setelah domain stabil.
- CSP ketat (`default-src 'self'`), no inline script pada produksi.
- CSRF token untuk seluruh state-changing request.
- Parameterized SQL dan schema validation.
- Output escaping default; tidak merender HTML dari input sales/customer.
- Upload dibatasi ukuran, extension, MIME, row count; disimpan di luar web root.
- Encryption at rest menggunakan AES-256-GCM dengan master key dari systemd credential/env berpermission 600, bukan database/repo.
- Key rotation dengan `key_version`.
- Token tidak pernah dikirim ke browser.
- RBAC deny-by-default dan object ownership check setiap query.
- Rate limit per IP dan per user.
- Audit admin dan ekspor data.
- Backup terenkripsi dan uji restore berkala.
- Dependabot/npm audit, lockfile, CI secret scan.

## 12. Desain UI

Surface utama adalah **Operate**. Struktur desktop:

- Sidebar tetap: Ringkasan, Prospek, Input, Import, Leads, Aktivitas, Koneksi ASSIST.
- Admin mendapat area tambahan: Persetujuan Sales, Pengguna, Audit, Sistem.
- Header ringkas berisi identitas, status koneksi, dan menu akun.
- Tabel menjadi komponen utama; cards hanya untuk status operasional yang perlu tindakan.
- Warna primer merah Honda/Astra yang terkendali, netral terang, status semantik hijau/amber/merah.
- Mobile memakai bottom navigation dan drawer filter.

## 13. API awal

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/me`
- `GET /account/pending`
- `GET /admin/users?status=PENDING`
- `POST /admin/users/:id/approve`
- `POST /admin/users/:id/reject`
- `POST /admin/users/:id/suspend`
- `POST /assist/login-jobs`
- `GET /assist/login-jobs/:id`
- `DELETE /assist/connection`
- `GET /regions/provinces`
- `GET /regions/districts?provinceId=`
- `GET /regions/subdistricts?districtId=`
- `GET /regions/villages?subDistrictId=`
- `POST /prospects/check-duplicate`
- `POST /prospects`
- `GET /prospects/search?q=`
- `POST /prospects/:id/upgrade`
- `POST /imports/preview`
- `POST /imports/:id/submit`
- `GET /jobs/:id`

## 14. Fase delivery

### Fase 0 — Fondasi

- Pisahkan ASSIST client dari Telegram handler.
- SQLite migrations, users, sessions, audit.
- Security headers, CSRF, validation, test harness.

### Fase 1 — Auth dan approval

- Register, login, pending screen.
- Admin approval/suspend/revoke.
- Audit log dasar.

### Fase 2 — Koneksi ASSIST

- Login worker, MFA status, encrypted token vault per user.
- Token metadata dan refresh.

### Fase 3 — Prospek inti

- LOW/MEDIUM/HOT, dedup, wilayah, motor, asal prospek.
- Search dan upgrade.

### Fase 4 — Batch dan laporan

- Excel preview/submit, jobs, leads, aktivitas.
- Bulk Not Deal dengan safeguards.

### Fase 5 — Hardening dan rollout

- Pentest aplikasi, backup/restore drill, monitoring, pilot sales terbatas, parallel run dengan Telegram.

## 15. Acceptance criteria MVP

1. User PENDING mendapat 403 pada seluruh endpoint bisnis meski mengetahui URL.
2. Hanya ADMIN dapat approve/reject/suspend.
3. Approval tercatat lengkap di audit log.
4. Sales A tidak dapat membaca atau memakai token/prospek Sales B.
5. Token mentah tidak muncul pada HTML, API response, log, atau audit.
6. Logout dan suspend mencabut seluruh session aktif.
7. Login ASSIST mendukung MFA resmi dan timeout tanpa meninggalkan browser process.
8. Input LOW/MEDIUM/HOT menghasilkan payload setara bot.
9. Wilayah salah ditolak; tidak fallback ke Sepaku.
10. Upload invalid tidak membuat mutasi ASSIST.
11. Idempotency mencegah submit ganda.
12. Semua critical route memiliki tests dan CI lulus.
13. Backup SQLite dapat direstore pada lingkungan uji.
14. Portal berjalan hanya di localhost di belakang reverse proxy/Cloudflare Tunnel.
15. Bot Telegram tetap berfungsi selama pilot.

## 16. Risiko dan mitigasi

- **JWT singkat/refresh gagal:** worker refresh + status jelas + relogin resmi.
- **Playwright menghabiskan memori:** satu job per user, global concurrency rendah, timeout dan cleanup process tree.
- **Perubahan schema ASSIST:** adapter terisolasi dan contract tests.
- **Double submit:** idempotency key + unique constraint.
- **Akun palsu:** approval admin dan verifikasi email kantor pada fase lanjut.
- **Admin compromise:** MFA admin, session pendek, audit, notifikasi aksi berisiko.
- **SQLite contention:** WAL, busy timeout, transaksi singkat, satu writer queue untuk batch.

## 17. Definisi selesai

MVP dinyatakan siap pilot bila seluruh acceptance criteria lulus, tidak ada secret di GitHub, security review independen lolos, backup/restore teruji, dan minimal dua sales menyelesaikan alur daftar → approval → koneksi ASSIST → buat prospek tanpa bantuan teknis.
