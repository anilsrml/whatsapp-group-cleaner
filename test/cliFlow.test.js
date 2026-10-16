import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/cliFlow.js';

function group(id, overrides = {}) {
    return {
        id,
        name: id,
        lastMessageAt: null,
        admin: false,
        community: false,
        archived: false,
        left: false,
        ...overrides,
    };
}

// User input and the WhatsApp client are system boundaries; fakes replace them.
function setup({ groups, search = '', selected = [], mode = 'leave-delete', community = true, confirm = 'yes', dryRun = false }) {
    const calls = [];
    const output = [];
    const asked = { choices: null, community: null };
    const getChat = async (id) => ({
        leave: async () => calls.push(`${id}:leave`),
        delete: async () => calls.push(`${id}:delete`),
    });
    const ask = {
        search: async () => search,
        select: async (choices) => {
            asked.choices = choices;
            return selected;
        },
        mode: async () => mode,
        community: async (message) => {
            asked.community = message;
            return community;
        },
        confirm: async () => confirm,
    };
    const run = () =>
        runCli({
            getGroups: async () => groups,
            getChat,
            ask,
            print: (m) => output.push(m),
            dryRun,
            wait: async () => {},
            random: () => 0,
        });
    return { run, calls, output, asked };
}

test('leaves and deletes the selected groups and prints a summary', async () => {
    const t = setup({ groups: [group('a'), group('b')], selected: ['a'] });
    await t.run();
    assert.deepEqual(t.calls, ['a:leave', 'a:delete']);
    assert.equal(t.output.at(-1), '1 succeeded, 0 failed');
});

test('the selection list shows matching groups with labels and dates', async () => {
    const t = setup({ groups: [group('İzmir', { admin: true }), group('Family')], search: 'izm' });
    await t.run();
    assert.deepEqual(t.asked.choices, [{ value: 'İzmir', name: 'İzmir [ADMIN] · -' }]);
});

test('a dry run shows the plan but changes nothing', async () => {
    const t = setup({ groups: [group('a')], selected: ['a'], dryRun: true });
    await t.run();
    assert.deepEqual(t.calls, []);
    assert.ok(t.output.some((m) => m.includes('a → leave and delete')));
    assert.match(t.output.at(-1), /Dry run/);
});

test('any answer other than "yes" cancels', async () => {
    const t = setup({ groups: [group('a')], selected: ['a'], confirm: 'ok' });
    await t.run();
    assert.deepEqual(t.calls, []);
    assert.match(t.output.at(-1), /Cancelled/);
});

test('the confirmation ignores case and spaces', async () => {
    const t = setup({ groups: [group('a')], selected: ['a'], confirm: '  YES ' });
    await t.run();
    assert.deepEqual(t.calls, ['a:leave', 'a:delete']);
});

test('a selected community group asks first, and is dropped if the answer is no', async () => {
    const t = setup({
        groups: [group('a'), group('c', { community: true })],
        selected: ['a', 'c'],
        community: false,
    });
    await t.run();
    assert.match(t.asked.community, /entire community/);
    assert.deepEqual(t.calls, ['a:leave', 'a:delete']);
});

test('a community group is processed when the answer is yes', async () => {
    const t = setup({ groups: [group('c', { community: true })], selected: ['c'] });
    await t.run();
    assert.deepEqual(t.calls, ['c:leave', 'c:delete']);
});

test('no community warning for a community group I already left', async () => {
    const t = setup({ groups: [group('c', { community: true, left: true })], selected: ['c'] });
    await t.run();
    assert.equal(t.asked.community, null);
    assert.deepEqual(t.calls, ['c:delete']);
});

test('nothing happens when no group is selected', async () => {
    const t = setup({ groups: [group('a')], selected: [] });
    await t.run();
    assert.deepEqual(t.calls, []);
    assert.match(t.output.at(-1), /No groups selected/);
});

test('it says so when no group matches the search', async () => {
    const t = setup({ groups: [group('a')], search: 'zzz' });
    await t.run();
    assert.equal(t.asked.choices, null);
    assert.match(t.output.at(-1), /No groups match/);
});

test('it says so when there are no groups', async () => {
    const t = setup({ groups: [] });
    await t.run();
    assert.match(t.output.at(-1), /No groups found/);
});
