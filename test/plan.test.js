import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durationText, estimateDuration, makePlan, planText } from '../src/core.js';

const active = { id: '1@g.us', name: 'Family', left: false, community: false };
const alreadyLeft = { id: '2@g.us', name: 'Old', left: true, community: false };

test('"leave and delete" leaves an active group and deletes it', () => {
    assert.deepEqual(makePlan([active], 'leave-delete'), [{ group: active, action: 'leave-delete' }]);
});

test('"leave and delete" only deletes a group I already left', () => {
    assert.deepEqual(makePlan([alreadyLeft], 'leave-delete'), [{ group: alreadyLeft, action: 'delete' }]);
});

test('"leave only" leaves an active group', () => {
    assert.deepEqual(makePlan([active], 'leave'), [{ group: active, action: 'leave' }]);
});

test('"leave only" skips a group I already left', () => {
    assert.deepEqual(makePlan([alreadyLeft], 'leave'), [{ group: alreadyLeft, action: 'skip' }]);
});

test('an unknown mode throws', () => {
    assert.throws(() => makePlan([active], 'wrong'), /Unknown mode/);
});

test('the plan text lists each group with its action', () => {
    assert.equal(
        planText(makePlan([active, alreadyLeft], 'leave')),
        '  1. Family → leave\n  2. Old → already left, will be skipped',
    );
});

const step = (action) => ({ group: { id: action, name: action }, action });

test('an empty plan takes no time', () => {
    assert.equal(estimateDuration([]), 0);
});

test('skipped groups add no time', () => {
    assert.equal(estimateDuration([step('skip'), step('skip')]), 0);
});

test('action times and the average 6-second wait between them add up', () => {
    // leave-delete 5 s + wait 6 s + delete 1 s
    assert.equal(estimateDuration([step('leave-delete'), step('delete')]), 12000);
});

test('a 1-minute break is added after every 20 actions', () => {
    const plan = Array.from({ length: 21 }, () => step('delete'));
    // 21 deletes + 20 waits + 1 break
    assert.equal(estimateDuration(plan), 21 * 1000 + 20 * 6000 + 60000);
});

test('the duration text is rounded to minutes', () => {
    assert.equal(durationText(0), 'under 1 minute');
    assert.equal(durationText(45000), 'under 1 minute');
    assert.equal(durationText(90000), 'about 2 minutes');
    assert.equal(durationText(15 * 60000), 'about 15 minutes');
});
