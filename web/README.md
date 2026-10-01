# Portal Prospek Web

Website pendamping `@Rd_prospek_bot`. Aplikasi ini **tidak mengimpor, menjalankan, menghentikan, atau mengganti bot Telegram**. Database dan process service terpisah.

## Fitur yang sudah bekerja

- Registrasi akun sales dengan status awal `PENDING`.
- Login ditolak sebelum persetujuan admin.
- Login admin.
- Daftar permohonan akun.
- Approve, reject, dan suspend akun sales.
- Session server-side dengan cookie HttpOnly/SameSite.
- CSRF protection pada aksi admin.
- RBAC backend: sales mendapat 403 pada endpoint admin.
- Suspend mencabut seluruh session sales.
- Password di-hash dengan Node `scrypt` + salt acak.
- SQLite terpisah dengan foreign keys dan WAL.
- Audit log registrasi, login, approval, reject, dan suspend.
- Dashboard Sales/Admin responsif.
- Input draft prospek LOW/MEDIUM/HOT.
- Daftar prospek terisolasi per Sales; `owner_id` selalu berasal dari session backend.
- Sales lain tidak dapat membaca atau mengubah prospek yang bukan miliknya.
- Rate limiting login: 5 kegagalan per IP+email dalam 15 menit.
- Vault token ASSIST terenkripsi per Sales, read model tenant-safe, activity, follow-up, batch draft, Bulk Not Deal, dan submit draft→STAR melalui preview/confirm persisten.

## Menjalankan lokal

```bash
cd web
export PORTAL_ADMIN_EMAIL='admin@example.invalid'
export PORTAL_ADMIN_PASSWORD='ganti-dengan-password-kuat'
npm test
npm start
```

Server hanya bind ke `127.0.0.1:3210`.

## Deployment berdampingan

Gunakan service baru, misalnya `prospek-web.service`. Jangan mengubah `prospek-bot.service`.

Environment produksi wajib:

- `PORTAL_ADMIN_EMAIL`
- `PORTAL_ADMIN_PASSWORD` minimal 12 karakter
- `PORT` opsional, default `3210`
- `ASSIST_MASTER_KEY` wajib sebelum koneksi ASSIST diaktifkan; base64 dari 32 byte acak, disimpan hanya di environment produksi permission `0600`
- `ASSIST_CHROMIUM_PATH` menunjuk binary Chromium khusus portal; browser context baru dibuat per login dan selalu ditutup setelah sukses, gagal, atau timeout
- `ASSIST_MUTATION_ENABLED=false|true` untuk executor status lama.
- `ASSIST_PARITY_MUTATION_ENABLED=false|true`; default dan nilai wajib saat rollout awal adalah `false`.

Publikasikan melalui reverse proxy/Cloudflare Tunnel ke `127.0.0.1:3210`. Jangan membuka port aplikasi langsung ke internet.

Deployment produksi menggunakan user Linux dan service terpisah dari bot. Template terverifikasi tersedia di `deploy/`. Credential tunnel, `.env`, database, dan password admin tidak termasuk repository.

URL produksi Astra Motor Penajam: `https://prospek.radi.biz.id`.

## Mutation safety

Mutation parity tersedia tetapi default OFF. Preview/read/cancel tetap dapat digunakan saat OFF. Confirm create/follow-up/Bulk hanya boleh diaktifkan setelah artifact immutable lulus test, audit, migration smoke, dan independent review. Outcome POST ambigu menjadi `UNKNOWN` dan tidak pernah blind retry.

## Tests

```bash
npm test
```

Menguji:

1. Registrasi selalu PENDING.
2. Sales pending tidak dapat login.
3. Admin dapat approve.
4. Sales approved dapat login.
5. Sales tidak dapat mengakses endpoint admin.
6. Suspend mencabut session.
7. Mutasi admin tanpa CSRF ditolak.

## Security notes

- Dependency runtime dikunci melalui `package-lock.json`; `.xlsx` dibaca dengan `read-excel-file`.
- `npm audit`: 0 vulnerability.
- Content Security Policy, frame denial, MIME sniffing protection, dan referrer policy aktif.
- Database, `.env`, dan log diabaikan Git.
- Token ASSIST disimpan terenkripsi per Sales, didekripsi hanya dalam memori server, dan tidak dikirim ke browser/log/audit/operation row.
