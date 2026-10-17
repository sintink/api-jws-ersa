// api/rss_xml.js (Versi Antrean Bola)
const RSS_SOURCES = [
    { name: 'Antara', url: 'https://www.antaranews.com/rss/terkini.xml' },
    { name: 'CNN',    url: 'https://www.cnnindonesia.com/rss' },
    { name: 'Tirto',  url: 'https://tirto.id/sitemap/r/google-discover' },
];

const BMKG_GEMPA   = 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json';
const RSS_OLAHRAGA = { name: 'Olahraga', url: 'https://www.cnnindonesia.com/olahraga/rss' };
const LIBUR_URL    = 'https://raw.githubusercontent.com/guangrei/APIHariLibur_V2/main/holidays.json';
const GOOGLE_LANTAS_URL = 'https://news.google.com/rss/search?q=lalu+lintas+Jawa+Tengah+OR+Polda+Jateng+OR+macet+Semarang&hl=id&gl=ID&ceid=ID:id';

const LANTAS_STOPWORDS = new Set([
    'lalu', 'lintas', 'jawa', 'tengah', 'jateng', 'polda', 'semarang', 'macet',
    'yang', 'dengan', 'untuk', 'dari', 'pada', 'akan', 'karena', 'saat', 'usai',
    'kota', 'jalan', 'arus', 'kendaraan', 'polisi', 'polres'
]);

const GEMPA_MIN_MAG = 4.0;
const GEMPA_MAX_JAM = 6;
const SPORTSDB_KEY = '123';

const LIGA_LIST = [
    { nama: 'EPL',       id: 4328 },
    { nama: 'La Liga',   id: 4335 },
    { nama: 'Serie A',   id: 4332 },
    { nama: 'Bundesliga',id: 4331 },
    { nama: 'UCL',       id: 4480 },
    { nama: 'UEL',       id: 4481 },
    { nama: 'Liga 1',    id: 4790 },
];

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

const FETCH_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, application/json, text/plain, */*',
    'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8'
};

async function fetchWithTimeout(url, ms = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, { signal: controller.signal, headers: FETCH_HEADERS });
        return res;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchOneRSS(source, quota = 3, label = 'Berita', maxAgeHours = 6) {
    try {
        const res = await fetchWithTimeout(source.url);
        const xml = await res.text();
        const itemRegex = /<item>[\s\S]*?<\/item>/g;
        const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;
        const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/;
        const items = [];
        let match;
        while ((match = itemRegex.exec(xml)) !== null && items.length < quota) {
            const itemXml = match[0];
            const pubDateMatch = pubDateRegex.exec(itemXml);
            if (pubDateMatch) {
                const pubDate = new Date(pubDateMatch[1].trim());
                if (!isNaN(pubDate.getTime())) {
                    const ageHours = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60);
                    if (ageHours > maxAgeHours) continue;
                }
            }
            const titleMatch = titleRegex.exec(itemXml);
            if (titleMatch) {
                const title = (titleMatch[1] || titleMatch[2] || '').trim();
                if (title.length > 3) items.push(`[${label}] ${title}`);
            }
        }
        return items;
    } catch (e) { return []; }
}

async function getBerita(quotaPerSource = 3) {
    const results = await Promise.all(RSS_SOURCES.map(src => fetchOneRSS(src, quotaPerSource, 'Berita')));
    const merged = [];
    const maxLen = Math.max(...results.map(r => r.length), 0);
    for (let i = 0; i < maxLen; i++) {
        for (const arr of results) { if (arr[i]) merged.push(arr[i]); }
    }
    return merged;
}

async function getLantas(quota = 2, maxAgeHours = 24) {
    try {
        const res = await fetchWithTimeout(GOOGLE_LANTAS_URL);
        const xml = await res.text();
        const itemRegex = /<item>[\s\S]*?<\/item>/g;
        const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;
        const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/;
        const items = [];
        const seenKeywords = [];
        let match;
        while ((match = itemRegex.exec(xml)) !== null && items.length < quota) {
            const itemXml = match[0];
            const pubDateMatch = pubDateRegex.exec(itemXml);
            if (pubDateMatch) {
                const pubDate = new Date(pubDateMatch[1].trim());
                if (!isNaN(pubDate.getTime())) {
                    const ageHours = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60);
                    if (ageHours > maxAgeHours) continue;
                }
            }
            const titleMatch = titleRegex.exec(itemXml);
            if (!titleMatch) continue;
            let title = (titleMatch[1] || titleMatch[2] || '').trim();
            title = title.replace(/\s-\s[^-]+$/, '').trim();
            const words = (title.toLowerCase().match(/\b[a-z]{4,}\b/g) || []).filter(w => !LANTAS_STOPWORDS.has(w));
            let isDuplicate = false;
            for (const seen of seenKeywords) {
                if (words.filter(w => seen.includes(w)).length >= 2) { isDuplicate = true; break; }
            }
            if (title.length > 10 && !isDuplicate) {
                seenKeywords.push(words);
                items.push(`[Lantas] ${title}`);
            }
        }
        return items;
    } catch (e) { return []; }
}

async function getGempa() {
    try {
        const res = await fetchWithTimeout(BMKG_GEMPA);
        const json = await res.json();
        const g = json?.Infogempa?.gempa;
        if (!g) return [];
        const dirasakanField = (g.Dirasakan || '').trim();
        const potensiField   = (g.Potensi || '').trim();
        if (!((dirasakanField !== '' && dirasakanField !== '-') || /dirasakan/i.test(potensiField))) return [];
        const magNum = parseFloat(g.Magnitude);
        if (isNaN(magNum) || magNum < GEMPA_MIN_MAG) return [];
        if (g.DateTime) {
            const waktuGempa = new Date(g.DateTime);
            if (!isNaN(waktuGempa.getTime())) {
                if ((Date.now() - waktuGempa.getTime()) / 3600000 > GEMPA_MAX_JAM) return [];
            }
        }
        return [`Gempa M${g.Magnitude || '?'} | ${g.Kedalaman || '?'} | ${g.Wilayah || '?'} | ${g.Potensi || ''} | ${g.Tanggal || ''} ${g.Jam || ''}`];
    } catch (e) { return []; }
}

async function getLibur() {
    try {
        const res = await fetchWithTimeout(LIBUR_URL);
        const json = await res.json();
        const wibNow = new Date(Date.now() + WIB_OFFSET_MS);
        const today = new Date(Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate()));
        let nearest = null; let minDiff = Infinity;
        for (const [tgl, val] of Object.entries(json)) {
            const diff = Math.round((new Date(tgl) - today) / 86400000);
            if (diff >= 0 && diff < minDiff) { minDiff = diff; nearest = { nama: val.summary }; }
        }
        if (!nearest || minDiff > 7) return [];
        const label = minDiff === 0 ? `Hari ini Libur! ${nearest.nama}` : (minDiff === 1 ? `Besok Libur! ${nearest.nama}` : `${nearest.nama} ${minDiff} hari lagi`);
        return [label];
    } catch (e) { return []; }
}

// ── FUNGSI BOLA DENGAN SISTEM ANTREAN ────────────────────────────────────────
async function getBola(lastSkor, lastJadwal) {
    const wibNow = new Date(Date.now() + WIB_OFFSET_MS);
    const hariIniWIB = new Date(Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate()));
    const kemarinWIB = new Date(hariIniWIB.getTime() - 86400000);

    let rawSkor = [];
    let rawJadwal = [];

    await Promise.all(LIGA_LIST.map(async (liga) => {
        try {
            const res = await fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/eventspastleague.php?id=${liga.id}`, 4000);
            const json = await res.json();
            for (const ev of (json?.events || [])) {
                if (!ev.dateEvent || ev.intHomeScore == null) continue;
                if (new Date(`${ev.dateEvent}T00:00:00Z`).getTime() < kemarinWIB.getTime()) continue;
                rawSkor.push({
                    id: ev.idEvent, // ID unik
                    liga: liga.nama,
                    waktu: new Date(`${ev.dateEvent}T${ev.strTime || '00:00:00'}Z`).getTime(),
                    text: `[Skor ${liga.nama}] ${ev.strHomeTeam} ${ev.intHomeScore}-${ev.intAwayScore} ${ev.strAwayTeam} (${['1H','2H','HT','ET','P'].includes(ev.strStatus) ? 'LIVE' : 'FT'})`
                });
            }
        } catch (e) {}

        try {
            const res = await fetchWithTimeout(`https://www.thesportsdb.com/api/v1/json/${SPORTSDB_KEY}/eventsnextleague.php?id=${liga.id}`, 4000);
            const json = await res.json();
            for (const ev of (json?.events || [])) {
                if (!ev.dateEvent) continue;
                const wibDate = new Date(new Date(`${ev.dateEvent}T${ev.strTime || '00:00:00'}Z`).getTime() + WIB_OFFSET_MS);
                const target = new Date(wibDate.toISOString().substring(0, 10));
                const hariLagi = Math.ceil((target - hariIniWIB) / 86400000);
                if (hariLagi > 1) continue; // Cuma hari ini & besok

                rawJadwal.push({
                    id: ev.idEvent, // ID unik
                    liga: liga.nama,
                    waktu: wibDate.getTime(),
                    text: `[Jadwal ${liga.nama}] ${ev.strHomeTeam} vs ${ev.strAwayTeam} (${hariLagi <= 0 ? "Nanti" : "Besok"} ${String(wibDate.getUTCHours()).padStart(2,'0')}:${String(wibDate.getUTCMinutes()).padStart(2,'0')} WIB)`
                });
            }
        } catch (e) {}
    }));

    // --- PROSES ANTREAN SKOR ---
    rawSkor.sort((a, b) => a.waktu - b.waktu); // Urutkan dari terlama
    let skorIndex = rawSkor.findIndex(x => x.id === lastSkor);
    // Kalau ID terakhir nggak ketemu (misal udah kehapus) atau belum ada, mulai dari 0
    let nextSkorIndex = (skorIndex === -1) ? 0 : skorIndex + 1;
    if (nextSkorIndex >= rawSkor.length) nextSkorIndex = 0; // Muter ke awal kalau mentok
    const selectedSkor = rawSkor[nextSkorIndex] || null;

    // --- PROSES ANTREAN JADWAL ---
    rawJadwal.sort((a, b) => a.waktu - b.waktu); // Urutkan dari terdekat
    let jadwalIndex = rawJadwal.findIndex(x => x.id === lastJadwal);
    let nextJadwalIndex = (jadwalIndex === -1) ? 0 : jadwalIndex + 1;
    if (nextJadwalIndex >= rawJadwal.length) nextJadwalIndex = 0;
    const selectedJadwal = rawJadwal[nextJadwalIndex] || null;

    return {
        items: [selectedSkor?.text, selectedJadwal?.text].filter(Boolean),
        nextSkor: selectedSkor ? selectedSkor.id : lastSkor,
        nextJadwal: selectedJadwal ? selectedJadwal.id : lastJadwal
    };
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    const q = req.query || {};

    // Ambil state terakhir dari PHP
    const lastSkor = q.last_skor || "";
    const lastJadwal = q.last_jadwal || "";

    const wantBerita = q.berita !== '0';
    const wantGempa = q.gempa !== '0';
    const wantBola = q.bola !== '0';
    const wantOlahraga = q.olahraga !== '0';
    const wantLibur = q.libur !== '0';
    const wantLantas = wantBerita && q.lantas !== '0';

    const [liburItems, gempaItems, olahragaItems, beritaItemsMentah, lantasItems] = await Promise.all([
        wantLibur ? getLibur() : [],
        wantGempa ? getGempa() : [],
        wantOlahraga ? fetchOneRSS(RSS_OLAHRAGA, 2, 'Olahraga', 24) : [],
        wantBerita ? getBerita(3) : [],
        wantLantas ? getLantas(2) : [],
    ]);

    // Ambil Bola (pakai state)
    const bolaResult = wantBola ? await getBola(lastSkor, lastJadwal) : { items: [], nextSkor: "", nextJadwal: "" };
    
    // Gabungkan Berita & Lantas (Interleave 2:1)
    const poolBerita = [];
    let bi = 0, li = 0;
    while (bi < beritaItemsMentah.length || li < lantasItems.length) {
        if (bi < beritaItemsMentah.length) poolBerita.push(beritaItemsMentah[bi++]);
        if (bi < beritaItemsMentah.length) poolBerita.push(beritaItemsMentah[bi++]);
        if (li < lantasItems.length) poolBerita.push(lantasItems[li++]);
    }

    let allItems = [...liburItems, ...gempaItems, ...poolBerita, ...olahragaItems, ...bolaResult.items];
    if (allItems.length > 12) allItems = allItems.slice(0, 12);
    if (allItems.length === 0) allItems.push('Tidak ada data');

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(JSON.stringify({
        status: "success",
        total: allItems.length,
        items: allItems,
        // ⬇️ PENTING: PHP harus nyimpen ini buat request selanjutnya
        next_state: {
            last_skor: bolaResult.nextSkor || "",
            last_jadwal: bolaResult.nextJadwal || ""
        }
    }, null, 2));
    }
