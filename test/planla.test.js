import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planla, planMetni } from '../src/cekirdek.js';

const aktif = { id: '1@g.us', ad: 'Aile', cikilmis: false, topluluk: false };
const cikilmis = { id: '2@g.us', ad: 'Eski', cikilmis: true, topluluk: false };

test('"çık + sil" modunda aktif gruptan çıkılıp silinir', () => {
    assert.deepEqual(planla([aktif], 'cik-sil'), [{ grup: aktif, islem: 'cik-sil' }]);
});

test('"çık + sil" modunda çıkılmış grup sadece silinir', () => {
    assert.deepEqual(planla([cikilmis], 'cik-sil'), [{ grup: cikilmis, islem: 'sil' }]);
});

test('"sadece çık" modunda aktif gruptan sadece çıkılır', () => {
    assert.deepEqual(planla([aktif], 'cik'), [{ grup: aktif, islem: 'cik' }]);
});

test('"sadece çık" modunda çıkılmış gruba dokunulmaz', () => {
    assert.deepEqual(planla([cikilmis], 'cik'), [{ grup: cikilmis, islem: 'atla' }]);
});

test('bilinmeyen mod hata verir', () => {
    assert.throws(() => planla([aktif], 'yanlis'), /Unknown mode/);
});

test('plan metni her grubu yapılacak işlemle listeler', () => {
    const metin = planMetni(planla([aktif, cikilmis], 'cik'));
    assert.equal(
        metin,
        '  1. Aile → leave\n  2. Eski → already left, will be skipped',
    );
});
