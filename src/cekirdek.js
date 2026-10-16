// WhatsApp bağlantısından bağımsız saf mantık.

// `ham`: src/whatsapp.js'in WhatsApp Web sayfasından okuduğu grup verisi.
export function grupBilgisi(ham) {
    return {
        id: ham.id,
        ad: ham.ad || '(unnamed group)',
        sonTarih: ham.t ? new Date(ham.t * 1000) : null,
        yonetici: Boolean(ham.yonetici),
        topluluk: Boolean(ham.topluluk),
        arsiv: Boolean(ham.arsiv),
        // Üyelik okunamadıysa (null) çıkılmış sayılmaz; yoksa "sadece çık" grubu atlardı.
        cikilmis: ham.uye === false,
    };
}

// Adı olmayan kayıtlar (WhatsApp Web hafızasındaki silinmiş ya da yüklenmemiş gruplar)
// ve bu oturumda silindiği bilinen gruplar listelenmez.
export function listele(hamlar, silinenler = new Set()) {
    return hamlar
        .filter((h) => h.ad?.trim() && !silinenler.has(h.id))
        .sort((a, b) => b.t - a.t)
        .map((h) => grupBilgisi(h));
}

// Örnek: "3 Oct 2026". Gün/ay sırası ülkeye göre karıştırılmasın diye ay adı yazılır.
export function tarihMetni(tarih) {
    return tarih.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ETIKETLER = [
    ['yonetici', 'ADMIN'],
    ['topluluk', 'COMMUNITY'],
    ['arsiv', 'ARCHIVED'],
    ['cikilmis', 'LEFT'],
];

export function etiketListesi(grup) {
    return ETIKETLER.filter(([alan]) => grup[alan]).map(([, etiket]) => etiket);
}

export function etiketler(grup) {
    return etiketListesi(grup)
        .map((etiket) => `[${etiket}]`)
        .join(' ');
}

export function satirMetni(grup) {
    const tarih = grup.sonTarih ? tarihMetni(grup.sonTarih) : '-';
    const etiket = etiketler(grup);
    return `${grup.ad}${etiket ? ` ${etiket}` : ''} · ${tarih}`;
}

// Türkçe kuralıyla küçültülür (İ → i), sonra ı → i yapılır; böylece "IT" de "it" ile bulunur.
export function aramaMetni(metin) {
    return metin.toLocaleLowerCase('tr').replace(/ı/g, 'i');
}

export function filtrele(gruplar, metin) {
    const aranan = aramaMetni(metin.trim());
    if (!aranan) return gruplar;
    return gruplar.filter((g) => aramaMetni(g.ad).includes(aranan));
}

export function planla(secilenler, mod) {
    if (mod !== 'cik-sil' && mod !== 'cik') throw new Error(`Unknown mode: ${mod}`);
    return secilenler.map((grup) => {
        if (!grup.cikilmis) return { grup, islem: mod };
        return { grup, islem: mod === 'cik-sil' ? 'sil' : 'atla' };
    });
}

export const ISLEM_ACIKLAMALARI = {
    'cik-sil': 'leave and delete',
    cik: 'leave',
    sil: 'delete (already left)',
    atla: 'already left, will be skipped',
};

export function planMetni(plan) {
    return plan
        .map(({ grup, islem }, i) => `  ${i + 1}. ${grup.ad} → ${ISLEM_ACIKLAMALARI[islem]}`)
        .join('\n');
}

const MOLA_ARALIGI = 20;

// `sira`: o ana kadar yapılan işlemin 0'dan başlayan sırası.
export function beklemeSuresi(sira, rastgele = Math.random) {
    const temel = 4000 + Math.floor(rastgele() * 4000);
    return (sira + 1) % MOLA_ARALIGI === 0 ? temel + 60000 : temel;
}

async function islemYap(sohbet, islem) {
    if (islem === 'cik' || islem === 'cik-sil') await sohbet.leave();
    if (islem === 'sil' || islem === 'cik-sil') await sohbet.delete();
}

export async function uygula(plan, { sohbetAl, bekle, rastgele = Math.random, bildir = () => {}, ilerle = () => {} }) {
    const sonuclar = [];
    const kaydet = (sonuc) => {
        sonuclar.push(sonuc);
        ilerle(sonuc);
    };
    const yapilacakSayisi = plan.filter((a) => a.islem !== 'atla').length;
    let yapilan = 0;
    for (const { grup, islem } of plan) {
        const sonuc = { id: grup.id, ad: grup.ad, islem };
        if (islem === 'atla') {
            kaydet({ ...sonuc, durum: 'atlandi' });
            continue;
        }
        try {
            const sohbet = await sohbetAl(grup.id);
            if (!sohbet) throw new Error('chat not found');
            await islemYap(sohbet, islem);
            kaydet({ ...sonuc, durum: 'basarili' });
            bildir(`✓ ${grup.ad}`);
        } catch (hata) {
            kaydet({ ...sonuc, durum: 'basarisiz', hata: hata.message });
            bildir(`✗ ${grup.ad}: ${hata.message}`);
        }
        if (yapilan < yapilacakSayisi - 1) await bekle(beklemeSuresi(yapilan, rastgele));
        yapilan++;
    }
    return sonuclar;
}

export function ozet(sonuclar) {
    const say = (durum) => sonuclar.filter((s) => s.durum === durum);
    const basarisizlar = say('basarisiz');
    const parcalar = [`${say('basarili').length} succeeded`];
    parcalar.push(
        basarisizlar.length
            ? `${basarisizlar.length} failed (${basarisizlar.map((s) => s.ad).join(', ')})`
            : '0 failed',
    );
    const atlananlar = say('atlandi').length;
    if (atlananlar) parcalar.push(`${atlananlar} skipped`);
    return parcalar.join(', ');
}

// Koşul sağlanana kadar `aralik` ms arayla bekler. Süre dolarsa false döner.
export async function bekleKadar({ kosul, bekle, aralik = 500, sure = 15000 }) {
    for (let gecen = 0; gecen < sure; gecen += aralik) {
        if (await kosul()) return true;
        await bekle(aralik);
    }
    return false;
}

// Ortalama değerler: çıkış doğrulaması ve "gruptan çıktın" beklemesi dahil.
const ISLEM_SURELERI = { 'cik-sil': 5000, cik: 4000, sil: 1000 };
const ORTALAMA_BEKLEME = 6000;

export function tahminiSure(plan) {
    const islemler = plan.filter((a) => a.islem !== 'atla');
    if (islemler.length === 0) return 0;
    const islemSuresi = islemler.reduce((toplam, a) => toplam + ISLEM_SURELERI[a.islem], 0);
    const beklemeSayisi = islemler.length - 1;
    const molaSayisi = Math.floor(beklemeSayisi / MOLA_ARALIGI);
    return islemSuresi + beklemeSayisi * ORTALAMA_BEKLEME + molaSayisi * 60000;
}

export function sureMetni(ms) {
    if (ms < 60000) return 'under 1 minute';
    return `about ${Math.round(ms / 60000)} minutes`;
}

// İşlem `ms` içinde bitmezse ya da hata verirse undefined döner; kapanışın takılmasını önler.
export function zamanAsimiyla(islem, ms) {
    let zamanlayici;
    const sure = new Promise((coz) => {
        zamanlayici = setTimeout(coz, ms);
    });
    return Promise.race([Promise.resolve(islem).catch(() => undefined), sure]).finally(() =>
        clearTimeout(zamanlayici),
    );
}
