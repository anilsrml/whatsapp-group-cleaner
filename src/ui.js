// Starts the browser UI: WhatsApp session + local server + opens the browser.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import QRCode from 'qrcode';
import { createAppServer } from './server.js';
import { createSession } from './session.js';

// Opens the default browser for the operating system. If it fails, the user copies the address.
function openBrowser(url) {
    const [command, args] =
        process.platform === 'darwin'
            ? ['open', [url]]
            : process.platform === 'win32'
              ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
              : ['xdg-open', [url]];
    spawn(command, args, { stdio: 'ignore', detached: true })
        .on('error', () => {})
        .unref();
}

const PORT = Number(process.env.PORT ?? 4747);
const key = randomBytes(24).toString('hex');
const session = createSession();

// When the UI asks to log out, wait for the changes to reach the phone, then exit.
const closeSession = session.close;
session.close = async () => {
    await closeSession({ waitForSync: true });
    setTimeout(() => process.exit(0), 500);
};

const server = createAppServer({
    session,
    key,
    wait: (ms) => sleep(ms),
    qrImage: (text) => QRCode.toDataURL(text, { margin: 1, width: 264 }),
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is in use. Try another port: PORT=4848 npm run ui`);
    } else {
        console.error(`Server error: ${error.message}`);
    }
    process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${PORT}/#${key}`;
    console.log('Opening the app. If your browser does not open, copy this address:');
    console.log(url);
    console.log('To stop, click "Log out" in the app or press Ctrl+C here.');
    // The key is after the #; the browser never sends this part to any server.
    openBrowser(url);
    session.start();
});

process.on('SIGINT', async () => {
    console.log('\nLogging out of WhatsApp Web...');
    await closeSession();
    process.exit(130);
});
