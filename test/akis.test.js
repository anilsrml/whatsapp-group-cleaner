import { test } from 'node:test';
import assert from 'node:assert/strict';
import { akis } from '../src/akis.js';

function grup(id, ozellikler = {}) {
    return {
        id,
        ad: id,
        sonTarih: null,
        yonetici: false,
        topluluk: false,
        arsiv: false,
        cikilmis: false,
        ...ozellikler,
    };
}

// Kullanıcı girdisi ve WhatsApp istemcisi sistem sınırlarıdır; sahteleriyle değiştirilir.
function kur({ gruplar, filtre = '', secilen = [], mod = 'cik-sil', topluluk = true, onay = 'yes', deneme = false }) {
    const cagrilar = [];
    const ciktilar = [];
    const sorulanlar = { secenekler: null, topluluk: null };
    const sohbetAl = async (id) => ({
        leave: async () => cagrilar.push(`${id}:cik`),
        delete: async () => cagrilar.push(`${id}:sil`),
    });
    const sor = {
        filtre: async () => filtre,
        sec: async (secenekler) => {
            sorulanlar.secenekler = secenekler;
            return secilen;
        },
        mod: async () => mod,
        topluluk: async (mesaj) => {
            sorulanlar.topluluk = mesaj;
            return topluluk;
        },
        onay: async () => onay,
    };
    const calistir = () =>
        akis({
            gruplariGetir: async () => gruplar,
            sohbetAl,
            sor,
            yaz: (m) => ciktilar.push(m),
            deneme,
            bekle: async () => {},
            rastgele: () => 0,
        });
    return { calistir, cagrilar, ciktilar, sorulanlar };
}

test('seçilen gruplardan çıkıp siler ve özet yazar', async () => {
    const t = kur({ gruplar: [grup('a'), grup('b')], secilen: ['a'] });
    await t.calistir();
    assert.deepEqual(t.cagrilar, ['a:cik', 'a:sil']);
    assert.equal(t.ciktilar.at(-1), '1 succeeded, 0 failed');
});

test('seçim listesi filtreye uyan grupları etiket ve tarihle gösterir', async () => {
    const t = kur({
        gruplar: [grup('İş', { yonetici: true }), grup('Aile')],
        filtre: 'iş',
    });
    await t.calistir();
    assert.deepEqual(t.sorulanlar.secenekler, [{ value: 'İş', name: 'İş [ADMIN] · -' }]);
});

test('deneme modunda planı gösterir ama hiçbir işlem yapmaz', async () => {
    const t = kur({ gruplar: [grup('a')], secilen: ['a'], deneme: true });
    await t.calistir();
    assert.deepEqual(t.cagrilar, []);
    assert.ok(t.ciktilar.some((m) => m.includes('a → leave and delete')));
    assert.match(t.ciktilar.at(-1), /Dry run/);
});

test('onaya "evet" dışında bir cevap verilirse iptal eder', async () => {
    const t = kur({ gruplar: [grup('a')], secilen: ['a'], onay: 'ok' });
    await t.calistir();
    assert.deepEqual(t.cagrilar, []);
    assert.match(t.ciktilar.at(-1), /Cancelled/);
});

test('onay büyük harf ve boşluklara duyarsızdır', async () => {
    const t = kur({ gruplar: [grup('a')], secilen: ['a'], onay: '  YES ' });
    await t.calistir();
    assert.deepEqual(t.cagrilar, ['a:cik', 'a:sil']);
});

test('topluluk grubu seçilince uyarır, reddedilirse onu çıkarır', async () => {
    const t = kur({
        gruplar: [grup('a'), grup('t', { topluluk: true })],
        secilen: ['a', 't'],
        topluluk: false,
    });
    await t.calistir();
    assert.match(t.sorulanlar.topluluk, /entire community/);
    assert.deepEqual(t.cagrilar, ['a:cik', 'a:sil']);
});

test('topluluk uyarısı onaylanırsa topluluk grubundan da çıkar', async () => {
    const t = kur({ gruplar: [grup('t', { topluluk: true })], secilen: ['t'] });
    await t.calistir();
    assert.deepEqual(t.cagrilar, ['t:cik', 't:sil']);
});

test('çıkılmış topluluk grubu için uyarı gösterilmez', async () => {
    const t = kur({
        gruplar: [grup('t', { topluluk: true, cikilmis: true })],
        secilen: ['t'],
    });
    await t.calistir();
    assert.equal(t.sorulanlar.topluluk, null);
    assert.deepEqual(t.cagrilar, ['t:sil']);
});

test('hiç grup seçilmezse işlem yapmadan biter', async () => {
    const t = kur({ gruplar: [grup('a')], secilen: [] });
    await t.calistir();
    assert.deepEqual(t.cagrilar, []);
    assert.match(t.ciktilar.at(-1), /No groups selected/);
});

test('filtreye uyan grup yoksa bunu söyler', async () => {
    const t = kur({ gruplar: [grup('a')], filtre: 'zzz' });
    await t.calistir();
    assert.equal(t.sorulanlar.secenekler, null);
    assert.match(t.ciktilar.at(-1), /No groups match/);
});

test('hiç grup yoksa bunu söyler', async () => {
    const t = kur({ gruplar: [] });
    await t.calistir();
    assert.match(t.ciktilar.at(-1), /No groups found/);
});
