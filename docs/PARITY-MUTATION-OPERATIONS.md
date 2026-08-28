# Operasi Mutation Parity Portal

## Batas layanan

- Portal: service `prospek-web.service`, bind `127.0.0.1:3210`.
- Bot Telegram: service terpisah. Deployment portal tidak boleh mengubah atau merestart bot.
- Credential ASSIST tersimpan terenkripsi per Sales. Token hanya didekripsi dalam memori server.

## Switch

- `ASSIST_MUTATION_ENABLED=true`: executor upgrade status lama.
- `ASSIST_PARITY_MUTATION_ENABLED=false`: default aman untuk create draft→STAR, recovery create→upgrade, follow-up, dan Bulk Not Deal.
- Preview, cancel, owner-only status, activity read-only, dan batch draft lokal tetap tersedia saat parity switch OFF.
- Jangan aktifkan parity switch sebelum exact artifact lulus test, audit, migration smoke, independent security review, dan database tidak memiliki operasi `CONFIRMED`/`RUNNING` yang tidak dikenal.

## State create draft→STAR

- `PREVIEW`: snapshot draft canonical tersimpan; belum POST.
- `RUNNING`: create sedang berjalan. Restart mengubahnya menjadi `UNKNOWN`; tidak pernah replay create.
- `SUCCEEDED`: create dan read-back selesai.
- `DUPLICATE`: nomor HP sudah ada upstream; tidak POST.
- `PARTIAL`: create berhasil, upgrade MEDIUM/HOT gagal. Recovery hanya update status, tidak create ulang.
- `RECOVERING`: recovery upgrade sedang berjalan. Restart mengembalikan ke `PARTIAL`.
- `UNKNOWN`: outcome create ambigu. Jangan ulang create; lakukan rekonsiliasi upstream.
- `FAILED`, `STALE_SOURCE`, `CANCELLED`: terminal sesuai error/source/operator.

## State follow-up dan Bulk Not Deal

- Operation: `PREVIEW`, `CONFIRMED`, `RUNNING`, terminal summary.
- Item: `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `UNKNOWN`, `STALE`.
- Restart mengubah item `RUNNING` menjadi `UNKNOWN`; POST item tidak diulang otomatis.
- GraphQL reject eksplisit menjadi `FAILED`; timeout/transport/schema ambigu menjadi `UNKNOWN`.
- `LOST` tidak diikuti follow-up kedua karena dapat mengaktifkan prospek kembali.

## Batch file

- Format diterima: `.csv`, `.txt`, `.xlsx`.
- `.xls` dan `.xlsm` ditolak.
- Maksimum 1 MiB dan 500 baris.
- Parser fail-closed untuk UTF-8 invalid, formula injection, schema/header invalid, duplikat dalam file, dan row unsafe.
- Konfirmasi batch hanya membuat draft lokal secara transaksi atomik. Kirim ke STAR tetap memakai preview/confirm per draft.

## Rollout

1. Buat commit immutable setelah full tests, `npm audit --omit=dev`, syntax, diff, dan secret scan lulus.
2. Independent review commit; BLOCK menghentikan rollout.
3. Backup DB dan artifact rollback.
4. Deploy artifact dengan `ASSIST_PARITY_MUTATION_ENABLED=false`.
5. Jalankan migration smoke, health lokal/publik, RBAC/CSRF, read-only activity, preview/cancel, dan cek journal.
6. Pastikan tidak ada operasi `CONFIRMED`, `RUNNING`, `RECOVERING`, atau replay tak dikenal.
7. Aktifkan `ASSIST_PARITY_MUTATION_ENABLED=true`, restart hanya `prospek-web.service`.
8. Uji mutation hanya dengan prospek uji/intent Sales sah. Jangan membuat mutation pelanggan nyata otomatis.
9. Verifikasi public HTTPS, state terminal, audit, SQLite integrity, restart count, dan bot Telegram tidak berubah.

## Rollback

1. Set `ASSIST_PARITY_MUTATION_ENABLED=false` lebih dulu.
2. Restart hanya `prospek-web.service`.
3. Jika code rollback dibutuhkan, restore artifact immutable sebelumnya; jangan downgrade DB tanpa migration teruji.
4. Operasi `RUNNING` pasca-crash harus diperlakukan `UNKNOWN`, bukan direplay.
5. Rekonsiliasi STAR berdasarkan owner dan nomor HP sebelum tindakan manual.

## Larangan

- Jangan menulis token/password ke log, audit, operation row, browser, Git, atau dokumen.
- Jangan retry POST create/follow-up/status yang outcome-nya ambigu.
- Jangan menerima target ID, owner, tenant, channel, source UUID, atau Sales identity dari browser.
- Jangan mengaktifkan bulk tanpa preview eksplisit dan intent operator sah.
- Jangan menyimpulkan bot mati dari service manager/host yang bukan authority.
