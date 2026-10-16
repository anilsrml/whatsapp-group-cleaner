import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etiketler, filtrele, satirMetni } from '../src/cekirdek.js';

function grup(ozellikler = {}) {
    return {
        id: '1@g.us',
        ad: 'Aile',
        sonTarih: new Date(2026, 9, 3),
        yonetici: false,
        topluluk: false,
        arsiv: false,
        cikilmis: false,
        ...ozellikler,
    };
}

test('etiketi olmayan grup için boş metin döner', () => {
    assert.equal(etiketler(grup()), '');
});

test('bütün etiketleri sırayla gösterir', () => {
    const g = grup({ yonetici: true, topluluk: true, arsiv: true, cikilmis: true });
    assert.equal(etiketler(g), '[ADMIN] [COMMUNITY] [ARCHIVED] [LEFT]');
});

test('satır metninde ad, etiket ve son mesaj tarihi vardır', () => {
    assert.equal(satirMetni(grup({ arsiv: true })), 'Aile [ARCHIVED] · 3 Oct 2026');
});

test('mesajı olmayan grup için tarih yerine tire gösterir', () => {
    assert.equal(satirMetni(grup({ sonTarih: null })), 'Aile · -');
});

test('boş filtre bütün grupları döner', () => {
    const liste = [grup({ ad: 'A' }), grup({ ad: 'B' })];
    assert.deepEqual(filtrele(liste, '  '), liste);
});

test('filtre büyük-küçük harfe ve Türkçe karakterlere duyarsızdır', () => {
    const liste = [grup({ ad: 'İŞ Arkadaşları' }), grup({ ad: 'Aile' })];
    assert.deepEqual(
        filtrele(liste, 'iş').map((g) => g.ad),
        ['İŞ Arkadaşları'],
    );
});

test('filtre İngilizce adlarda da çalışır (I harfi ı olmaz)', () => {
    const liste = [grup({ ad: 'IT Team' }), grup({ ad: 'Family' })];
    assert.deepEqual(
        filtrele(liste, 'it').map((g) => g.ad),
        ['IT Team'],
    );
});
