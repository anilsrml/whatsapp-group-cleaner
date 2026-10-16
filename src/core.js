// Pure logic with no dependency on the WhatsApp connection.

// `raw`: group data that src/whatsapp.js reads from the WhatsApp Web page.
export function toGroup(raw) {
    return {
        id: raw.id,
        name: raw.name || '(unnamed group)',
        lastMessageAt: raw.t ? new Date(raw.t * 1000) : null,
        admin: Boolean(raw.admin),
        community: Boolean(raw.community),
        archived: Boolean(raw.archived),
        // Unknown membership (null) does not count as left; otherwise "leave only" would skip the group.
        left: raw.member === false,
    };
}

// Entries without a name (deleted or not yet loaded groups in WhatsApp Web's memory)
// and groups known to be deleted in this session are not listed.
export function listGroups(raws, deletedIds = new Set()) {
    return raws
        .filter((r) => r.name?.trim() && !deletedIds.has(r.id))
        .sort((a, b) => b.t - a.t)
        .map((r) => toGroup(r));
}

// Example: "3 Oct 2026". The month name avoids day/month confusion between countries.
export function formatDate(date) {
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const LABELS = [
    ['admin', 'ADMIN'],
    ['community', 'COMMUNITY'],
    ['archived', 'ARCHIVED'],
    ['left', 'LEFT'],
];

export function labelList(group) {
    return LABELS.filter(([field]) => group[field]).map(([, label]) => label);
}

export function labelText(group) {
    return labelList(group)
        .map((label) => `[${label}]`)
        .join(' ');
}

export function rowText(group) {
    const date = group.lastMessageAt ? formatDate(group.lastMessageAt) : '-';
    const labels = labelText(group);
    return `${group.name}${labels ? ` ${labels}` : ''} · ${date}`;
}

// Lower-cased with Turkish rules (İ → i), then ı → i, so "IT" is also found with "it".
export function searchKey(text) {
    return text.toLocaleLowerCase('tr').replace(/ı/g, 'i');
}

export function filterGroups(groups, text) {
    const query = searchKey(text.trim());
    if (!query) return groups;
    return groups.filter((g) => searchKey(g.name).includes(query));
}

export function makePlan(selected, mode) {
    if (mode !== 'leave-delete' && mode !== 'leave') throw new Error(`Unknown mode: ${mode}`);
    return selected.map((group) => {
        if (!group.left) return { group, action: mode };
        return { group, action: mode === 'leave-delete' ? 'delete' : 'skip' };
    });
}

export const ACTION_DESCRIPTIONS = {
    'leave-delete': 'leave and delete',
    leave: 'leave',
    delete: 'delete (already left)',
    skip: 'already left, will be skipped',
};

export function planText(plan) {
    return plan
        .map(({ group, action }, i) => `  ${i + 1}. ${group.name} → ${ACTION_DESCRIPTIONS[action]}`)
        .join('\n');
}

const BREAK_EVERY = 20;

// `index`: zero-based position of the action that just finished.
export function delayAfter(index, random = Math.random) {
    const base = 4000 + Math.floor(random() * 4000);
    return (index + 1) % BREAK_EVERY === 0 ? base + 60000 : base;
}

async function perform(chat, action) {
    if (action === 'leave' || action === 'leave-delete') await chat.leave();
    if (action === 'delete' || action === 'leave-delete') await chat.delete();
}

export async function runPlan(plan, { getChat, wait, random = Math.random, log = () => {}, onResult = () => {} }) {
    const results = [];
    const record = (result) => {
        results.push(result);
        onResult(result);
    };
    const toDo = plan.filter((s) => s.action !== 'skip').length;
    let done = 0;
    for (const { group, action } of plan) {
        const result = { id: group.id, name: group.name, action };
        if (action === 'skip') {
            record({ ...result, status: 'skipped' });
            continue;
        }
        try {
            const chat = await getChat(group.id);
            if (!chat) throw new Error('chat not found');
            await perform(chat, action);
            record({ ...result, status: 'succeeded' });
            log(`✓ ${group.name}`);
        } catch (error) {
            record({ ...result, status: 'failed', error: error.message });
            log(`✗ ${group.name}: ${error.message}`);
        }
        if (done < toDo - 1) await wait(delayAfter(done, random));
        done++;
    }
    return results;
}

export function summary(results) {
    const withStatus = (status) => results.filter((r) => r.status === status);
    const failed = withStatus('failed');
    const parts = [`${withStatus('succeeded').length} succeeded`];
    parts.push(failed.length ? `${failed.length} failed (${failed.map((r) => r.name).join(', ')})` : '0 failed');
    const skipped = withStatus('skipped').length;
    if (skipped) parts.push(`${skipped} skipped`);
    return parts.join(', ');
}

// Checks the condition every `interval` ms. Returns false when `timeout` runs out.
export async function waitUntil({ condition, wait, interval = 500, timeout = 15000 }) {
    for (let elapsed = 0; elapsed < timeout; elapsed += interval) {
        if (await condition()) return true;
        await wait(interval);
    }
    return false;
}

// Average values, including the leave confirmation and the "You left" wait.
const ACTION_DURATIONS = { 'leave-delete': 5000, leave: 4000, delete: 1000 };
const AVERAGE_DELAY = 6000;

export function estimateDuration(plan) {
    const actions = plan.filter((s) => s.action !== 'skip');
    if (actions.length === 0) return 0;
    const actionTime = actions.reduce((total, s) => total + ACTION_DURATIONS[s.action], 0);
    const delays = actions.length - 1;
    const breaks = Math.floor(delays / BREAK_EVERY);
    return actionTime + delays * AVERAGE_DELAY + breaks * 60000;
}

export function durationText(ms) {
    if (ms < 60000) return 'under 1 minute';
    return `about ${Math.round(ms / 60000)} minutes`;
}

// Returns undefined if the work does not finish within `ms` or throws; keeps shutdown from hanging.
export function withTimeout(work, ms) {
    let timer;
    const timeout = new Promise((resolve) => {
        timer = setTimeout(resolve, ms);
    });
    return Promise.race([Promise.resolve(work).catch(() => undefined), timeout]).finally(() => clearTimeout(timer));
}
