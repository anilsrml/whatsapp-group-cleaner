// Tarayıcı arayüzünü başlatır: WhatsApp oturumu + yerel sunucu + tarayıcıyı açma.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as uyu } from 'node:timers/promises';
import QRCode from 'qrcode';
import { oturumOlustur } from './oturum.js';
import { sunucuOlustur } from './sunucu.js';

// Varsayılan tarayıcıyı işletim sistemine göre açar. Açamazsa kullanıcı adresi kendisi kopyalar.
function tarayiciAc(adres) {
    const [komut, argumanlar] =
        process.platform === 'darwin'
            ? ['open', [adres]]
            : process.platform === 'win32'
              ? ['cmd', ['/c', 'start', '""', adres.replace(/&/g, '^&')]]
              : ['xdg-open', [adres]];
    spawn(komut, argumanlar, { stdio: 'ignore', detached: true })
        .on('error', () => {})
        .unref();
}

const PORT = Number(process.env.PORT ?? 4747);
const anahtar = randomBytes(24).toString('hex');
const oturum = oturumOlustur();

// Arayüz "çıkış" isteğinde değişikliklerin telefona iletilmesini bekleyip kapanır.
const kapat = oturum.kapat;
oturum.kapat = async () => {
    await kapat({ senkronBekle: true });
    setTimeout(() => process.exit(0), 500);
};

const sunucu = sunucuOlustur({
    oturum,
    anahtar,
    bekle: (ms) => uyu(ms),
    qrResmi: (metin) => QRCode.toDataURL(metin, { margin: 1, width: 264 }),
});

sunucu.on('error', (hata) => {
    if (hata.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is in use. Try another port: PORT=4848 npm run ui`);
    } else {
        console.error(`Server error: ${hata.message}`);
    }
    process.exit(1);
});

sunucu.listen(PORT, '127.0.0.1', () => {
    const adres = `http://127.0.0.1:${PORT}/#${anahtar}`;
    console.log('Opening the app. If your browser does not open, copy this address:');
    console.log(adres);
    console.log('To stop, click "Log out" in the app or press Ctrl+C here.');
    // Anahtar adresin # kısmında durur; # kısmı hiçbir sunucuya gönderilmez.
    tarayiciAc(adres);
    oturum.baslat();
});

process.on('SIGINT', async () => {
    console.log('\nLogging out of WhatsApp Web...');
    await kapat();
    process.exit(130);
});
