// Wraps the whatsapp-web.js client in the simple event interface that the UI server expects.
// Events: 'qr' (text), 'authenticated', 'ready', 'disconnected' (reason).
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import wweb from 'whatsapp-web.js';
import { listGroups, withTimeout } from './core.js';
import { chatActions, readGroups, readPhoto } from './whatsapp.js';

const { Client, NoAuth } = wweb;
const SYSTEM_CHROME = '/usr/bin/google-chrome';

export function createSession() {
    const session = new EventEmitter();
    const chromePath = process.env.CHROME_PATH ?? (existsSync(SYSTEM_CHROME) ? SYSTEM_CHROME : undefined);
    // NoAuth: the session is not saved to disk. webVersionCache 'none': no version cache is written.
    const client = new Client({
        authStrategy: new NoAuth(),
        webVersionCache: { type: 'none' },
        // handleSIGINT: false → on Ctrl+C the browser does not close at once; the app logs out first.
        puppeteer: { headless: true, handleSIGINT: false, executablePath: chromePath },
    });

    client.on('qr', (qr) => session.emit('qr', qr));
    client.once('authenticated', () => session.emit('authenticated'));
    // 'ready' can fire again when WhatsApp refreshes the connection; the UI becomes ready only once.
    client.once('ready', () => session.emit('ready'));
    client.on('auth_failure', (message) => session.emit('disconnected', `login failed (${message})`));
    client.on('disconnected', (reason) => session.emit('disconnected', reason));

    session.start = () =>
        client.initialize().catch((error) => session.emit('disconnected', `could not start (${error.message})`));

    session.groups = async () => listGroups(await readGroups(client));

    session.getChat = async (id) => chatActions(client, id, sleep);

    session.photo = (id) => readPhoto(client, id);

    let closed = false;
    session.close = async ({ waitForSync = false } = {}) => {
        if (closed) return;
        closed = true;
        // Give leave and delete actions a moment to reach the phone.
        if (waitForSync) await sleep(10000);
        // logout() removes the linked device from the phone. It throws if there was no connection;
        // if it hangs, shutdown does not wait more than 15 seconds.
        await withTimeout(client.logout(), 15000);
        await withTimeout(client.destroy(), 5000);
    };

    return session;
}
