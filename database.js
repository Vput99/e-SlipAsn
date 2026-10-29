const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Lokasi berkas database SQLite
const dbPath = path.join(__dirname, 'eslipasn.db');
const db = new DatabaseSync(dbPath);

// Inisialisasi Tabel
db.exec(`
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

  CREATE INDEX IF NOT EXISTS idx_users_nip ON users(nip);
  CREATE INDEX IF NOT EXISTS idx_master_nip ON master_pegawai(nip);
`);

// Migrasi skema: pastikan kolom role ada jika tabel users sudah ada sebelumnya
try {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'pegawai'`);
} catch (e) {
  // Kolom role sudah ada
}

// Migrasi skema: pastikan kolom status_pegawai ada di master_pegawai
try {
  db.exec(`ALTER TABLE master_pegawai ADD COLUMN status_pegawai TEXT DEFAULT 'Aktif'`);
} catch (e) {
  // Kolom status_pegawai sudah ada
}

/**
 * Hash password dengan SHA-256 + Salt
 */
function hashPassword(password) {
  const salt = 'eslipasn_salt_2026';
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

/**
 * Seed Akun Khusus Bendahara Pengeluaran & Admin Keuangan
 */
function seedBendaharaAccount() {
  const bendaharaNip = '197705192003122005'; // Dra. ERNA NURLAYLI, SE.
  const passHash = hashPassword('bendahara123');

  try {
    const checkStmt = db.prepare('SELECT nip, role FROM users WHERE nip = ?');
    const existing = checkStmt.get(bendaharaNip);
    if (!existing) {
      const ins = db.prepare(`
        INSERT INTO users (nip, nama, nik, instansi, satker, email, no_hp, password_hash, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      ins.run(
        bendaharaNip,
        'Dra. ERNA NURLAYLI, SE.',
        '3571015905770002',
        'Pemerintah Kota / Kabupaten',
        'Dinas Pendidikan & Kebudayaan (Bendahara Pengeluaran)',
        'erna.bendahara@dinas.go.id',
        '081234567890',
        passHash,
        'bendahara'
      );
      console.log('[DATABASE] Akun Bendahara Dra. ERNA NURLAYLI, SE. berhasil didaftarkan (Password: bendahara123).');
    } else {
      db.prepare('UPDATE users SET role = ?, password_hash = ? WHERE nip = ?').run('bendahara', passHash, bendaharaNip);
    }

    // Alias akun 'bendahara' untuk kemudahan login
    const checkAlias = checkStmt.get('bendahara');
    if (!checkAlias) {
      const insAlias = db.prepare(`
        INSERT INTO users (nip, nama, nik, instansi, satker, email, no_hp, password_hash, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insAlias.run(
        'bendahara',
        'Dra. ERNA NURLAYLI, SE. (Bendahara Pengeluaran)',
        '3571015905770002',
        'Dinas Pendidikan & Kebudayaan',
        'Bidang Pengelolaan Keuangan & Perbendaharaan',
        'bendahara@dinas.go.id',
        '081234567890',
        hashPassword('bendahara123'),
        'bendahara'
      );
    }

    // Alias akun 'admin'
    const checkAdmin = checkStmt.get('admin');
    if (!checkAdmin) {
      const insAdmin = db.prepare(`
        INSERT INTO users (nip, nama, nik, instansi, satker, email, no_hp, password_hash, role)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insAdmin.run(
        'admin',
        'Administrator Penggajian & Keuangan ASN',
        '3571000000000001',
        'Dinas Pendidikan',
        'Subbag Keuangan & Gaji',
        'admin.gaji@dinas.go.id',
        '08111222333',
        hashPassword('admin123'),
        'bendahara'
      );
    }

    // Seed Akun Sampel Pegawai (Vicky Setya Putra & Drs. Mandung Sulaksono) untuk pengujian cepat
    const samplePass = hashPassword('asn12345');
    const updateOrInsertUser = (nip, nama, nik, satker, email) => {
      const u = checkStmt.get(nip);
      if (!u) {
        db.prepare(`
          INSERT INTO users (nip, nama, nik, instansi, satker, email, no_hp, password_hash, role)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(nip, nama, nik, 'Dinas Pendidikan & Kebudayaan', satker, email, '081299887766', samplePass, 'pegawai');
      } else {
        db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE nip = ?').run(samplePass, 'pegawai', nip);
      }
    };

    updateOrInsertUser('199411062025211063', 'VICKY SETYA PUTRA', '3571010611940001', 'Dinas Pendidikan & Kebudayaan', 'vicky.setya@dinas.go.id');
    updateOrInsertUser('196701021986021003', 'Drs. MANDUNG SULAKSONO', '3571010201670001', 'Dinas Pendidikan', 'mandung@dinas.go.id');
  } catch (err) {
    console.error('[SEED BENDAHARA ERROR]', err.message);
  }
}
seedBendaharaAccount();

/**
 * Sinkronisasi data awal dari data-pegawai.json ke tabel master_pegawai
 */
function seedMasterPegawai() {
  const jsonPath = path.join(__dirname, 'data-pegawai.json');
  if (!fs.existsSync(jsonPath)) return;

  try {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return;

    // Gunakan INSERT OR IGNORE agar pegawai yang sudah ada di database master
    // (termasuk yang sudah memiliki slip_gaji_json dari impor) TIDAK TERTIMPA menjadi null!
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO master_pegawai (nip, nama, nik, instansi, satker, golongan, jabatan, email, no_hp, slip_gaji_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec('BEGIN TRANSACTION');
    for (const p of list) {
      const nip = (p.nip || p.NIP || '').toString().trim();
      const nama = (p.nama || p.Nama || '').toString().trim();
      if (!nip || !nama) continue;

      const nik = p.nik || p.NIK || '';
      const instansi = p.instansi || p.Instansi || 'Badan Kepegawaian Negara';
      const satker = p.satker || p.Satker || p.unitKerja || p.UnitKerja || 'Dinas Pendidikan & Kebudayaan';
      const golongan = p.golongan || p.Golongan || 'Penata / Gol. III';
      const jabatan = p.jabatan || p.Jabatan || 'Tenaga Pendidik / Aparatur Sipil Negara';
      const email = p.email || p.Email || '';
      const noHp = p.noHp || p.NoHp || '';
      const slipGajiJson = p.slipGaji ? JSON.stringify(p.slipGaji) : null;

      insertStmt.run(nip, nama, nik, instansi, satker, golongan, jabatan, email, noHp, slipGajiJson);
    }
    db.exec('COMMIT');
  } catch (err) {
    console.error('[DATABASE SEED ERROR]', err.message);
  }
}

// Jalankan seed saat modul dimuat
seedMasterPegawai();

module.exports = {
  db,
  hashPassword,

  // Registrasi Pengguna Baru (Pegawai mendaftar, query data pegawai, simpan ke database users & master_pegawai)
  registerUser({ nip, nama, nik, instansi, satker, email, noHp, password }) {
    const cleanNip = (nip || '').replace(/\D/g, '');
    if (cleanNip.length !== 18) {
      return { success: false, message: 'NIP wajib 18 digit angka.' };
    }

    const checkStmt = db.prepare('SELECT nip FROM users WHERE nip = ?');
    const existing = checkStmt.get(cleanNip);
    if (existing) {
      return { success: false, message: 'NIP sudah terdaftar di sistem. Silakan langsung login dengan NIP dan kata sandi Anda.' };
    }

    // Queri data pegawai dari master_pegawai untuk validasi dan pelengkap profil
    const masterStmt = db.prepare('SELECT * FROM master_pegawai WHERE nip = ?');
    const master = masterStmt.get(cleanNip);

    const finalNama = (nama && nama.trim()) || (master ? master.nama : '');
    const finalNik = (nik && nik.trim()) || (master ? master.nik : '');
    const finalInstansi = (instansi && instansi.trim()) || (master ? master.instansi : 'Pemerintah Kota / Kabupaten');
    const finalSatker = (satker && satker.trim()) || (master ? master.satker : 'Dinas Pendidikan & Kebudayaan');
    const finalEmail = (email && email.trim()) || (master ? master.email : '');
    const finalNoHp = (noHp && noHp.trim()) || (master ? master.no_hp : '');

    const passHash = hashPassword(password);
    const insertStmt = db.prepare(`
      INSERT INTO users (nip, nama, nik, instansi, satker, email, no_hp, password_hash, role)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(cleanNip, finalNama, finalNik, finalInstansi, finalSatker, finalEmail, finalNoHp, passHash, 'pegawai');

    // Jika pegawai belum ada di master_pegawai, daftarkan juga ke master_pegawai dengan slip awal
    if (!master) {
      const isPppk = parseInt(cleanNip.substring(12, 14), 10) >= 20;
      const initialSlip = {
        nomorSlip: `SLIP/2026/09/${cleanNip.substring(12, 18)}`,
        periode: 'September 2026',
        gajiPokok: isPppk ? 4500000 : 4200000,
        tunjanganKeluarga: 450000,
        tunjanganJabatan: 600000,
        tunjanganBeras: 289680,
        tunjanganKinerja: 1250000,
        gajiKotor: (isPppk ? 4500000 : 4200000) + 450000 + 600000 + 289680 + 1250000,
        potongan: {
          korpri: 10000,
          zakat: 50000,
          koperasi: 150000,
          bank: 250000,
          iwpBpjs: 120000,
          lainLain: 0
        },
        totalPotongan: 580000,
        totalGajiBersih: ((isPppk ? 4500000 : 4200000) + 450000 + 600000 + 289680 + 1250000) - 580000,
        rekening: `0062${cleanNip.substring(10, 16)}`,
        terbilang: 'Rupiah',
        bendahara: 'Dra. ERNA NURLAYLI, SE.',
        statusTte: 'TERVALIDASI BSrE'
      };

      db.prepare(`
        INSERT INTO master_pegawai (nip, nama, nik, instansi, satker, golongan, jabatan, email, no_hp, slip_gaji_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        cleanNip,
        finalNama,
        finalNik,
        finalInstansi,
        finalSatker,
        isPppk ? 'PPPK Golongan IX' : 'Penata Muda / III/a',
        'Tenaga Pendidik / Aparatur Sipil Negara',
        finalEmail,
        finalNoHp,
        JSON.stringify(initialSlip)
      );
    }

    return {
      success: true,
      message: 'Registrasi akun ASN berhasil disimpan di database. Silakan masuk (login) menggunakan NIP dan kata sandi Anda.',
      nip: cleanNip,
      nama: finalNama
    };
  },

  // Login Pengguna dengan Pemisahan Peran (Role-Based: Pegawai vs Bendahara)
  loginUser({ nip, password, role }) {
    const cleanNip = (nip || '').toString().trim().replace(/\s+/g, '');
    const userStmt = db.prepare('SELECT * FROM users WHERE nip = ?');
    let user = userStmt.get(cleanNip);

    // Fallback: coba cari tanpa simbol non-digit jika bukan alias
    if (!user && cleanNip.replace(/\D/g, '').length === 18) {
      user = userStmt.get(cleanNip.replace(/\D/g, ''));
    }

    if (!user) {
      // Jika mencoba login bendahara dengan NIP bendahara tapi belum ada, atau pegawai
      if (role === 'bendahara') {
        return {
          success: false,
          code: 'NOT_REGISTERED',
          message: 'Akun Bendahara tidak ditemukan. Pastikan NIP / ID Bendahara benar atau gunakan akun default bendahara (Password: bendahara123).'
        };
      }
      return {
        success: false,
        code: 'NOT_REGISTERED',
        message: 'NIP belum terdaftar di sistem. Silakan lakukan pendaftaran akun terlebih dahulu.'
      };
    }

    const passHash = hashPassword(password);
    if (user.password_hash !== passHash) {
      return {
        success: false,
        code: 'WRONG_PASSWORD',
        message: 'Kata sandi yang Anda masukkan tidak cocok.'
      };
    }

    const userRole = user.role || (user.nip === '197705192003122005' || user.nip === 'bendahara' || user.nip === 'admin' ? 'bendahara' : 'pegawai');

    // Validasi Pemisahan Hak Akses (Role Separation Enforcement)
    if (role === 'bendahara') {
      if (userRole !== 'bendahara') {
        return {
          success: false,
          code: 'UNAUTHORIZED_ROLE',
          message: 'Akses Ditolak: NIP Anda terdaftar sebagai Pegawai/ASN reguler. Anda tidak berhak masuk ke Portal Pengelolaan Bendahara/Admin.'
        };
      }
    }

    // Ambil data slip gaji jika ada di master_pegawai
    const masterStmt = db.prepare('SELECT slip_gaji_json, golongan, jabatan FROM master_pegawai WHERE nip = ?');
    const master = masterStmt.get(user.nip);

    const redirectUrl = (role === 'bendahara' || userRole === 'bendahara')
      ? 'dashboard-bendahara.html'
      : `dashboard-pegawai.html?nip=${user.nip}`;

    return {
      success: true,
      message: role === 'bendahara' ? 'Autentikasi Bendahara Berhasil!' : 'Autentikasi Pegawai ASN Berhasil!',
      role: userRole,
      redirectUrl: redirectUrl,
      user: {
        id: user.id,
        nip: user.nip,
        nama: user.nama,
        nik: user.nik,
        instansi: user.instansi,
        satker: user.satker,
        email: user.email,
        noHp: user.no_hp,
        role: userRole,
        golongan: master ? master.golongan : 'PNS Aktif',
        jabatan: master ? master.jabatan : (userRole === 'bendahara' ? 'Bendahara Pengeluaran' : 'Aparatur Sipil Negara'),
        slipGaji: master && master.slip_gaji_json ? JSON.parse(master.slip_gaji_json) : null
      }
    };
  },

  // Tambah Pegawai Baru dari Dashboard Bendahara/Admin
  addPegawai(data) {
    const cleanNip = (data.nip || '').toString().trim().replace(/\D/g, '');
    if (cleanNip.length !== 18) {
      return { success: false, message: 'NIP wajib 18 digit angka sesuai standar BKN.' };
    }
    const nama = (data.nama || '').trim();
    if (!nama) {
      return { success: false, message: 'Nama lengkap pegawai wajib diisi.' };
    }

    const checkStmt = db.prepare('SELECT nip FROM master_pegawai WHERE nip = ?');
    const existing = checkStmt.get(cleanNip);
    if (existing) {
      return { success: false, message: `Pegawai dengan NIP ${cleanNip} sudah ada di database master.` };
    }

    const nik = (data.nik || `3571${cleanNip.substring(0, 8)}0001`).toString().trim();
    const instansi = (data.instansi || 'Dinas Pendidikan & Kebudayaan').trim();
    const satker = (data.satker || 'Unit Kerja Pelaksana Teknis').trim();
    const golongan = (data.golongan || 'Penata Muda / III/a').trim();
    const jabatan = (data.jabatan || 'Aparatur Sipil Negara').trim();
    const email = (data.email || '').trim();
    const noHp = (data.noHp || '').trim();
    const rekening = (data.rekening || `0062${cleanNip.substring(10, 16)}`).trim();
    const bankPenyalur = data.bankPenyalur || 'PT BPD JATIM (BANK JATIM)';

    // Komponen Pendapatan
    const gajiPokok = parseInt(data.gajiPokok, 10) || 3500000;
    const tunjanganKeluarga = parseInt(data.tunjanganKeluarga, 10) || Math.round(gajiPokok * 0.1);
    const tunjanganJabatan = parseInt(data.tunjanganJabatan, 10) || 540000;
    const tunjanganBeras = parseInt(data.tunjanganBeras, 10) || 289680;
    const tunjanganUmum = parseInt(data.tunjanganUmum, 10) || 185000;
    const tunjanganKinerja = parseInt(data.tunjanganKinerja, 10) || 0;

    const gajiKotor = gajiPokok + tunjanganKeluarga + tunjanganJabatan + tunjanganBeras + tunjanganUmum + tunjanganKinerja;

    // Komponen Potongan
    const iwpBpjs = Math.round(gajiPokok * 0.04);
    const korpri = parseInt(data.potonganKorpri, 10) || 10000;
    const taperum = 10000;
    const potonganBank = parseInt(data.potonganBank, 10) || 0;
    const potonganKoperasi = parseInt(data.potonganKoperasi, 10) || 0;
    const zakat = parseInt(data.zakat, 10) || 0;
    const pph21 = parseInt(data.pph21, 10) || 0;
    const lainLain = parseInt(data.lainLain, 10) || 0;

    const totalPotongan = iwpBpjs + korpri + taperum + potonganBank + potonganKoperasi + zakat + pph21 + lainLain;
    const totalGajiBersih = gajiKotor - totalPotongan;

    const slipObj = {
      periode: data.periode || "September 2026",
      nomorSlip: `SLIP/2026/09/${cleanNip.substring(12, 18)}`,
      rekening: rekening,
      bankPenyalur: bankPenyalur,
      pendapatan: {
        gajiPokok: gajiPokok,
        tunjanganKeluarga: tunjanganKeluarga,
        tunjanganJabatan: tunjanganJabatan,
        tunjanganBeras: tunjanganBeras,
        tunjanganKinerja: tunjanganKinerja,
        tunjanganUmum: tunjanganUmum
      },
      gajiKotor: gajiKotor,
      potongan: {
        korpri: korpri,
        zakat: zakat,
        bpdKmg: 0,
        koperasi: potonganKoperasi,
        bank: potonganBank,
        iwpBpjs: iwpBpjs,
        taperum: taperum,
        pph21: pph21,
        lainLain: lainLain
      },
      totalPotongan: totalPotongan,
      totalGajiBersih: totalGajiBersih,
      statusTte: "Tersertifikasi BSrE",
      tanggalTerbit: "25 September 2026",
      bendahara: "Dra. ERNA NURLAYLI, SE."
    };

    const insertStmt = db.prepare(`
      INSERT INTO master_pegawai (nip, nama, nik, instansi, satker, golongan, jabatan, email, no_hp, slip_gaji_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      cleanNip,
      nama,
      nik,
      instansi,
      satker,
      golongan,
      jabatan,
      email,
      noHp,
      JSON.stringify(slipObj)
    );

    // Otomatis buat akun login portal bagi pegawai baru
    if (data.createLoginAccount !== false) {
      const userCheck = db.prepare('SELECT nip FROM users WHERE nip = ?').get(cleanNip);
      if (!userCheck) {
        const defaultPassword = data.defaultPassword || 'asn12345';
        const userInsert = db.prepare(`
          INSERT INTO users (nip, nama, nik, instansi, satker, email, no_hp, password_hash, role)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        userInsert.run(cleanNip, nama, nik, instansi, satker, email, noHp, hashPassword(defaultPassword), 'pegawai');
      }
    }

    // Tulis ke data/pegawai/{nip}.json untuk modularitas
    try {
      const pegawaiDir = path.join(__dirname, 'data', 'pegawai');
      if (!fs.existsSync(pegawaiDir)) {
        fs.mkdirSync(pegawaiDir, { recursive: true });
      }
      const indivPath = path.join(pegawaiDir, `${cleanNip}.json`);
      fs.writeFileSync(indivPath, JSON.stringify({
        nip: cleanNip,
        nama: nama,
        nik: nik,
        instansi: instansi,
        satker: satker,
        golongan: golongan,
        jabatan: jabatan,
        email: email,
        noHp: noHp,
        slipGaji: slipObj
      }, null, 2), 'utf8');
    } catch (e) {
      console.warn('[ADD PEGAWAI FILE WRITE]', e.message);
    }

    return {
      success: true,
      message: `Pegawai ${nama} (NIP: ${cleanNip}) berhasil ditambahkan ke database master!`,
      data: {
        nip: cleanNip,
        nama: nama,
        nik: nik,
        satker: satker,
        golongan: golongan,
        jabatan: jabatan,
        rekening: rekening,
        slipGaji: slipObj
      }
    };
  },

  // Ambil Data Pegawai untuk Verifikasi
  getPegawai(nip) {
    const cleanNip = nip.replace(/\D/g, '');
    const stmt = db.prepare('SELECT * FROM master_pegawai WHERE nip = ?');
    const p = stmt.get(cleanNip);
    if (!p) return null;

    const slip = p.slip_gaji_json ? JSON.parse(p.slip_gaji_json) : null;
    const isGajiNol = slip && (Number(slip.gajiKotor) === 0 || slip.gajiKotor === '0' || slip.statusKeaktifan === 'Tidak Aktif');
    const isTidakAktif = p.status_pegawai === 'Tidak Aktif' || isGajiNol;
    const isPppk = (p.nip.length === 18 && parseInt(p.nip.substring(12, 14), 10) >= 20);
    const statusPegawai = isTidakAktif ? 'Tidak Aktif' : (isPppk ? 'PPPK Aktif' : 'PNS Aktif');

    return {
      nip: p.nip,
      nama: p.nama,
      nik: p.nik,
      instansi: p.instansi,
      instansiKey: 'lainnya',
      satker: p.satker,
      golongan: p.golongan,
      jabatan: p.jabatan,
      statusPegawai: statusPegawai,
      statusKeaktifan: isTidakAktif ? 'Tidak Aktif' : 'Aktif',
      email: p.email,
      noHp: p.no_hp,
      slipGaji: slip
    };
  },

  // Ambil Semua Daftar Pegawai untuk Dashboard Bendahara
  getAllPegawai() {
    const stmt = db.prepare('SELECT * FROM master_pegawai ORDER BY nama ASC');
    const rows = stmt.all();
    return rows.map(p => {
      const slip = p.slip_gaji_json ? JSON.parse(p.slip_gaji_json) : null;
      const isGajiNol = slip && (Number(slip.gajiKotor) === 0 || slip.gajiKotor === '0' || slip.statusKeaktifan === 'Tidak Aktif');
      const isTidakAktif = p.status_pegawai === 'Tidak Aktif' || isGajiNol;
      const isPppk = (p.nip.length === 18 && parseInt(p.nip.substring(12, 14), 10) >= 20);
      const statusPegawai = isTidakAktif ? 'Tidak Aktif' : (isPppk ? 'PPPK Aktif' : 'PNS Aktif');

      return {
        nip: p.nip,
        nama: p.nama,
        nik: p.nik || '',
        instansi: p.instansi || 'Dinas Pendidikan',
        satker: p.satker || 'Unit Kerja ASN',
        golongan: p.golongan || 'Golongan III',
        jabatan: p.jabatan || 'Aparatur Sipil Negara',
        statusPegawai: statusPegawai,
        statusKeaktifan: isTidakAktif ? 'Tidak Aktif' : 'Aktif',
        email: p.email || '',
        noHp: p.no_hp || '',
        slipGaji: slip
      };
    });
  },

  // Simpan / Perbarui Slip Gaji Pegawai
  updateSlipGaji(nip, slipGajiObj) {
    const cleanNip = nip.replace(/\D/g, '');
    const jsonStr = JSON.stringify(slipGajiObj);
    const stmt = db.prepare('UPDATE master_pegawai SET slip_gaji_json = ? WHERE nip = ?');
    stmt.run(jsonStr, cleanNip);

    // Update juga berkas data/pegawai/{nip}.json jika ada
    const indivPath = path.join(__dirname, 'data', 'pegawai', `${cleanNip}.json`);
    if (fs.existsSync(indivPath)) {
      try {
        const content = JSON.parse(fs.readFileSync(indivPath, 'utf8'));
        content.slipGaji = slipGajiObj;
        fs.writeFileSync(indivPath, JSON.stringify(content, null, 2), 'utf8');
      } catch (e) {
        console.error('[UPDATE INDIVIDUAL FILE ERROR]', e.message);
      }
    }

    return { success: true, message: 'Slip gaji berhasil diperbarui dan diterbitkan.' };
  },

  // Sinkronkan data slip gaji dari berkas CSV jika ada
  syncGajiFromCsv() {
    const csvPath = path.join(__dirname, 'September_GAJI PNS  DINAS 2026 (1) - Copy.csv');
    if (!fs.existsSync(csvPath)) return { count: 0 };

    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n');
    let updatedCount = 0;

    const cleanNum = (str) => {
      if (!str) return 0;
      const sanitized = str.trim().replace(/\./g, '').replace(/,/g, '.');
      const val = parseFloat(sanitized);
      return isNaN(val) ? 0 : Math.round(val);
    };

    db.exec('BEGIN TRANSACTION');
    for (let i = 5; i < lines.length; i++) {
      const parts = lines[i].split(';');
      const nip = (parts[2] || '').trim().replace(/\D/g, '');
      if (nip.length !== 18) continue;

      const nama = (parts[3] || '').trim();
      const rekening = (parts[4] || '').replace(/['"]/g, '').trim();
      const gajiKotor = cleanNum(parts[5]);
      const bpdKmg = cleanNum(parts[6]);
      const korpri = cleanNum(parts[7]);
      const sosial = cleanNum(parts[8]);
      const zakat = cleanNum(parts[9]);
      const koperasi = cleanNum(parts[11]);
      const bankBri = cleanNum(parts[12]) + cleanNum(parts[13]) + cleanNum(parts[15]);
      const bankBtn = cleanNum(parts[16]);
      const bankBtpn = cleanNum(parts[17]);
      const bankBws = cleanNum(parts[18]);
      const koperasiHarapan = cleanNum(parts[20]);
      const koperasiGuyub = cleanNum(parts[21]);
      const lainLain = cleanNum(parts[26]);
      const totalPotongan = cleanNum(parts[27]);
      const gajiBersih = cleanNum(parts[28]);

      const isTidakAktif = (gajiKotor === 0);
      const isPppk = nip.substring(12, 14) >= '20';
      const statusPegawai = isTidakAktif ? 'Tidak Aktif' : (isPppk ? 'PPPK Aktif' : 'PNS Aktif');

      const gajiPokok = isTidakAktif ? 0 : (Math.round(gajiKotor * 0.65) || 4000000);
      const tunjanganKeluarga = isTidakAktif ? 0 : (Math.round(gajiKotor * 0.10) || 400000);
      const tunjanganJabatan = isTidakAktif ? 0 : (Math.round(gajiKotor * 0.15) || 600000);
      const tunjanganBeras = isTidakAktif ? 0 : ((gajiKotor - (gajiPokok + tunjanganKeluarga + tunjanganJabatan)) || 289680);

      const slipObj = {
        periode: "September 2026",
        nomorSlip: isTidakAktif ? `NONAKTIF/2026/09/${nip.substring(12, 18)}` : `SLIP/2026/09/${nip.substring(12, 18)}`,
        statusKeaktifan: isTidakAktif ? 'Tidak Aktif' : 'Aktif',
        statusPegawai: statusPegawai,
        rekening: rekening || `0062${nip.substring(10, 16)}`,
        bankPenyalur: "PT BPD JATIM (BANK JATIM)",
        pendapatan: {
          gajiPokok: gajiPokok,
          tunjanganKeluarga: tunjanganKeluarga,
          tunjanganJabatan: tunjanganJabatan,
          tunjanganBeras: tunjanganBeras > 0 ? tunjanganBeras : (isTidakAktif ? 0 : 289680),
          tunjanganKinerja: 0,
          tunjanganUmum: isTidakAktif ? 0 : 185000
        },
        gajiKotor: gajiKotor,
        potongan: {
          korpri: isTidakAktif ? 0 : (korpri || 10000),
          zakat: isTidakAktif ? 0 : (zakat || 0),
          bpdKmg: isTidakAktif ? 0 : (bpdKmg || 0),
          koperasi: isTidakAktif ? 0 : (koperasi + koperasiHarapan + koperasiGuyub),
          bank: isTidakAktif ? 0 : (bankBri + bankBtn + bankBtpn + bankBws),
          iwpBpjs: isTidakAktif ? 0 : (Math.round(gajiPokok * 0.04) || 160000),
          taperum: isTidakAktif ? 0 : 10000,
          pph21: 0,
          lainLain: isTidakAktif ? 0 : (lainLain || sosial || 0)
        },
        totalPotongan: isTidakAktif ? 0 : (totalPotongan || (korpri + zakat + bpdKmg + koperasi + lainLain)),
        totalGajiBersih: isTidakAktif ? 0 : (gajiBersih || (gajiKotor - totalPotongan)),
        statusTte: isTidakAktif ? "Pegawai Tidak Aktif" : "Tersertifikasi BSrE",
        tanggalTerbit: "25 September 2026",
        bendahara: "Dra. ERNA NURLAYLI, SE.",
        keterangan: isTidakAktif ? "Pegawai dinyatakan TIDAK AKTIF pada instansi ini (Gaji kotor berkas Rp 0)" : "Slip gaji resmi Dinas Pendidikan"
      };

      // Pastikan pegawai ada di master_pegawai
      const checkStmt = db.prepare('SELECT nip FROM master_pegawai WHERE nip = ?');
      const existing = checkStmt.get(nip);
      if (!existing && nama) {
        const insStmt = db.prepare(`
          INSERT INTO master_pegawai (nip, nama, nik, instansi, satker, golongan, jabatan, email, no_hp, slip_gaji_json, status_pegawai)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        insStmt.run(nip, nama, `3571${nip.substring(0, 8)}0001`, 'Dinas Pendidikan', 'Dinas Pendidikan Kota/Kabupaten', isPppk ? 'PPPK Golongan IX' : 'Penata / Gol. III', 'Aparatur Sipil Negara', '', '', JSON.stringify(slipObj), statusPegawai);
      } else {
        const updStmt = db.prepare('UPDATE master_pegawai SET slip_gaji_json = ?, status_pegawai = ? WHERE nip = ?');
        updStmt.run(JSON.stringify(slipObj), statusPegawai, nip);
      }
      updatedCount++;
    }
    db.exec('COMMIT');
    console.log(`[DATABASE] Berhasil menyinkronkan ${updatedCount} data slip gaji dari berkas CSV.`);
    return { count: updatedCount };
  },

  // Terapkan data gaji dan potongan hasil ekstraksi (Excel/PDF/JPEG) ke database SQLite
  applyExtractedPayroll({ periode = 'Oktober 2026', filename = 'payroll_ekstraksi.csv', records = [], csvContent = '' }) {
    // 1. Simpan salinan berkas CSV hasil ekstraksi untuk riwayat arsip
    try {
      const importsDir = path.join(__dirname, 'data', 'imports');
      if (!fs.existsSync(importsDir)) {
        fs.mkdirSync(importsDir, { recursive: true });
      }
      const safeFilename = `${Date.now()}_${(filename || 'extracted.csv').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const savePath = path.join(importsDir, safeFilename);
      if (csvContent) {
        fs.writeFileSync(savePath, csvContent, 'utf8');
      }
    } catch (e) {
      console.warn('[APPLY IMPORT FILE ARCHIVE]', e.message);
    }

    // 2. Tentukan penomoran bulan & tahun slip resmi
    const monthMap = {
      'januari': '01', 'februari': '02', 'maret': '03', 'april': '04',
      'mei': '05', 'juni': '06', 'juli': '07', 'agustus': '08',
      'september': '09', 'oktober': '10', 'november': '11', 'desember': '12'
    };
    const lowerPeriode = (periode || '').toLowerCase();
    let bulanDigit = '10';
    for (const [name, num] of Object.entries(monthMap)) {
      if (lowerPeriode.includes(name)) {
        bulanDigit = num;
        break;
      }
    }
    const yearMatch = (periode || '').match(/\b(20\d\d)\b/);
    const tahunDigit = yearMatch ? yearMatch[1] : '2026';

    let updatedCount = 0;
    db.exec('BEGIN TRANSACTION');

    const checkStmt = db.prepare('SELECT * FROM master_pegawai WHERE nip = ?');
    const updateStmt = db.prepare('UPDATE master_pegawai SET slip_gaji_json = ?, status_pegawai = ? WHERE nip = ?');
    const insertStmt = db.prepare(`
      INSERT INTO master_pegawai (nip, nama, nik, instansi, satker, golongan, jabatan, email, no_hp, slip_gaji_json, status_pegawai)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Deduplikasi data agar baris tanda tangan di bagian akhir berkas tidak menimpa data gaji ASN yang sah
    const dedupMap = new Map();
    for (const item of records) {
      const nip = (item.nip || '').toString().trim().replace(/\D/g, '');
      if (nip.length !== 18) continue;
      const kotor = parseInt(item.gajiKotor, 10) || 0;
      if (!dedupMap.has(nip)) {
        dedupMap.set(nip, item);
      } else {
        const existing = dedupMap.get(nip);
        const existKotor = parseInt(existing.gajiKotor, 10) || 0;
        // Prioritaskan baris yang memiliki nominal gaji kotor valid (> 0)
        if (kotor > 0 && existKotor === 0) {
          dedupMap.set(nip, item);
        }
      }
    }
    const finalRecords = Array.from(dedupMap.values());

    for (const item of finalRecords) {
      const nip = (item.nip || '').toString().trim().replace(/\D/g, '');
      if (nip.length !== 18) continue;

      const nama = (item.nama || '').trim();
      const rekening = (item.rekening || '').replace(/['"]/g, '').trim();
      const gajiKotor = parseInt(item.gajiKotor, 10) || 0;
      const isTidakAktif = (gajiKotor === 0 || item.isTidakAktif === true || item.statusKeaktifan === 'Tidak Aktif' || item.statusPegawai === 'Tidak Aktif');
      const isPPPK = nip.substring(12, 14) >= '20';
      const statusPegawai = isTidakAktif ? 'Tidak Aktif' : (isPPPK ? 'PPPK Aktif' : 'PNS Aktif');
      const statusKeaktifan = isTidakAktif ? 'Tidak Aktif' : 'Aktif';
      
      const pot = item.potongan || {};
      const potBpd = isTidakAktif ? 0 : (parseInt(item.potBpd !== undefined ? item.potBpd : (pot.bpd || pot.bpdKmg), 10) || 0);
      const potKorpri = isTidakAktif ? 0 : (parseInt(item.potKorpri !== undefined ? item.potKorpri : pot.korpri, 10) || 0);
      const potSosial = isTidakAktif ? 0 : (parseInt(item.potSosial !== undefined ? item.potSosial : pot.sosial, 10) || 0);
      const potZakat = isTidakAktif ? 0 : (parseInt(item.potZakat !== undefined ? item.potZakat : pot.zakat, 10) || 0);
      const potKopTentrem = isTidakAktif ? 0 : (parseInt(item.potKopTentrem !== undefined ? item.potKopTentrem : pot.kopTentrem, 10) || 0);
      const potKopKgr = isTidakAktif ? 0 : (parseInt(item.potKopKgr !== undefined ? item.potKopKgr : pot.kopKgr, 10) || 0);
      const potKopHarapan = isTidakAktif ? 0 : (parseInt(item.potKopHarapan !== undefined ? item.potKopHarapan : pot.kopHarapan, 10) || 0);
      const potKopGuyub = isTidakAktif ? 0 : (parseInt(item.potKopGuyub !== undefined ? item.potKopGuyub : pot.kopGuyub, 10) || 0);
      const potBprJatim = isTidakAktif ? 0 : (parseInt(item.potBprJatim !== undefined ? item.potBprJatim : pot.bprJatim, 10) || 0);
      const potJoyoboyo = isTidakAktif ? 0 : (parseInt(item.potJoyoboyo !== undefined ? item.potJoyoboyo : pot.joyoboyo, 10) || 0);
      const potBprKota = isTidakAktif ? 0 : (parseInt(item.potBprKota !== undefined ? item.potBprKota : pot.bprKota, 10) || 0);
      const potBankLain = isTidakAktif ? 0 : (parseInt(item.potBankLain !== undefined ? item.potBankLain : (pot.bankLain || pot.bri || pot.btn), 10) || 0);
      const potDharmaWanita = isTidakAktif ? 0 : (parseInt(item.potDharmaWanita !== undefined ? item.potDharmaWanita : pot.dharmaWanita, 10) || 0);
      const potAdministrasi = isTidakAktif ? 0 : (parseInt(item.potAdministrasi !== undefined ? item.potAdministrasi : (pot.administrasi || pot.lainLain), 10) || 0);
      const potLainLain = isTidakAktif ? 0 : (parseInt(item.potLainLain !== undefined ? item.potLainLain : pot.lainLain, 10) || potAdministrasi);

      const sumPotonganRincian = potBpd + potKorpri + potSosial + potZakat + potKopTentrem + potKopKgr + potKopHarapan + potKopGuyub + potBprJatim + potJoyoboyo + potBprKota + potBankLain + potDharmaWanita + potLainLain;
      const totalPotongan = isTidakAktif ? 0 : (parseInt(item.totalPotongan, 10) || sumPotonganRincian);
      let totalGajiBersih = isTidakAktif ? 0 : parseInt(item.gajiBersih !== undefined ? item.gajiBersih : item.totalGajiBersih, 10);
      if (!isTidakAktif && (!totalGajiBersih || isNaN(totalGajiBersih))) {
        totalGajiBersih = Math.max(0, gajiKotor - totalPotongan);
      }

      const gajiPokok = isTidakAktif ? 0 : (Math.round(gajiKotor * 0.65) || 4000000);
      const tunjanganKeluarga = isTidakAktif ? 0 : (Math.round(gajiKotor * 0.10) || 400000);
      const tunjanganJabatan = isTidakAktif ? 0 : (Math.round(gajiKotor * 0.15) || 600000);
      const tunjanganBeras = isTidakAktif ? 0 : ((gajiKotor - (gajiPokok + tunjanganKeluarga + tunjanganJabatan)) || 289680);

      const slipObj = {
        periode: periode,
        nomorSlip: isTidakAktif ? `NONAKTIF/${tahunDigit}/${bulanDigit}/${nip.substring(12, 18)}` : `SLIP/${tahunDigit}/${bulanDigit}/${nip.substring(12, 18)}`,
        statusKeaktifan: statusKeaktifan,
        statusPegawai: statusPegawai,
        rekening: rekening || `0062${nip.substring(10, 16)}`,
        bankPenyalur: item.bankPenyalur || "PT BPD JATIM (BANK JATIM)",
        pendapatan: {
          gajiPokok: gajiPokok,
          tunjanganKeluarga: tunjanganKeluarga,
          tunjanganJabatan: tunjanganJabatan,
          tunjanganBeras: tunjanganBeras > 0 ? tunjanganBeras : (isTidakAktif ? 0 : 289680),
          tunjanganKinerja: 0,
          tunjanganUmum: isTidakAktif ? 0 : 185000
        },
        gajiKotor: gajiKotor,
        potongan: {
          bpd: potBpd,
          korpri: potKorpri,
          sosial: potSosial,
          zakat: potZakat,
          kopTentrem: potKopTentrem,
          kopKgr: potKopKgr,
          kopHarapan: potKopHarapan,
          kopGuyub: potKopGuyub,
          bprJatim: potBprJatim,
          joyoboyo: potJoyoboyo,
          bprKota: potBprKota,
          bankLain: potBankLain,
          dharmaWanita: potDharmaWanita,
          administrasi: potAdministrasi,
          lainLain: potLainLain,
          // Bidang agregasi untuk kompatibilitas tampilan lama
          bpdKmg: potBpd,
          koperasi: potKopTentrem + potKopKgr + potKopHarapan + potKopGuyub,
          bank: potBpd + potBprJatim + potJoyoboyo + potBprKota + potBankLain
        },
        totalPotongan: totalPotongan,
        totalGajiBersih: totalGajiBersih,
        statusTte: isTidakAktif ? "Pegawai Tidak Aktif" : "Tersertifikasi BSrE",
        tanggalTerbit: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
        bendahara: "Dra. ERNA NURLAYLI, SE.",
        keterangan: isTidakAktif 
          ? `Pegawai berstatus TIDAK AKTIF pada instansi ini (Gaji kotor berkas Rp 0) untuk periode ${periode}` 
          : `Slip gaji bersumber dari ekstraksi berkas (${filename}) untuk periode ${periode}`
      };

      const existing = checkStmt.get(nip);
      if (existing) {
        updateStmt.run(JSON.stringify(slipObj), statusPegawai, nip);
      } else if (nama) {
        insertStmt.run(
          nip,
          nama,
          `3571${nip.substring(0, 8)}0001`,
          'Dinas Pendidikan',
          'Dinas Pendidikan Kota/Kabupaten',
          isPPPK ? 'PPPK Golongan IX' : 'Penata / Gol. III',
          'Aparatur Sipil Negara',
          '',
          '',
          JSON.stringify(slipObj),
          statusPegawai
        );
      }

      // Sinkronkan berkas individual jika ada
      try {
        const indivPath = path.join(__dirname, 'data', 'pegawai', `${nip}.json`);
        if (fs.existsSync(indivPath)) {
          const content = JSON.parse(fs.readFileSync(indivPath, 'utf8'));
          content.slipGaji = slipObj;
          fs.writeFileSync(indivPath, JSON.stringify(content, null, 2), 'utf8');
        }
      } catch (err) {}

      updatedCount++;
    }

    db.exec('COMMIT');
    console.log(`[DATABASE] Berhasil menerapkan ${updatedCount} data gaji hasil ekstraksi ke SQLite untuk ${periode}.`);
    return {
      success: true,
      count: updatedCount,
      message: `Berhasil mengekstrak & menyinkronkan ${updatedCount} data gaji pegawai ke database untuk periode ${periode}!`
    };
  }
};
