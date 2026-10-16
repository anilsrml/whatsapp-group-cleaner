import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listele } from '../src/cekirdek.js';

const ham = (id, ozellikler = {}) => ({ id, ad: id, t: 0, arsiv: false, uye: true, yonetici: false, topluluk: false, ...ozellikler });

test('adı olmayan kayıtlar listelenmez', () => {
    const liste = listele([ham('a'), ham('b', { ad: '' }), ham('c', { ad: '   ' })]);
    assert.deepEqual(liste.map((g) => g.id), ['a']);
});

test('silinmiş olarak bilinen gruplar listelenmez', () => {
    const liste = listele([ham('a'), ham('b')], new Set(['b']));
    assert.deepEqual(liste.map((g) => g.id), ['a']);
});

test('gruplar son mesaj tarihine göre yeniden eskiye sıralanır', () => {
    const liste = listele([ham('eski', { t: 100 }), ham('yeni', { t: 300 }), ham('orta', { t: 200 })]);
    assert.deepEqual(liste.map((g) => g.id), ['yeni', 'orta', 'eski']);
});
