// api/rss_xml.js
// Vercel Serverless Function — RSS + JSON Aggregator untuk ESP32 Display
// Endpoint: GET /rss.xml?berita=1&gempa=1&bola=1&olahraga=1&libur=1

// ── Sumber RSS Berita ─────────────────────────────────────────────────────────
const RSS_SOURCES = [
    { name: 'Antara', url: 'https://www.antaranews.com/rss/terkini.xml' },
    { name: 'CNN',    url: 'https://www.cnnindonesia.com/rss' },
    { name: 'Detik',  url: 'https://finance.detik.com/rss' },
    { name: 'Tirto',  url: 'https://tirto.id/sitemap/r/google-discover' },
];

// ── Sumber JSON ───────────────────────────────────────────────────────────────
const BMKG_GEMPA   = 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json';
const RSS_OLAHRAGA = { name: 'Olahraga', url: 'https://www.cnnindonesia.com/olahraga/rss' };
const LIBUR_URL    = 'https://raw.githubusercontent.com/guangrei/APIHariLibur_V2/main/holidays.json';

// TheSportsDB — 7 Liga Pilihan
const LIGA_LIST = [
    { nama: 'EPL',       id: 4328 },  // English Premier League
    { nama: 'La Liga',   id: 4335 },  // Spanish La Liga
    { nama: 'Serie A',   id: 4332 },  // Italian Serie A
    { nama: 'Bundesliga',id: 4331 },  // German Bundesliga
    { nama: 'UCL',       id: 4480 },  // UEFA Champions League
    { nama: 'UEL',       id: 4359 },  // UEFA Europa League (Malam Jumat)
    { nama: 'Liga 1',    id: 4790 },  // Liga 1 Indonesia
];

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
                    items.push(`[Berita] ${title}`);
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

// ── Countdown hari libur nasional Indonesia ──────────────────────────────────
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

// ── Ambil Jadwal & Skor Bola dari TheSportsDB ────────────────────────────────
async function getBola() {
    const wibOffset = 7 * 60 * 60 * 1000;
    let semuaMatch = [];
    const sekarang = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
    const hariIni = new Date(sekarang.getFullYear(), sekarang.getMonth(), sekarang.getDate());

    await Promise.all(LIGA_LIST.map(async (liga) => {
        try {
            const urlNext = `https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=${liga.id}`;
            const urlPast = `https://www.thesportsdb.com/api/v1/json/123/eventspastleague.php?id=${liga.id}`;

            const [resNext, resPast] = await Promise.all([
                fetchWithTimeout(urlNext, 6000),
                fetchWithTimeout(urlPast, 6000)
            ]);

            const [jsonNext, jsonPast] = await Promise.all([
                resNext.json(),
                resPast.json()
            ]);

            const eventsNext = jsonNext?.events || [];
            const eventsPast = jsonPast?.events || [];

            // 1. Jadwal Pertandingan Akan Datang
            for (const ev of eventsNext) {
                if (!ev.dateEvent) continue;
                const time = ev.strTime || "00:00:00";
                const utcDate = new Date(`${ev.dateEvent}T${time}Z`);
                const wibDate = new Date(utcDate.getTime() + wibOffset);

                semuaMatch.push({
                    liga: liga.nama,
                    tanggal: wibDate.toISOString().substring(0, 10),
                    jam: String(wibDate.getUTCHours()).padStart(2, '0') + ":" + String(wibDate.getUTCMinutes()).padStart(2, '0'),
                    home: ev.strHomeTeam || '?',
                    away: ev.strAwayTeam || '?',
                    status: 'upcoming',
                    homeScore: null,
                    awayScore: null
                });
            }

            // 2. Hasil Pertandingan Selesai / LIVE
            for (const ev of eventsPast) {
                if (!ev.dateEvent) continue;

                const time = ev.strTime || "00:00:00";
                const utcDate = new Date(`${ev.dateEvent}T${time}Z`);
                const wibDate = new Date(utcDate.getTime() + wibOffset);
                const status = ev.strStatus || '';

                const homeScore = ev.intHomeScore !== null && ev.intHomeScore !== undefined ? parseInt(ev.intHomeScore) : null;
                const awayScore = ev.intAwayScore !== null && ev.intAwayScore !== undefined ? parseInt(ev.intAwayScore) : null;

                if (homeScore === null || awayScore === null) continue;

                let statusLabel = 'FT';
                if (['1H', '2H', 'HT', 'ET', 'P'].includes(status)) statusLabel = 'LIVE';

                semuaMatch.push({
                    liga: liga.nama,
                    tanggal: wibDate.toISOString().substring(0, 10),
                    jam: String(wibDate.getUTCHours()).padStart(2, '0') + ":" + String(wibDate.getUTCMinutes()).padStart(2, '0'),
                    home: ev.strHomeTeam || '?',
                    away: ev.strAwayTeam || '?',
                    status: statusLabel,
                    homeScore: homeScore,
                    awayScore: awayScore
                });
            }

        } catch (e) {
            console.error(`getBola ${liga.nama} error:`, e.message);
        }
    }));

    if (semuaMatch.length === 0) return [];

    const hasilItems = [];

    // ── OUTPUT JADWAL MENDATANG ──
    const upcoming = semuaMatch.filter(m => m.status === 'upcoming');
    if (upcoming.length > 0) {
        upcoming.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));
        const tanggalTerdekat = upcoming[0].tanggal;
        const target = new Date(tanggalTerdekat);
        const hariLagi = Math.ceil((target - hariIni) / (1000 * 60 * 60 * 24));

        let label;
        if (hariLagi === 0) label = "Hari ini";
        else if (hariLagi === 1) label = "Besok";
        else label = `${hariLagi} hari lagi`;

        upcoming.filter(m => m.tanggal === tanggalTerdekat).forEach(m => {
            hasilItems.push(`[${m.liga}] ${label} ${m.jam} | ${m.home} vs ${m.away}`);
        });
    }

    // ── OUTPUT HASIL SKOR (DIPOTONG & DIGABUNG 2 MATCH PER LIGA) ──
    const livePast = semuaMatch.filter(m => m.status !== 'upcoming');
    
    // Kelompokkan skor berdasarkan Liganya
    const skorPerLiga = {};
    for (const m of livePast) {
        if (!skorPerLiga[m.liga]) skorPerLiga[m.liga] = [];
        
        const textSkor = m.status === 'FT' 
            ? `${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`
            : `[LIVE] ${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`;
            
        skorPerLiga[m.liga].push(textSkor);
    }

    // Gabungkan maksimal 2 skor per liga dengan pemisah ' | '
    for (const [namaLiga, listSkor] of Object.entries(skorPerLiga)) {
        const duaSkor = listSkor.slice(0, 2).join(' | ');
        hasilItems.push(`[Skor ${namaLiga}] ${duaSkor}`);
    }

    return hasilItems;
}

// ── Build RSS XML ─────────────────────────────────────────────────────────────
function buildRSS(items) {
    const now = new Date().toUTCString();
    let itemsXml = '';
    for (const title of items) {
        itemsXml += `  <item><title><![CDATA[${escXml(title)}]]></title></item>\n`;
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

    const [beritaItems, gempaItems, bolaItems, olahragaItems, liburItems] = await Promise.all([
        wantBerita   ? getBerita(3)                  : [],
        wantGempa    ? getGempa()                    : [],
        wantBola     ? getBola()                     : [],
        wantOlahraga ? fetchOneRSS(RSS_OLAHRAGA, 3)  : [],
        wantLibur    ? getLibur()                    : [],
    ]);

    const allItems = [
        ...liburItems,    // countdown libur
        ...gempaItems,    // gempa
        ...bolaItems,     // jadwal + skor bola
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
        
