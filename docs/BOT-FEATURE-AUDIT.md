# Audit Fitur `@Rd_prospek_bot`

**Tanggal audit:** 27 Agustus 2026
**Source:** `/home/ubuntu/prospek-bot` pada VM200
**Tujuan:** Menentukan fitur yang dipertahankan, dipisahkan, atau ditunda saat membangun portal web multi-sales.

## 1. Ringkasan arsitektur saat ini

Bot adalah aplikasi Node.js monolitik berbasis `node-telegram-bot-api`. Handler Telegram, state percakapan, GraphQL client ASSIST, parsing Excel, account vault, login Playwright/Microsoft MFA, dan business rules berada dalam satu proses atau script pendamping.

Dependency utama:

- `node-telegram-bot-api`
- `xlsx`
- `crypto-js`

Data runtime masih berbasis file: JWT aktif, token per akun, state, log, browser auth state, dan vault. Portal web tidak boleh menggunakan pola global-file tersebut untuk multi-user; token harus dimiliki user tertentu dalam database dan dienkripsi.

## 2. Fitur operasional yang ditemukan

### Input prospek

- Input LOW: nama, nomor HP, asal prospek.
- Input MEDIUM: LOW + motor + alamat/wilayah.
- Input HOT: MEDIUM + NIK.
- Input conversational melalui tombol Telegram.
- Input pipe/text untuk data berformat.
- Upload `.xlsx`, `.xls`, `.csv`, `.txt`.
- Preview dan konfirmasi sebelum submit batch.
- Normalisasi nomor HP Indonesia.
- Validasi NIK, kode motor, pekerjaan, asal prospek, dan wilayah.
- Pengecekan duplicate sebelum create.
- Create prospect melalui GraphQL ASSIST.

### Status dan pencarian

- Cari prospek berdasarkan nama atau nomor HP.
- Detail prospek.
- Upgrade status LOW/MEDIUM/HOT/DEAL sesuai aturan.
- Follow-up leads New dan On Track.
- Bulk follow-up dengan progress dan estimasi waktu.
- Bulk Not Deal dengan alasan terkontrol.

### Account dan autentikasi ASSIST

- Daftar akun dari vault.
- Pilih akun aktif.
- Tambah/edit/hapus metadata akun.
- Relogin akun melalui Playwright.
- Microsoft number matching MFA.
- Pemeriksaan expiry JWT.
- Aktivasi JWT akun ke runtime bot.
- Laporan aktivitas POS/BTL.

### Katalog

- Mapping pekerjaan ASSIST.
- Katalog motor dan validasi kode.
- Asal prospek.
- Master wilayah ASSIST seluruh Indonesia dan parent relation resolver.

### Operasional bot

- Menu persistent/reply keyboard.
- Inline callback confirmation.
- Audit log lokal.
- PID lock.
- Error handling Telegram/API dasar.
- Systemd user service.

## 3. Klasifikasi migrasi

### A. Pindahkan ke service bersama terlebih dahulu

Business logic berikut harus diekstrak dari `bot.js` agar bot dan web menggunakan implementasi yang sama:

1. ASSIST GraphQL client dengan timeout dan sanitized errors.
2. Resolver wilayah.
3. Normalisasi dan validasi customer/prospect.
4. Dedup checker.
5. Payload builder LOW/MEDIUM/HOT.
6. Search dan status transition rules.
7. Katalog motor, pekerjaan, dan asal.
8. Batch job processor dengan idempotency.

### B. Bangun ulang khusus web

- Register/login/session portal.
- Admin approval/suspend/revoke.
- RBAC dan ownership.
- Encrypted token vault per user.
- Login job status/MFA stream.
- Upload sandbox dan preview.
- Audit log database.
- UI tabel, form, filter, dan progress.

### C. Pertahankan di Telegram selama pilot

- Reply keyboard.
- Callback handlers.
- Telegram notification untuk status job/MFA.
- Bot sebagai fallback jika portal bermasalah.

### D. Jangan migrasikan ke MVP

- Set JWT mentah melalui chat/form.
- Pemilihan JWT global lintas sales.
- File Test Ride customer-specific dan script eksperimen.
- Hardcoded customer/event IDs.
- Restart service dari handler aplikasi.

## 4. Risiko teknis yang ditemukan

### Critical untuk portal

- Model JWT aktif global tidak aman untuk multi-sales.
- Tidak ada auth portal, RBAC, approval middleware, atau object ownership.
- Password/token berbasis file tidak cocok untuk aplikasi web.
- Handler bot monolitik menyulitkan test dan isolation.
- State percakapan in-memory hilang saat restart.

### High

- `xlsx@0.18.5` memiliki advisory prototype pollution dan ReDoS; npm melaporkan tidak ada fix otomatis. Web upload tidak boleh mengekspos parser ini pada file publik tanpa mitigasi. Pilih parser terpelihara atau worker terisolasi dengan size/row/time limits.
- Login Playwright dapat menghabiskan memori bila job duplikat; wajib queue, concurrency cap, timeout, dan process-tree cleanup.
- Beberapa script eksperimen lokal mengandung material customer/token dan tidak boleh masuk GitHub.

### Medium

- GraphQL calls perlu timeout, retry policy, correlation ID, dan standardized errors.
- Audit berbasis log file belum immutable dan belum mudah dicari.
- File dataset wilayah besar tidak tepat untuk dimuat penuh per request web; perlu cache/index/database table.
- CryptoJS tidak lagi aktif dikembangkan; portal harus memakai Node `crypto` AES-256-GCM atau library terpelihara.

## 5. Rekomendasi urutan implementasi

1. Freeze kontrak payload bot melalui characterization tests.
2. Ekstrak ASSIST client dan business rules tanpa mengubah behavior bot.
3. Buat SQLite schema/migrations untuk users, sessions, approvals, assist connections, jobs, dan audit.
4. Implement register → PENDING → admin approval menggunakan TDD.
5. Implement session/RBAC/ownership dan security tests.
6. Implement encrypted per-user ASSIST connection.
7. Implement input LOW sebagai vertical slice pertama.
8. Tambahkan MEDIUM/HOT, wilayah, dedup, search, dan upgrade.
9. Tambahkan import/batch worker setelah parser aman dipilih.
10. Pilot dengan dua sales sambil bot tetap aktif.

## 6. Gate sebelum produksi web

- Tidak ada secret pada Git history dan staged diff.
- User PENDING selalu 403 pada business endpoints.
- Sales A tidak dapat memakai token Sales B, termasuk dengan mengganti URL/body.
- Suspend mencabut semua session.
- Token tidak pernah masuk browser atau log.
- Upload diuji dengan malformed/oversized/archive-bomb-like files.
- Playwright jobs tidak meninggalkan child process.
- SQLite backup dan restore terbukti.
- Semua mutasi menggunakan idempotency key.
- Security headers, CSRF, rate limit, dan audit aktif.
