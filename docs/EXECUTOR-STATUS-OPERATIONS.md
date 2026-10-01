# Executor Status ASSIST — Runbook

## State machine

`PREVIEW → CONFIRMED → RUNNING → SUCCEEDED | FAILED | UNKNOWN`

Jalur aman lain: `PREVIEW → CANCELLED | EXPIRED`, serta `CONFIRMED → STALE_SOURCE` ketika status aktual berbeda dari snapshot.

## Safety controls

- Executor hanya aktif jika `ASSIST_MUTATION_ENABLED=true`.
- Token berasal dari vault terenkripsi milik Sales owner; tidak ada token global/Admin fallback.
- Sebelum mutation: akun Sales ACTIVE, koneksi CONNECTED, token belum kedaluwarsa, prospek masih owner-visible, dan status aktual sama dengan `from_status`.
- Claim atomik hanya dari `CONFIRMED` ke `RUNNING`.
- Payload STAR authoritative memakai `reasonNotDeal`.
- Timeout/transport ambiguity menjadi `UNKNOWN` dan tidak diulang otomatis.
- Setelah respons sukses, status dibaca ulang; mismatch menjadi `UNKNOWN`.
- Startup mengubah sisa `RUNNING` menjadi `UNKNOWN/WORKER_RESTARTED`, tidak replay.
- Shutdown menunggu worker maksimum 30 detik; sisa `RUNNING` menjadi `UNKNOWN/SHUTDOWN_TIMEOUT`.

## Operasional

- `UNKNOWN` tidak boleh di-retry otomatis. Periksa status aktual ASSIST melalui detail prospek.
- `STALE_SOURCE` aman: tidak ada mutation dikirim.
- `FAILED` boleh dibuat sebagai intent baru hanya setelah penyebab diperbaiki dan status aktual dibaca ulang.
- Audit actions: `ASSIST_STATUS_PREVIEW`, `ASSIST_STATUS_CONFIRM`, `ASSIST_STATUS_EXECUTE`, `ASSIST_STATUS_CANCEL`.

## Rollback

1. Set `ASSIST_MUTATION_ENABLED=false` dan restart hanya `prospek-web.service`.
2. Pastikan tidak ada operasi `RUNNING`.
3. Pulihkan artifact dari `/root/prospek-web-rollbacks/<commit>/` bila code rollback diperlukan.
4. Jangan pernah me-replay operasi `UNKNOWN`.
