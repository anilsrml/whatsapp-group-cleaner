// Arayüz: sunucunun durumunu her saniye sorar ve uygun ekranı gösterir.
// Grup adları sadece textContent ile yazılır; adlardaki HTML sayfada çalıştırılamaz.

const anahtar = location.hash.slice(1);
const $ = (id) => document.getElementById(id);

const ekranlar = ['baglan', 'yukleniyor', 'liste', 'ilerleme', 'son'];
const durumEkrani = {
    baslatiliyor: 'baglan',
    qr: 'baglan',
    yukleniyor: 'yukleniyor',
    hazir: 'liste',
    isleniyor: 'ilerleme',
    bitti: 'ilerleme',
    koptu: 'son',
    kapandi: 'son',
};
const ETIKET_ADLARI = {
    ADMIN: ['Admin', 'etiket-yonetici'],
    COMMUNITY: ['Community', 'etiket-topluluk'],
    ARCHIVED: ['Archived', 'etiket-arsiv'],
    LEFT: ['Left', 'etiket-cikilmis'],
};
const AVATAR_RENKLERI = ['#00a884', '#027eb5', '#7f66ff', '#e26ab6', '#fa6533', '#53bdeb', '#ffbc38', '#25d366'];

let gruplar = [];
const secili = new Set();
let filtre = '';
let sonDurum = null;
let gosterilenEkran = null;
let listeOkunuyor = false;
let durduruldu = false;
// Kullanıcı iş bitince "Listeye dön" dediyse "bitti" durumunda liste ekranında kalınır.
let listeyeDonuldu = false;

async function api(yol, govde) {
    const yanit = await fetch(yol, {
        method: govde ? 'POST' : 'GET',
        headers: { 'x-anahtar': anahtar, ...(govde && { 'content-type': 'application/json' }) },
        body: govde && JSON.stringify(govde),
    });
    const veri = await yanit.json().catch(() => ({}));
    if (!yanit.ok) throw new Error(veri.hata ?? `request failed (${yanit.status})`);
    return veri;
}

function ekranGoster(ad) {
    if (gosterilenEkran === ad) return;
    gosterilenEkran = ad;
    for (const e of ekranlar) $(`ekran-${e}`).hidden = e !== ad;
}

function sonEkrani(baslik, metin) {
    $('son-baslik').textContent = baslik;
    $('son-metin').textContent = metin;
    ekranGoster('son');
}

// ---------- Liste ----------

// src/cekirdek.js aramaMetni() ile aynı kural.
const kucukHarf = (metin) => metin.toLocaleLowerCase('tr').replace(/ı/g, 'i');
const grupSayisi = (n) => `${n} ${n === 1 ? 'group' : 'groups'}`;

function gorunenGruplar() {
    const aranan = kucukHarf($('ara').value.trim());
    return gruplar.filter(
        (g) => (!aranan || kucukHarf(g.ad).includes(aranan)) && (!filtre || g.etiketler.includes(filtre)),
    );
}

function basHarfler(ad) {
    const harfler = [...ad.replace(/[^\p{L}\p{N}\s]/gu, '').trim()]
        .filter((_, i, dizi) => i === 0 || dizi[i - 1] === ' ')
        .slice(0, 2)
        .join('');
    return harfler.toLocaleUpperCase() || '#';
}

function avatarRengi(ad) {
    let toplam = 0;
    for (const harf of ad) toplam = (toplam * 31 + harf.codePointAt(0)) >>> 0;
    return AVATAR_RENKLERI[toplam % AVATAR_RENKLERI.length];
}

function el(etiket, sinif, metin) {
    const e = document.createElement(etiket);
    if (sinif) e.className = sinif;
    if (metin !== undefined) e.textContent = metin;
    return e;
}

// ---------- Fotoğraflar ----------
// Sadece ekranda görünen satırların fotoğrafı, aynı anda en fazla 3 tane olacak şekilde yüklenir.
const fotoAdresleri = new Map(); // id → nesne adresi ya da null (fotoğraf yok)
const fotoKuyrugu = [];
let fotoYukleniyor = 0;
const AYNI_ANDA_FOTO = 3;

function fotoyuGoster(avatar, adres) {
    const resim = el('img', 'avatar-foto');
    resim.alt = '';
    resim.src = adres;
    avatar.replaceChildren(resim);
}

async function fotoKuyrugunuIsle() {
    while (fotoYukleniyor < AYNI_ANDA_FOTO && fotoKuyrugu.length) {
        const { id, avatar } = fotoKuyrugu.shift();
        if (fotoAdresleri.has(id)) {
            if (fotoAdresleri.get(id)) fotoyuGoster(avatar, fotoAdresleri.get(id));
            continue;
        }
        fotoYukleniyor++;
        fetch(`/api/foto?id=${encodeURIComponent(id)}`, { headers: { 'x-anahtar': anahtar } })
            .then((yanit) => (yanit.ok ? yanit.blob() : null))
            .catch(() => null)
            .then((blob) => {
                const adres = blob ? URL.createObjectURL(blob) : null;
                fotoAdresleri.set(id, adres);
                if (adres && avatar.isConnected) fotoyuGoster(avatar, adres);
            })
            .finally(() => {
                fotoYukleniyor--;
                fotoKuyrugunuIsle();
            });
    }
}

const fotoGozcusu = new IntersectionObserver((girdiler) => {
    for (const girdi of girdiler) {
        if (!girdi.isIntersecting) continue;
        fotoGozcusu.unobserve(girdi.target);
        const id = girdi.target.closest('.grup').dataset.id;
        if (fotoAdresleri.get(id)) fotoyuGoster(girdi.target, fotoAdresleri.get(id));
        else if (!fotoAdresleri.has(id)) fotoKuyrugu.push({ id, avatar: girdi.target });
    }
    fotoKuyrugunuIsle();
});

function grupSatiri(g) {
    const satir = el('li', 'grup');
    satir.setAttribute('role', 'checkbox');
    satir.setAttribute('aria-checked', String(secili.has(g.id)));
    satir.tabIndex = 0;
    satir.dataset.id = g.id;

    const isaret = el('span', 'isaret');
    isaret.setAttribute('aria-hidden', 'true');
    const avatar = el('span', 'avatar', basHarfler(g.ad));
    avatar.style.background = avatarRengi(g.ad);
    avatar.setAttribute('aria-hidden', 'true');

    const govde = el('div', 'grup-govde');
    const ust = el('div', 'grup-satir');
    ust.append(el('span', 'grup-ad', g.ad), el('span', 'grup-tarih', g.tarih ?? ''));
    const etiketler = el('div', 'etiketler');
    for (const e of g.etiketler) {
        const [ad, sinif] = ETIKET_ADLARI[e];
        etiketler.append(el('span', `etiket ${sinif}`, ad));
    }
    govde.append(ust, etiketler);
    satir.append(isaret, avatar, govde);
    if (fotoAdresleri.get(g.id)) fotoyuGoster(avatar, fotoAdresleri.get(g.id));
    else if (!fotoAdresleri.has(g.id)) fotoGozcusu.observe(avatar);
    return satir;
}

function listeyiCiz() {
    const gorunen = gorunenGruplar();
    $('gruplar').replaceChildren(...gorunen.map(grupSatiri));
    $('bos').hidden = gorunen.length > 0;
    $('grup-sayisi').textContent = grupSayisi(gruplar.length);
    secimCubugunuGuncelle();
}

function secimCubugunuGuncelle() {
    $('secim-cubugu').hidden = secili.size === 0;
    $('secim-sayisi').textContent = `${grupSayisi(secili.size)} selected`;
}

function secimiDegistir(satir) {
    const id = satir.dataset.id;
    if (secili.has(id)) secili.delete(id);
    else secili.add(id);
    satir.setAttribute('aria-checked', String(secili.has(id)));
    secimCubugunuGuncelle();
}

async function listeyiOku() {
    if (listeOkunuyor) return;
    listeOkunuyor = true;
    try {
        gruplar = await api('/api/gruplar');
        const varOlan = new Set(gruplar.map((g) => g.id));
        for (const id of secili) if (!varOlan.has(id)) secili.delete(id);
        listeyiCiz();
    } catch (hata) {
        sonEkrani('Could not read groups', hata.message);
    } finally {
        listeOkunuyor = false;
    }
}

$('gruplar').addEventListener('click', (olay) => {
    const satir = olay.target.closest('.grup');
    if (satir) secimiDegistir(satir);
});

$('gruplar').addEventListener('keydown', (olay) => {
    const satir = olay.target.closest('.grup');
    if (!satir) return;
    if (olay.key === ' ' || olay.key === 'Enter') {
        olay.preventDefault();
        secimiDegistir(satir);
    } else if (olay.key === 'ArrowDown' || olay.key === 'ArrowUp') {
        olay.preventDefault();
        (olay.key === 'ArrowDown' ? satir.nextElementSibling : satir.previousElementSibling)?.focus();
    }
});

$('ara').addEventListener('input', listeyiCiz);

for (const cip of document.querySelectorAll('.cip')) {
    cip.addEventListener('click', () => {
        filtre = cip.dataset.filtre;
        for (const c of document.querySelectorAll('.cip')) c.setAttribute('aria-pressed', String(c === cip));
        listeyiCiz();
    });
}

$('hepsini-sec').addEventListener('click', () => {
    for (const g of gorunenGruplar()) secili.add(g.id);
    listeyiCiz();
});

$('secimi-temizle').addEventListener('click', () => {
    secili.clear();
    listeyiCiz();
});

// ---------- Onay penceresi ----------

const onay = $('onay');
let planIstegi = 0;

function secenekler() {
    return {
        idler: [...secili],
        mod: onay.querySelector('input[name="mod"]:checked').value,
        topluluklarDahil: $('topluluk-dahil').checked,
    };
}

async function planiYenile() {
    const istek = ++planIstegi;
    $('onayla').disabled = true;
    try {
        const plan = await api('/api/plan', secenekler());
        if (istek !== planIstegi) return;
        $('topluluk-uyari').hidden = plan.topluluklar.length === 0;
        $('topluluk-metin').textContent =
            `These groups belong to a community: ${plan.topluluklar.join(', ')}. ` +
            'Leaving them also removes you from the entire community and all its groups.';
        $('plan').replaceChildren(...plan.adimlar.map((a) => el('li', '', `${a.ad} → ${a.aciklama}`)));
        $('plan-sayi').textContent = grupSayisi(plan.adimlar.length);
        $('plan-sure').textContent = `Estimated time: ${plan.sure}`;
        $('onayla').textContent = `Yes, process ${grupSayisi(plan.adimlar.length)}`;
        $('onayla').disabled = plan.adimlar.length === 0;
    } catch (hata) {
        $('plan').replaceChildren(el('li', '', `Could not prepare the plan: ${hata.message}`));
    }
}

$('devam').addEventListener('click', () => {
    $('topluluk-dahil').checked = false;
    onay.querySelector('input[value="cik-sil"]').checked = true;
    $('onayla').textContent = 'Preparing...';
    onay.showModal();
    planiYenile();
});

onay.addEventListener('change', planiYenile);

$('onayla').addEventListener('click', async () => {
    $('onayla').disabled = true;
    try {
        await api('/api/isle', secenekler());
        listeyeDonuldu = false;
        onay.close();
        secili.clear();
        $('sonuclar').replaceChildren();
        $('ozet-kutu').hidden = true;
        await durumuSor();
    } catch (hata) {
        $('plan').replaceChildren(el('li', '', `Could not start: ${hata.message}`));
        $('onayla').disabled = false;
    }
});

// ---------- İlerleme ----------

function ilerlemeyiCiz({ ilerleme, durum, hata }) {
    if (!ilerleme) return;
    const { toplam, sonuclar, ozet } = ilerleme;
    const liste = $('sonuclar');
    for (const s of sonuclar.slice(liste.children.length)) {
        const satir = el('li', `sonuc-${s.durum}`, s.ad);
        if (s.hata) satir.append(el('small', '', s.hata));
        liste.append(satir);
        satir.scrollIntoView({ block: 'nearest' });
    }
    const oran = toplam ? sonuclar.length / toplam : 1;
    $('cubuk-dolu').style.width = `${Math.round(oran * 100)}%`;
    $('cubuk').setAttribute('aria-valuemax', String(toplam));
    $('cubuk').setAttribute('aria-valuenow', String(sonuclar.length));
    $('ilerleme-sayi').textContent = `${sonuclar.length} / ${toplam}`;

    const bitti = durum === 'bitti';
    $('ilerleme-baslik').textContent = bitti ? 'Done' : 'Processing groups';
    $('ilerleme-not').hidden = bitti;
    $('ozet-kutu').hidden = !bitti;
    $('ozet').textContent = hata ?? ozet ?? '';
}

$('listeye-don').addEventListener('click', async () => {
    listeyeDonuldu = true;
    ekranGoster('liste');
    await listeyiOku();
});

// ---------- Oturum ----------

$('cikis').addEventListener('click', async () => {
    $('cikis').disabled = true;
    durduruldu = true;
    sonEkrani('Logging out', 'Waiting for changes to sync to your phone...');
    try {
        await api('/api/cikis', {});
        $('cikis').hidden = true;
        sonEkrani('Logged out', 'The linked device was removed. You can close this tab.');
    } catch (hata) {
        sonEkrani('Could not log out', hata.message);
    }
});

// ---------- Durum döngüsü ----------

async function durumuSor() {
    let durum;
    try {
        durum = await api('/api/durum');
    } catch (hata) {
        if (!durduruldu) sonEkrani('Cannot reach the app', 'Make sure it is still running in your terminal.');
        return;
    }
    if (durduruldu) return;

    const onceki = sonDurum;
    sonDurum = durum.durum;
    $('cikis').hidden = !['hazir', 'bitti', 'isleniyor', 'yukleniyor'].includes(durum.durum);

    if (durum.durum === 'qr' || durum.durum === 'baslatiliyor') {
        $('qr').hidden = !durum.qr;
        $('qr-bekle').hidden = Boolean(durum.qr);
        if (durum.qr && $('qr').src !== durum.qr) $('qr').src = durum.qr;
    }
    if (durum.durum === 'koptu') sonEkrani('Connection lost', durum.hata ?? '');
    if (durum.durum === 'kapandi') {
        sonEkrani('Logged out', 'You can close this tab.');
        durduruldu = true;
        return;
    }

    if (durum.durum === 'hazir' && onceki !== 'hazir') {
        ekranGoster('liste');
        await listeyiOku();
        return;
    }
    if (durum.durum === 'bitti' && listeyeDonuldu) return;
    if (durumEkrani[durum.durum] !== 'son') ekranGoster(durumEkrani[durum.durum]);
    if (durum.durum === 'isleniyor' || durum.durum === 'bitti') ilerlemeyiCiz(durum);
}

async function dongu() {
    await durumuSor();
    if (!durduruldu) setTimeout(dongu, 700);
}

if (!anahtar) {
    sonEkrani('Missing key', 'Open this page with the address shown in your terminal.');
} else {
    ekranGoster('baglan');
    dongu();
}
