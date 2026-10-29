# e-SlipASN - Dokumentasi Proyek & Panduan Sistem

Dokumen ini mencatat seluruh arsitektur, implementasi sistem, modul dashboard, skrip manajemen proyek, endpoint REST API, cara menjalankan, serta data pengujian sistem **e-SlipASN**.

---

## 1. Ringkasan Proyek

**e-SlipASN** adalah portal layanan digital terpadu untuk Aparatur Sipil Negara (**PNS & PPPK**) guna mengakses transparansi informasi kepegawaian dan rincian slip gaji elektronik bulanan tersertifikasi secara mandiri.

Sistem dilengkapi dengan:
- **Pengecekan NIP 18 Digit Real-time**: Mendukung format **PNS** (Perka BKN No. 22/2007) dan **NI PPPK** (Perka BKN No. 18/2020 dengan kode jenis pengadaan $\ge 20$).
- **Verifikasi OTP Resmi via Resend Email API**: Pengiriman 6-digit kode OTP langsung ke email kedinasan/pribadi pegawai tanpa menampilkan kode rahasia di browser.
- **Dashboard Bendahara Pengeluaran (Admin)**: Manajemen penggajian, pengerjaan komponen pendapatan & potongan dengan kalkulator otomatis, sinkronisasi data CSV Dinas, serta penerbitan slip gaji.
- **Dashboard Pegawai ASN (Karyawan)**: Portal mandiri bagi pegawai untuk melihat rekapitulasi gaji bulanan, rincian transparansi penghasilan & potongan, riwayat gaji 6 bulan terakhir, dan cetak e-Slip resmi kedinasan berformat A4 dengan validasi TTE BSrE.
- **Penyimpanan Permanen SQLite Native**: Menggunakan modul bawaan `node:sqlite` (*zero-dependency external database* pada Node.js modern v22+).

---

## 2. Struktur Direktori & Komponen File

```
f:\e-SlipAsn\
│
├── package.json            # Konfigurasi proyek & skrip eksekusi npm (start, dev, test)
├── server.js               # Backend REST API, proxy BKN, mailer Resend OTP & static file server
├── database.js             # Engine SQLite native (DatabaseSync) untuk tabel users & master_pegawai
├── eslipasn.db             # File database SQLite lokal (menyimpan akun terdaftar & master ASN)
├── .env                    # Konfigurasi port & API Key Resend (re_GEpAXtt4_5Zkmz8DR1aRXwP2Ah253zR7U)
├── .env.example            # Template konfigurasi variabel lingkungan
│
├── login.html              # Antarmuka login & registrasi terintegrasi (Stitch Design)
├── masuk.html              # Antarmuka portal utama dengan navigasi dashboard & modal OTP
├── dashboard-bendahara.html# Dashboard Admin Bendahara (Pengerjaan, sinkronisasi CSV & penerbitan slip)
├── dashboard-pegawai.html  # Dashboard Mandiri ASN (Melihat rekapitulasi gaji & cetak e-slip resmi)
│
├── September_GAJI PNS  DINAS 2026 (1) - Copy.csv # Berkas CSV master gaji & potongan resmi Dinas
├── data-pegawai.json       # Master data 150 pegawai ASN (NIP, Nama, NIK, Instansi, dsb.)
├── data/
│   └── pegawai/
│       └── [NIP].json      # File JSON individual per pegawai untuk akses cepat & modular
│
└── e-slipasn.md            # Dokumentasi acuan proyek (file ini)
```

---

## 3. Fitur yang Telah Diimplementasikan

| Fitur | Status | Deskripsi |
| :--- | :---: | :--- |
| **Validasi NIP 18 Digit (PNS & PPPK)** | Selesai | Mendukung parsing tanggal lahir, TMT CPNS (PNS 01-12), dan Kode Pengadaan PPPK ($\ge 20$). Otomatis mengisi Nama, NIK, Satker. |
| **Pengiriman OTP via Resend** | Selesai | Integrasi API Resend (`https://api.resend.com/emails`) dengan template email resmi, kedaluwarsa 5 menit, dan proteksi kerahasiaan token. |
| **Pencarian Bertingkat Data ASN** | Selesai | SIASN BKN Asli -> `data/pegawai/<nip>.json` -> SQLite `master_pegawai` -> `data-pegawai.json` -> Formula Perka BKN. |
| **Dashboard Bendahara (Admin)** | Selesai | Ringkasan anggaran belanja pegawai, form pengerjaan/edit slip gaji, **menu tambah pegawai baru**, kalkulator live, terbilang rupiah, impor CSV massal, dan pratinjau cetak kedinasan. |
| **Pemisahan Sistem Login (RBAC)**| Selesai | Pemisahan tegas portal login antara **User Pegawai (PNS/PPPK)** dengan **Bendahara/Admin Pengeluaran**, dilengkapi proteksi penolakan role otomatis (*Role Separation Enforcement*). |
| **Menu Tambah Pegawai Baru** | Selesai | Form modal kedinasan di Dashboard Bendahara untuk menambah ASN baru lengkap dengan validasi 18-digit NIP, perhitungan gaji awal, penyimpanan SQLite & file JSON, serta aktivasi akun portal otomatis. |
| **Dashboard Pegawai (Karyawan)** | Selesai | Ringkasan Take Home Pay (THP), status transfer rekening Bank Jatim, perbandingan dua kolom (Penghasilan vs Potongan), riwayat 6 bulan, dan cetak lembar slip gaji resmi berstandar A4. |
| **Keabsahan Dokumen TTE BSrE** | Selesai | Format dokumen digital dilengkapi penanda QR Code Sertifikasi Elektronik Balai Sertifikasi Elektronik (BSrE) Badan Siber dan Sandi Negara. |
| **Database SQLite Native** | Selesai | Tabel `users` (dengan kolom `role` & hash SHA-256) dan tabel `master_pegawai` (data kepegawaian & JSON rincian slip gaji). |
| **Siklus Gaji Pra-Cair (Bulan Berikutnya)** | Selesai | Mendukung pengerjaan slip gaji bulan berikutnya (misal gaji Oktober dikerjakan pada akhir September) dengan penomoran bukti resmi otomatis (`SLIP/2026/10/...`). |
| **Manajemen Skrip NPM** | Selesai | Tersedia perintah standar `npm start` dan mode pengawasan berkas `npm run dev`. |

---

## 4. Cara Menjalankan & Tautan URL

### A. Persyaratan Lingkungan
- **Node.js**: Versi 22.x atau 24.x ke atas (mendukung fitur bawaan `node:sqlite`).

### B. Menjalankan Server Backend
Buka terminal PowerShell atau Command Prompt di direktori proyek `f:\e-SlipAsn`:

1. **Mode Produksi / Standar**:
   ```bash
   npm start
   ```
   *(Menjalankan `node server.js`)*

2. **Mode Pengembangan (Hot-Reload / Watch Mode)**:
   ```bash
   npm run dev
   ```
   *(Menjalankan `node --watch server.js` sehingga server otomatis merestart saat kode diubah)*

3. **Atau Menggunakan Perintah Langsung**:
   ```bash
   node server.js
   ```

### C. Tautan Akses Aplikasi di Browser
- **Dashboard Bendahara (Admin Keuangan)**:  
  👉 [http://localhost:3000/dashboard-bendahara.html](http://localhost:3000/dashboard-bendahara.html)
- **Dashboard Pegawai (Mandiri ASN)**:  
  👉 [http://localhost:3000/dashboard-pegawai.html](http://localhost:3000/dashboard-pegawai.html)
- **Portal Registrasi & Login Utama**:  
  👉 [http://localhost:3000/masuk.html](http://localhost:3000/masuk.html) atau [http://localhost:3000/login.html](http://localhost:3000/login.html)

---

## 5. Rute REST API Backend

| Metode | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `POST` | `/api/send-otp` | Membuat 6-digit OTP aman (`crypto.randomInt`) dan mengirimkannya via Resend Email. |
| `POST` | `/api/register` | Verifikasi kode OTP pemohon dan menyimpan akun ASN baru ke database SQLite. |
| `POST` | `/api/login` | Validasi kredensial login role-based (NIP, Password hash, dan Role) serta proteksi hak akses. |
| `POST` | `/api/pegawai/add` | Menambah data pegawai ASN baru ke master database beserta pembuatan komponen slip awal. |
| `GET` | `/api/cek-bkn/:nip` | Pengecekan otomatis profil ASN secara bertingkat (BKN API -> Master Pegawai -> Algoritma). |
| `GET` | `/api/pegawai-list` | Mengambil seluruh daftar pegawai beserta rincian slip gajinya untuk Dashboard Bendahara. |
| `POST` | `/api/slip-gaji/save` | Menyimpan dan menerbitkan pembaruan rincian slip gaji pegawai tertentu. |
| `GET` | `/api/slip-gaji/:nip` | Mengambil rincian spesifik slip gaji pegawai untuk Dashboard Pegawai. |
| `POST` | `/api/slip-gaji/sync-csv`| Sinkronisasi otomatis data pemotongan gaji massal dari berkas CSV Dinas Pendidikan. |

---

## 6. Data Akun Uji Coba (Testing Credentials)

### A. Akun Pengelola / Bendahara Pengeluaran (Admin)
- **NIP Resmi**: `197705192003122005` (Nama: **Dra. ERNA NURLAYLI, SE.**)
- **Alias ID**: `bendahara` atau `admin`
- **Kata Sandi**: `bendahara123` (atau `admin123` untuk alias admin)
- **Hak Akses**: Dashboard Bendahara, Edit & Terbitkan Slip, Sinkronisasi CSV, Tambah Pegawai Baru.

### B. Akun User / Pegawai ASN (PNS & PPPK)
- **Akun 1 (PPPK)**: `199411062025211063` (**VICKY SETYA PUTRA**) | Kata Sandi: `asn12345`
- **Akun 2 (PNS)**: `196701021986021003` (**Drs. MANDUNG SULAKSONO**) | Kata Sandi: `asn12345`
- **Akun Baru (Hasil Tambah Pegawai)**: `199508172024211009` (**NURUL HIDAYAH, S.Pd.**) | Kata Sandi: `asn12345`

---

## 7. Skema Database SQLite (`eslipasn.db`)

### Tabel `users` (Penyimpanan Akun & Role Login)
```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nip TEXT UNIQUE NOT NULL,
  nama TEXT NOT NULL,
  nik TEXT,
  instansi TEXT,
  satker TEXT,
  email TEXT,
  no_hp TEXT,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'pegawai',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Tabel `master_pegawai` (Data Master & Rincian Slip Gaji)
```sql
CREATE TABLE IF NOT EXISTS master_pegawai (
  nip TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  nik TEXT,
  instansi TEXT,
  satker TEXT,
  golongan TEXT,
  jabatan TEXT,
  email TEXT,
  no_hp TEXT,
  slip_gaji_json TEXT
);
```

---

## 8. Panduan Alur Kerja Otentikasi & Akses Dashboard Pegawai

Sistem menerapkan alur berjenjang yang aman dan terpadu:

```
[1. Pegawai Daftar User] 
        ↓ (Input NIP 18 Digit & Validasi OTP)
[2. Queri Pegawai & Simpan ke Database]
        ↓ (Pencocokan data master_pegawai, hash password, simpan ke tabel users)
[3. Selesai Daftar → Alihkan ke Halaman Login]
        ↓ (NIP otomatis terisi, pegawai memasukkan kata sandi)
[4. Pegawai Berhasil Login → Baru Bisa Lihat Dashboard Pegawai]
        ↓ (Sesi tersimpan di browser, Dashboard Pegawai menampilkan data resmi ASN terkait)
```

### Rincian Tiap Tahap:
1. **Pendaftaran Akun Pegawai (`Daftar Baru`)**:
   - Pegawai mengakses formulir di portal [masuk.html#register](http://localhost:3000/masuk.html#register).
   - Memasukkan NIP 18 Digit, NIK, Nama, Email/WhatsApp, dan Kata Sandi.
   - Sistem mengirimkan 6-digit kode OTP resmi via Resend API untuk verifikasi identitas.
2. **Penyimpanan ke Database SQLite (Query Pegawai)**:
   - Sistem melakukan queri ke tabel `master_pegawai` berdasarkan NIP untuk memverifikasi dan memperkaya data (golongan, instansi, satker, nomor rekening).
   - Password di-hash menggunakan algoritma SHA-256 dengan *salt* kedinasan (`eslipasn_salt_2026`).
   - Data user disimpan ke tabel `users` dengan peran (`role = 'pegawai'`). Jika belum ada di `master_pegawai`, data slip awal otomatis diinisialisasi.
3. **Pengalihan Otomatis ke Form Login**:
   - Setelah notifikasi verifikasi sukses, sistem secara otomatis mengalihkan tampilan ke formulir **Masuk Akun** (`#login`).
   - NIP yang baru didaftarkan langsung terisi dan kursor otomatis fokus ke kolom Kata Sandi.
4. **Login Pegawai & Proteksi Akses Dashboard**:
   - Pegawai melakukan login dengan NIP dan kata sandi yang baru dibuat.
   - Sistem memvalidasi kredensial dan menerbitkan sesi resmi (`eslip_session`).
   - **Hanya setelah login yang sah**, pegawai diarahkan dan diizinkan melihat [dashboard-pegawai.html](http://localhost:3000/dashboard-pegawai.html).
   - Akses langsung tanpa login akan otomatis **diblokir dan dialihkan kembali ke halaman login**.

---

## 9. Fitur Ekstraktor Berkas Penggajian ke CSV (Excel, PDF, JPEG/Foto)

Untuk mempermudah dan mempercepat pengerjaan slip gaji oleh Bendahara Pengeluaran, telah ditambahkan fitur **Ekstraksi Dokumen Penggajian Multi-Format**:

```
[ Berkas Gaji Dinas ]
(Excel .xlsx/.xls | PDF .pdf | Foto/Scan .jpg/.png | CSV)
         ↓
[ Engine Ekstraktor di Browser ]
• SheetJS   : Parsing lembar kerja spreadsheet Excel
• PDF.js    : Ekstraksi teks & koordinat halaman PDF
• Tesseract : Optical Character Recognition (OCR) foto scan berkas
         ↓
[ Parser Cerdas NIP 18 Digit & Nominal Keuangan ]
• Deteksi NIP 18 Digit BKN, Nama ASN & Nomor Rekening
• Konversi format titik ribuan & koma desimal (Rp 8.021.900 -> 8021900)
• Kalkulasi 10 jenis rincian potongan resmi Dinas Pendidikan:
  1. BPD / KMG (Bank Pembangunan Daerah)
  2. Iuran KORPRI
  3. Koperasi Tentrem
  4. Koperasi KGR
  5. Koperasi Harapan
  6. Koperasi Guyub Rukun
  7. BPR Jatim
  8. Joyoboyo (j. boyo)
  9. BPR Kota
  10. Dharma Wanita
  (Serta Administrasi Bank/Mitra)
         ↓
[ Format Standar CSV Acuan Gaji & 10 Potongan Kedinasan ]
NO;NIP;NAMA;REKENING;GAJI_KOTOR;POT_BPD;POT_KORPRI;POT_KOP_TENTREM;POT_KOP_KGR;POT_KOP_HARAPAN;POT_KOP_GUYUB;POT_BPR_JATIM;POT_JOYOBOYO;POT_BPR_KOTA;POT_DHARMA_WANITA;POT_ADMINISTRASI;TOTAL_POTONGAN;GAJI_BERSIH
         ↓
┌───────────────────────────────────────┬──────────────────────────────────────────┐
│      1. Unduh Berkas CSV (.csv)       │  2. Terapkan & Sinkronkan ke Gaji ASN    │
│  (Disimpan ke komputer Bendahara)     │  (Update master_pegawai & slip periode)  │
└───────────────────────────────────────┴──────────────────────────────────────────┘
```

### Keunggulan Fitur Ekstraktor:
1. **Dukungan Format Luas**:
   - **Excel (`.xlsx`, `.xls`)**: Dibaca langsung menggunakan SheetJS (`xlsx.full.min.js`) tanpa perlu install software Excel di server. Mendukung pembacaan *merged header* bertingkat untuk mendeteksi ke-10 jenis potongan dinas secara presisi.
   - **Dokumen PDF (`.pdf`)**: Diekstrak menggunakan `PDF.js` dengan pencarian koordinat teks per halaman.
   - **Foto / Dokumen Pindai (`.jpg`, `.jpeg`, `.png`)**: Dipindai otomatis menggunakan engine OCR `Tesseract.js` bahasa Indonesia.
   - **CSV (`.csv`)**: Dibaca dan distandarisasi ulang pemisah titik-koma (`;`).
2. **10 Rincian Potongan Lengkap**:
   - Menghindari penggabungan kasar (lump-sum), setiap potongan mitra dinas (BPD, KORPRI, 4 Koperasi: Tentrem, KGR, Harapan, Guyub Rukun, serta 3 Bank Perkreditan: BPR Jatim, Joyoboyo, BPR Kota, dan Dharma Wanita) tercatat secara mandiri dan dapat dilihat detailnya di slip pegawai maupun bendahara.
3. **Pilihan Target Periode Penggajian**:
   - Dapat diterapkan langsung ke periode aktif (misal: **Oktober 2026** pada siklus pengerjaan akhir September).
   - Mendukung pemilihan periode bulan-bulan berikutnya (November 2026, Desember 2026).
4. **Penyimpanan Arsip CSV Otomatis**:
   - Setiap kali bendahara menekan tombol *"Terapkan & Sinkronkan ke Gaji ASN"*, salinan CSV acuan otomatis disimpan ke direktori `data/imports/` dengan stempel waktu unik (timestamp).
5. **Tombol Sampel Cepat (150 ASN)**:
   - Tombol *"Muat Contoh Berkas Dinas (150 ASN)"* memungkinkan bendahara menguji pratinjau tabel, statistik total pagu kotor, total potongan, dan gaji bersih dalam 1 detik.

---

*Dokumentasi ini mencerminkan status terkini seluruh kode sumber dan siap digunakan sebagai panduan pemeliharaan sistem.*

