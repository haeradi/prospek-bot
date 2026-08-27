# Audit Feature Parity Bot Telegram → Portal Web

> Audit statis terhadap `bot.js` dan modul lokal yang di-`require`, dibanding implementasi portal pada `web/src/app.js` dan `web/public/*`. Tidak ada bot, service, login, atau API STAR/ASSIST yang dijalankan. Nilai credential/token tidak dibaca atau disalin; seluruh secret dalam dokumen ini dinyatakan `[REDACTED]`.

## Ringkasan eksekutif

Portal saat ini **belum feature-parity** dengan bot. Portal sudah kuat sebagai fondasi akun/RBAC/audit dan koneksi ASSIST per-sales, tetapi fitur prospek portal masih berupa **draft SQLite lokal**. Tidak ada query atau mutation STAR pada portal saat ini.

| Area | Status web | Catatan |
|---|---|---|
| Registrasi/login/session/RBAC admin-sales | ✅ Ada (web-only) | Bukan fitur bot; fondasi keamanan yang baik. |
| Koneksi ASSIST per sales + MFA job | ✅ Ada | Padanan parsial relogin/JWT, tetapi modelnya per-user terenkripsi, bukan vault global/file JWT bot. |
| Input LOW/MEDIUM/HOT | 🟡 Parsial lokal | Form dan draft SQLite ada; field dan validasi belum parity; **tidak dikirim ke STAR**. |
| Daftar prospek | 🟡 Parsial lokal | Hanya draft portal sendiri, bukan `getCustomerProspectFromCustomers`. |
| Cari/detail prospek STAR | ✅ Read-only | Query per akun Sales dari vault terenkripsi; search/filter/detail owner-scoped, Admin tenant-scoped dengan PII masking. |
| Upgrade status STAR | ❌ Belum | PATCH web hanya mengubah `level` draft lokal, termasuk boleh turun. |
| Aktivitas clock-in/out | ❌ Belum | Tidak ada query/report BTL/POS. |
| FF/Excel/text batch | ❌ Belum | Tidak ada parser/upload/preview/job runner. |
| Bulk Not Deal | ❌ Belum | Mutasi berbahaya; jangan diaktifkan sebelum guardrail lengkap. |
| Leads New/On Track + bulk follow-up | ❌ Belum | Query dan mutasi belum ada. |
| EOM reset | ❌ Belum | Bot menjalankan otomatis saat startup pada hari terakhir; portal tidak. |
| Manajemen vault akun STAR bersama | ❌/tidak disarankan | Portal memakai koneksi ASSIST per-sales yang lebih aman; jangan menyalin vault plaintext/file JWT bot. |

## Klasifikasi risiko

- **LOCAL**: hanya proses/file/database lokal; tidak memanggil STAR. Mutasi lokal tetap perlu CSRF/RBAC/audit.
- **READ-ONLY**: melakukan query STAR/men-decode metadata token, tanpa mengubah data STAR.
- **MUTATION**: mengubah satu entitas STAR dan perlu preview/konfirmasi/idempotensi.
- **MUTATION-DANGEROUS**: bulk, irreversible, login/credential, switch identity, atau otomatisasi terjadwal.

## Inventaris entry point: menu, command, callback, dan input

### Command Telegram

| Command | Fungsi | Kelas | Padanan web/status |
|---|---|---:|---|
| `/start` | Reset conversation; tampilkan petunjuk level, identitas JWT, menu utama | LOCAL | 🟡 Dashboard ada, tetapi tidak menampilkan status/katalog fitur STAR. |
| `/jwt <token>` | Decode token, simpan sebagai JWT aktif ke file | MUTATION-DANGEROUS | ❌ Tidak ada (dan sebaiknya tidak dibuat sebagai input token mentah). Portal memakai login ASSIST + token terenkripsi. |
| `/accounts` | List akun vault, grup tim, status/expiry JWT | LOCAL/READ-ONLY | 🟡 Koneksi user sendiri ada; tidak ada daftar vault global. |
| `/aktivitas [POS\|BTL]` | Query aktivitas+staff dan format laporan all/POS/BTL | READ-ONLY | ❌ |
| `/relogin <code>` | Spawn login Playwright, MFA push | MUTATION-DANGEROUS | ✅ Konsep tersedia sebagai login job ASSIST per-user (queued/running/MFA/success/fail), lebih aman. |
| `/setpw <code> <password>` | Tulis password plaintext ke vault JSON | MUTATION-DANGEROUS | ❌ dan **jangan diparity-kan secara literal**; portal tidak menyimpan password login. |
| `/use <code>` | Salin JWT akun menjadi aktif; versi command restart service bot setelah 1,5 detik | MUTATION-DANGEROUS | ❌; model per-user portal menghilangkan kebutuhan global switch/restart. |

### Menu utama / reply-keyboard

Menu bot: Prospek LOW, MEDIUM, HOT; Upgrade Status; Cari Prospek; FF/Excel; Set JWT; Bulk Not Deal; Leads; Akun. Semua punya callback identik (`create:*`, `upgrade:menu`, `search:menu`, `ff:menu`, `setjwt`, `notdeal:menu`, `leads:menu`, `accounts:menu`) dan tombol reply-keyboard sebagai jalur alternatif.

Portal hanya memiliki Ringkasan, Input Prospek, Koneksi ASSIST; admin memiliki Persetujuan Sales, Semua Prospek (lokal), Audit Log.

### Callback/action lengkap

| Keluarga callback | Action yang ditemukan | Kelas | Status web |
|---|---|---:|---|
| Navigasi | `menu`, `cancel`, `noop`, `status` | LOCAL/READ-ONLY | 🟡 Navigasi ada; status JWT STAR tidak ada. |
| Create | `create:LOW`, `create:MEDIUM`, `create:HOT`, `asal:*`, `motor:*`, `motor:list`, `confirm` | LOCAL → MUTATION | 🟡 Form draft saja; asal, pekerjaan, NIK, RT/RW, preview/confirm, dan submit STAR belum ada. |
| Search/upgrade | `search:menu`, `search:select:<id>`, `upgrade:menu`, `upgrade:select:<id>:<status>`, `upgrade:do` | READ-ONLY → MUTATION | ❌ STAR; PATCH lokal bukan parity. |
| FF | `ff:menu`, `ff:submit_all` | LOCAL → MUTATION-DANGEROUS | ❌ |
| Not Deal | `notdeal:menu`, `notdeal:status:{HOT,MEDIUM,LOW,ALL}`, `notdeal:do`; keyboard alasan lama tersedia tetapi flow kini memakai alasan tetap | READ-ONLY → MUTATION-DANGEROUS | ❌ |
| Leads | `leads:menu`, `leads:new`, `leads:ontrack`, `leads:bulk_new`, `leads:bulk`, `leads:do_new`, `leads:do` | READ-ONLY → MUTATION-DANGEROUS | ❌ |
| Accounts | `accounts:menu/detail/use/relogin/edit/edit_email/edit_password/edit_dealer/delete/delete_confirm/add:start/add:code` | LOCAL/MUTATION-DANGEROUS | 🟡 Portal mempunyai connect/status/disconnect ASSIST sendiri, bukan CRUD vault bersama. |

Bot juga menerima dokumen `.xlsx`, `.xls`, `.csv`, `.txt`, serta state text bertahap. State conversation disimpan lokal ke `state.json` setiap perubahan.

## Detail fitur dan kontrak perilaku

### 1. Create prospek LOW / MEDIUM / HOT

**Urutan input bot**

1. Level.
2. Nama.
3. Nomor HP.
4. Asal prospek (16 pilihan kode: `1,2,3,4,5a,5b,6,9a,9c,9d,9f,9g,10,12,13,55`).
5. MEDIUM/HOT: motor (pilihan populer, seluruh katalog, atau kode teks).
6. MEDIUM/HOT: pekerjaan.
7. HOT: NIK.
8. MEDIUM/HOT: alamat.
9. Preview lengkap + identitas sales/channel + **Kirim/Batal**.

**Field mutation STAR (`ensureCreateCustomerProspectFromCustomers`)**

- Selalu: `name`, `mobilePhoneNumber`, `customerType=REGULAR`, `gender` (default laki-laki), `testRidePreference=false`, `tagPriority=true`, `preferenceSalesType=CREDIT`, `prospectStatus=PROSPECT`, channel id/name dari identity aktif, `occupation`, `religion=ISLAM`, `sourceOfProspectHsoId`.
- MEDIUM/HOT: province, district, subdistrict, village (ID+nama), postal code, RT, RW, address.
- Opsional: catalogue unit description/color, ID number/NIK, description, occupation HSO ID/name/code.
- Setelah create MEDIUM/HOT: mutation `ensureUpdateCustomerProspectStatusFromCustomers` ke level target; kegagalan update ditelan sehingga create dapat sukses tetapi status tetap PROSPECT.

**Validasi bot**

- Nama minimal 2 karakter.
- HP: buang non-digit, awalan `0` menjadi `62`, minimal 10 digit; tidak ada batas maksimum eksplisit.
- Motor: 2–6 alfanumerik; kode yang tidak ada katalog tetap diterima jika format valid.
- Pekerjaan minimal 2 karakter dan dicocokkan secara substring case-insensitive ke 23 mapping occupation HSO.
- NIK: hanya memeriksa minimal 16 digit (bukan tepat 16).
- Alamat minimal 5 karakter.
- Status upgrade hanya naik menurut map, walau map juga menawarkan `LOST`.

**Output bot**: preview; sukses berisi nomor prospek, customer, HP, asal, field opsional, status; error dapat dicoba ulang dari tombol confirm.

**Portal saat ini**

- Field: customerName, phone, level, motor, province, district, subDistrict, village.
- Validasi: nama 3–100; HP regex 9–15 digit dengan opsional `+`; level enum; field lokasi/motor ≤100.
- Menyimpan status `DRAFT` di SQLite milik owner session, bukan STAR.
- Belum ada asal, pekerjaan, gender, agama, NIK, alamat bebas, RT/RW, postal code, sales type/test ride, katalog/mapping wilayah, preview/confirm, duplicate check, nomor/status STAR.

**Status: 🟡 UI/data lokal parsial, 0% integrasi STAR.**

### 2. Cari dan detail prospek

- Query: `getCustomerProspectFromCustomers(first: 50)` dengan field id, nomor, nama, HP, status, created, NIK, alamat, description, unit color description.
- Filter nama substring case-insensitive atau HP substring; tampilkan maksimum 10 hasil.
- Detail menampilkan field tersedia dan tombol upgrade yang valid.
- Portal hanya list draft owner (maks. 200) dan list admin ber-cursor; tidak mencari atau membaca STAR.

**Status: ❌. Kelas READ-ONLY; kandidat integrasi STAR pertama.**

### 3. Upgrade status

- Flow: cari → pilih → query ulang berdasarkan id → validasi transition → preview → konfirmasi → `ensureUpdateCustomerProspectStatusFromCustomers` dengan reason bot.
- Transition bot: LOW/PROSPECT→MEDIUM/HOT/DEAL/LOST; MEDIUM→HOT/DEAL/LOST; HOT→DEAL/LOST. Tidak ada downgrade.
- Output: old→new; pesan khusus DEAL; retry/error.
- PATCH portal hanya mengganti level draft LOW/MEDIUM/HOT tanpa hierarchy dan tanpa STAR.

**Status: ❌ parity STAR / 🟡 fungsi lokal yang namanya mirip namun semantiknya berbeda. Kelas MUTATION.**

### 4. Aktivitas

Modul `star-activity.js` melakukan:

1. `getAttendanceValidationFromActivity` untuk activity assignment/id/type/name.
2. Untuk setiap aktivitas, `getListStaffDetailActivityFromActivity(activityId)` untuk staff, clock-in/out.
3. Parse ISO duration/timestamp ke WITA.
4. Output all (BTL+POS), POS-only, atau BTL-only, dikelompokkan belum clock-in/sedang bekerja/sudah clock-out dan summary total.

Catatan: query staff dilakukan sinkron satu per aktivitas; perlu bounded concurrency/caching di web. **Status: ❌, READ-ONLY.**

### 5. FF / Excel / text batch

**Input**

- Text multi-line format spasi atau pipe berawalan `individu`.
- Upload `.xlsx/.xls/.csv/.txt`.
- Excel mencari sheet `MEDIUM` atau sheet pertama dengan header Nama/JenisSales.
- Header: jenisSales, kodeAsalProspek, nama, gender, alamat, kodeProvinsi, kodeKota, kecamatan, kelurahan, RT, RW, agama, pekerjaan, nomorHP, preferensiTesRide, preferensiPembelian, tipeMotor, NIK/nomorNIK.
- Hanya baris jenis `individu`.
- Level Excel: HOT bila kolom NIK ada; MEDIUM bila kolom alamat/wilayah/motor ada; selain itu LOW. CSV/TXT/text: LOW bila seluruh data tanpa motor dan alamat default, selain itu MEDIUM.

**Normalisasi/validasi**

- Prefix wajib `individu`, minimal 10 part.
- HP dinormalisasi ke `62...`; gender LAKI_LAKI/PEREMPUAN; RT/RW buang nol depan; default agama ISLAM; payment tunai/kredit.
- Wilayah memakai mapping lokal, fallback SEPAKU; motor batch hanya diterima bila ada di daftar lokal (berbeda dengan create manual yang menerima free code).
- Occupation memakai mapping lokal.
- HOT hanya mengirim NIK tepat 16 digit.
- Preview file dibatasi 5 detail; preview text saat state aktif tidak dibatasi.

**Submit/batching**

- Konfirmasi tunggal “Kirim Semua”.
- Query seluruh prospek sekali untuk dedup HP; local set mencegah HP ganda satu batch. Jika query dedup gagal, proses tetap lanjut hanya dengan local dedup.
- Per row: create STAR; lalu follow-up WA untuk semua level. Error follow-up ditelan.
- Progress sekitar setiap 20% (minimum interval 3 item).
- Delay hanya setelah item yang dianggap sukses: LOW acak basis 1/2/3 menit, MEDIUM 2/4/5, HOT 3/5/7, masing-masing jitter ±20% dari basis.
- Estimasi UI 2/4/5 menit per item (LOW/MEDIUM/HOT).
- Output akhir: count baru, duplicate, gagal, parse error; detail sukses maks. 10 dan gagal maks. 5.

**Status: ❌, MUTATION-DANGEROUS.** Harus menjadi background job persisten; jangan menahan HTTP request selama berjam-jam.

### 6. Bulk Not Deal

- Pilih status HOT/MEDIUM/LOW/ALL; alasan efektif selalu `Ada keperluan lain`.
- Preview melakukan pagination `first:10`, delay 2 detik antarpages, filter prefix nomor, status, creator dari subject JWT, serta **rentang tanggal hardcoded Juli 2026**.
- Preview menampilkan count/nama per status dan peringatan irreversible.
- Execute query ulang per status/page; skip DEAL/LOST; mutation status menjadi LOST dengan `reasonNotDeal`. Dengan sengaja **tidak** menambah follow-up kedua karena dapat mengaktifkan ulang prospek.
- Delay sukses 5–10 detik; setiap 15 sukses berhenti 3–4 menit; progress per item; hasil count OK/skip/gagal dan nama per level, detail gagal maks. 5.

**Status: ❌, MUTATION-DANGEROUS (irreversible).** Wajib perbaiki filter tanggal menjadi eksplisit/dinamis sebelum implementasi.

### 7. Leads

- Query New: `leadsByAssignmentFromCrm(input:{isOntrack:false,isOverdue:false},first:50)`; tetap filter `isOverdue===true` client-side karena filter API disebut rusak; dedup assignment id.
- Query On Track: input `isOntrack:true,isOverdue:false`, first 50; dedup assignment id.
- Preview list nama/telepon dan bulk max 20 nama.
- Mutation per lead `ensureSaveFollowUpSalesmanFromCrm` dengan nilai tetap: WhatsApp Chat, Contacted, “Chat terkirim, dibalas”, “Tidak Tertarik”, “Ada keperluan lain”, notes “belum”.
- Konfirmasi irreversible; delay sekitar 30 detik dengan jitter; output OK/gagal dan maksimal 5 error.

**Status: ❌. Listing READ-ONLY; bulk follow-up MUTATION-DANGEROUS.**

### 8. Account/JWT/vault

Bot memiliki vault JSON global berisi email/password, JWT per file, active JWT global, CRUD account, expiry status, relogin child process, dan switch JWT. Hapus akun juga menghapus file JWT. Password ditampilkan hanya sebagai ada/tidak, tetapi disimpan plaintext.

Portal memiliki desain berbeda dan lebih aman: akun portal per-user, login ASSIST ephemeral, access/refresh token AES-256-GCM per user, status koneksi aman tanpa token, bounded login jobs, MFA number, timeout/cancel saat suspend/disconnect/shutdown, dan audit. Tidak ada active identity global.

**Keputusan parity:** parity harus pada *capability* (user dapat connect/reconnect/status/disconnect dan query STAR sebagai dirinya), bukan menyalin file/vault global bot. Jangan buat field “Set JWT”, password vault, atau switch global.

### 9. EOM reset

Saat proses bot startup, jika hari lokal terakhir bulan, bot query maksimum 50 prospek lewat `QRY_SEARCH`, lalu mengubah semuanya ke LOST satu per satu tanpa preview, filter status/owner eksplisit, alasan, delay, checkpoint, atau operator confirmation. Tidak ada scheduler periodik selain check saat startup.

**Status: ❌, MUTATION-DANGEROUS tertinggi.** Jangan parity literal. Implementasi web hanya boleh sebagai job admin terjadwal dengan dry-run, scope tenant/owner/periode, exclusion DEAL/LOST, approval dua langkah, idempotency, checkpoint, dan laporan.

## Matriks query/mutation STAR

| Operasi STAR | Dipakai oleh bot | Input/filter penting | Output | Status web |
|---|---|---|---|---|
| `getCustomerProspectFromCustomers` | search/detail, dedup FF, upgrade verification, EOM | default `first:50`; bulk ND `first:10` + cursor/status/prefix/creator/date | prospek + pageInfo (bulk) | ❌ |
| `ensureCreateCustomerProspectFromCustomers` | create manual, FF | customer/contact/channel/source/wilayah/motor/occupation | id, prospectNumber, created, status | ❌ |
| `ensureUpdateCustomerProspectStatusFromCustomers` | create MEDIUM/HOT, upgrade, not-deal, EOM | id, status, reason/reasonNotDeal | id/name/status | ❌ |
| `ensureCreateFollowUpProspectFromCustomers` | FF sesudah create | id, method WA, result, date, description | id | ❌ |
| `leadsByAssignmentFromCrm` | New/On Track | isOntrack/isOverdue, first 50 | assignment/customer/phone/flags | ❌ |
| `ensureSaveFollowUpSalesmanFromCrm` | bulk leads | assignment id + fixed follow-up fields | scalar/result | ❌ |
| `getAttendanceValidationFromActivity` | activity | tanpa variable | activity IDs/type/name | ❌ |
| `getListStaffDetailActivityFromActivity` | activity | activity UUID | staff + clock times | ❌ |

## Output dan UX yang perlu dipertahankan di web

1. Preview sebelum mutation, termasuk identity sales/channel yang akan dipakai.
2. Result per operasi: nomor/id, status sebelum→sesudah, sukses/duplicate/skip/gagal.
3. Error per item (dibatasi di UI, seluruhnya tersedia sebagai CSV/log aman).
4. Progress persisten untuk batch; ETA; tombol tidak dapat diklik ulang ketika job aktif.
5. Empty states dan session/job expired yang jelas.
6. Waktu ditampilkan WITA.
7. Audit: actor portal, subject ASSIST, operation, target IDs/count, confirmation timestamp, result; **tanpa token, password, full request credential, atau NIK/HP mentah di log**.

## Gap dan risiko/kecacatan yang ditemukan di bot (jangan disalin)

1. **HOT manual kemungkinan tidak mengirim NIK:** caller memberi property `iDNumber`, sedangkan `createProspek()` membaca `data.nik`.
2. **Auto-detect FF “anytime” tidak terjangkau:** handler melakukan `if (!s) return` sebelum blok yang mensyaratkan `!s`.
3. **State preview Bulk Not Deal tertimpa:** state lengkap `_ndNames/_ndCounts/_ndTotal` disimpan lalu langsung ditimpa state yang dibangun dari object lama; execute dapat kehilangan metadata preview.
4. **Bulk Not Deal hardcoded Juli 2026**, prefix dealer dan UUID creator aktif; berisiko salah periode/scope.
5. **EOM hanya first 50**, dan mengubah semua node hasil query tanpa konfirmasi/filter eksplisit.
6. Search/dedup umum menggunakan first 50, sehingga bukan pencarian/dedup menyeluruh jika pagination tidak ditangani `callStar` lain.
7. Create MEDIUM/HOT menelan kegagalan status update; sukses parsial tidak ditandai kepada user.
8. FF menelan kegagalan follow-up; hasil tetap dihitung create sukses tanpa status partial.
9. Parser/semantik payment tidak konsisten (`statusKredit` dinormalisasi lowercase, tetapi submit membandingkan `=== 'KREDIT'`), sehingga preference dapat tidak terkirim.
10. Manual create motor keyboard menyimpan kode saja sebagai description katalog, sementara input teks menyimpan nama; FF memakai `KODE-NAMA`; kontrak tidak konsisten.
11. Validation NIK manual “minimal 16” bukan tepat 16; HP tidak dibatasi maksimum.
12. Vault bot menyimpan password plaintext dan token di file; tidak sesuai standar portal.
13. Mutation synchronous dan delay panjang berada dalam event handler; tidak tahan restart dan mudah double-submit.
14. Bulk preview menyatakan “Ketik YA” tetapi eksekusi sebenarnya via tombol; kontrak UI membingungkan.
15. Daftar `REASONS_NOT_DEAL`/callback alasan tersedia tetapi flow efektif memakai alasan tetap; dead/legacy surface.

## Urutan implementasi aman

| Tahap | Implementasi | Risiko | Gate selesai |
|---:|---|---:|---|
| 0 | Ekstrak kontrak STAR client **baru** untuk portal; token dari koneksi per-user terenkripsi; timeout, schema validation, redaction, correlation id; bot tidak diubah | Fondasi | Unit test mock GraphQL; tidak ada secret/log PII; ownership/RBAC terbukti. |
| 1 | Metadata lokal/read-only: katalog motor, asal, occupation, wilayah; form kondisional dan validasi server-side; preview draft | LOCAL | Field parity; NIK tepat 16; HP normalisasi+batas; tidak ada STAR mutation. |
| 2 | Read-only STAR: connection check, activity reports, search/detail prospek, listing leads New/On Track dengan pagination | READ-ONLY | Pagination lengkap, cache/bounded concurrency, owner identity tampil, audit query minimal. |
| 3 | Submit **satu** prospek dengan preview+confirm+idempotency key; tangani create + update status sebagai hasil dua langkah/partial | MUTATION | Double-click aman; status partial terlihat; read-back STAR diverifikasi. |
| 4 | Upgrade satu prospek dengan server-side transition validation, re-read sebelum mutation, confirm, audit | MUTATION | Downgrade ditolak; stale status/concurrency ditangani. |
| 5 | Parser FF/upload sebagai dry-run lokal; preview, error export, dedup lokal; tanpa mutation | LOCAL | Fuzz/fixture test xlsx/xls/csv/txt; file size/row limit; malware/formula handling. |
| 6 | FF submit sebagai background job persisten dengan per-item idempotency/checkpoint/retry terbatas/cancel; dedup STAR paginated | MUTATION-DANGEROUS | Restart-safe; rate-limit config; progress/result lengkap; tidak ada request HTTP panjang. |
| 7 | Bulk leads, diawali listing/selection; values follow-up eksplisit; typed confirmation + job queue | MUTATION-DANGEROUS | Scope preview hash sama dengan execute; max batch; approval/kill switch. |
| 8 | Bulk Not Deal setelah membuang tanggal/prefix hardcoded; filter periode/owner/dealer eksplisit; dry-run snapshot + typed confirmation | MUTATION-DANGEROUS | Snapshot immutable/TTL; revalidation; max batch; no second follow-up; admin policy. |
| 9 | EOM sebagai job admin terjadwal, bukan startup side effect; dry-run + dual approval + exclusions + checkpoint | MUTATION-DANGEROUS | Uji sandbox, two-person approval, rollback/incident runbook, global kill switch. |

## Guardrail minimum untuk semua mutation STAR

- Hanya SALES aktif dengan koneksi ASSIST valid miliknya; admin tidak boleh “menjadi sales” secara implisit.
- CSRF, RBAC, same-owner check, rate limit, idempotency key, dan audit append-only.
- Re-fetch target tepat sebelum commit; preview memiliki hash/scope/expiry dan invalid jika data berubah.
- Satu job aktif per actor/jenis; batas row dan target; retry hanya error transient dan tidak untuk mutation tanpa idempotency.
- Token/password selalu `[REDACTED]`; NIK/HP dimasking di UI admin/log; credential tidak masuk queue payload persisten.
- Configurable delay/rate limit berdasarkan batas resmi STAR, bukan klaim “agar tidak terdeteksi spam”.
- Circuit breaker/kill switch; cancellation kooperatif; checkpoint; summary partial success.
- Tidak mengimpor `bot.js` (karena import langsung memulai polling, PID logic, dan EOM check). Ekstrak hanya pure mappings/parser ke modul baru setelah test karakterisasi.

## Inventaris portal web saat audit

**Sales:** register/login/logout, `/api/me`, form/list/update level draft prospek lokal, koneksi ASSIST per-user (start/poll login job, MFA, connection status, disconnect).

**Admin:** list/approve/reject/suspend user, list draft prospek lintas sales dengan level/status/cursor, audit log lokal.

**Keamanan yang sudah ada:** session server-side 12 jam, HttpOnly/SameSite cookie, CSRF untuk mutation, RBAC, owner isolation, login rate limit, password scrypt, revoke session saat suspend, CSP/security headers, encrypted ASSIST token. Semua ini harus dipertahankan saat menambah parity STAR.

## Definisi “parity selesai”

Parity dinyatakan selesai bila setiap capability bot memiliki padanan web yang setara atau keputusan eksplisit “diganti desain lebih aman”, dan untuk setiap operasi terdapat: field+default yang terdokumentasi, validasi client/server, identity/scope, preview/confirmation, query pagination, mutation idempotency, progress/delay/job semantics, hasil sukses/partial/gagal, audit aman, serta test mock + sandbox. Draft SQLite portal **tidak boleh disebut prospek STAR** sebelum submit dan read-back STAR berhasil.

---

**Kesimpulan:** prioritas teraman adalah metadata/form parity → query read-only → submit satu prospek → upgrade satu prospek → dry-run parser → batch jobs. Bulk Not Deal dan EOM harus paling akhir karena irreversible dan implementasi bot saat ini memiliki hardcoded scope serta kelemahan checkpoint/pagination yang tidak boleh diwariskan.
