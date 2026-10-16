// End-to-end test: a real Chrome opens the page and clicks like a user.
// The WhatsApp session is a system boundary; a fake session replaces it.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createAppServer } from '../src/server.js';

const KEY = 'e2e-key';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function group(id, overrides = {}) {
    return {
        id,
        name: id,
        lastMessageAt: new Date(2026, 0, 2),
        admin: false,
        community: false,
        archived: false,
        left: false,
        ...overrides,
    };
}

const GROUPS = [
    group('Family', { admin: true }),
    group('Football', { left: true }),
    group('Campus Community', { community: true }),
    group('Work friends', { archived: true }),
];

function fakeSession() {
    const session = new EventEmitter();
    session.calls = [];
    session.closed = false;
    session.groups = async () => GROUPS;
    session.getChat = async (id) => ({
        leave: async () => session.calls.push(`${id}:leave`),
        delete: async () => session.calls.push(`${id}:delete`),
    });
    session.close = async () => {
        session.closed = true;
    };
    session.photo = async (id) => (id === 'Family' ? PNG : undefined);
    return session;
}

let browser;
let page;
let server;
let session;

before(async () => {
    assert.ok(existsSync(CHROME), `Chrome not found: ${CHROME}`);
    browser = await chromium.launch({ executablePath: CHROME, headless: true });
});

after(() => browser?.close());

beforeEach(async () => {
    session = fakeSession();
    server = createAppServer({
        session,
        key: KEY,
        wait: async () => {},
        random: () => 0,
        // No real QR image is needed.
        qrImage: async () => `data:image/png;base64,${PNG}`,
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(`http://127.0.0.1:${server.address().port}/#${KEY}`);
});

afterEach(async () => {
    await page.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
});

async function openGroupList() {
    session.emit('qr', 'CODE');
    await page.getByRole('img', { name: 'QR code' }).waitFor();
    session.emit('authenticated');
    await page.getByText('Loading chats').waitFor();
    session.emit('ready');
    await page.getByRole('heading', { name: 'Groups' }).waitFor();
}

const row = (name) => page.getByRole('checkbox', { name: new RegExp(`^${name}`) });

test('shows the QR code, then lists the groups with labels', async () => {
    await openGroupList();
    for (const g of GROUPS) await row(g.name).waitFor();
    assert.match(await row('Family').textContent(), /Admin/);
    assert.match(await row('Football').textContent(), /Left/);
    assert.match(await row('Campus Community').textContent(), /Community/);
    assert.match(await row('Work friends').textContent(), /Archived/);
});

test('shows a photo when there is one, and initials when there is not', async () => {
    await openGroupList();
    await row('Family').locator('img.avatar-photo').waitFor();
    assert.equal(await row('Football').locator('img.avatar-photo').count(), 0);
    assert.match(await row('Football').locator('.avatar').textContent(), /F/);
});

test('search and label filters narrow the list', async () => {
    await openGroupList();
    await page.getByRole('searchbox', { name: 'Search groups' }).fill('work');
    await page.waitForFunction(() => document.querySelectorAll('[role="checkbox"]').length === 1);
    await row('Work friends').waitFor();

    await page.getByRole('searchbox', { name: 'Search groups' }).fill('');
    await page.getByRole('button', { name: 'Left', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('[role="checkbox"]').length === 1);
    await row('Football').waitFor();
});

test('leaves and deletes the selected groups and shows the summary', async () => {
    await openGroupList();
    await row('Family').click();
    await row('Football').click();
    await page.getByText('2 groups selected').waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByText('Family → leave and delete').waitFor();
    await dialog.getByText('Football → delete (already left)').waitFor();
    await dialog.getByText('under 1 minute').waitFor();
    await dialog.getByRole('button', { name: 'Yes, process 2 groups' }).click();

    await page.getByText('2 succeeded, 0 failed').waitFor();
    assert.deepEqual(session.calls, ['Family:leave', 'Family:delete', 'Football:delete']);
});

test('"leave only" skips a group I already left', async () => {
    await openGroupList();
    await row('Family').click();
    await row('Football').click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /Leave only/ }).check();
    await dialog.getByText('Football → already left, will be skipped').waitFor();
    await dialog.getByRole('button', { name: 'Yes, process 2 groups' }).click();
    await page.getByText('1 succeeded, 0 failed, 1 skipped').waitFor();
    assert.deepEqual(session.calls, ['Family:leave']);
});

test('a community group is not processed unless its checkbox is ticked', async () => {
    await openGroupList();
    await row('Family').click();
    await row('Campus Community').click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText(/entire community/).waitFor();
    await dialog.getByRole('button', { name: 'Yes, process 1 group' }).click();
    await page.getByText('1 succeeded, 0 failed').waitFor();
    assert.deepEqual(session.calls, ['Family:leave', 'Family:delete']);
});

test('a community group is processed when its checkbox is ticked', async () => {
    await openGroupList();
    await row('Campus Community').click();
    await page.getByRole('button', { name: 'Continue' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('checkbox', { name: /Also process community groups/ }).check();
    await dialog.getByRole('button', { name: 'Yes, process 1 group' }).click();
    await page.getByText('1 succeeded, 0 failed').waitFor();
    assert.deepEqual(session.calls, ['Campus Community:leave', 'Campus Community:delete']);
});

test('Cancel closes the dialog and changes nothing', async () => {
    await openGroupList();
    await row('Family').click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(session.calls, []);
});

test('Log out closes the session', async () => {
    await openGroupList();
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.getByText('Logged out').waitFor();
    assert.equal(session.closed, true);
});

test('a lost connection shows an error screen', async () => {
    session.emit('disconnected', 'LOGOUT');
    await page.getByText(/WhatsApp connection lost: LOGOUT/).waitFor();
});
