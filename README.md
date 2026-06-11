# api-jws-ersa

RSS + JSON Aggregator untuk ESP32 Display — Vercel Serverless

## Endpoint

```
GET /rss.xml?berita=1&gempa=1&bola=1&fakta=1&libur=1
```

| Parameter | Default | Keterangan |
|-----------|---------|------------|
| berita    | 1 (aktif) | Berita terkini dari Antara, CNN Indonesia, Detik, Media Indonesia |
| gempa     | 1 (aktif) | Info gempa terkini dari BMKG |
| bola      | 1 (aktif) | Jadwal bola malam ini (EPL, La Liga, Serie A, Bundesliga, Liga 1) |
| fakta     | 1 (aktif) | Fakta unik acak Bahasa Indonesia |
| libur     | 1 (aktif) | Countdown hari libur nasional berikutnya |

> Nonaktifkan dengan menambahkan `=0`, contoh: `?bola=0&fakta=0`

## Sumber Data

| Konten | Sumber | Tipe |
|--------|--------|------|
| Berita | Antara, CNN Indonesia, Detik, Media Indonesia | RSS |
| Gempa | BMKG | JSON |
| Jadwal Bola | TheSportsDB | JSON |
| Fakta Unik | uselessfacts.jsph.pl | JSON |
| Hari Libur | guangrei/APIHariLibur_V2 (Google Calendar) | JSON |

## Jadwal Bola

- Tampil otomatis hanya pada jam **15:00 – 03:00 WIB**
- Label waktu: `Sore ini`, `Malam ini`, `Dini hari`, `Besok`, atau tanggal
- Maksimal 3 pertandingan per liga
- Liga: EPL, La Liga, Serie A, Bundesliga, Liga 1 Indonesia

## Cara Deploy ke Vercel

### 1. Buat akun Vercel
- Buka https://vercel.com
- Klik **Sign Up** → pilih **Continue with GitHub**

### 2. Upload project
- Di dashboard Vercel, klik **Add New → Project**
- Pilih **Deploy without Git** (atau drag & drop folder ini)
- Upload folder `api-jws-ersa` ini

### 3. Deploy
- Klik **Deploy** — tunggu ~30 detik
- Vercel akan memberi domain: `nama-project.vercel.app`

### 4. Test endpoint
Buka di browser:
```
https://nama-project.vercel.app/rss.xml?berita=1&gempa=1&bola=1&fakta=1&libur=1
```
Harusnya muncul XML RSS.

### 5. Update ESP32
Di web panel ESP32, tab Konten → isi URL Feed:
```
https://nama-project.vercel.app/rss.xml
```
Simpan → ESP32 otomatis pakai URL baru saat fetch berikutnya.

## Struktur File

```
api-jws-ersa/
├── api/
│   └── rss_xml.js     ← Serverless function utama
├── vercel.json         ← Routing config
├── package.json
└── README.md
```
