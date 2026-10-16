// Terminal version: same steps as the browser UI, with prompts in the terminal.
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { checkbox, confirm, input, select } from '@inquirer/prompts';
import qrcode from 'qrcode-terminal';
import wweb from 'whatsapp-web.js';
import { runCli } from './cliFlow.js';
import { listGroups, withTimeout } from './core.js';
import { chatActions, readGroups } from './whatsapp.js';

const { Client, NoAuth } = wweb;

const dryRun = process.argv.includes('--dry-run');
const SYSTEM_CHROME = '/usr/bin/google-chrome';
const chromePath = process.env.CHROME_PATH ?? (existsSync(SYSTEM_CHROME) ? SYSTEM_CHROME : undefined);

// NoAuth: the session is not saved to disk. webVersionCache 'none': no version cache is written.
const client = new Client({
    authStrategy: new NoAuth(),
    webVersionCache: { type: 'none' },
    // handleSIGINT: false → on Ctrl+C the browser does not close at once; the app logs out first.
    puppeteer: { headless: true, handleSIGINT: false, executablePath: chromePath },
});

let closing = false;
async function shutdown(exitCode) {
    if (closing) return;
    closing = true;
    console.log('\nLogging out of WhatsApp Web...');
    // logout() removes the linked device from the phone; shutdown waits at most 15 seconds for it.
    await withTimeout(client.logout(), 15000);
    await withTimeout(client.destroy(), 5000);
    process.exit(exitCode);
}

process.on('SIGINT', () => shutdown(130));

const ask = {
    search: () => input({ message: 'Search group names (leave empty for all):' }),
    select: (choices) =>
        checkbox({
            message: 'Select groups (space: select, enter: done)',
            choices,
            pageSize: 15,
            loop: false,
        }),
    mode: () =>
        select({
            message: 'What should happen to the selected groups?',
            choices: [
                { value: 'leave-delete', name: 'Leave and delete (removed from your chat list)' },
                { value: 'leave', name: 'Leave only (chat history stays in your list)' },
            ],
        }),
    community: (message) => confirm({ message, default: false }),
    confirm: () => input({ message: 'Type "yes" to continue:' }),
};

client.on('qr', (qr) => {
    console.log('On your phone, open WhatsApp → Linked devices → Link a device and scan this code:\n');
    qrcode.generate(qr, { small: true });
});

client.once('authenticated', () => console.log('QR code scanned. Loading chats, this can take 1-2 minutes...'));

client.on('auth_failure', (message) => {
    console.error(`Login failed: ${message}`);
    shutdown(1);
});

client.once('ready', async () => {
    console.log('Connected. Reading groups...');
    try {
        await runCli({
            getGroups: async () => listGroups(await readGroups(client)),
            getChat: async (id) => chatActions(client, id, sleep),
            ask,
            print: (message) => console.log(message),
            dryRun,
            wait: (ms) => sleep(ms),
        });
        if (!dryRun) {
            console.log('Waiting for changes to sync to your phone (10 seconds)...');
            await sleep(10000);
        }
        await shutdown(0);
    } catch (error) {
        // Pressing Ctrl+C in a prompt makes inquirer throw ExitPromptError.
        if (error?.name !== 'ExitPromptError') console.error(`Error: ${error?.stack ?? error}`);
        await shutdown(1);
    }
});

if (dryRun) console.log('Dry run: no groups will be changed.');
console.log('Starting WhatsApp Web...');
client.initialize().catch((error) => {
    console.error(`Could not start WhatsApp Web: ${error.message}`);
    shutdown(1);
});
