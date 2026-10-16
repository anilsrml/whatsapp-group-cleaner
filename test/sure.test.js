import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tahminiSure, sureMetni } from '../src/cekirdek.js';

const adim = (islem) => ({ grup: { id: islem, ad: islem }, islem });

test('boş plan sıfır sürer', () => {
    assert.equal(tahminiSure([]), 0);
});

test('atlanan gruplar süreye eklenmez', () => {
    assert.equal(tahminiSure([adim('atla'), adim('atla')]), 0);
});

test('işlem süreleri ve aradaki ortalama 6 saniyelik bekleme toplanır', () => {
    // cik-sil 5 sn + bekleme 6 sn + sil 1 sn
    assert.equal(tahminiSure([adim('cik-sil'), adim('sil')]), 12000);
});

test('her 20 işlemde bir 1 dakikalık mola eklenir', () => {
    const plan = Array.from({ length: 21 }, () => adim('sil'));
    // 21 sil + 20 bekleme + 1 mola
    assert.equal(tahminiSure(plan), 21 * 1000 + 20 * 6000 + 60000);
});

test('süre metni dakikaya yuvarlanır', () => {
    assert.equal(sureMetni(0), 'under 1 minute');
    assert.equal(sureMetni(45000), 'under 1 minute');
    assert.equal(sureMetni(90000), 'about 2 minutes');
    assert.equal(sureMetni(15 * 60000), 'about 15 minutes');
});
