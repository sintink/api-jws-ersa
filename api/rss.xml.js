// api/rss.xml.js
// Vercel Serverless Function — RSS Aggregator untuk ESP32 Masjid Display
// Endpoint: GET /rss.xml?berita=1&gempa=1&hadits=1
// Kompatibel dengan News.cpp parser (format <item><title>...</title></item>)

const ANTARA_RSS = 'https://www.antaranews.com/rss/terkini.xml';
const BMKG_GEMPA = 'https://data.bmkg.go.id/DataMKG/TEWS/autogempa.json';
const HADITH_API = 'https://api.hadith.gading.dev/books/muslim/1';

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

// ── Ambil berita dari Antara RSS ──────────────────────────────────────────────
async function getBerita(quota = 4) {
    try {
        const res = await fetchWithTimeout(ANTARA_RSS);
        const xml = await res.text();
        const items = [];
        // Parse <title> di dalam <item> secara manual (tidak ada DOM di serverless)
        const itemRegex = /<item>[\s\S]*?<\/item>/g;
        const titleRegex = /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>|<title>([\s\S]*?)<\/title>/;
        let match;
        while ((match = itemRegex.exec(xml)) !== null && items.length < quota) {
            const itemXml = match[0];
            const titleMatch = titleRegex.exec(itemXml);
            if (titleMatch) {
                const title = (titleMatch[1] || titleMatch[2] || '').trim();
                if (title.length > 3) {
                    items.push(title);
                }
            }
        }
        return items;
    } catch (e) {
        console.error('getBerita error:', e.message);
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

        // Format: "Gempa M5.2 | Kedalaman 10 km | Kab. Xxx, Jawa | Tidak berpotensi tsunami"
        const mag    = g.Magnitude  || '?';
        const dalam  = g.Kedalaman  || '?';
        const wilayah= g.Wilayah    || '?';
        const potensi= g.Potensi    || '';
        const tgl    = g.Tanggal    || '';
        const jam    = g.Jam        || '';

        const title = `Gempa M${mag} | Kedalaman ${dalam} | ${wilayah} | ${potensi} | ${tgl} ${jam}`;
        return [title.trim()];
    } catch (e) {
        console.error('getGempa error:', e.message);
        return [];
    }
}

// ── Ambil hadits acak dari API ────────────────────────────────────────────────
async function getHadits() {
    try {
        // Ambil hadits nomor acak 1-100 dari kitab Muslim
        const nomor = Math.floor(Math.random() * 100) + 1;
        const url   = `https://api.hadith.gading.dev/books/muslim/${nomor}`;
        const res   = await fetchWithTimeout(url);
        const json  = await res.json();

        const arab = json?.data?.contents?.arab || '';
        const id   = json?.data?.contents?.id   || '';

        if (id.length > 5) {
            // Potong agar tidak terlalu panjang di matrix LED (maks ~200 char)
            const trimmed = id.length > 180 ? id.substring(0, 177) + '...' : id;
            return [`Hadits: ${trimmed}`];
        }
        return [];
    } catch (e) {
        console.error('getHadits error:', e.message);
        return [];
    }
}

// ── Build RSS XML ─────────────────────────────────────────────────────────────
function buildRSS(items) {
    const now = new Date().toUTCString();
    let itemsXml = '';
    for (const title of items) {
        itemsXml += `  <item>\n    <title><![CDATA[${title}]]></title>\n  </item>\n`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>JWS Ersa Cloud Feed</title>
    <link>https://api-jws-ersa.vercel.app</link>
    <description>Aggregated feed untuk ESP32 Masjid Display</description>
    <lastBuildDate>${now}</lastBuildDate>
${itemsXml}  </channel>
</rss>`;
}

// ── Handler utama ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
    // CORS header agar bisa diakses dari mana saja
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate'); // cache 5 menit di Vercel edge

    const q = req.query || {};
    const wantBerita = q.berita !== '0';  // default aktif kecuali eksplisit =0
    const wantGempa  = q.gempa  === '1';
    const wantHadits = q.hadits !== '0';  // default aktif kecuali eksplisit =0

    // Jalankan semua fetch yang dibutuhkan secara paralel
    const promises = [];
    if (wantBerita) promises.push(getBerita(4));   else promises.push(Promise.resolve([]));
    if (wantGempa)  promises.push(getGempa());     else promises.push(Promise.resolve([]));
    if (wantHadits) promises.push(getHadits());    else promises.push(Promise.resolve([]));

    const [beritaItems, gempaItems, haditsItems] = await Promise.all(promises);

    // Gabungkan semua item
    const allItems = [...beritaItems, ...gempaItems, ...haditsItems];

    if (allItems.length === 0) {
        // Fallback: kembalikan 1 item placeholder agar ESP32 tidak kosong
        allItems.push('Tidak ada data tersedia saat ini');
    }

    const xml = buildRSS(allItems);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(200).send(xml);
          }
