import { existsSync } from 'node:fs';
import { setTimeout as uyu } from 'node:timers/promises';
import { checkbox, confirm, input, select } from '@inquirer/prompts';
import qrcode from 'qrcode-terminal';
import wweb from 'whatsapp-web.js';
import { akis } from './akis.js';
import { listele, zamanAsimiyla } from './cekirdek.js';
import { gruplariOku, sohbetAl } from './whatsapp.js';

const { Client, NoAuth } = wweb;

const deneme = process.argv.includes('--dry-run');
const sistemChrome = '/usr/bin/google-chrome';
const chromeYolu = process.env.CHROME_PATH ?? (existsSync(sistemChrome) ? sistemChrome : undefined);

// NoAuth: oturum diske kaydedilmez. webVersionCache 'none': sürüm önbelleği yazılmaz.
const istemci = new Client({
    authStrategy: new NoAuth(),
    webVersionCache: { type: 'none' },
    // handleSIGINT: false → Ctrl+C'de tarayıcı hemen kapanmaz; önce WhatsApp'tan çıkış yapılır.
    puppeteer: { headless: true, handleSIGINT: false, executablePath: chromeYolu },
});

let kapaniyor = false;
async function kapat(kod) {
    if (kapaniyor) return;
    kapaniyor = true;
    console.log('\nLogging out of WhatsApp Web...');
    // logout() bağlı cihazı telefondan kaldırır; takılırsa kapanış 15 saniyeden fazla beklemez.
    await zamanAsimiyla(istemci.logout(), 15000);
    await zamanAsimiyla(istemci.destroy(), 5000);
    process.exit(kod);
}

process.on('SIGINT', () => kapat(130));

const sor = {
    filtre: () => input({ message: 'Search group names (leave empty for all):' }),
    sec: (secenekler) =>
        checkbox({
            message: 'Select groups (space: select, enter: done)',
            choices: secenekler,
            pageSize: 15,
            loop: false,
        }),
    mod: () =>
        select({
            message: 'What should happen to the selected groups?',
            choices: [
                { value: 'cik-sil', name: 'Leave and delete (removed from your chat list)' },
                { value: 'cik', name: 'Leave only (chat history stays in your list)' },
            ],
        }),
    topluluk: (mesaj) => confirm({ message: mesaj, default: false }),
    onay: () => input({ message: 'Type "yes" to continue:' }),
};

istemci.on('qr', (qr) => {
    console.log('On your phone, open WhatsApp → Linked devices → Link a device and scan this code:\n');
    qrcode.generate(qr, { small: true });
});

istemci.once('authenticated', () => console.log('QR code scanned. Loading chats, this can take 1-2 minutes...'));

istemci.on('auth_failure', (mesaj) => {
    console.error(`Login failed: ${mesaj}`);
    kapat(1);
});

istemci.once('ready', async () => {
    console.log('Connected. Reading groups...');
    try {
        await akis({
            gruplariGetir: async () => listele(await gruplariOku(istemci)),
            sohbetAl: async (id) => sohbetAl(istemci, id, uyu),
            sor,
            yaz: (m) => console.log(m),
            deneme,
            bekle: (ms) => uyu(ms),
        });
        if (!deneme) {
            console.log('Waiting for changes to sync to your phone (10 seconds)...');
            await uyu(10000);
        }
        await kapat(0);
    } catch (hata) {
        // Menüde Ctrl+C basılınca inquirer ExitPromptError fırlatır.
        if (hata?.name !== 'ExitPromptError') console.error(`Error: ${hata?.stack ?? hata}`);
        await kapat(1);
    }
});

if (deneme) console.log('Dry run: no groups will be changed.');
console.log('Starting WhatsApp Web...');
istemci.initialize().catch((hata) => {
    console.error(`Could not start WhatsApp Web: ${hata.message}`);
    kapat(1);
});
