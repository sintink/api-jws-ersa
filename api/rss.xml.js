// api/rss_xml.js
// Vercel Serverless Function — RSS + JSON Aggregator untuk ESP32 Display
// Endpoint: GET /rss.xml?berita=1&gempa=1&bola=1&olahraga=1&libur=1
//
// Query params (default semua aktif, nonaktifkan dengan =0):
//   berita=0   → matikan berita
//   gempa=0    → matikan gempa
//   bola=0     → matikan jadwal bola
//   olahraga=0 → matikan berita olahraga
//   libur=0    → matikan countdown hari libur

// ── Sumber RSS Berita ─────────────────────────────────────────────────────────
const RSS_SOURCES = [
    { name: 'Antara',   url: 'https://www.antaranews.com/rss/terkini.xml' },
    { name: 'CNN',      url: 'https://www.cnnindonesia.com/rss' },
    { name: 'Detik',    url: 'https://finance.detik.com/rss' },
    { name: 'Tirto',  url: 'https://tirto.id/sitemap/r/google-discover' },
];

// ── Sumber JSON ───────────────────────────────────────────────────────────────
const BMKG_GEMPA   = 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json';
const RSS_OLAHRAGA = { name: 'Olahraga', url: 'https://www.cnnindonesia.com/olahraga/rss' };
const LIBUR_URL = 'https://raw.githubusercontent.com/guangrei/APIHariLibur_V2/main/holidays.json';

// TheSportsDB — liga yang ditampilkan
// id: league ID di TheSportsDB
const LIGA_LIST = [
    { nama: 'EPL',       id: 4328 },  // English Premier League
    { nama: 'La Liga',   id: 4335 },  // Spanish La Liga
    { nama: 'Serie A',   id: 4332 },  // Italian Serie A
    { nama: 'Bundesliga',id: 4331 },  // German Bundesliga
    { nama: 'Liga 1',    id: 4790 },  // Liga 1 Indonesia
];
const MAX_MATCH_PER_LIGA = 3;

// ── Fetch dengan timeout ──────────────────────────────────────────────────────
async function fetchWithTimeout(url, ms = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return res;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

// ── Escape XML special chars ──────────────────────────────────────────────────
function escXml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// ── Ambil berita dari satu RSS source ────────────────────────────────────────
async function fetchOneRSS(source, quota = 3) {
    try {
        const res = await fetchWithTimeout(source.url);
        const xml = await res.text();
        const items = [];
        const itemRegex = /<item>[\s\S]*?<\/item>/g;
        const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/;
        let match;
        while ((match = itemRegex.exec(xml)) !== null && items.length < quota) {
            const itemXml = match[0];
            const titleMatch = titleRegex.exec(itemXml);
            if (titleMatch) {
                const title = (titleMatch[1] || titleMatch[2] || '').trim();
                if (title.length > 3) {
                    items.push(`[${source.name}] ${title}`);
                }
            }
        }
        return items;
    } catch (e) {
        console.error(`fetchOneRSS ${source.name} error:`, e.message);
        return [];
    }
}

// ── Ambil berita dari semua sumber RSS ───────────────────────────────────────
async function getBerita(quotaPerSource = 3) {
    const results = await Promise.all(
        RSS_SOURCES.map(src => fetchOneRSS(src, quotaPerSource))
    );
    // Gabungkan dan interleave agar tidak semua Antara dulu
    const merged = [];
    const maxLen = Math.max(...results.map(r => r.length));
    for (let i = 0; i < maxLen; i++) {
        for (const arr of results) {
            if (arr[i]) merged.push(arr[i]);
        }
    }
    return merged;
}

// ── Ambil info gempa terkini dari BMKG ───────────────────────────────────────
async function getGempa() {
    try {
        const res = await fetchWithTimeout(BMKG_GEMPA);
        const json = await res.json();
        const g = json?.Infogempa?.gempa;
        if (!g) return [];

        const mag     = g.Magnitude || '?';
        const dalam   = g.Kedalaman || '?';
        const wilayah = g.Wilayah   || '?';
        const potensi = g.Potensi   || '';
        const tgl     = g.Tanggal   || '';
        const jam     = g.Jam       || '';

        const title = `Gempa M${mag} | ${dalam} | ${wilayah} | ${potensi} | ${tgl} ${jam}`;
        return [title.trim()];
    } catch (e) {
        console.error('getGempa error:', e.message);
        return [];
    }
}


// ── Countdown hari libur nasional Indonesia ───────────────
async function getLibur() {
    try {
        const res  = await fetchWithTimeout(LIBUR_URL);
        const json = await res.json();

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let nearest = null;
        let minDiff = Infinity;

        for (const [tgl, val] of Object.entries(json)) {
            const d = new Date(tgl);
            d.setHours(0, 0, 0, 0);
            const diff = Math.round((d - today) / (1000 * 60 * 60 * 24));
            if (diff >= 0 && diff < minDiff) {
                minDiff = diff;
                nearest = { nama: val.summary };
            }
        }

        if (!nearest) return [];
        const nama = nearest.nama || 'Hari Libur';
        let label;
        if (minDiff === 0)      label = `Hari ini Libur! ${nama}`;
        else if (minDiff === 1) label = `Besok Libur! ${nama}`;
        else                    label = `${nama} ${minDiff} hari lagi`;

        return [label];
    } catch (e) {
        console.error('getLibur error:', e.message);
        return [];
    }
}

// ── Label waktu pertandingan (WIB) ───────────────────────────────────────────
function getLabelWaktu(dateStr, timeStr) {
    // dateStr: "2026-06-14", timeStr: "13:00:00" (UTC dari TheSportsDB)
    try {
        const utcStr = `${dateStr}T${timeStr}Z`;
        const matchDate = new Date(utcStr);

        const now = new Date();
        // Konversi ke WIB (UTC+7)
        const wibOffset = 7 * 60 * 60 * 1000;
        const matchWIB  = new Date(matchDate.getTime() + wibOffset);
        const nowWIB    = new Date(now.getTime() + wibOffset);

        const matchDay = new Date(matchWIB);
        matchDay.setHours(0, 0, 0, 0);
        const todayDay = new Date(nowWIB);
        todayDay.setHours(0, 0, 0, 0);

        const diffDay = Math.round((matchDay - todayDay) / (1000 * 60 * 60 * 24));

        const jam = matchWIB.getUTCHours();
        const mnt = String(matchWIB.getUTCMinutes()).padStart(2, '0');
        const jamStr = `${jam}:${mnt}`;

        // Label waktu
        let labelHari;
        if (diffDay === 0) {
            if (jam >= 15 && jam < 18)      labelHari = 'Sore ini';
            else if (jam >= 18 && jam < 22) labelHari = 'Malam ini';
            else if (jam >= 22 || jam < 4)  labelHari = 'Dini hari';
            else                             labelHari = 'Hari ini';
        } else if (diffDay === 1) {
            labelHari = 'Besok';
        } else {
            // Format tanggal DD Mon
            const bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Ags','Sep','Okt','Nov','Des'];
            labelHari = `${matchWIB.getUTCDate()} ${bulan[matchWIB.getUTCMonth()]}`;
        }

        return `${labelHari} ${jamStr}`;
    } catch {
        return timeStr || '';
    }
}
// ── Ambil jadwal bola dari TheSportsDB ───────────────────────────────────────
async function getBola() {
    const wibOffset = 7 * 60 * 60 * 1000;
    const nowWIB    = new Date(Date.now() + wibOffset);

    // Tanggal hari ini dalam format YYYY-MM-DD (WIB)
    const todayStr = nowWIB.toISOString().substring(0, 10);

    const hasil = [];

    await Promise.all(LIGA_LIST.map(async (liga) => {
        try {
            const url = `https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=${liga.id}`;
            const res  = await fetchWithTimeout(url, 6000);
            const json = await res.json();
            const events = json?.events || [];

            for (const ev of events) {
                const tgl  = ev.dateEvent || '';
                if (tgl !== todayStr) continue;  // hanya hari ini

                const home = ev.strHomeTeam || '?';
                const away = ev.strAwayTeam || '?';
                const time = ev.strTime     || '00:00:00';

                // Konversi jam UTC → WIB
                const utcDate = new Date(`${tgl}T${time}Z`);
                const wibDate = new Date(utcDate.getTime() + wibOffset);
                const jam = String(wibDate.getUTCHours()).padStart(2, '0');
                const mnt = String(wibDate.getUTCMinutes()).padStart(2, '0');

                hasil.push(`[${liga.nama}] ${jam}:${mnt} | ${home} vs ${away}`);
            }
        } catch (e) {
            console.error(`getBola ${liga.nama} error:`, e.message);
        }
    }));

    return hasil;
}

// ── Build RSS XML ─────────────────────────────────────────────────────────────
function buildRSS(items) {
    const now = new Date().toUTCString();
    let itemsXml = '';
    for (const title of items) {
        itemsXml += `  <item><title><![CDATA[${title}]]></title></item>\n`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>JWS Ersa Cloud Feed</title>
    <link>https://api-jws-ersa.vercel.app</link>
    <description>Aggregated feed untuk ESP32 Display</description>
    <lastBuildDate>${now}</lastBuildDate>
${itemsXml}  </channel>
</rss>`;
}

// ── Handler utama ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

    const q = req.query || {};
    const wantBerita   = q.berita   !== '0';
    const wantGempa    = q.gempa    !== '0';
    const wantBola     = q.bola     !== '0';
    const wantOlahraga = q.olahraga !== '0';
    const wantLibur    = q.libur    !== '0';

    // Jalankan semua fetch paralel
    const [beritaItems, gempaItems, bolaItems, olahragaItems, liburItems] = await Promise.all([
        wantBerita   ? getBerita(3)                  : [],
        wantGempa    ? getGempa()                    : [],
        wantBola     ? getBola()                     : [],
        wantOlahraga ? fetchOneRSS(RSS_OLAHRAGA, 3)  : [],
        wantLibur    ? getLibur()                    : [],
    ]);

    const allItems = [
        ...liburItems,    // countdown libur paling atas
        ...gempaItems,    // gempa prioritas kedua
        ...bolaItems,     // jadwal bola
        ...olahragaItems, // berita olahraga
        ...beritaItems,   // berita umum
    ];

    if (allItems.length === 0) {
        allItems.push('Tidak ada data tersedia saat ini');
    }

    const xml = buildRSS(allItems);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send(xml);
            }
        
