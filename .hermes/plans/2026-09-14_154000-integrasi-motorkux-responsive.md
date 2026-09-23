# Integrasi Motorku X Responsif Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Menambahkan seluruh kemampuan operasional `@Motorkux_bot` ke Portal Tools dengan UI responsif Web/Desktop, Tablet, dan Mobile, alur registrasi tanpa OTP, master wilayah resmi Motorku X, pembatasan role, serta mutasi aman berbasis preview/confirm.

**Architecture:** Modul Motorku X menjadi bounded context terpisah di dalam companion web service yang sudah ada. Browser hanya menerima data aman; seluruh token Motorku X, enkripsi request, validasi wilayah, idempotency, dan eksekusi upstream berada di server. Bot Telegram dan service produksinya tetap independen dan tidak disentuh.

**Tech Stack:** Node.js built-in HTTP server, SQLite `node:sqlite`, HTML/CSS/vanilla JavaScript, Node test runner, Motorku X REST adapter, AES envelope compatibility sesuai bot, systemd, Cloudflare Tunnel.

---

## 1. Konteks dan Keputusan Tetap

- Repository kerja: `/root/prospek-bot-web-pr`.
- Portal production: `https://prospek.radi.biz.id/`.
- Bot production: VM 200, `/home/ubuntu/motorkux-register-bot`, `motorkux-bot.service` milik user `ubuntu`.
- Bot tidak boleh diubah, dihentikan, atau direstart selama pekerjaan portal.
- Registrasi web mengikuti perilaku bot: daftar → simpan token → selesai; tidak ada kirim/input/consume OTP.
- Master wilayah hanya berasal dari API Motorku X:
  - `GET /api/location/province`
  - `GET /api/location/regional_city/{regional_id}`
- Kontrak identifier wilayah Motorku X bukan UUID:
  - provinsi: integer `id`, string `province_code`, `name`;
  - kota: integer `id`, integer `province_id`, string `city_code`, string `province_code`, `name`, `pivot.regional_id`.
- Snapshot analisis saat ini: 39 provinsi, 421 kota/kabupaten, 38 provinsi memiliki kota.
- Anomali upstream wajib fail closed:
  - Papua Pegunungan tersedia sebagai provinsi tetapi belum memiliki kota;
  - Kota Sungai Penuh memiliki konflik `province_id` dan `province_code`.
- UUID ASSIST tidak boleh digunakan, ditampilkan, atau dikirim dalam modul Motorku X.
- Desain dan PRD harus disetujui sebelum implementasi production dimulai.

## 2. Breakpoint dan Kontrak Tampilan

- **Mobile:** 360–599 px; satu kolom, bottom navigation, sticky action aman terhadap safe-area.
- **Tablet:** 600–1023 px; navigation rail ringkas, form dua kolom bila muat, region picker menjadi side sheet/modal.
- **Web/Desktop:** ≥1024 px; sidebar Portal Tools, workspace dua kolom, preview/status panel sticky di kanan.
- Seluruh target sentuh minimal 44×44 px.
- Tidak ada document-level horizontal overflow pada 360, 390, 768, 1024, dan 1440 px.
- Tabel besar memakai container scroll dengan petunjuk eksplisit; halaman tidak ikut melebar.
- State wajib: loading, empty, validation error, upstream unavailable, preview, processing, success, failed, unknown.

## 3. Role Matrix

| Kemampuan | Owner | Admin | Sales | Team Leader/User non-operasional |
|---|---:|---:|---:|---:|
| Ringkasan global | Ya | Ya | Tidak | Tidak |
| Daftar customer | Ya | Ya | Ya, miliknya | Tidak |
| Daftar + motor | Ya | Ya | Ya, miliknya | Tidak |
| Tambah motor | Ya | Ya | Ya, miliknya | Tidak |
| Login ulang | Ya | Ya | Hanya miliknya | Tidak |
| Transfer/hapus motor | Ya | Ya | Ajukan/terbatas sesuai PRD | Tidak |
| Batch teks/Bulk Excel | Ya | Ya | Tidak | Tidak |
| Riwayat | Semua | Semua | Miliknya | Tidak |
| Retensi/audit | Ya | Terbatas | Tidak | Tidak |

Semua pembatasan wajib ditegakkan API server-side; menyembunyikan tombol saja tidak cukup.

## 4. Files Likely to Change

### Dokumen/desain
- Modify: `web/design/PRD-integrasi-motorkux.md`
- Create: `web/design/motorkux-register-responsive.html`
- Keep: `web/design/motorkux-regions.json`
- Keep: `web/design/motorkux-regions.csv`

### Backend
- Create: `web/src/motorkux/motorkux-client.js`
- Create: `web/src/motorkux/motorkux-region-service.js`
- Create: `web/src/motorkux/motorkux-account-service.js`
- Create: `web/src/motorkux/motorkux-operation-service.js`
- Create: `web/src/motorkux/motorkux-bulk-service.js`
- Create: `web/src/motorkux/motorkux-routes.js`
- Modify: `web/src/app.js`

### Frontend
- Create: `web/public/motorkux.js`
- Create: `web/public/motorkux.css`
- Modify: `web/public/index.html`
- Modify: `web/public/app.js`
- Modify: `web/public/sw.js`

### Tests
- Create: `web/test/motorkux-region-service.test.js`
- Create: `web/test/motorkux-rbac.test.js`
- Create: `web/test/motorkux-registration.test.js`
- Create: `web/test/motorkux-operation-safety.test.js`
- Create: `web/test/motorkux-bulk.test.js`
- Create: `web/test/motorkux-static-ui.test.js`
- Modify only if fixture wiring requires it: `web/test/helpers.js`

## 5. Task-by-Task Plan

### Task 1: Finalize PRD and Responsive Design

**Objective:** Produce an approved product contract and screenshots before writing production feature code.

**Files:**
- Modify: `web/design/PRD-integrasi-motorkux.md`
- Create: `web/design/motorkux-register-responsive.html`

**Steps:**
1. Rewrite PRD role matrix so Sales sees only owned customer operations.
2. Replace every UUID-region reference with Motorku X integer IDs/codes.
3. Document 39/421 snapshot and two upstream anomalies.
4. Define exact registration fields: name, phone, referral, province, city, consent.
5. Define Web layout: sidebar + form workspace + sticky preview panel.
6. Define Tablet layout: navigation rail + two-column form + region side sheet.
7. Preserve Mobile layout: one column + sticky bottom actions.
8. Render at 1440×1100, 768×1200, and 390×2300.
9. Run visual QA for overflow, clipping, focus, consent state, and role copy.
10. Stop at approval gate and send PRD/screenshots to owner.

**Verification:**
- No `ASSIST` region UUID occurs in responsive prototype.
- No OTP controls/copy occur.
- `province_id`, `province_code`, `city_id`, `city_code` are visible in safe preview.
- Consent unchecked disables confirm/continue.

### Task 2: Add Region Contract Tests

**Objective:** Lock the authoritative Motorku X identifier contract before implementation.

**Files:**
- Create: `web/test/motorkux-region-service.test.js`

**Step 1: Write failing tests**

Tests must assert:
- province projection accepts only integer `id`, string `province_code`, and `name`;
- city projection accepts only integer `id`, integer `province_id`, codes, name, and `regional_id`;
- UUID/ASSIST fields are ignored/rejected;
- city parent mismatch fails closed;
- province without city returns `REGION_CITY_UNAVAILABLE`;
- duplicate ID/code rejects snapshot activation.

**Step 2: Run failure**

Run:
```bash
cd /root/prospek-bot-web-pr/web
/usr/local/lib/prospek-web/node --test test/motorkux-region-service.test.js
```
Expected: FAIL because service does not exist.

**Step 3: Implement minimal service**

Create `web/src/motorkux/motorkux-region-service.js` with schema projection, parent validation, snapshot loader, and safe public output.

**Step 4: Run pass**

Expected: all region tests pass.

**Step 5: Commit selectively**

```bash
git add web/src/motorkux/motorkux-region-service.js web/test/motorkux-region-service.test.js
git commit -m "feat: validate Motorku X region master"
```

### Task 3: Add SQLite Schema and Encrypted Token Boundary

**Objective:** Store accounts and operations independently from Prospek/ASSIST state.

**Files:**
- Create: `web/src/motorkux/motorkux-account-service.js`
- Create: `web/test/motorkux-account-service.test.js`
- Modify: `web/src/app.js`

**Tests first:**
- account owner is server-derived;
- duplicate normalized phone is rejected/idempotent;
- token ciphertext is stored; plaintext never appears in DB/API output;
- account list masks phone and omits token/password;
- delete/suspend Sales makes owned account inaccessible;
- WAL/foreign keys/busy timeout remain enabled.

**Verification:** Run focused tests then full suite.

### Task 4: Add RBAC Routes in Execution-OFF Mode

**Objective:** Expose navigation/read models while upstream mutation remains impossible.

**Files:**
- Create: `web/src/motorkux/motorkux-routes.js`
- Create: `web/test/motorkux-rbac.test.js`
- Modify: `web/src/app.js`

**Tests first:**
- unauthenticated → 401;
- Team Leader/non-operational role → 403;
- Sales sees only owned records;
- Admin/Owner scope follows explicit selected Sales context;
- direct Sales request cannot override owner ID;
- mutation endpoints return `MOTORKUX_EXECUTION_DISABLED` while feature flag is off;
- GET can never mutate.

### Task 5: Build Responsive Read-Only UI

**Objective:** Install approved Web/Tablet/Mobile surfaces without enabling mutations.

**Files:**
- Create: `web/public/motorkux.css`
- Create: `web/public/motorkux.js`
- Modify: `web/public/index.html`
- Modify: `web/public/app.js`
- Modify: `web/public/sw.js`
- Create: `web/test/motorkux-static-ui.test.js`

**Tests first:**
- required static files are allowlisted;
- `[hidden]{display:none!important}` remains effective;
- no OTP form/string;
- no ASSIST UUID sample;
- role navigation differs correctly;
- HTML does not expose token/password.

**Browser QA:** 360, 390, 768, 1024, 1440 widths; keyboard focus and 200% zoom.

### Task 6: Registration Preview (No Upstream Mutation)

**Objective:** Validate a registration draft using live/snapshotted Motorku X regions and referral preflight without creating an account.

**Files:**
- Create: `web/src/motorkux/motorkux-operation-service.js`
- Create: `web/test/motorkux-registration.test.js`

**Tests first:**
- normalized phone/name/referral;
- exact province-city hierarchy;
- mandatory consent with timestamp/actor;
- Papua Pegunungan city selection fails closed;
- Kota Sungai Penuh anomaly fails closed;
- preview contains no password/token;
- preview operation is persistent and owner-bound;
- repeated idempotency key returns same preview.

### Task 7: Registration Confirm Executor

**Objective:** Enable one safe create-account operation matching bot behavior and explicitly excluding OTP.

**Files:**
- Create: `web/src/motorkux/motorkux-client.js`
- Modify: `web/src/motorkux/motorkux-operation-service.js`
- Extend: `web/test/motorkux-registration.test.js`

**Tests first:**
- confirm requires CSRF, correct owner/role, PREVIEW status;
- atomic execution claim permits one upstream call;
- payload contains Motorku X IDs/codes and `is_agree_tnc=true`;
- no OTP endpoint exists/can be called;
- response copy says `AKUN BERHASIL DIBUAT`, never `terverifikasi`;
- timeout after send becomes `UNKNOWN` and is not auto-retried;
- token update is atomic and server-only.

**Activation:** executor remains behind `MOTORKUX_MUTATIONS_ENABLED=false` until pilot approval.

### Task 8: Add Motor, Login, Transfer, and Delete Workflows

**Objective:** Port single-item bot workflows with independent preview/confirm states.

**Tests first for each operation:**
- account/token owner scope;
- refresh/preflight before confirm;
- no token in response/log;
- double confirm executes once;
- transfer requires STNK upload metadata and verified target;
- delete requires typed confirmation and postcondition verification;
- ambiguous outcomes become `UNKNOWN`.

**Order:** login ulang → tambah motor → transfer → hapus motor.

### Task 9: Batch Text and Bulk Excel

**Objective:** Port mass operations after single-item flows are proven.

**Files:**
- Create: `web/src/motorkux/motorkux-bulk-service.js`
- Create: `web/test/motorkux-bulk.test.js`

**Tests first:**
- exact legacy headers remain accepted;
- file cap and safe XLSX parsing;
- dedup HP/engine within file and database;
- invalid rows are previewed, not submitted;
- checkpoint prevents replay after refresh/restart;
- concurrency bounded;
- progress/ETA derived from real completed rows;
- export contains no token/password.

### Task 10: Test Ride Read-Only Gate

**Objective:** Keep Test Ride visible but locked until authoritative conditions pass.

**Tests first:**
- disabled feature flag returns unavailable;
- missing event/motor/date fails closed;
- no booking mutation route enabled before separate approval;
- UI never shows an active submit when prerequisites fail.

### Task 11: Security and Regression Review

**Objective:** Prove the feature does not weaken portal or bot boundaries.

**Commands:**
```bash
cd /root/prospek-bot-web-pr/web
/usr/local/lib/prospek-web/node --test test/*.test.js
/usr/local/lib/prospek-web/node --check src/app.js
/usr/local/lib/prospek-web/node --check public/motorkux.js
npm audit --omit=dev
```

**Review attempts:** privilege escalation, owner override, CSRF bypass, GET mutation, stale session, token leakage, upload traversal, XSS, double-submit, timeout replay.

Every confirmed defect becomes a failing regression test before correction.

### Task 12: Staged Production Rollout

**Objective:** Deploy portal-only changes without affecting `@Motorkux_bot`.

**Preconditions:**
- user explicitly approves design and production execution;
- full suite passes;
- immutable candidate assembled with runtime assets;
- backup/rollback prepared;
- service-user smoke passes.

**Sequence:**
1. Record bot PID, restart count, and service status using ubuntu user manager.
2. Record portal service and public health.
3. Backup current portal artifact/database.
4. Deploy with `MOTORKUX_MUTATIONS_ENABLED=false`.
5. Verify public HTTPS, auth, role navigation, region cascade, and browser console.
6. Confirm bot PID/restart count unchanged.
7. Pilot one approved registration only after explicit second approval.
8. Reconcile result read-only.
9. Enable additional operations one group at a time.

**Rollback trigger:** portal health/login regression, token leakage, ownership ambiguity, duplicate mutation, or bot restart/state change.

## 6. Final Acceptance Gates

- PRD and all three responsive designs approved.
- 39 Motorku X provinces and 421 cities loaded from server-owned master snapshot/live adapter.
- No UUID ASSIST in source, payload, UI, or tests.
- No OTP route, control, request, or verified-account claim.
- Consent mandatory and persisted with actor/time.
- Sales ownership and Admin selected-Sales context proven server-side.
- All mutations use persistent preview/confirm/idempotency state.
- Web 1440, Tablet 768, Mobile 390 have no horizontal overflow or clipped controls.
- Existing portal tests remain green.
- Production rollout leaves bot PID/restart count unchanged.

## 7. Current Approval Boundary

This plan authorizes only documentation and prototype work until the owner approves the final PRD plus Web/Tablet/Mobile screenshots. It does not authorize production code deployment, API mutation, bot changes, service restart, or customer registration.
