import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitUntil, withTimeout } from '../src/core.js';

// Time is a system boundary; the fake wait() only records the delays.
function fakeWait() {
    const delays = [];
    return { delays, wait: async (ms) => delays.push(ms) };
}

test('waitUntil stops when the condition is true', async () => {
    const { delays, wait } = fakeWait();
    let left = 2;
    const ok = await waitUntil({ condition: async () => --left < 0, wait, interval: 500, timeout: 15000 });
    assert.equal(ok, true);
    assert.deepEqual(delays, [500, 500]);
});

test('waitUntil returns false when the time runs out', async () => {
    const { delays, wait } = fakeWait();
    const ok = await waitUntil({ condition: async () => false, wait, interval: 500, timeout: 2000 });
    assert.equal(ok, false);
    assert.equal(delays.length, 4);
});

test('withTimeout returns the result when the work finishes in time', async () => {
    assert.equal(await withTimeout(Promise.resolve('done'), 1000), 'done');
});

test('withTimeout returns undefined when the time runs out', async () => {
    assert.equal(await withTimeout(new Promise(() => {}), 20), undefined);
});

test('withTimeout swallows errors', async () => {
    assert.equal(await withTimeout(Promise.reject(new Error('x')), 1000), undefined);
});
