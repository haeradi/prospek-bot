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
- Placeholder aman untuk koneksi ASSIST dan input prospek tahap berikutnya.

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

Publikasikan melalui reverse proxy/Cloudflare Tunnel ke `127.0.0.1:3210`. Jangan membuka port aplikasi langsung ke internet.

## Batas fase ini

Mutasi ASSIST, login Microsoft MFA, dan upload Excel belum diaktifkan. UI menandainya dengan jelas. Tahap berikutnya akan mengekstrak ASSIST client menjadi modul bersama tanpa menghentikan bot Telegram.

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

- Tidak ada dependency runtime eksternal pada fase ini.
- `npm audit`: 0 vulnerability.
- Content Security Policy, frame denial, MIME sniffing protection, dan referrer policy aktif.
- Database, `.env`, dan log diabaikan Git.
- Token ASSIST tidak disimpan atau ditampilkan pada fase ini.
