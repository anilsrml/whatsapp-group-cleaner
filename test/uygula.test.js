import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beklemeSuresi, uygula, ozet } from '../src/cekirdek.js';

test('bekleme süresi 4 ile 8 saniye arasındadır', () => {
    assert.equal(beklemeSuresi(0, () => 0), 4000);
    assert.equal(beklemeSuresi(0, () => 0.999), 7996);
});

test('her 20 işlemde bir 1 dakika mola eklenir', () => {
    assert.equal(beklemeSuresi(19, () => 0), 64000);
    assert.equal(beklemeSuresi(20, () => 0), 4000);
    assert.equal(beklemeSuresi(39, () => 0), 64000);
});

// WhatsApp istemcisi sistem sınırıdır; burada sahte bir sohbet nesnesiyle değiştirilir.
function sahteSohbet(kayit, ad, { hata } = {}) {
    return {
        leave: async () => {
            if (hata) throw new Error(hata);
            kayit.push(`${ad}:cik`);
        },
        delete: async () => {
            kayit.push(`${ad}:sil`);
            return true;
        },
    };
}

function ortam(sohbetler) {
    const beklemeler = [];
    return {
        beklemeler,
        secenekler: {
            sohbetAl: async (id) => sohbetler[id],
            bekle: async (ms) => beklemeler.push(ms),
            rastgele: () => 0,
            bildir: () => {},
        },
    };
}

const g = (id) => ({ id, ad: id });

test('her işlem türü doğru çağrıları yapar', async () => {
    const kayit = [];
    const { secenekler } = ortam({
        a: sahteSohbet(kayit, 'a'),
        b: sahteSohbet(kayit, 'b'),
        c: sahteSohbet(kayit, 'c'),
        d: sahteSohbet(kayit, 'd'),
    });
    const plan = [
        { grup: g('a'), islem: 'cik-sil' },
        { grup: g('b'), islem: 'cik' },
        { grup: g('c'), islem: 'sil' },
        { grup: g('d'), islem: 'atla' },
    ];
    const sonuclar = await uygula(plan, secenekler);
    assert.deepEqual(kayit, ['a:cik', 'a:sil', 'b:cik', 'c:sil']);
    assert.deepEqual(
        sonuclar.map((s) => s.durum),
        ['basarili', 'basarili', 'basarili', 'atlandi'],
    );
});

test('işlemler arasında bekler, son işlemden ve atlanandan sonra beklemez', async () => {
    const kayit = [];
    const { secenekler, beklemeler } = ortam({
        a: sahteSohbet(kayit, 'a'),
        b: sahteSohbet(kayit, 'b'),
        c: sahteSohbet(kayit, 'c'),
    });
    await uygula(
        [
            { grup: g('a'), islem: 'cik' },
            { grup: g('c'), islem: 'atla' },
            { grup: g('b'), islem: 'cik' },
        ],
        secenekler,
    );
    assert.deepEqual(beklemeler, [4000]);
});

test('başarısız grubu atlayıp devam eder', async () => {
    const kayit = [];
    const { secenekler } = ortam({
        a: sahteSohbet(kayit, 'a', { hata: 'ağ hatası' }),
        b: sahteSohbet(kayit, 'b'),
    });
    const sonuclar = await uygula(
        [
            { grup: g('a'), islem: 'cik-sil' },
            { grup: g('b'), islem: 'cik-sil' },
        ],
        secenekler,
    );
    assert.deepEqual(kayit, ['b:cik', 'b:sil']);
    assert.equal(sonuclar[0].durum, 'basarisiz');
    assert.equal(sonuclar[0].hata, 'ağ hatası');
    assert.equal(sonuclar[1].durum, 'basarili');
});

test('sohbet bulunamazsa başarısız sayılır', async () => {
    const { secenekler } = ortam({});
    const [sonuc] = await uygula([{ grup: g('yok'), islem: 'cik' }], secenekler);
    assert.equal(sonuc.durum, 'basarisiz');
    assert.match(sonuc.hata, /not found/);
});

test('özet başarılı, başarısız ve atlanan sayılarını gösterir', () => {
    const sonuclar = [
        { ad: 'A', durum: 'basarili' },
        { ad: 'B', durum: 'basarisiz', hata: 'x' },
        { ad: 'C', durum: 'basarisiz', hata: 'y' },
        { ad: 'D', durum: 'atlandi' },
    ];
    assert.equal(ozet(sonuclar), '1 succeeded, 2 failed (B, C), 1 skipped');
});

test('başarısız yoksa özet sadece başarılıları gösterir', () => {
    assert.equal(ozet([{ ad: 'A', durum: 'basarili' }]), '1 succeeded, 0 failed');
});

test('her sonuç ilerle() ile anında bildirilir', async () => {
    const kayit = [];
    const { secenekler } = ortam({ a: sahteSohbet(kayit, 'a') });
    const bildirilen = [];
    await uygula(
        [
            { grup: g('a'), islem: 'cik' },
            { grup: g('b'), islem: 'atla' },
        ],
        { ...secenekler, ilerle: (sonuc) => bildirilen.push(sonuc) },
    );
    assert.deepEqual(bildirilen, [
        { id: 'a', ad: 'a', islem: 'cik', durum: 'basarili' },
        { id: 'b', ad: 'b', islem: 'atla', durum: 'atlandi' },
    ]);
});
