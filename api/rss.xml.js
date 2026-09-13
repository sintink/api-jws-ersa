// api/rss_xml.js (Sekarang output JSON murni)
// Vercel Serverless Function — RSS + JSON Aggregator untuk ESP32 Display
// Endpoint: GET /rss.xml?berita=1&gempa=1&bola=1&olahraga=1&libur=1 (atau /rss.json)

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
    { nama: 'UEL',       id: 4359 },  // UEFA Europa League
    { nama: 'Liga 1',    id: 4790 },  // Liga 1 Indonesia
];

// ── Offset WIB (UTC+7) dalam milidetik ───────────────────────────────────────
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

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

// ── Ambil berita dari satu RSS source ────────────────────────────────────────
async function fetchOneRSS(source, quota = 3, label = 'Berita', maxAgeHours = 3) {
    try {
        const res = await fetchWithTimeout(source.url);
        const xml = await res.text();

        const itemRegex = /<item>[\s\S]*?<\/item>/g;
        const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;

        const firstItemMatch = itemRegex.exec(xml);
        if (firstItemMatch) {
            const pubDateMatch = pubDateRegex.exec(firstItemMatch[0]);
            if (pubDateMatch) {
                const pubDate = new Date(pubDateMatch[1].trim());
                if (!isNaN(pubDate.getTime())) {
                    const ageHours = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60);
                    if (ageHours > maxAgeHours) {
                        return [];
                    }
                }
            }
        }
        itemRegex.lastIndex = 0;

        const items = [];
        const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/;
        let match;
        while ((match = itemRegex.exec(xml)) !== null && items.length < quota) {
            const itemXml = match[0];
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

// ── Ambil Data Bola ───────────────────────────────────────────────────────────
async function getBola() {
    const wibNow      = new Date(Date.now() + WIB_OFFSET_MS);
    const hariIniWIB  = new Date(Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate()));
    const kemarinWIB  = new Date(hariIniWIB.getTime() - 24 * 60 * 60 * 1000);

    let semuaSkor = [];
    let semuaJadwal = [];

    await Promise.all(LIGA_LIST.map(async (liga) => {
        try {
            const urlPast = `https://www.thesportsdb.com/api/v1/json/123/eventspastleague.php?id=${liga.id}`;
            const resPast = await fetchWithTimeout(urlPast, 6000);
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

        try {
            const urlNext = `https://www.thesportsdb.com/api/v1/json/123/eventsnextleague.php?id=${liga.id}`;
            const resNext = await fetchWithTimeout(urlNext, 6000);
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
            if (!jadwalPerLiga[m.liga]) jadwalPerLiga[m.liga] = [];

            const target = new Date(m.tanggal);
            const hariLagi = Math.ceil((target - hariIniWIB) / (1000 * 60 * 60 * 24));

            let labelHari;
            if (hariLagi <= 0) labelHari = "Nanti";
            else if (hariLagi === 1) labelHari = "Besok";
            else labelHari = `${hariLagi}hr lg`;

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

    const TARGET_TOTAL          = 12;
    const BERITA_QUOTA_PER_SUMBER = 8;

    const [liburItems, gempaItems, olahragaItems, bolaItems] = await Promise.all([
        wantLibur    ? getLibur()                              : [],
        wantGempa    ? getGempa()                              : [],
        wantOlahraga ? fetchOneRSS(RSS_OLAHRAGA, 3, 'Olahraga') : [],
        wantBola     ? getBola()                                : [],
    ]);

    const beritaItemsMentah = wantBerita ? await getBerita(BERITA_QUOTA_PER_SUMBER) : [];

    const nonBeritaCount = liburItems.length + gempaItems.length + olahragaItems.length + bolaItems.length;
    const sisaUntukBerita = Math.max(TARGET_TOTAL - nonBeritaCount, 0);
    const beritaItems = beritaItemsMentah.slice(0, sisaUntukBerita);

    let allItems = [
        ...liburItems,
        ...gempaItems,
        ...beritaItems,
        ...olahragaItems,
        ...bolaItems,
    ];

    if (allItems.length > TARGET_TOTAL) {
        allItems = allItems.slice(0, TARGET_TOTAL);
    }

    if (allItems.length === 0) {
        allItems.push('Tidak ada data tersedia saat ini');
    }

    // Perubahan Utama: Output dikirim sebagai JSON murni
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).json({
        status: "success",
        total: allItems.length,
        items: allItems
    });
            }
            
