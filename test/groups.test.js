import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterGroups, labelList, labelText, listGroups, rowText, toGroup } from '../src/core.js';

// Raw group data as read from the WhatsApp Web page (produced by src/whatsapp.js).
function raw(overrides = {}) {
    return {
        id: '123@g.us',
        name: 'Family',
        t: 1760000000,
        archived: false,
        member: true,
        admin: false,
        community: false,
        ...overrides,
    };
}

function group(overrides = {}) {
    return {
        id: '1@g.us',
        name: 'Family',
        lastMessageAt: new Date(2026, 9, 3),
        admin: false,
        community: false,
        archived: false,
        left: false,
        ...overrides,
    };
}

test('toGroup maps the basic fields', () => {
    assert.deepEqual(toGroup(raw()), {
        id: '123@g.us',
        name: 'Family',
        lastMessageAt: new Date(1760000000 * 1000),
        admin: false,
        community: false,
        archived: false,
        left: false,
    });
});

test('toGroup keeps the admin, community and archived flags', () => {
    const g = toGroup(raw({ admin: true, community: true, archived: true }));
    assert.equal(g.admin, true);
    assert.equal(g.community, true);
    assert.equal(g.archived, true);
});

test('a group I am not a member of counts as left', () => {
    assert.equal(toGroup(raw({ member: false })).left, true);
});

test('a group with unknown membership does not count as left', () => {
    assert.equal(toGroup(raw({ member: null })).left, false);
});

test('a group without a name gets a placeholder name', () => {
    assert.equal(toGroup(raw({ name: '' })).name, '(unnamed group)');
});

test('a group without messages has no last message date', () => {
    assert.equal(toGroup(raw({ t: 0 })).lastMessageAt, null);
});

test('listGroups hides entries without a name', () => {
    const list = listGroups([raw({ id: 'a' }), raw({ id: 'b', name: '' }), raw({ id: 'c', name: '   ' })]);
    assert.deepEqual(list.map((g) => g.id), ['a']);
});

test('listGroups hides groups known to be deleted', () => {
    const list = listGroups([raw({ id: 'a' }), raw({ id: 'b' })], new Set(['b']));
    assert.deepEqual(list.map((g) => g.id), ['a']);
});

test('listGroups sorts by last message, newest first', () => {
    const list = listGroups([raw({ id: 'old', t: 100 }), raw({ id: 'new', t: 300 }), raw({ id: 'mid', t: 200 })]);
    assert.deepEqual(list.map((g) => g.id), ['new', 'mid', 'old']);
});

test('a group without labels has an empty label text', () => {
    assert.equal(labelText(group()), '');
    assert.deepEqual(labelList(group()), []);
});

test('all labels are shown in a fixed order', () => {
    const g = group({ admin: true, community: true, archived: true, left: true });
    assert.equal(labelText(g), '[ADMIN] [COMMUNITY] [ARCHIVED] [LEFT]');
});

test('the row text has the name, labels and last message date', () => {
    assert.equal(rowText(group({ archived: true })), 'Family [ARCHIVED] · 3 Oct 2026');
});

test('the row text shows a dash when there is no date', () => {
    assert.equal(rowText(group({ lastMessageAt: null })), 'Family · -');
});

test('an empty search returns all groups', () => {
    const list = [group({ name: 'A' }), group({ name: 'B' })];
    assert.deepEqual(filterGroups(list, '  '), list);
});

test('search ignores case and handles the Turkish dotted İ', () => {
    const list = [group({ name: 'İZMİR Friends' }), group({ name: 'Family' })];
    assert.deepEqual(filterGroups(list, 'izmir').map((g) => g.name), ['İZMİR Friends']);
});

test('search works for English names (I does not become ı)', () => {
    const list = [group({ name: 'IT Team' }), group({ name: 'Family' })];
    assert.deepEqual(filterGroups(list, 'it').map((g) => g.name), ['IT Team']);
});
