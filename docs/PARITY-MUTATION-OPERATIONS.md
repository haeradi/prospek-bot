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

### Perintah deployment exact

Jalankan dari checkout immutable yang sudah direview. Ganti `<SHA>` hanya dengan commit berstatus PASS.

```bash
set -euo pipefail
SHA='<SHA>'
STAMP="$(date -u +%Y%m%d-%H%M%S)"
BACKUP=/var/backups/prospek-web
install -d -m 0700 "$BACKUP"

# Backup artifact dan SQLite secara konsisten, termasuk checkpoint WAL.
tar -C /opt -czf "$BACKUP/app-$STAMP.tgz" prospek-web
sqlite3 /var/lib/prospek-web/data/portal.db 'PRAGMA wal_checkpoint(FULL); PRAGMA integrity_check;'
sqlite3 /var/lib/prospek-web/data/portal.db ".backup '$BACKUP/portal-$STAMP.db'"
sha256sum "$BACKUP/app-$STAMP.tgz" "$BACKUP/portal-$STAMP.db"
printf '%s\n' "$STAMP" > "$BACKUP/LATEST.tmp"
mv "$BACKUP/LATEST.tmp" "$BACKUP/LATEST"

# Pastikan tidak ada pekerjaan aktif/tidak dikenal sebelum install.
sqlite3 -header -column /var/lib/prospek-web/data/portal.db "
SELECT 'submit' kind,id,status FROM prospect_submit_operations WHERE status IN ('CONFIRMED','RUNNING','CREATED','PARTIAL','RECOVERING')
UNION ALL SELECT 'followup',id,status FROM followup_operations WHERE status IN ('CONFIRMED','RUNNING')
UNION ALL SELECT 'bulk',id,status FROM bulk_not_deal_operations WHERE status IN ('CONFIRMED','RUNNING');"

# Assemble artifact exact, dependencies lockfile, dan runtime assets.
rm -rf /opt/prospek-web.new
git worktree add --detach /opt/prospek-web.new "$SHA"
(cd /opt/prospek-web.new/web && npm ci --omit=dev)
test -f /opt/prospek-web.new/web/data/master-data.json
chown -R prospekweb:prospekweb /opt/prospek-web.new

# Switch harus OFF pada first restart.
grep -q '^ASSIST_PARITY_MUTATION_ENABLED=false$' /etc/prospek-web.env
mv /opt/prospek-web /opt/prospek-web.previous
mv /opt/prospek-web.new /opt/prospek-web
systemctl restart prospek-web.service

# Bounded readiness dan verifikasi.
ready=false
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3210/health; then ready=true; break; fi
  sleep 1
done
test "$ready" = true
curl -fsS https://prospek.radi.biz.id/ >/dev/null
sqlite3 /var/lib/prospek-web/data/portal.db 'PRAGMA integrity_check;'
systemctl show prospek-web.service -p ActiveState -p SubState -p NRestarts
journalctl -u prospek-web.service --since '-5 minutes' --no-pager
```

Stop timeout unit harus lebih besar dari drain aplikasi 45 detik, misalnya `TimeoutStopSec=60s`.

## Rollback

1. Set `ASSIST_PARITY_MUTATION_ENABLED=false` lebih dulu.
2. Restart hanya `prospek-web.service`.
3. Jika code rollback dibutuhkan, restore artifact immutable sebelumnya; jangan downgrade DB tanpa migration teruji.
4. Operasi `RUNNING` pasca-crash harus diperlakukan `UNKNOWN`, bukan direplay.
5. Rekonsiliasi STAR berdasarkan owner dan nomor HP sebelum tindakan manual.

Setiap deployment menulis timestamp backup yang baru selesai ke
`/var/backups/prospek-web/LATEST`. Rollback wajib membaca manifest tersebut,
bukan memilih timestamp secara manual.

Rollback code tanpa downgrade DB:

```bash
sed -i 's/^ASSIST_PARITY_MUTATION_ENABLED=.*/ASSIST_PARITY_MUTATION_ENABLED=false/' /etc/prospek-web.env
STAMP="$(cat /var/backups/prospek-web/LATEST)"
test -n "$STAMP"
test -f "/var/backups/prospek-web/app-$STAMP.tgz"
systemctl stop prospek-web.service
mv /opt/prospek-web "/opt/prospek-web.failed-$(date -u +%Y%m%d-%H%M%S)"
tar -C /opt -xzf "/var/backups/prospek-web/app-$STAMP.tgz"
systemctl start prospek-web.service
curl -fsS http://127.0.0.1:3210/health
```

Restore DB hanya jika rollback compatibility sudah diuji dan operator menerima kehilangan perubahan setelah backup:

```bash
systemctl stop prospek-web.service
STAMP="$(cat /var/backups/prospek-web/LATEST)"
test -f "/var/backups/prospek-web/portal-$STAMP.db"
install -o prospekweb -g prospekweb -m 0600 "/var/backups/prospek-web/portal-$STAMP.db" /var/lib/prospek-web/data/portal.db
rm -f /var/lib/prospek-web/data/portal.db-wal /var/lib/prospek-web/data/portal.db-shm
systemctl start prospek-web.service
```

## Larangan

- Jangan menulis token/password ke log, audit, operation row, browser, Git, atau dokumen.
- Jangan retry POST create/follow-up/status yang outcome-nya ambigu.
- Jangan menerima target ID, owner, tenant, channel, source UUID, atau Sales identity dari browser.
- Jangan mengaktifkan bulk tanpa preview eksplisit dan intent operator sah.
- Jangan menyimpulkan bot mati dari service manager/host yang bukan authority.
