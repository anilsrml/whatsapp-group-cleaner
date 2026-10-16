import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delayAfter, runPlan, summary } from '../src/core.js';

test('the delay between actions is 4 to 8 seconds', () => {
    assert.equal(delayAfter(0, () => 0), 4000);
    assert.equal(delayAfter(0, () => 0.999), 7996);
});

test('a 1-minute break is added after every 20 actions', () => {
    assert.equal(delayAfter(19, () => 0), 64000);
    assert.equal(delayAfter(20, () => 0), 4000);
    assert.equal(delayAfter(39, () => 0), 64000);
});

// The WhatsApp client is a system boundary; a fake chat object replaces it here.
function fakeChat(calls, name, { error } = {}) {
    return {
        leave: async () => {
            if (error) throw new Error(error);
            calls.push(`${name}:leave`);
        },
        delete: async () => {
            calls.push(`${name}:delete`);
            return true;
        },
    };
}

function setup(chats) {
    const waits = [];
    return {
        waits,
        options: {
            getChat: async (id) => chats[id],
            wait: async (ms) => waits.push(ms),
            random: () => 0,
            log: () => {},
        },
    };
}

const g = (id) => ({ id, name: id });

test('each action makes the right calls', async () => {
    const calls = [];
    const { options } = setup({
        a: fakeChat(calls, 'a'),
        b: fakeChat(calls, 'b'),
        c: fakeChat(calls, 'c'),
        d: fakeChat(calls, 'd'),
    });
    const results = await runPlan(
        [
            { group: g('a'), action: 'leave-delete' },
            { group: g('b'), action: 'leave' },
            { group: g('c'), action: 'delete' },
            { group: g('d'), action: 'skip' },
        ],
        options,
    );
    assert.deepEqual(calls, ['a:leave', 'a:delete', 'b:leave', 'c:delete']);
    assert.deepEqual(
        results.map((r) => r.status),
        ['succeeded', 'succeeded', 'succeeded', 'skipped'],
    );
});

test('it waits between actions, but not after the last one or a skipped one', async () => {
    const calls = [];
    const { options, waits } = setup({ a: fakeChat(calls, 'a'), b: fakeChat(calls, 'b'), c: fakeChat(calls, 'c') });
    await runPlan(
        [
            { group: g('a'), action: 'leave' },
            { group: g('c'), action: 'skip' },
            { group: g('b'), action: 'leave' },
        ],
        options,
    );
    assert.deepEqual(waits, [4000]);
});

test('a failed group is skipped and the run continues', async () => {
    const calls = [];
    const { options } = setup({ a: fakeChat(calls, 'a', { error: 'network error' }), b: fakeChat(calls, 'b') });
    const results = await runPlan(
        [
            { group: g('a'), action: 'leave-delete' },
            { group: g('b'), action: 'leave-delete' },
        ],
        options,
    );
    assert.deepEqual(calls, ['b:leave', 'b:delete']);
    assert.equal(results[0].status, 'failed');
    assert.equal(results[0].error, 'network error');
    assert.equal(results[1].status, 'succeeded');
});

test('a missing chat counts as failed', async () => {
    const { options } = setup({});
    const [result] = await runPlan([{ group: g('missing'), action: 'leave' }], options);
    assert.equal(result.status, 'failed');
    assert.match(result.error, /not found/);
});

test('each result is reported at once through onResult()', async () => {
    const calls = [];
    const { options } = setup({ a: fakeChat(calls, 'a') });
    const reported = [];
    await runPlan(
        [
            { group: g('a'), action: 'leave' },
            { group: g('b'), action: 'skip' },
        ],
        { ...options, onResult: (r) => reported.push(r) },
    );
    assert.deepEqual(reported, [
        { id: 'a', name: 'a', action: 'leave', status: 'succeeded' },
        { id: 'b', name: 'b', action: 'skip', status: 'skipped' },
    ]);
});

test('the summary shows succeeded, failed and skipped counts', () => {
    const results = [
        { name: 'A', status: 'succeeded' },
        { name: 'B', status: 'failed', error: 'x' },
        { name: 'C', status: 'failed', error: 'y' },
        { name: 'D', status: 'skipped' },
    ];
    assert.equal(summary(results), '1 succeeded, 2 failed (B, C), 1 skipped');
});

test('without failures the summary shows 0 failed', () => {
    assert.equal(summary([{ name: 'A', status: 'succeeded' }]), '1 succeeded, 0 failed');
});
