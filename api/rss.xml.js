// api/rss_xml.js (Output JSON murni - Vercel Serverless Function)
// Endpoint: GET /api/rss_xml?berita=1&gempa=1&bola=1&olahraga=1&libur=1&lantas=1

// ── Sumber RSS Berita ─────────────────────────────────────────────────────────
const RSS_SOURCES = [
    { name: 'Antara', url: 'https://www.antaranews.com/rss/terkini.xml' },
    { name: 'CNN',    url: 'https://www.cnnindonesia.com/rss' },
    { name: 'Tirto',  url: 'https://tirto.id/sitemap/r/google-discover' },
];

// ── Sumber JSON & RSS Tambahan ────────────────────────────────────────────────
const BMKG_GEMPA   = 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json';
const RSS_OLAHRAGA = { name: 'Olahraga', url: 'https://www.cnnindonesia.com/olahraga/rss' };
const LIBUR_URL    = 'https://raw.githubusercontent.com/guangrei/APIHariLibur_V2/main/holidays.json';

// ── Sumber Google News (Lalu Lintas Jateng) ──────────────────────────────────
const GOOGLE_LANTAS_URL = 'https://news.google.com/rss/search?q=lalu+lintas+Jawa+Tengah+OR+Polda+Jateng+OR+macet+Semarang&hl=id&gl=ID&ceid=ID:id';

// TheSportsDB — 7 Liga Pilihan (ID Resmi)
const LIGA_LIST = [
    { nama: 'EPL',       id: 4328 },  // English Premier League
    { nama: 'La Liga',   id: 4335 },  // Spanish La Liga
    { nama: 'Serie A',   id: 4332 },  // Italian Serie A
    { nama: 'Bundesliga',id: 4331 },  // German Bundesliga
    { nama: 'UCL',       id: 4188 },  // UEFA Champions League (Pria)
    { nama: 'UEL',       id: 4481 },  // UEFA Europa League
    { nama: 'Liga 1',    id: 4790 },  // Liga 1 Indonesia
];

// ── Offset WIB (UTC+7) dalam milidetik ───────────────────────────────────────
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// ── Fetch dengan timeout yang terisolasi ──────────────────────────────────────
async function fetchWithTimeout(url, ms = 7000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const res = await fetch(url, { signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timer); // Selalu dibersihkan secara aman
    }
}

// ── Ambil berita dari satu RSS source ────────────────────────────────────────
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
            
            // Filter umur berita jika pubDate tersedia
            const pubDateMatch = pubDateRegex.exec(itemXml);
            if (pubDateMatch) {
                const pubDate = new Date(pubDateMatch[1].trim());
                if (!isNaN(pubDate.getTime())) {
                    const ageHours = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60);
                    if (ageHours > maxAgeHours) continue; // Skip item yang terlalu lama
                }
            }

            const titleMatch = titleRegex.exec(itemXml);
            if (titleMatch) {
                const title = (titleMatch[1] || titleMatch[2] || '').trim();
                if (title.length > 3) {
                    items.push(`[${label}] ${title}`);
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
        RSS_SOURCES.map(src => fetchOneRSS(src, quotaPerSource, 'Berita'))
    );
    const merged = [];
    const maxLen = Math.max(...results.map(r => r.length), 0);
    for (let i = 0; i < maxLen; i++) {
        for (const arr of results) {
            if (arr[i]) merged.push(arr[i]);
        }
    }
    return merged;
}

// ── Ambil berita Lantas dari Google News (Anti Duplikat Topik) ───────────────
async function getLantas(quota = 3) {
    try {
        const res = await fetchWithTimeout(GOOGLE_LANTAS_URL);
        const xml = await res.text();

        const itemRegex = /<item>[\s\S]*?<\/item>/g;
        const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/;

        const items = [];
        const seenKeywords = []; // Array buat simpan kata kunci berita yang udah masuk
        let match;

        while ((match = itemRegex.exec(xml)) !== null && items.length < quota) {
            const itemXml = match[0];
            const titleMatch = titleRegex.exec(itemXml);

            if (titleMatch) {
                let title = (titleMatch[1] || titleMatch[2] || '').trim();
                title = title.replace(/\s-\s[^-]+$/, '').trim(); // Hapus nama media
                
                // Ambil kata-kata penting (minimal 4 huruf)
                const words = title.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
                
                // Cek apakah ada 2 kata penting yang udah pernah muncul di berita sebelumnya
                let isDuplicate = false;
                for (const seen of seenKeywords) {
                    const commonWords = words.filter(w => seen.includes(w));
                    if (commonWords.length >= 2) { 
                        isDuplicate = true;
                        break;
                    }
                }

                if (title.length > 10 && !isDuplicate) {
                    seenKeywords.push(words);
                    items.push(`[Lantas] ${title}`);
                }
            }
        }
        return items;
    } catch (e) {
        console.error('getLantas error:', e.message);
        return [];
    }
}

// ── Ambil info gempa terkini dari BMKG ───────────────────────────────────────
async function getGempa() {
    try {
        const res = await fetchWithTimeout(BMKG_GEMPA);
        const json = await res.json();
        const g = json?.Infogempa?.gempa;
        if (!g) return [];

        const dirasakanField = (g.Dirasakan || '').trim();
        const potensiField   = (g.Potensi || '').trim();
        const adaLaporanDirasakan =
            (dirasakanField !== '' && dirasakanField !== '-') ||
            /dirasakan/i.test(potensiField);

        if (!adaLaporanDirasakan) return [];

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

        const wibNow = new Date(Date.now() + WIB_OFFSET_MS);
        const today = new Date(Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate()));

        let nearest = null;
        let minDiff = Infinity;

        for (const [tgl, val] of Object.entries(json)) {
            const d = new Date(tgl);
            const diff = Math.round((d - today) / (1000 * 60 * 60 * 24));
            if (diff >= 0 && diff < minDiff) {
                minDiff = diff;
                nearest = { nama: val.summary };
            }
        }

        if (!nearest || minDiff > 7) return [];
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

// ── Acak urutan array ──────────────────────────────────────────────────────────
function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ── Ambil Data Bola (Menggunakan Free Key 1 & Timeout 8 Detik) ───────────────
async function getBola() {
    const wibNow      = new Date(Date.now() + WIB_OFFSET_MS);
    const hariIniWIB  = new Date(Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate()));
    const kemarinWIB  = new Date(hariIniWIB.getTime() - 24 * 60 * 60 * 1000);

    let semuaSkor = [];
    let semuaJadwal = [];

    await Promise.all(LIGA_LIST.map(async (liga) => {
        // 1. Ambil Skor Terakhir (Key 1, Timeout 8000)
        try {
            const urlPast = `https://www.thesportsdb.com/api/v1/json/1/eventspastleague.php?id=${liga.id}`;
            const resPast = await fetchWithTimeout(urlPast, 8000);
            const jsonPast = await resPast.json();
            const eventsPast = jsonPast?.events || [];

            for (const ev of eventsPast) {
                if (!ev.dateEvent) continue;
                const homeScore = ev.intHomeScore !== null && ev.intHomeScore !== undefined ? parseInt(ev.intHomeScore) : null;
                const awayScore = ev.intAwayScore !== null && ev.intAwayScore !== undefined ? parseInt(ev.intAwayScore) : null;
                if (homeScore === null || awayScore === null) continue;

                const tglMatch = new Date(`${ev.dateEvent}T00:00:00Z`);
                if (tglMatch.getTime() < kemarinWIB.getTime()) continue;

                const status = ev.strStatus || '';
                let statusLabel = 'FT';
                if (['1H', '2H', 'HT', 'ET', 'P'].includes(status)) statusLabel = 'LIVE';

                semuaSkor.push({
                    liga: liga.nama,
                    waktuSort: `${ev.dateEvent}T${(ev.strTime || '00:00:00')}`,
                    home: ev.strHomeTeam || '?',
                    away: ev.strAwayTeam || '?',
                    status: statusLabel,
                    homeScore: homeScore,
                    awayScore: awayScore
                });
            }
        } catch (e) {
            console.error(`getBola skor ${liga.nama} error:`, e.message);
        }

        // 2. Ambil Jadwal Mendatang (Key 1, Timeout 8000)
        try {
            const urlNext = `https://www.thesportsdb.com/api/v1/json/1/eventsnextleague.php?id=${liga.id}`;
            const resNext = await fetchWithTimeout(urlNext, 8000);
            const jsonNext = await resNext.json();
            const eventsNext = jsonNext?.events || [];

            for (const ev of eventsNext) {
                if (!ev.dateEvent) continue;
                const time = ev.strTime || "00:00:00";
                const utcDate = new Date(`${ev.dateEvent}T${time}Z`);
                const wibDate = new Date(utcDate.getTime() + WIB_OFFSET_MS);

                semuaJadwal.push({
                    liga: liga.nama,
                    tanggal: wibDate.toISOString().substring(0, 10),
                    jam: String(wibDate.getUTCHours()).padStart(2, '0') + ":" + String(wibDate.getUTCMinutes()).padStart(2, '0'),
                    home: ev.strHomeTeam || '?',
                    away: ev.strAwayTeam || '?'
                });
            }
        } catch (e) {
            console.error(`getBola jadwal ${liga.nama} error:`, e.message);
        }
    }));

    const hasilItems = [];

    if (semuaSkor.length > 0) {
        semuaSkor.sort((a, b) => new Date(b.waktuSort) - new Date(a.waktuSort));
        const skorPerLiga = {};
        for (const m of semuaSkor) {
            if (!skorPerLiga[m.liga]) skorPerLiga[m.liga] = [];
            const textSkor = m.status === 'FT'
                ? `${m.home} ${m.homeScore}-${m.awayScore} ${m.away} (FT)`
                : `[LIVE] ${m.home} ${m.homeScore}-${m.awayScore} ${m.away}`;
            skorPerLiga[m.liga].push(textSkor);
        }
        const skorItems = [];
        for (const [namaLiga, listSkor] of Object.entries(skorPerLiga)) {
            skorItems.push(`[Skor ${namaLiga}] ${listSkor.slice(0, 2).join(' | ')}`);
        }
        hasilItems.push(...shuffleArray(skorItems).slice(0, 3));
    }

    if (semuaJadwal.length > 0) {
        semuaJadwal.sort((a, b) => new Date(a.tanggal) - new Date(b.tanggal));
        const jadwalPerLiga = {};
        for (const m of semuaJadwal) {
            const target = new Date(m.tanggal);
            const hariLagi = Math.ceil((target - hariIniWIB) / (1000 * 60 * 60 * 24));

            if (hariLagi > 1) continue;

            const labelHari = hariLagi <= 0 ? "Nanti" : "Besok";

            if (!jadwalPerLiga[m.liga]) jadwalPerLiga[m.liga] = [];
            jadwalPerLiga[m.liga].push(`${m.home} vs ${m.away} (${labelHari} ${m.jam} WIB)`);
        }
        const jadwalItems = [];
        for (const [namaLiga, listJadwal] of Object.entries(jadwalPerLiga)) {
            jadwalItems.push(`[Jadwal ${namaLiga}] ${listJadwal.slice(0, 2).join(' | ')}`);
        }
        hasilItems.push(...shuffleArray(jadwalItems).slice(0, 3));
    }

    return hasilItems;
}

// ── Fungsi Interleave: Selang-seling 2 Berita : 1 Lantas ─────────────────────
function interleaveBeritaLantas(beritaArr, lantasArr) {
    const hasil = [];
    let bi = 0, li = 0;
    
    while (bi < beritaArr.length || li < lantasArr.length) {
        for (let k = 0; k < 2 && bi < beritaArr.length; k++) {
            hasil.push(beritaArr[bi++]);
        }
        if (li < lantasArr.length) {
            hasil.push(lantasArr[li++]);
        }
    }
    return hasil;
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
    const wantLantas   = wantBerita && q.lantas !== '0';

    const TARGET_TOTAL            = 12;
    const BERITA_QUOTA_PER_SUMBER = 4;

    // Perbaikan 1: Umur berita olahraga dilonggarkan jadi 24 jam
    const [liburItems, gempaItems, olahragaItems, bolaItems, lantasItems] = await Promise.all([
        wantLibur    ? getLibur()                                  : [],
        wantGempa    ? getGempa()                                  : [],
        wantOlahraga ? fetchOneRSS(RSS_OLAHRAGA, 3, 'Olahraga', 24): [],
        wantBola     ? getBola()                                   : [],
        wantLantas   ? getLantas(4)                                : [],
    ]);

    const beritaItemsMentah = wantBerita ? await getBerita(BERITA_QUOTA_PER_SUMBER) : [];
    const poolBerita = interleaveBeritaLantas(beritaItemsMentah, lantasItems);

    // Perbaikan 2: Batasi maksimal berita jadi 5 slot aja
    const nonBeritaCount = liburItems.length + gempaItems.length + olahragaItems.length + bolaItems.length;
    const MAX_BERITA = 5; 
    const sisaUntukBerita = Math.min(
        Math.max(TARGET_TOTAL - nonBeritaCount, 0),
        MAX_BERITA // Berita umum maksimal 5 item
    );
    
    const beritaFinal = poolBerita.slice(0, sisaUntukBerita);

    let allItems = [
        ...liburItems,
        ...gempaItems,
        ...beritaFinal,
        ...olahragaItems,
        ...bolaItems,
    ];

    if (allItems.length > TARGET_TOTAL) {
        allItems = allItems.slice(0, TARGET_TOTAL);
    }

    if (allItems.length === 0) {
        allItems.push('Tidak ada data tersedia saat ini');
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(JSON.stringify({
        status: "success",
        total: allItems.length,
        items: allItems
    }, null, 2));
}
