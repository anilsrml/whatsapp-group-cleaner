// whatsapp-web.js istemcisini arayüz sunucusunun beklediği sade olay arayüzüne çevirir.
// Olaylar: 'qr' (metin), 'giris', 'hazir', 'koptu' (sebep).
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { setTimeout as uyu } from 'node:timers/promises';
import wweb from 'whatsapp-web.js';
import { listele, zamanAsimiyla } from './cekirdek.js';
import { fotoOku, gruplariOku, sohbetAl } from './whatsapp.js';

const { Client, NoAuth } = wweb;
const SISTEM_CHROME = '/usr/bin/google-chrome';

export function oturumOlustur() {
    const oturum = new EventEmitter();
    const chromeYolu = process.env.CHROME_PATH ?? (existsSync(SISTEM_CHROME) ? SISTEM_CHROME : undefined);
    // NoAuth: oturum diske kaydedilmez. webVersionCache 'none': sürüm önbelleği yazılmaz.
    const istemci = new Client({
        authStrategy: new NoAuth(),
        webVersionCache: { type: 'none' },
        // handleSIGINT: false → Ctrl+C'de tarayıcı hemen kapanmaz; önce WhatsApp'tan çıkış yapılır.
        puppeteer: { headless: true, handleSIGINT: false, executablePath: chromeYolu },
    });

    istemci.on('qr', (qr) => oturum.emit('qr', qr));
    istemci.once('authenticated', () => oturum.emit('giris'));
    // WhatsApp bağlantıyı yenilediğinde 'ready' tekrar gelebilir; arayüz bir kez hazır olur.
    istemci.once('ready', () => oturum.emit('hazir'));
    istemci.on('auth_failure', (mesaj) => oturum.emit('koptu', `login failed (${mesaj})`));
    istemci.on('disconnected', (sebep) => oturum.emit('koptu', sebep));

    oturum.baslat = () =>
        istemci.initialize().catch((hata) => oturum.emit('koptu', `could not start (${hata.message})`));

    oturum.gruplar = async () => listele(await gruplariOku(istemci));

    oturum.sohbetAl = async (id) => sohbetAl(istemci, id, uyu);

    oturum.foto = (id) => fotoOku(istemci, id);

    let kapandi = false;
    oturum.kapat = async ({ senkronBekle = false } = {}) => {
        if (kapandi) return;
        kapandi = true;
        // Silme ve çıkma işlemlerinin telefona iletilmesi için kısa bir süre beklenir.
        if (senkronBekle) await uyu(10000);
        // logout() bağlı cihazı telefondan kaldırır. Bağlantı hiç kurulmadıysa hata verir;
        // takılırsa kapanış 15 saniyeden fazla beklemez.
        await zamanAsimiyla(istemci.logout(), 15000);
        await zamanAsimiyla(istemci.destroy(), 5000);
    };

    return oturum;
}
