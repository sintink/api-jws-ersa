# api-jws-ersa

RSS Aggregator untuk ESP32 Masjid Display — Vercel Serverless

## Endpoint

```
GET /rss.xml?berita=1&gempa=1&hadits=1
```

| Parameter | Default | Keterangan |
|-----------|---------|------------|
| berita    | 1 (aktif) | Berita terkini dari Antara |
| gempa     | 0 (nonaktif) | Info gempa terkini BMKG |
| hadits    | 1 (aktif) | Mutiara hadits acak |

## Cara Deploy ke Vercel

### 1. Buat akun Vercel
- Buka https://vercel.com
- Klik **Sign Up** → pilih **Continue with GitHub**
- Daftar/login GitHub jika belum punya

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
https://nama-project.vercel.app/rss.xml?berita=1&gempa=1&hadits=1
```
Harusnya muncul XML RSS.

### 5. Update ESP32
Di web panel ESP32, tab Konten → Feed 1:
```
URL:  https://nama-project.vercel.app/rss.xml
Nama: Cloud
```
Simpan → ESP32 akan otomatis pakai URL baru saat fetch berikutnya.

## Struktur File

```
api-jws-ersa/
├── api/
│   └── rss.xml.js    ← Serverless function utama
├── vercel.json        ← Routing config
├── package.json
└── README.md
```
