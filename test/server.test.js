import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { request } from 'node:http';
import { createAppServer } from '../src/server.js';

const KEY = 'test-key';
// 1x1 transparent PNG (base64)
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

// The WhatsApp session is a system boundary; a fake session replaces it.
function fakeSession(groups) {
    const session = new EventEmitter();
    session.calls = [];
    session.closed = false;
    session.photoRequests = [];
    session.groups = async () => groups;
    session.getChat = async (id) => ({
        leave: async () => session.calls.push(`${id}:leave`),
        delete: async () => session.calls.push(`${id}:delete`),
    });
    session.close = async () => {
        session.closed = true;
    };
    session.photo = async (id) => {
        session.photoRequests.push(id);
        return id === 'a' ? PNG : undefined;
    };
    return session;
}

let server;
let session;
let base;

function stop() {
    if (!server) return;
    server.closeAllConnections();
    server.close();
    server = null;
}

async function start(groups = [group('a'), group('b'), group('c', { community: true })]) {
    stop();
    session = fakeSession(groups);
    server = createAppServer({
        session,
        key: KEY,
        wait: async () => {},
        random: () => 0,
        qrImage: async (text) => `data:qr,${text}`,
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
}

function api(path, { method = 'GET', body, key = KEY } = {}) {
    const headers = { 'x-key': key };
    if (body) headers['content-type'] = 'application/json';
    return fetch(base + path, { method, headers, body: body && JSON.stringify(body) });
}

async function becomeReady() {
    session.emit('ready');
    await new Promise((r) => setImmediate(r));
}

async function waitForDone() {
    for (let i = 0; i < 50; i++) {
        const status = await (await api('/api/status')).json();
        if (status.state === 'done') return status;
        await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('the job did not finish');
}

beforeEach(() => start());
afterEach(stop);

test('an API request without the key is rejected', async () => {
    assert.equal((await api('/api/status', { key: 'wrong' })).status, 403);
});

test('a request with another host name is rejected', async () => {
    // fetch does not allow changing the Host header, so node:http is used.
    const status = await new Promise((resolve, reject) => {
        const req = request(
            {
                host: '127.0.0.1',
                port: server.address().port,
                path: '/api/status',
                headers: { host: 'evil.example', 'x-key': KEY },
            },
            (res) => {
                res.resume();
                resolve(res.statusCode);
            },
        );
        req.on('error', reject);
        req.end();
    });
    assert.equal(status, 403);
});

test('the main page opens without a key', async () => {
    const res = await fetch(base + '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
});

test('the first state is "starting"', async () => {
    const status = await (await api('/api/status')).json();
    assert.equal(status.state, 'starting');
    assert.equal(status.qr, null);
});

test('a QR code moves the state to "qr" and returns an image', async () => {
    session.emit('qr', 'CODE');
    await new Promise((r) => setImmediate(r));
    const status = await (await api('/api/status')).json();
    assert.equal(status.state, 'qr');
    assert.equal(status.qr, 'data:qr,CODE');
});

test('authenticated and ready events move the state forward', async () => {
    session.emit('authenticated');
    assert.equal((await (await api('/api/status')).json()).state, 'loading');
    await becomeReady();
    const status = await (await api('/api/status')).json();
    assert.equal(status.state, 'ready');
    assert.equal(status.qr, null);
});

test('the group list is not available before ready', async () => {
    assert.equal((await api('/api/groups')).status, 409);
});

test('the group list has labels and dates', async () => {
    await start([group('a', { admin: true, archived: true })]);
    await becomeReady();
    const groups = await (await api('/api/groups')).json();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].id, 'a');
    assert.deepEqual(groups[0].labels, ['ADMIN', 'ARCHIVED']);
    assert.equal(groups[0].date, '2 Jan 2026');
});

test('the plan lists active community groups and leaves them out by default', async () => {
    await becomeReady();
    const plan = await (
        await api('/api/plan', { method: 'POST', body: { ids: ['a', 'c'], mode: 'leave-delete' } })
    ).json();
    assert.deepEqual(plan.communities, ['c']);
    assert.deepEqual(
        plan.steps.map((s) => [s.name, s.action]),
        [['a', 'leave-delete']],
    );
    assert.equal(plan.duration, 'under 1 minute');
});

test('community groups are in the plan when included', async () => {
    await becomeReady();
    const plan = await (
        await api('/api/plan', {
            method: 'POST',
            body: { ids: ['a', 'c'], mode: 'leave', includeCommunities: true },
        })
    ).json();
    assert.deepEqual(
        plan.steps.map((s) => s.name),
        ['a', 'c'],
    );
});

test('an invalid mode is rejected', async () => {
    await becomeReady();
    const res = await api('/api/plan', { method: 'POST', body: { ids: ['a'], mode: 'wrong' } });
    assert.equal(res.status, 400);
});

test('a job runs and its progress and summary show in the status', async () => {
    await becomeReady();
    const res = await api('/api/run', { method: 'POST', body: { ids: ['a', 'b'], mode: 'leave-delete' } });
    assert.equal(res.status, 202);
    const status = await waitForDone();
    assert.deepEqual(session.calls, ['a:leave', 'a:delete', 'b:leave', 'b:delete']);
    assert.equal(status.progress.total, 2);
    assert.equal(status.progress.results.length, 2);
    assert.equal(status.progress.summary, '2 succeeded, 0 failed');
});

test('a second job cannot start while one is running', async () => {
    await becomeReady();
    let release;
    session.getChat = async () => ({
        leave: () => new Promise((r) => (release = r)),
        delete: async () => {},
    });
    await api('/api/run', { method: 'POST', body: { ids: ['a'], mode: 'leave' } });
    const second = await api('/api/run', { method: 'POST', body: { ids: ['b'], mode: 'leave' } });
    assert.equal(second.status, 409);
    while (!release) await new Promise((r) => setTimeout(r, 5));
    release();
    await waitForDone();
});

test('the group list can be read again after a job', async () => {
    await becomeReady();
    await api('/api/run', { method: 'POST', body: { ids: ['a'], mode: 'leave' } });
    await waitForDone();
    assert.equal((await api('/api/groups')).status, 200);
});

test('a deleted group does not show again in the same session', async () => {
    await becomeReady();
    await api('/api/run', { method: 'POST', body: { ids: ['a'], mode: 'leave-delete' } });
    await waitForDone();
    const groups = await (await api('/api/groups')).json();
    assert.deepEqual(groups.map((g) => g.id), ['b', 'c']);
});

test('a group I only left stays in the list', async () => {
    await becomeReady();
    await api('/api/run', { method: 'POST', body: { ids: ['a'], mode: 'leave' } });
    await waitForDone();
    const groups = await (await api('/api/groups')).json();
    assert.ok(groups.some((g) => g.id === 'a'));
});

test('a group photo is returned as an image', async () => {
    await becomeReady();
    const res = await api('/api/photo?id=a');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(PNG, 'base64'));
});

test('a group without a photo returns 404', async () => {
    await becomeReady();
    assert.equal((await api('/api/photo?id=b')).status, 404);
});

test('photos are cached', async () => {
    await becomeReady();
    await api('/api/photo?id=a');
    await api('/api/photo?id=a');
    await api('/api/photo?id=b');
    await api('/api/photo?id=b');
    assert.deepEqual(session.photoRequests, ['a', 'b']);
});

test('photos also need the key', async () => {
    await becomeReady();
    assert.equal((await api('/api/photo?id=a', { key: 'wrong' })).status, 403);
});

test('log out closes the session', async () => {
    const res = await api('/api/logout', { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(session.closed, true);
    assert.equal((await (await api('/api/status')).json()).state, 'closed');
});

test('a lost connection moves the state to "disconnected" with an error', async () => {
    session.emit('disconnected', 'LOGOUT');
    const status = await (await api('/api/status')).json();
    assert.equal(status.state, 'disconnected');
    assert.match(status.error, /LOGOUT/);
});
