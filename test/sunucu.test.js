import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { request } from 'node:http';
import { sunucuOlustur } from '../src/sunucu.js';

const ANAHTAR = 'test-anahtari';

function grup(id, ozellikler = {}) {
    return {
        id,
        ad: id,
        sonTarih: new Date(2026, 0, 2),
        yonetici: false,
        topluluk: false,
        arsiv: false,
        cikilmis: false,
        ...ozellikler,
    };
}

// WhatsApp oturumu sistem sınırıdır; sahte bir oturumla değiştirilir.
function sahteOturum(gruplar) {
    const oturum = new EventEmitter();
    oturum.cagrilar = [];
    oturum.kapatildi = false;
    oturum.gruplar = async () => gruplar;
    oturum.sohbetAl = async (id) => ({
        leave: async () => oturum.cagrilar.push(`${id}:cik`),
        delete: async () => oturum.cagrilar.push(`${id}:sil`),
    });
    oturum.kapat = async () => {
        oturum.kapatildi = true;
    };
    oturum.fotoIstekleri = [];
    oturum.foto = async (id) => {
        oturum.fotoIstekleri.push(id);
        return id === 'a' ? PNG : undefined;
    };
    return oturum;
}

// 1x1 şeffaf PNG (base64)
const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let sunucu;
let oturum;
let adres;

function durdur() {
    if (!sunucu) return;
    sunucu.closeAllConnections();
    sunucu.close();
    sunucu = null;
}

async function baslat(gruplar = [grup('a'), grup('b'), grup('t', { topluluk: true })]) {
    durdur();
    oturum = sahteOturum(gruplar);
    sunucu = sunucuOlustur({
        oturum,
        anahtar: ANAHTAR,
        bekle: async () => {},
        rastgele: () => 0,
        qrResmi: async (metin) => `data:qr,${metin}`,
    });
    await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
    adres = `http://127.0.0.1:${sunucu.address().port}`;
}

function api(yol, { method = 'GET', govde, anahtar = ANAHTAR } = {}) {
    const headers = { 'x-anahtar': anahtar };
    if (govde) headers['content-type'] = 'application/json';
    return fetch(adres + yol, { method, headers, body: govde && JSON.stringify(govde) });
}

async function hazirOl() {
    oturum.emit('hazir');
    // Durum değişikliği aynı tur içinde işlenir.
    await new Promise((r) => setImmediate(r));
}

async function bitmesiniBekle() {
    for (let i = 0; i < 50; i++) {
        const durum = await (await api('/api/durum')).json();
        if (durum.durum === 'bitti') return durum;
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('işlem bitmedi');
}

beforeEach(() => baslat());
afterEach(durdur);

test('anahtar olmadan API isteği reddedilir', async () => {
    const yanit = await api('/api/durum', { anahtar: 'yanlis' });
    assert.equal(yanit.status, 403);
});

test('başka bir alan adından gelen istek reddedilir', async () => {
    // fetch Host başlığını değiştirmeye izin vermez; bu yüzden node:http kullanılır.
    const kod = await new Promise((coz, reddet) => {
        const istek = request(
            {
                host: '127.0.0.1',
                port: sunucu.address().port,
                path: '/api/durum',
                headers: { host: 'kotu-site.com', 'x-anahtar': ANAHTAR },
            },
            (yanit) => {
                yanit.resume();
                coz(yanit.statusCode);
            },
        );
        istek.on('error', reddet);
        istek.end();
    });
    assert.equal(kod, 403);
});

test('ana sayfa anahtarsız açılır', async () => {
    const yanit = await fetch(adres + '/');
    assert.equal(yanit.status, 200);
    assert.match(yanit.headers.get('content-type'), /text\/html/);
});

test('başlangıçta durum "baslatiliyor" dur', async () => {
    const durum = await (await api('/api/durum')).json();
    assert.equal(durum.durum, 'baslatiliyor');
    assert.equal(durum.qr, null);
});

test('QR gelince durum "qr" olur ve resim döner', async () => {
    oturum.emit('qr', 'KOD');
    await new Promise((r) => setImmediate(r));
    const durum = await (await api('/api/durum')).json();
    assert.equal(durum.durum, 'qr');
    assert.equal(durum.qr, 'data:qr,KOD');
});

test('giriş ve hazır olayları durumu ilerletir', async () => {
    oturum.emit('giris');
    assert.equal((await (await api('/api/durum')).json()).durum, 'yukleniyor');
    await hazirOl();
    const durum = await (await api('/api/durum')).json();
    assert.equal(durum.durum, 'hazir');
    assert.equal(durum.qr, null);
});

test('hazır olmadan grup listesi istenemez', async () => {
    assert.equal((await api('/api/gruplar')).status, 409);
});

test('grup listesi etiketlerle döner', async () => {
    await baslat([grup('a', { yonetici: true, arsiv: true })]);
    await hazirOl();
    const gruplar = await (await api('/api/gruplar')).json();
    assert.equal(gruplar.length, 1);
    assert.equal(gruplar[0].id, 'a');
    assert.deepEqual(gruplar[0].etiketler, ['ADMIN', 'ARCHIVED']);
    assert.equal(gruplar[0].tarih, '2 Jan 2026');
});

test('plan aktif topluluk gruplarını ayrı listeler ve varsayılan olarak dışarıda bırakır', async () => {
    await hazirOl();
    const plan = await (
        await api('/api/plan', { method: 'POST', govde: { idler: ['a', 't'], mod: 'cik-sil' } })
    ).json();
    assert.deepEqual(plan.topluluklar, ['t']);
    assert.deepEqual(
        plan.adimlar.map((a) => [a.ad, a.islem]),
        [['a', 'cik-sil']],
    );
    assert.equal(plan.sure, 'under 1 minute');
});

test('topluluklar dahil edilirse plana girer', async () => {
    await hazirOl();
    const plan = await (
        await api('/api/plan', {
            method: 'POST',
            govde: { idler: ['a', 't'], mod: 'cik', topluluklarDahil: true },
        })
    ).json();
    assert.deepEqual(
        plan.adimlar.map((a) => a.ad),
        ['a', 't'],
    );
});

test('geçersiz mod reddedilir', async () => {
    await hazirOl();
    const yanit = await api('/api/plan', { method: 'POST', govde: { idler: ['a'], mod: 'yanlis' } });
    assert.equal(yanit.status, 400);
});

test('işlem yapılır, ilerleme ve özet durumda görünür', async () => {
    await hazirOl();
    const yanit = await api('/api/isle', { method: 'POST', govde: { idler: ['a', 'b'], mod: 'cik-sil' } });
    assert.equal(yanit.status, 202);
    const durum = await bitmesiniBekle();
    assert.deepEqual(oturum.cagrilar, ['a:cik', 'a:sil', 'b:cik', 'b:sil']);
    assert.equal(durum.ilerleme.toplam, 2);
    assert.equal(durum.ilerleme.sonuclar.length, 2);
    assert.equal(durum.ilerleme.ozet, '2 succeeded, 0 failed');
});

test('işlem sırasında ikinci işlem başlatılamaz', async () => {
    await hazirOl();
    let birak;
    oturum.sohbetAl = async () => ({
        leave: () => new Promise((r) => (birak = r)),
        delete: async () => {},
    });
    await api('/api/isle', { method: 'POST', govde: { idler: ['a'], mod: 'cik' } });
    const ikinci = await api('/api/isle', { method: 'POST', govde: { idler: ['b'], mod: 'cik' } });
    assert.equal(ikinci.status, 409);
    while (!birak) await new Promise((r) => setTimeout(r, 5));
    birak();
    await bitmesiniBekle();
});

test('işlem bitince grup listesi yeniden okunabilir', async () => {
    await hazirOl();
    await api('/api/isle', { method: 'POST', govde: { idler: ['a'], mod: 'cik' } });
    await bitmesiniBekle();
    assert.equal((await api('/api/gruplar')).status, 200);
});

test('silinen grup aynı oturumda listede bir daha görünmez', async () => {
    await hazirOl();
    await api('/api/isle', { method: 'POST', govde: { idler: ['a'], mod: 'cik-sil' } });
    await bitmesiniBekle();
    const gruplar = await (await api('/api/gruplar')).json();
    assert.deepEqual(gruplar.map((g) => g.id), ['b', 't']);
});

test('sadece çıkılan grup listede kalır', async () => {
    await hazirOl();
    await api('/api/isle', { method: 'POST', govde: { idler: ['a'], mod: 'cik' } });
    await bitmesiniBekle();
    const gruplar = await (await api('/api/gruplar')).json();
    assert.ok(gruplar.some((g) => g.id === 'a'));
});

test('grup fotoğrafı resim olarak döner', async () => {
    await hazirOl();
    const yanit = await api('/api/foto?id=a');
    assert.equal(yanit.status, 200);
    assert.equal(yanit.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await yanit.arrayBuffer()), Buffer.from(PNG, 'base64'));
});

test('fotoğrafı olmayan grup için 404 döner', async () => {
    await hazirOl();
    assert.equal((await api('/api/foto?id=b')).status, 404);
});

test('fotoğraflar önbelleğe alınır', async () => {
    await hazirOl();
    await api('/api/foto?id=a');
    await api('/api/foto?id=a');
    await api('/api/foto?id=b');
    await api('/api/foto?id=b');
    assert.deepEqual(oturum.fotoIstekleri, ['a', 'b']);
});

test('fotoğraf da anahtar ister', async () => {
    await hazirOl();
    assert.equal((await api('/api/foto?id=a', { anahtar: 'yanlis' })).status, 403);
});

test('çıkış oturumu kapatır', async () => {
    const yanit = await api('/api/cikis', { method: 'POST' });
    assert.equal(yanit.status, 200);
    assert.equal(oturum.kapatildi, true);
    assert.equal((await (await api('/api/durum')).json()).durum, 'kapandi');
});

test('bağlantı koparsa durum hata mesajıyla "koptu" olur', async () => {
    oturum.emit('koptu', 'LOGOUT');
    const durum = await (await api('/api/durum')).json();
    assert.equal(durum.durum, 'koptu');
    assert.match(durum.hata, /LOGOUT/);
});
