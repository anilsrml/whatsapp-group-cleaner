import { bekleKadar } from './cekirdek.js';

// WhatsApp Web sayfasıyla konuşan katman (sistem sınırı).
// Kütüphanenin getChats() ve getChatById() fonksiyonları bütün sohbetleri modele
// çevirirken WhatsApp Web'in yeni sürümünde "r" hatasıyla çöküyor. Bu yüzden
// gruplar her biri ayrı ayrı ve hataya dayanıklı şekilde doğrudan sayfadan okunur.

export async function gruplariOku(istemci) {
    return istemci.pupPage.evaluate(async () => {
        const koleksiyonlar = window.require('WAWebCollections');
        const metaKoleksiyon = koleksiyonlar.GroupMetadata || koleksiyonlar.WAWebGroupMetadataCollection;
        const dene = (f) => {
            try {
                return f();
            } catch {
                return null;
            }
        };
        const gruplar = [];
        for (const c of koleksiyonlar.Chat.getModelsArray()) {
            const gm = c.groupMetadata;
            if (!gm) continue;
            try {
                await metaKoleksiyon.update(c.id);
            } catch {
                // Güncel bilgi alınamazsa önbellekteki bilgiyle devam edilir.
            }
            const p = gm.participants;
            gruplar.push({
                id: c.id._serialized,
                ad: c.formattedTitle || c.name || gm.subject || '',
                t: typeof c.t === 'number' ? c.t : 0,
                arsiv: Boolean(c.archive),
                uye: dene(() => p.iAmMember()),
                yonetici: Boolean(dene(() => p.iAmAdmin() || p.iAmSuperAdmin())),
                topluluk: Boolean(gm.parentGroup || gm.isParentGroup),
            });
        }
        return gruplar;
    });
}

function uyeMiyim(istemci, id) {
    return istemci.pupPage.evaluate((chatId) => {
        const { Chat } = window.require('WAWebCollections');
        const chat = Chat.get(chatId);
        try {
            return chat?.groupMetadata?.participants?.iAmMember() ?? false;
        } catch {
            return false;
        }
    }, id);
}

// Çıkıştan hemen sonra silinirse, ardından gelen "gruptan çıktın" mesajı grubu
// listeye geri ekler. Bu yüzden çıkış doğrulanmadan silinmez.
// Silinen grup WhatsApp Web'in hafızasında bir süre kalır, o yüzden silme sonrası kontrol yapılmaz.
export function sohbetAl(istemci, id, bekle) {
    return {
        leave: async () => {
            await istemci.pupPage.evaluate(async (chatId) => {
                const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
                if (!chat) throw new Error('chat not found');
                await window.require('WAWebExitGroupAction').sendExitGroup(chat);
            }, id);
            const cikildi = await bekleKadar({ kosul: async () => !(await uyeMiyim(istemci, id)), bekle });
            if (!cikildi) throw new Error('could not confirm leaving the group');
            // "Gruptan çıktın" mesajının gelmesi için kısa bir süre daha beklenir.
            await bekle(2000);
        },
        delete: () =>
            istemci.pupPage.evaluate((chatId) => window.WWebJS.sendDeleteChat(chatId), id),
    };
}

// Grup fotoğrafını base64 olarak döner; yoksa undefined.
// Önce WhatsApp Web'in önbelleğindeki küçük fotoğrafa bakılır. Görünmez tarayıcı sohbetleri
// hiç açmadığı için bu önbellek çoğu zaman boştur; o zaman fotoğraf adresi sunucudan istenir.
// Kütüphanenin getProfilePicUrl() fonksiyonu bozuk getChatModel yolundan geçtiği için kullanılmaz.
export async function fotoOku(istemci, id) {
    const sonuc = await istemci.pupPage.evaluate(async (chatId) => {
        const wid = window.require('WAWebWidFactory').createWid(chatId);
        try {
            const kucuk = await window.WWebJS.getProfilePicThumbToBase64(wid);
            if (kucuk) return { base64: kucuk };
        } catch {
            // Önbellekte yoksa sunucuya sorulur.
        }
        const kopru = window.require('WAWebContactProfilePicThumbBridge');
        const chat = await window.WWebJS.getChat(chatId, { getAsModel: false }).catch(() => null);
        for (const arguman of [chat, wid]) {
            if (!arguman) continue;
            try {
                const foto = await kopru.requestProfilePicFromServer(arguman);
                if (foto?.eurl) return { adres: foto.eurl };
                if (foto) return {};
            } catch (hata) {
                // ServerStatusCodeError: grubun fotoğrafı yok.
                if (hata?.name === 'ServerStatusCodeError') return {};
            }
        }
        return {};
    }, id);
    if (sonuc.base64) return sonuc.base64;
    if (!sonuc.adres) return undefined;
    // CDN adresi tarayıcı yerine buradan indirilir; böylece tarayıcının CORS kısıtına takılmaz.
    const yanit = await fetch(sonuc.adres);
    if (!yanit.ok) return undefined;
    return Buffer.from(await yanit.arrayBuffer()).toString('base64');
}
