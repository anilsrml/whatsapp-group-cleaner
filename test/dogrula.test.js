import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bekleKadar, zamanAsimiyla } from '../src/cekirdek.js';

// Zaman sistem sınırıdır; bekle() sahtesi sadece süreleri kaydeder.
function sahteBekle() {
    const sureler = [];
    return { sureler, bekle: async (ms) => sureler.push(ms) };
}

test('bekleKadar koşul sağlanınca durur', async () => {
    const { sureler, bekle } = sahteBekle();
    let kalan = 2;
    await bekleKadar({ kosul: async () => --kalan < 0, bekle, aralik: 500, sure: 15000 });
    assert.deepEqual(sureler, [500, 500]);
});

test('bekleKadar süre dolunca hata vermeden döner ve false bildirir', async () => {
    const { sureler, bekle } = sahteBekle();
    const sonuc = await bekleKadar({ kosul: async () => false, bekle, aralik: 500, sure: 2000 });
    assert.equal(sonuc, false);
    assert.equal(sureler.length, 4);
});

test('zamanAsimiyla işlem süresinde biterse sonucunu döner', async () => {
    assert.equal(await zamanAsimiyla(Promise.resolve('tamam'), 1000), 'tamam');
});

test('zamanAsimiyla süre dolarsa takılmadan undefined döner', async () => {
    const asla = new Promise(() => {});
    assert.equal(await zamanAsimiyla(asla, 20), undefined);
});

test('zamanAsimiyla işlem hata verirse hatayı yutar', async () => {
    assert.equal(await zamanAsimiyla(Promise.reject(new Error('x')), 1000), undefined);
});
