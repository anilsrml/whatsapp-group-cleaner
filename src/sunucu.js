// Tarayıcı arayüzü için yerel HTTP sunucusu.
// Sadece 127.0.0.1'den ve doğru anahtarla gelen API isteklerini kabul eder.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    etiketListesi,
    ISLEM_ACIKLAMALARI,
    ozet,
    planla,
    sureMetni,
    tahminiSure,
    tarihMetni,
    uygula,
} from './cekirdek.js';

const VARSAYILAN_DIZIN = fileURLToPath(new URL('../public/', import.meta.url));
const TURLER = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
};
const AZAMI_GOVDE = 100_000;

class IstekHatasi extends Error {
    constructor(kod, mesaj) {
        super(mesaj);
        this.kod = kod;
    }
}

function json(yanit, kod, veri) {
    yanit.writeHead(kod, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    yanit.end(JSON.stringify(veri));
}

async function govdeOku(istek) {
    let veri = '';
    for await (const parca of istek) {
        veri += parca;
        if (veri.length > AZAMI_GOVDE) throw new IstekHatasi(413, 'request too large');
    }
    if (!veri) return {};
    try {
        return JSON.parse(veri);
    } catch {
        throw new IstekHatasi(400, 'invalid JSON');
    }
}

export function sunucuOlustur({ oturum, anahtar, bekle, rastgele = Math.random, qrResmi, dizin = VARSAYILAN_DIZIN }) {
    const durum = { durum: 'baslatiliyor', qr: null, hata: null, ilerleme: null };
    let gruplar = [];
    let kilitli = false;
    // WhatsApp Web silinen grubu hafızasında tutmaya devam eder; bu oturumda silinenler hatırlanır.
    const silinenler = new Set();
    // id → Promise<Buffer|null>; aynı fotoğraf WhatsApp'tan bir kez istenir.
    const fotolar = new Map();
    const gruplariYenile = async () => {
        gruplar = (await oturum.gruplar()).filter((g) => !silinenler.has(g.id));
    };

    oturum.on('qr', async (metin) => {
        durum.qr = await qrResmi(metin);
        durum.durum = 'qr';
    });
    oturum.on('giris', () => {
        durum.durum = 'yukleniyor';
        durum.qr = null;
    });
    oturum.on('hazir', () => {
        durum.durum = 'hazir';
        durum.qr = null;
    });
    oturum.on('koptu', (sebep) => {
        durum.durum = 'koptu';
        durum.hata = `WhatsApp connection lost: ${sebep}`;
    });

    const listeyeHazir = () => durum.durum === 'hazir' || durum.durum === 'bitti';

    async function planHazirla({ idler, mod, topluluklarDahil }) {
        if (!listeyeHazir()) throw new IstekHatasi(409, 'WhatsApp is not ready yet');
        if (gruplar.length === 0) await gruplariYenile();
        if (mod !== 'cik-sil' && mod !== 'cik') throw new IstekHatasi(400, 'invalid mode');
        if (!Array.isArray(idler)) throw new IstekHatasi(400, 'idler must be a list');
        const secilen = new Set(idler);
        const secilenler = gruplar.filter((g) => secilen.has(g.id));
        const topluluklar = secilenler.filter((g) => g.topluluk && !g.cikilmis);
        const islenecekler = topluluklarDahil
            ? secilenler
            : secilenler.filter((g) => !topluluklar.includes(g));
        const plan = planla(islenecekler, mod);
        return { plan, topluluklar };
    }

    async function fotoGonder(yanit, id) {
        if (!listeyeHazir() && durum.durum !== 'isleniyor') throw new IstekHatasi(409, 'WhatsApp is not ready yet');
        if (!id) throw new IstekHatasi(400, 'missing id');
        if (!fotolar.has(id)) {
            fotolar.set(
                id,
                oturum
                    .foto(id)
                    .then((base64) => (base64 ? Buffer.from(base64, 'base64') : null))
                    .catch(() => null),
            );
        }
        const veri = await fotolar.get(id);
        if (!veri) throw new IstekHatasi(404, 'no photo');
        const png = veri[0] === 0x89 && veri[1] === 0x50;
        yanit.writeHead(200, {
            'content-type': png ? 'image/png' : 'image/jpeg',
            'cache-control': 'private, max-age=3600',
        });
        yanit.end(veri);
    }

    async function apiYanitla(istek, yanit, adres) {
        const yol = adres.pathname;
        if (istek.method === 'GET' && yol === '/api/durum') return json(yanit, 200, durum);
        if (istek.method === 'GET' && yol === '/api/foto') return fotoGonder(yanit, adres.searchParams.get('id'));

        if (istek.method === 'GET' && yol === '/api/gruplar') {
            if (!listeyeHazir()) throw new IstekHatasi(409, 'WhatsApp is not ready yet');
            await gruplariYenile();
            return json(
                yanit,
                200,
                gruplar.map((g) => ({
                    id: g.id,
                    ad: g.ad,
                    tarih: g.sonTarih ? tarihMetni(g.sonTarih) : null,
                    etiketler: etiketListesi(g),
                    cikilmis: g.cikilmis,
                    topluluk: g.topluluk,
                })),
            );
        }

        if (istek.method === 'POST' && yol === '/api/plan') {
            const { plan, topluluklar } = await planHazirla(await govdeOku(istek));
            return json(yanit, 200, {
                adimlar: plan.map(({ grup, islem }) => ({
                    id: grup.id,
                    ad: grup.ad,
                    islem,
                    aciklama: ISLEM_ACIKLAMALARI[islem],
                })),
                topluluklar: topluluklar.map((g) => g.ad),
                sure: sureMetni(tahminiSure(plan)),
            });
        }

        if (istek.method === 'POST' && yol === '/api/isle') {
            // Kilit, ilk await'ten önce alınır; aynı anda gelen iki istek ikisi birden geçemez.
            if (kilitli) throw new IstekHatasi(409, 'a job is already running');
            kilitli = true;
            let plan;
            try {
                ({ plan } = await planHazirla(await govdeOku(istek)));
            } catch (hata) {
                kilitli = false;
                throw hata;
            }
            durum.durum = 'isleniyor';
            durum.ilerleme = { toplam: plan.length, sonuclar: [], ozet: null };
            uygula(plan, {
                sohbetAl: (id) => oturum.sohbetAl(id),
                bekle,
                rastgele,
                ilerle: (sonuc) => {
                    durum.ilerleme.sonuclar.push(sonuc);
                    if (sonuc.durum === 'basarili' && sonuc.islem !== 'cik') silinenler.add(sonuc.id);
                },
            })
                .then((sonuclar) => {
                    durum.ilerleme.ozet = ozet(sonuclar);
                })
                .catch((hata) => {
                    durum.hata = `Job stopped: ${hata.message}`;
                })
                .finally(() => {
                    kilitli = false;
                    durum.durum = 'bitti';
                });
            return json(yanit, 202, { toplam: plan.length });
        }

        if (istek.method === 'POST' && yol === '/api/cikis') {
            await oturum.kapat();
            durum.durum = 'kapandi';
            return json(yanit, 200, { tamam: true });
        }

        throw new IstekHatasi(404, 'not found');
    }

    async function dosyaGonder(yanit, yol) {
        const goreli = normalize(yol === '/' ? '/index.html' : yol).replace(/^([/\\])+/, '');
        const tam = join(dizin, goreli);
        if (!tam.startsWith(dizin)) throw new IstekHatasi(404, 'not found');
        let icerik;
        try {
            icerik = await readFile(tam);
        } catch {
            throw new IstekHatasi(404, 'not found');
        }
        yanit.writeHead(200, {
            'content-type': TURLER[extname(tam)] ?? 'application/octet-stream',
            'cache-control': 'no-store',
        });
        yanit.end(icerik);
    }

    const sunucu = createServer(async (istek, yanit) => {
        try {
            const port = sunucu.address().port;
            // DNS yeniden bağlama saldırılarına karşı Host başlığı kontrol edilir.
            if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(istek.headers.host)) {
                throw new IstekHatasi(403, 'host not allowed');
            }
            const adres = new URL(istek.url, 'http://yerel');
            const yol = adres.pathname;
            if (yol.startsWith('/api/')) {
                if (istek.headers['x-anahtar'] !== anahtar) throw new IstekHatasi(403, 'invalid key');
                return await apiYanitla(istek, yanit, adres);
            }
            if (istek.method !== 'GET') throw new IstekHatasi(405, 'method not allowed');
            return await dosyaGonder(yanit, yol);
        } catch (hata) {
            const kod = hata instanceof IstekHatasi ? hata.kod : 500;
            if (!yanit.headersSent) json(yanit, kod, { hata: hata.message });
        }
    });
    return sunucu;
}
