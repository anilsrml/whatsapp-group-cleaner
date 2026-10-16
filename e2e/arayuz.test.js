// Uçtan uca test: gerçek Chrome sayfayı açar ve kullanıcı gibi tıklar.
// WhatsApp oturumu sistem sınırıdır; sahte bir oturumla değiştirilir.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { sunucuOlustur } from '../src/sunucu.js';

const ANAHTAR = 'e2e-anahtari';
const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const CHROME = process.env.CHROME_YOLU ?? '/usr/bin/google-chrome';

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

const GRUPLAR = [
    grup('Aile', { yonetici: true }),
    grup('Halı saha', { cikilmis: true }),
    grup('Kampüs Topluluğu', { topluluk: true }),
    grup('İş arkadaşları', { arsiv: true }),
];

function sahteOturum() {
    const oturum = new EventEmitter();
    oturum.cagrilar = [];
    oturum.kapatildi = false;
    oturum.gruplar = async () => GRUPLAR;
    oturum.sohbetAl = async (id) => ({
        leave: async () => oturum.cagrilar.push(`${id}:cik`),
        delete: async () => oturum.cagrilar.push(`${id}:sil`),
    });
    oturum.kapat = async () => {
        oturum.kapatildi = true;
    };
    oturum.foto = async (id) => (id === 'Aile' ? PNG : undefined);
    return oturum;
}

let tarayici;
let sayfa;
let sunucu;
let oturum;

before(async () => {
    assert.ok(existsSync(CHROME), `Chrome bulunamadı: ${CHROME}`);
    tarayici = await chromium.launch({ executablePath: CHROME, headless: true });
});

after(() => tarayici?.close());

beforeEach(async () => {
    oturum = sahteOturum();
    sunucu = sunucuOlustur({
        oturum,
        anahtar: ANAHTAR,
        bekle: async () => {},
        rastgele: () => 0,
        // 1x1 şeffaf PNG; gerçek QR resmi gerekmez.
        qrResmi: async () =>
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    });
    await new Promise((r) => sunucu.listen(0, '127.0.0.1', r));
    sayfa = await tarayici.newPage();
    sayfa.setDefaultTimeout(5000);
    await sayfa.goto(`http://127.0.0.1:${sunucu.address().port}/#${ANAHTAR}`);
});

afterEach(async () => {
    await sayfa.close();
    sunucu.closeAllConnections();
    await new Promise((r) => sunucu.close(r));
});

async function listeyeGel() {
    oturum.emit('qr', 'KOD');
    await sayfa.getByRole('img', { name: 'QR code' }).waitFor();
    oturum.emit('giris');
    await sayfa.getByText('Loading chats').waitFor();
    oturum.emit('hazir');
    await sayfa.getByRole('heading', { name: 'Groups' }).waitFor();
}

const satir = (ad) => sayfa.getByRole('checkbox', { name: new RegExp(`^${ad}`) });

test('QR kodu gösterir, giriş sonrası grupları etiketleriyle listeler', async () => {
    await listeyeGel();
    for (const g of GRUPLAR) await satir(g.ad).waitFor();
    const aile = await satir('Aile').textContent();
    assert.match(aile, /Admin/);
    assert.match(await satir('Halı saha').textContent(), /Left/);
    assert.match(await satir('Kampüs Topluluğu').textContent(), /Community/);
    assert.match(await satir('İş arkadaşları').textContent(), /Archived/);
});

test('fotoğrafı olan grupta fotoğraf, olmayanda baş harfler görünür', async () => {
    await listeyeGel();
    await satir('Aile').locator('img.avatar-foto').waitFor();
    assert.equal(await satir('Halı saha').locator('img.avatar-foto').count(), 0);
    assert.match(await satir('Halı saha').locator('.avatar').textContent(), /HS/);
});

test('arama ve etiket filtresi listeyi daraltır', async () => {
    await listeyeGel();
    await sayfa.getByRole('searchbox', { name: 'Search groups' }).fill('iş');
    await sayfa.waitForFunction(() => document.querySelectorAll('[role="checkbox"]').length === 1);
    await satir('İş arkadaşları').waitFor();

    await sayfa.getByRole('searchbox', { name: 'Search groups' }).fill('');
    await sayfa.getByRole('button', { name: 'Left', exact: true }).click();
    await sayfa.waitForFunction(() => document.querySelectorAll('[role="checkbox"]').length === 1);
    await satir('Halı saha').waitFor();
});

test('seçilen gruplardan çıkıp siler ve özeti gösterir', async () => {
    await listeyeGel();
    await satir('Aile').click();
    await satir('Halı saha').click();
    await sayfa.getByText('2 groups selected').waitFor();
    await sayfa.getByRole('button', { name: 'Continue' }).click();

    const pencere = sayfa.getByRole('dialog');
    await pencere.getByText('Aile → leave and delete').waitFor();
    await pencere.getByText('Halı saha → delete (already left)').waitFor();
    await pencere.getByText('under 1 minute').waitFor();
    await pencere.getByRole('button', { name: 'Yes, process 2 groups' }).click();

    await sayfa.getByText('2 succeeded, 0 failed').waitFor();
    assert.deepEqual(oturum.cagrilar, ['Aile:cik', 'Aile:sil', 'Halı saha:sil']);
});

test('"sadece çık" seçilince çıkılmış grup atlanır', async () => {
    await listeyeGel();
    await satir('Aile').click();
    await satir('Halı saha').click();
    await sayfa.getByRole('button', { name: 'Continue' }).click();
    const pencere = sayfa.getByRole('dialog');
    await pencere.getByRole('radio', { name: /Leave only/ }).check();
    await pencere.getByText('Halı saha → already left, will be skipped').waitFor();
    await pencere.getByRole('button', { name: 'Yes, process 2 groups' }).click();
    await sayfa.getByText('1 succeeded, 0 failed, 1 skipped').waitFor();
    assert.deepEqual(oturum.cagrilar, ['Aile:cik']);
});

test('topluluk grubu onay kutusu işaretlenmezse işlenmez', async () => {
    await listeyeGel();
    await satir('Aile').click();
    await satir('Kampüs Topluluğu').click();
    await sayfa.getByRole('button', { name: 'Continue' }).click();
    const pencere = sayfa.getByRole('dialog');
    await pencere.getByText(/entire community/).waitFor();
    await pencere.getByRole('button', { name: 'Yes, process 1 group' }).click();
    await sayfa.getByText('1 succeeded, 0 failed').waitFor();
    assert.deepEqual(oturum.cagrilar, ['Aile:cik', 'Aile:sil']);
});

test('topluluk onay kutusu işaretlenirse topluluk grubu da işlenir', async () => {
    await listeyeGel();
    await satir('Kampüs Topluluğu').click();
    await sayfa.getByRole('button', { name: 'Continue' }).click();
    const pencere = sayfa.getByRole('dialog');
    await pencere.getByRole('checkbox', { name: /Also process community groups/ }).check();
    await pencere.getByRole('button', { name: 'Yes, process 1 group' }).click();
    await sayfa.getByText('1 succeeded, 0 failed').waitFor();
    assert.deepEqual(oturum.cagrilar, ['Kampüs Topluluğu:cik', 'Kampüs Topluluğu:sil']);
});

test('vazgeç düğmesi hiçbir işlem yapmadan pencereyi kapatır', async () => {
    await listeyeGel();
    await satir('Aile').click();
    await sayfa.getByRole('button', { name: 'Continue' }).click();
    await sayfa.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await sayfa.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(oturum.cagrilar, []);
});

test('oturumu kapat düğmesi oturumu kapatır', async () => {
    await listeyeGel();
    await sayfa.getByRole('button', { name: 'Log out' }).click();
    await sayfa.getByText('Logged out').waitFor();
    assert.equal(oturum.kapatildi, true);
});

test('bağlantı koparsa hata ekranı gösterilir', async () => {
    oturum.emit('koptu', 'LOGOUT');
    await sayfa.getByText(/WhatsApp connection lost: LOGOUT/).waitFor();
});
