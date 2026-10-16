import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grupBilgisi } from '../src/cekirdek.js';

// WhatsApp Web sayfasından okunan ham grup verisi (src/whatsapp.js üretir).
function ham(ozellikler = {}) {
    return {
        id: '123@g.us',
        ad: 'Aile',
        t: 1760000000,
        arsiv: false,
        uye: true,
        yonetici: false,
        topluluk: false,
        ...ozellikler,
    };
}

test('grubun temel bilgilerini çıkarır', () => {
    assert.deepEqual(grupBilgisi(ham()), {
        id: '123@g.us',
        ad: 'Aile',
        sonTarih: new Date(1760000000 * 1000),
        yonetici: false,
        topluluk: false,
        arsiv: false,
        cikilmis: false,
    });
});

test('yönetici, topluluk ve arşiv bilgisini taşır', () => {
    const grup = grupBilgisi(ham({ yonetici: true, topluluk: true, arsiv: true }));
    assert.equal(grup.yonetici, true);
    assert.equal(grup.topluluk, true);
    assert.equal(grup.arsiv, true);
});

test('üye olmadığım grup çıkılmış sayılır', () => {
    assert.equal(grupBilgisi(ham({ uye: false })).cikilmis, true);
});

test('üyelik bilinmiyorsa grup çıkılmış sayılmaz', () => {
    assert.equal(grupBilgisi(ham({ uye: null })).cikilmis, false);
});

test('adı boş grup için yer tutucu ad kullanır', () => {
    assert.equal(grupBilgisi(ham({ ad: '' })).ad, '(unnamed group)');
});

test('mesajı olmayan grubun son tarihi boştur', () => {
    assert.equal(grupBilgisi(ham({ t: 0 })).sonTarih, null);
});
