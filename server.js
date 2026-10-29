const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Baca konfigurasi dari .env jika ada
const envPath = path.join(__dirname, '.env');
const env = {};
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.substring(0, idx).trim();
        const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
        env[key] = val;
      }
    }
  });
}

const PORT = process.env.PORT || env.PORT || 3000;
const BKN_API_BASE_URL = process.env.BKN_API_BASE_URL || env.BKN_API_BASE_URL || 'https://apim.bkn.go.id';
const BKN_BEARER_TOKEN = process.env.BKN_BEARER_TOKEN || env.BKN_BEARER_TOKEN || '';
const BKN_SSO_TOKEN = process.env.BKN_SSO_TOKEN || env.BKN_SSO_TOKEN || '';

// Konfigurasi Resend Email Service
const RESEND_API_KEY = process.env.RESEND_API_KEY || env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || env.RESEND_FROM_EMAIL || 'e-SlipASN <onboarding@resend.dev>';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/**
 * Validasi dan parse NIP 18 Digit sesuai Perka BKN No. 22 Tahun 2007 (PNS) & Perka BKN No. 18 Tahun 2020 (PPPK)
 * Digit 1-8   : Tanggal Lahir (YYYYMMDD)
 * Digit 9-12  : Tahun Pengangkatan CPNS / PPPK (YYYY)
 * Digit 13-14 : Bulan Pengangkatan CPNS (01-12) ATAU Kode Jenis Pengadaan PPPK (>= 20)
 * Digit 15    : Jenis Kelamin (1 = Laki-laki, 2 = Perempuan)
 * Digit 16-18 : Nomor Urut
 */
function parseNIPBKN(nip) {
  if (!nip || typeof nip !== 'string') return { valid: false, message: 'NIP wajib diisi' };
  const cleanNip = nip.replace(/\D/g, '');
  if (cleanNip.length !== 18) {
    return { valid: false, message: 'NIP harus tepat 18 digit angka' };
  }

  const thnLahir = parseInt(cleanNip.substring(0, 4), 10);
  const blnLahir = parseInt(cleanNip.substring(4, 6), 10);
  const tglLahir = parseInt(cleanNip.substring(6, 8), 10);

  const thnPengangkatan = parseInt(cleanNip.substring(8, 12), 10);
  const kodePengangkatan = parseInt(cleanNip.substring(12, 14), 10);

  const jkCode = cleanNip.substring(14, 15);
  const noUrut = cleanNip.substring(15, 18);

  const currentYear = new Date().getFullYear();

  // Validasi batas tahun & bulan lahir
  if (thnLahir < 1900 || thnLahir > currentYear - 17) {
    return { valid: false, message: 'Tahun lahir pada NIP tidak valid' };
  }
  if (blnLahir < 1 || blnLahir > 12 || tglLahir < 1 || tglLahir > 31) {
    return { valid: false, message: 'Tanggal atau bulan lahir pada NIP tidak valid' };
  }
  if (thnPengangkatan < thnLahir + 17 || thnPengangkatan > currentYear + 1) {
    return { valid: false, message: 'Tahun pengangkatan ASN pada NIP tidak masuk akal' };
  }

  // Format BKN:
  // - PNS: kodePengangkatan = 01 s/d 12 (Bulan TMT CPNS)
  // - PPPK: kodePengangkatan = 20 s/d 99 (Kode Jenis Pengadaan / Perjanjian Kerja BKN)
  const isPPPK = kodePengangkatan >= 20;

  if (!isPPPK && (kodePengangkatan < 1 || kodePengangkatan > 12)) {
    return { valid: false, message: 'Bulan pengangkatan CPNS tidak valid (harus 01-12 untuk PNS atau kode PPPK yang sah)' };
  }
  if (jkCode !== '1' && jkCode !== '2') {
    return { valid: false, message: 'Kode jenis kelamin NIP (digit 15) harus 1 atau 2' };
  }

  const bulanNames = [
    '', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const tmtFormatted = isPPPK
    ? `Tahun ${thnPengangkatan} (PPPK Tahap ${kodePengangkatan})`
    : `${bulanNames[kodePengangkatan]} ${thnPengangkatan}`;

  return {
    valid: true,
    nip: cleanNip,
    isPPPK: isPPPK,
    statusPegawai: isPPPK ? 'PPPK Aktif' : 'PNS Aktif',
    tanggalLahirFormatted: `${tglLahir} ${bulanNames[blnLahir]} ${thnLahir}`,
    tmtCpnsFormatted: tmtFormatted,
    jenisKelamin: jkCode === '1' ? 'Laki-Laki' : 'Perempuan',
    noUrut: noUrut
  };
}

/**
 * Panggil API SIASN BKN Asli
 */
async function fetchRealBKN(nip) {
  const endpoint = `${BKN_API_BASE_URL}/apiservice/pns/data-utama/${nip}`;
  const headers = {
    'Accept': 'application/json'
  };
  if (BKN_BEARER_TOKEN) {
    headers['Authorization'] = 'Bearer ' + BKN_BEARER_TOKEN;
  }
  if (BKN_SSO_TOKEN) {
    headers['Auth'] = 'bearer ' + BKN_SSO_TOKEN;
  }

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: headers,
    signal: AbortSignal.timeout(8000)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BKN API HTTP ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data;
}

const db = require('./database');

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// Penyimpanan OTP sementara (In-Memory dengan batas waktu 5 menit)
const otpStore = new Map();

/**
 * Mengirim Email OTP via Resend API
 */
async function sendOTPEmailResend(toEmail, otpCode, namaPegawai = 'Aparatur Sipil Negara') {
  if (!RESEND_API_KEY) {
    console.warn('[RESEND WARNING] RESEND_API_KEY belum disetel di .env.');
    return { success: false, reason: 'api_key_missing' };
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="id">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; padding: 24px 12px; margin: 0;">
      <div style="max-width: 520px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
        <div style="background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 26px 20px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px;">Portal e-SlipASN</h1>
          <p style="color: #bfdbfe; font-size: 13px; margin: 6px 0 0 0;">Layanan Slip Gaji & Administrasi ASN Digital</p>
        </div>

        <div style="padding: 28px 22px;">
          <p style="margin: 0 0 12px 0; color: #1e293b; font-size: 15px;">
            Yth. <strong>${namaPegawai}</strong>,
          </p>
          <p style="margin: 0 0 18px 0; color: #475569; font-size: 14px; line-height: 1.6;">
            Gunakan kode One-Time Password (OTP) berikut untuk menyelesaikan verifikasi akun Anda di portal e-SlipASN:
          </p>

          <div style="text-align: center; margin: 24px 0; padding: 18px; background: #f8fafc; border: 2px dashed #93c5fd; border-radius: 12px;">
            <div style="font-size: 34px; font-weight: 800; letter-spacing: 10px; color: #1d4ed8; font-family: 'Courier New', Courier, monospace;">
              ${otpCode}
            </div>
            <div style="font-size: 12px; color: #64748b; margin-top: 8px;">
              ⏱️ Berlaku selama <strong>5 menit</strong>
            </div>
          </div>

          <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px 14px; border-radius: 6px; margin-bottom: 20px;">
            <p style="margin: 0; color: #991b1b; font-size: 12px; line-height: 1.5;">
              <strong>PENTING:</strong> Jangan berikan kode OTP ini kepada siapa pun demi keamanan data kepegawaian Anda.
            </p>
          </div>

          <p style="margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.5;">
            Jika Anda tidak sedang mendaftar di e-SlipASN, abaikan email ini dengan aman.
          </p>
        </div>

        <div style="background-color: #f8fafc; padding: 14px 20px; text-align: center; border-top: 1px solid #f1f5f9;">
          <p style="margin: 0; color: #94a3b8; font-size: 11px;">
            &copy; 2026 e-SlipASN &bull; Sistem Layanan Terpadu Aparatur Sipil Negara RI
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: [toEmail],
      subject: `[e-SlipASN] Kode Verifikasi OTP Anda: ${otpCode}`,
      html: htmlContent
    })
  });

  const resJson = await response.json();
  if (!response.ok) {
    throw new Error(resJson.message || `Resend Error Status ${response.status}`);
  }

  return { success: true, data: resJson };
}

const server = http.createServer(async (req, res) => {
  // Aktifkan CORS untuk kemudahan dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = reqUrl.pathname;

  // ROUTE API: POST /api/send-otp (Generate & Kirim OTP via Resend Email / WhatsApp)
  if (pathname === '/api/send-otp' && req.method === 'POST') {
    const body = await readRequestBody(req);
    const nip = (body.nip || '').replace(/\D/g, '');
    const phone = body.phone || body.noHp || '0812xxxxxxxx';
    const email = (body.email || '').trim();

    if (!nip) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'NIP wajib diisi untuk permintaan OTP' }));
      return;
    }

    // Nama pegawai untuk personalisasi email
    let namaPegawai = (body.nama || body.name || '').trim();
    if (!namaPegawai) {
      const pns = db.getPegawai ? db.getPegawai(nip) : null;
      if (pns && pns.nama) namaPegawai = pns.nama;
    }
    if (!namaPegawai) namaPegawai = 'Aparatur Sipil Negara';

    // Buat 6 angka kode OTP acak yang aman (crypto)
    const otpCode = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // Berlaku 5 menit

    otpStore.set(nip, { otp: otpCode, expiresAt, phone, email });

    console.log(`=======================================================`);
    console.log(`[OTP GENERATED]`);
    console.log(`- NIP Pegawai : ${nip} (${namaPegawai})`);
    console.log(`- Tujuan Email: ${email || '(Email tidak diisi)'}`);
    console.log(`- KODE OTP    : >>> ${otpCode} <<< (Berlaku 5 Menit)`);

    let emailSent = false;
    let emailMessage = '';

    // Kirim via Resend jika email diisi
    if (email) {
      try {
        console.log(`[RESEND] Mengirim email OTP ke ${email}...`);
        await sendOTPEmailResend(email, otpCode, namaPegawai);
        emailSent = true;
        emailMessage = `Kode OTP berhasil dikirim ke email: ${email}`;
        console.log(`[RESEND SUCCESS] Email OTP berhasil dikirim ke ${email}!`);
      } catch (errResend) {
        console.error(`[RESEND ERROR] Gagal mengirim email ke ${email}:`, errResend.message);
        emailMessage = `Gagal mengirim email: ${errResend.message}`;
      }
    }
    console.log(`=======================================================`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: emailSent
        ? `Kode OTP 6 digit telah dikirim ke email ${email}.`
        : 'Kode OTP 6 digit berhasil dibuat.',
      emailSent,
      emailMessage,
      expiresIn: 300
    }));
    return;
  }

  // ROUTE API: POST /api/register (Verifikasi OTP & Simpan Akun Pendaftar ke Database SQLite)
  if (pathname === '/api/register' && req.method === 'POST') {
    const body = await readRequestBody(req);
    const cleanNip = (body.nip || '').replace(/\D/g, '');

    if (!cleanNip || !body.nama || !body.password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'NIP, Nama, dan Kata Sandi wajib diisi lengkap.' }));
      return;
    }

    // Validasi Kode OTP
    const userOtp = (body.otp || '').trim();
    const storedOtp = otpStore.get(cleanNip);

    if (!storedOtp) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        message: 'Kode OTP belum diminta atau telah kedaluwarsa. Silakan klik "Kirim Ulang".'
      }));
      return;
    }

    if (Date.now() > storedOtp.expiresAt) {
      otpStore.delete(cleanNip);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        message: 'Kode OTP telah kedaluwarsa (lebih dari 5 menit). Silakan minta kode baru.'
      }));
      return;
    }

    if (storedOtp.otp !== userOtp) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        message: 'Kode OTP yang Anda masukkan salah. Silakan periksa kembali 6 digit kode Anda.'
      }));
      return;
    }

    // Hapus OTP setelah berhasil diverifikasi agar tidak bisa dipakai ulang
    otpStore.delete(cleanNip);

    // Simpan ke database SQLite
    const regResult = db.registerUser(body);
    res.writeHead(regResult.success ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(regResult));
    return;
  }

  // ROUTE API: POST /api/login (Verifikasi Login dengan Database SQLite & Pemisahan Role)
  if (pathname === '/api/login' && req.method === 'POST') {
    const body = await readRequestBody(req);
    if (!body.nip || !body.password) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'NIP / ID dan Kata Sandi wajib diisi.' }));
      return;
    }
    const loginResult = db.loginUser(body);
    res.writeHead(loginResult.success ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(loginResult));
    return;
  }

  // ROUTE API: POST /api/pegawai/add (Tambah Pegawai Baru dari Dashboard Bendahara/Admin)
  if (pathname === '/api/pegawai/add' && req.method === 'POST') {
    const body = await readRequestBody(req);
    if (!body.nip || !body.nama) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'NIP 18 Digit dan Nama Lengkap Pegawai wajib diisi.' }));
      return;
    }
    const addResult = db.addPegawai(body);
    res.writeHead(addResult.success ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(addResult));
    return;
  }

  // ROUTE API: GET /api/pegawai-list (Daftar Seluruh Pegawai untuk Dashboard Bendahara)
  if (pathname === '/api/pegawai-list' && req.method === 'GET') {
    const list = db.getAllPegawai();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: list.length, data: list }));
    return;
  }

  // ROUTE API: POST /api/slip-gaji/save (Simpan / Terbitkan Slip Gaji dari Bendahara)
  if (pathname === '/api/slip-gaji/save' && req.method === 'POST') {
    const body = await readRequestBody(req);
    if (!body.nip || !body.slipGaji) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'NIP dan rincian slip gaji wajib diisi.' }));
      return;
    }
    const updateResult = db.updateSlipGaji(body.nip, body.slipGaji);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updateResult));
    return;
  }

  // ROUTE API: GET /api/slip-gaji/:nip (Ambil Slip Gaji Spesifik Pegawai)
  if (pathname.startsWith('/api/slip-gaji/') && req.method === 'GET') {
    const nip = pathname.replace('/api/slip-gaji/', '').trim();
    const pegawai = db.getPegawai(nip);
    if (!pegawai) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Data pegawai tidak ditemukan.' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: pegawai }));
    return;
  }

  // ROUTE API: POST /api/slip-gaji/sync-csv & /api/slip-gaji/sync-dinas (Sinkronkan Data Gaji dari CSV Dinas)
  if ((pathname === '/api/slip-gaji/sync-csv' || pathname === '/api/slip-gaji/sync-dinas') && req.method === 'POST') {
    const resSync = db.syncGajiFromCsv();
    const allPeg = db.getAllPegawai();
    const records = allPeg.filter(p => p.slipGaji).map(p => ({
      nip: p.nip,
      nama: p.nama,
      rekening: (p.slipGaji && p.slipGaji.rekening) || `0062${p.nip.slice(-6)}`,
      gajiKotor: (p.slipGaji && p.slipGaji.gajiKotor) || 0,
      potonganDetail: (p.slipGaji && p.slipGaji.potongan) || {},
      totalPotongan: (p.slipGaji && p.slipGaji.totalPotongan) || 0,
      gajiBersih: (p.slipGaji && p.slipGaji.totalGajiBersih) || 0
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      message: `Berhasil menyinkronkan ${resSync.count} data slip gaji dari CSV Dinas.`,
      count: resSync.count,
      records: records
    }));
    return;
  }

  // ROUTE API: POST /api/slip-gaji/import-extracted (Terapkan Ekstraksi File Excel/PDF/JPEG ke Database Gaji)
  if (pathname === '/api/slip-gaji/import-extracted' && req.method === 'POST') {
    const body = await readRequestBody(req);
    if (!body || !Array.isArray(body.records) || body.records.length === 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: 'Tidak ada data pegawai yang valid untuk diimpor.' }));
      return;
    }

    const importRes = db.applyExtractedPayroll(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(importRes));
    return;
  }

  // ROUTE API: /api/cek-bkn/:nip
  if (pathname.startsWith('/api/cek-bkn/')) {
    const nip = pathname.replace('/api/cek-bkn/', '').trim();
    const parsedNip = parseNIPBKN(nip);

    if (!parsedNip.valid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        message: parsedNip.message
      }));
      return;
    }

    // Jika Kredensial BKN Asli tersedia di .env, panggil API BKN resmi
    if (BKN_BEARER_TOKEN && BKN_BEARER_TOKEN !== 'YOUR_BKN_BEARER_TOKEN') {
      try {
        console.log(`[API BKN] Menghubungi server SIASN BKN untuk NIP: ${nip}...`);
        const bknData = await fetchRealBKN(nip);
        const pns = bknData.data || bknData;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          source: 'real_siasn_bkn',
          message: 'Data ASN berhasil diverifikasi langsung dari Server SIASN BKN',
          data: {
            nip: pns.nipBaru || nip,
            nama: pns.nama || pns.namaLengkap,
            nik: pns.nik || '',
            instansi: pns.instansiIndukNama || 'Badan Kepegawaian Negara',
            instansiKey: 'bkn',
            satker: pns.satuanKerjaIndukNama || pns.unorNama || 'Pusat Data dan Informasi BKN',
            golongan: pns.golonganAkhir || 'Penata Muda / III/a',
            jabatan: pns.jabatanNama || 'Aparatur Sipil Negara',
            statusPegawai: pns.statusPegawai || 'PNS Aktif',
            jenisKelamin: parsedNip.jenisKelamin,
            tglLahir: parsedNip.tanggalLahirFormatted,
            tmtCpns: parsedNip.tmtCpnsFormatted
          }
        }));
        return;
      } catch (err) {
        console.error('[API BKN ERROR]', err.message);
        // Fallback jika API BKN error/offline atau token kedaluwarsa
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          source: 'bkn_gateway_error',
          message: `Gagal menghubungi API Gateway SIASN BKN: ${err.message}. Pastikan Token BKN masih aktif dan IP server Anda sudah di-whitelist oleh BKN.`
        }));
        return;
      }
    }

    // 1. Cek apakah ada berkas .json tersendiri per-pegawai (data/pegawai/{nip}.json)
    const individualFilePath = path.join(__dirname, 'data', 'pegawai', `${parsedNip.nip}.json`);
    if (fs.existsSync(individualFilePath)) {
      try {
        const rawContent = fs.readFileSync(individualFilePath, 'utf8');
        const found = JSON.parse(rawContent);
        if (found && (found.nama || found.nip)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            source: 'local_master_data',
            message: 'Data Pegawai ditemukan di Berkas Master ASN Mandiri',
            data: {
              nip: found.nip || parsedNip.nip,
              nama: found.nama,
              nik: found.nik || `3201${parsedNip.nip.substring(0, 8)}0001`,
              instansi: found.instansi || 'Badan Kepegawaian Negara',
              instansiKey: found.instansiKey || 'bkn',
              satker: found.satker || 'Unit Kerja ASN',
              golongan: found.golongan || 'Penata Muda / III/a',
              jabatan: found.jabatan || 'Aparatur Sipil Negara',
              statusPegawai: found.statusPegawai || 'PNS Aktif',
              email: found.email || '',
              noHp: found.noHp || '',
              jenisKelamin: parsedNip.jenisKelamin,
              tglLahir: parsedNip.tanggalLahirFormatted,
              tmtCpns: parsedNip.tmtCpnsFormatted,
              slipGaji: found.slipGaji || null
            }
          }));
          return;
        }
      } catch (errIndiv) {
        console.error('[INDIVIDUAL MASTER ERROR]', errIndiv.message);
      }
    }

    // 2. Cek apakah ada di Database SQLite (master_pegawai)
    const dbPegawai = db.getPegawai(parsedNip.nip);
    if (dbPegawai) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        source: 'local_master_data',
        message: 'Data Pegawai terverifikasi di Database SQLite Instansi',
        data: dbPegawai
      }));
      return;
    }

    // 3. Cek apakah NIP terdaftar di Master Data Kolektif (data-pegawai.json atau data/data-pegawai.json)
    const collectivePaths = [
      path.join(__dirname, 'data', 'data-pegawai.json'),
      path.join(__dirname, 'data-pegawai.json')
    ];
    for (const masterDataPath of collectivePaths) {
      if (fs.existsSync(masterDataPath)) {
        try {
          const rawContent = fs.readFileSync(masterDataPath, 'utf8');
          const pegawaiList = JSON.parse(rawContent);
          if (Array.isArray(pegawaiList)) {
            const found = pegawaiList.find(p => {
              const pNip = (p.nip || p.NIP || '').toString().trim();
              return pNip === parsedNip.nip || pNip === nip;
            });
            if (found) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                source: 'local_master_data',
                message: 'Data Pegawai ditemukan di Master Data ASN Instansi',
                data: {
                  nip: found.nip || found.NIP || parsedNip.nip,
                  nama: found.nama || found.Nama,
                  nik: found.nik || found.NIK || `3201${parsedNip.nip.substring(0, 8)}0001`,
                  instansi: found.instansi || found.Instansi || 'Pemerintah Republik Indonesia',
                  instansiKey: found.instansiKey || 'lainnya',
                  satker: found.satker || found.Satker || found.unitKerja || found.UnitKerja || 'Dinas Pendidikan & Kebudayaan',
                  golongan: found.golongan || found.Golongan || 'Penata / Gol. III',
                  jabatan: found.jabatan || found.Jabatan || 'Tenaga Pendidik / Aparatur Sipil Negara',
                  statusPegawai: found.statusPegawai || 'PNS Aktif',
                  email: found.email || found.Email || '',
                  noHp: found.noHp || found.NoHp || '',
                  jenisKelamin: parsedNip.jenisKelamin,
                  tglLahir: parsedNip.tanggalLahirFormatted,
                  tmtCpns: parsedNip.tmtCpnsFormatted,
                  slipGaji: found.slipGaji || null
                }
              }));
              return;
            }
          }
        } catch (e) {
          console.error('[MASTER DATA ERROR]', e.message);
        }
      }
    }

    // Mode Proxy Sandbox / Verifikasi Algoritmik BKN (Saat data belum ada di master)
    // Mensimulasikan data ASN resmi berdasarkan struktur NIP 18 digit yang valid
    const namaPrefix = parsedNip.jenisKelamin === 'Laki-Laki' ? 'Drs. Hendra Gunawan' : 'Dra. Sri Wahyuni';
    const gelar = ', M.Si.';

    // Simulasi penentuan instansi & satker berdasarkan digit
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      source: 'bkn_algorithmic_verifier',
      isDevelopmentMode: true,
      message: 'Format NIP 18 Digit Sah & Valid sesuai Perka BKN No. 22/2007',
      data: {
        nip: parsedNip.nip,
        nama: `${namaPrefix}${gelar}`,
        nik: `3201${parsedNip.nip.substring(0, 8)}0001`,
        instansi: 'Badan Kepegawaian Negara (BKN Pusat)',
        instansiKey: 'bkn',
        satker: 'Biro Sistem Informasi Kepegawaian & Tata Kelola ASN',
        golongan: 'Pembina / Gol. IV/a',
        statusPegawai: 'PNS Aktif (SIASN Terverifikasi)',
        jenisKelamin: parsedNip.jenisKelamin,
        tglLahir: parsedNip.tanggalLahirFormatted,
        tmtCpns: parsedNip.tmtCpnsFormatted
      },
      catatanIntegrasi: 'Untuk beralih ke Server Live SIASN BKN, masukkan BKN_BEARER_TOKEN di berkas .env'
    }));
    return;
  }

  // STATIC FILE HANDLER
  if (pathname === '/') {
    pathname = '/login.html';
  }

  const filePath = path.join(__dirname, pathname);

  // Mencegah directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, { 'Content-Type': contentType });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`[e-SlipASN Server] Berjalan di http://localhost:${PORT}`);
  console.log(`- Portal Pendaftaran: http://localhost:${PORT}/login.html#register`);
  console.log(`- Portal Masuk Login: http://localhost:${PORT}/login.html#login`);
  console.log(`- API Cek BKN:       http://localhost:${PORT}/api/cek-bkn/{nip}`);
  console.log(`=======================================================`);
});
