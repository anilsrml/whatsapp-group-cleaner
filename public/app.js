// UI: asks the server for its status about every second and shows the matching screen.
// Group names are written only with textContent, so HTML in a name can never run on the page.

const key = location.hash.slice(1);
const $ = (id) => document.getElementById(id);

const screens = ['connect', 'loading', 'list', 'progress', 'end'];
const screenForState = {
    starting: 'connect',
    qr: 'connect',
    loading: 'loading',
    ready: 'list',
    running: 'progress',
    done: 'progress',
    disconnected: 'end',
    closed: 'end',
};
const LABEL_NAMES = {
    ADMIN: ['Admin', 'label-admin'],
    COMMUNITY: ['Community', 'label-community'],
    ARCHIVED: ['Archived', 'label-archived'],
    LEFT: ['Left', 'label-left'],
};
const AVATAR_COLORS = ['#00a884', '#027eb5', '#7f66ff', '#e26ab6', '#fa6533', '#53bdeb', '#ffbc38', '#25d366'];

let groups = [];
const selected = new Set();
let labelFilter = '';
let lastState = null;
let shownScreen = null;
let loadingList = false;
let stopped = false;
// If the user clicked "Back to list" after a job, stay on the list while the state is "done".
let backToList = false;

async function api(path, body) {
    const res = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: { 'x-key': key, ...(body && { 'content-type': 'application/json' }) },
        body: body && JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
    return data;
}

function showScreen(name) {
    if (shownScreen === name) return;
    shownScreen = name;
    for (const s of screens) $(`screen-${s}`).hidden = s !== name;
}

function showEnd(title, text) {
    $('end-title').textContent = title;
    $('end-text').textContent = text;
    showScreen('end');
}

// ---------- Group list ----------

// Same rule as searchKey() in src/core.js.
const searchKey = (text) => text.toLocaleLowerCase('tr').replace(/ı/g, 'i');
const groupCount = (n) => `${n} ${n === 1 ? 'group' : 'groups'}`;

function visibleGroups() {
    const query = searchKey($('search').value.trim());
    return groups.filter(
        (g) => (!query || searchKey(g.name).includes(query)) && (!labelFilter || g.labels.includes(labelFilter)),
    );
}

function initials(name) {
    const letters = [...name.replace(/[^\p{L}\p{N}\s]/gu, '').trim()]
        .filter((_, i, all) => i === 0 || all[i - 1] === ' ')
        .slice(0, 2)
        .join('');
    return letters.toLocaleUpperCase() || '#';
}

function avatarColor(name) {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// ---------- Photos ----------
// Photos load only for rows on the screen, and at most 3 at a time.
const photoUrls = new Map(); // id → object URL, or null (no photo)
const photoQueue = [];
let photosLoading = 0;
const MAX_PARALLEL_PHOTOS = 3;

function showPhoto(avatar, url) {
    const img = el('img', 'avatar-photo');
    img.alt = '';
    img.src = url;
    avatar.replaceChildren(img);
}

function processPhotoQueue() {
    while (photosLoading < MAX_PARALLEL_PHOTOS && photoQueue.length) {
        const { id, avatar } = photoQueue.shift();
        if (photoUrls.has(id)) {
            if (photoUrls.get(id)) showPhoto(avatar, photoUrls.get(id));
            continue;
        }
        photosLoading++;
        fetch(`/api/photo?id=${encodeURIComponent(id)}`, { headers: { 'x-key': key } })
            .then((res) => (res.ok ? res.blob() : null))
            .catch(() => null)
            .then((blob) => {
                const url = blob ? URL.createObjectURL(blob) : null;
                photoUrls.set(id, url);
                if (url && avatar.isConnected) showPhoto(avatar, url);
            })
            .finally(() => {
                photosLoading--;
                processPhotoQueue();
            });
    }
}

const photoObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        photoObserver.unobserve(entry.target);
        const id = entry.target.closest('.group').dataset.id;
        if (photoUrls.get(id)) showPhoto(entry.target, photoUrls.get(id));
        else if (!photoUrls.has(id)) photoQueue.push({ id, avatar: entry.target });
    }
    processPhotoQueue();
});

function groupRow(g) {
    const row = el('li', 'group');
    row.setAttribute('role', 'checkbox');
    row.setAttribute('aria-checked', String(selected.has(g.id)));
    row.tabIndex = 0;
    row.dataset.id = g.id;

    const check = el('span', 'check');
    check.setAttribute('aria-hidden', 'true');
    const avatar = el('span', 'avatar', initials(g.name));
    avatar.style.background = avatarColor(g.name);
    avatar.setAttribute('aria-hidden', 'true');

    const body = el('div', 'group-body');
    const line = el('div', 'group-line');
    line.append(el('span', 'group-name', g.name), el('span', 'group-date', g.date ?? ''));
    const labels = el('div', 'labels');
    for (const label of g.labels) {
        const [text, className] = LABEL_NAMES[label];
        labels.append(el('span', `label ${className}`, text));
    }
    body.append(line, labels);
    row.append(check, avatar, body);
    if (photoUrls.get(g.id)) showPhoto(avatar, photoUrls.get(g.id));
    else if (!photoUrls.has(g.id)) photoObserver.observe(avatar);
    return row;
}

function renderList() {
    const visible = visibleGroups();
    $('groups').replaceChildren(...visible.map(groupRow));
    $('empty').hidden = visible.length > 0;
    $('group-count').textContent = groupCount(groups.length);
    updateSelectionBar();
}

function updateSelectionBar() {
    $('selection-bar').hidden = selected.size === 0;
    $('selection-count').textContent = `${groupCount(selected.size)} selected`;
}

function toggle(row) {
    const id = row.dataset.id;
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    row.setAttribute('aria-checked', String(selected.has(id)));
    updateSelectionBar();
}

async function loadGroups() {
    if (loadingList) return;
    loadingList = true;
    try {
        groups = await api('/api/groups');
        const existing = new Set(groups.map((g) => g.id));
        for (const id of selected) if (!existing.has(id)) selected.delete(id);
        renderList();
    } catch (error) {
        showEnd('Could not read groups', error.message);
    } finally {
        loadingList = false;
    }
}

$('groups').addEventListener('click', (event) => {
    const row = event.target.closest('.group');
    if (row) toggle(row);
});

$('groups').addEventListener('keydown', (event) => {
    const row = event.target.closest('.group');
    if (!row) return;
    if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        toggle(row);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        (event.key === 'ArrowDown' ? row.nextElementSibling : row.previousElementSibling)?.focus();
    }
});

$('search').addEventListener('input', renderList);

for (const chip of document.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
        labelFilter = chip.dataset.filter;
        for (const c of document.querySelectorAll('.chip')) c.setAttribute('aria-pressed', String(c === chip));
        renderList();
    });
}

$('select-all').addEventListener('click', () => {
    for (const g of visibleGroups()) selected.add(g.id);
    renderList();
});

$('clear-selection').addEventListener('click', () => {
    selected.clear();
    renderList();
});

// ---------- Confirm dialog ----------

const dialog = $('confirm');
let planRequest = 0;

function choices() {
    return {
        ids: [...selected],
        mode: dialog.querySelector('input[name="mode"]:checked').value,
        includeCommunities: $('include-communities').checked,
    };
}

async function refreshPlan() {
    const request = ++planRequest;
    $('confirm-button').disabled = true;
    try {
        const plan = await api('/api/plan', choices());
        if (request !== planRequest) return;
        $('community-warning').hidden = plan.communities.length === 0;
        $('community-text').textContent =
            `These groups belong to a community: ${plan.communities.join(', ')}. ` +
            'Leaving them also removes you from the entire community and all its groups.';
        $('plan').replaceChildren(...plan.steps.map((s) => el('li', '', `${s.name} → ${s.description}`)));
        $('plan-count').textContent = groupCount(plan.steps.length);
        $('plan-duration').textContent = `Estimated time: ${plan.duration}`;
        $('confirm-button').textContent = `Yes, process ${groupCount(plan.steps.length)}`;
        $('confirm-button').disabled = plan.steps.length === 0;
    } catch (error) {
        $('plan').replaceChildren(el('li', '', `Could not prepare the plan: ${error.message}`));
    }
}

$('continue').addEventListener('click', () => {
    $('include-communities').checked = false;
    dialog.querySelector('input[value="leave-delete"]').checked = true;
    $('confirm-button').textContent = 'Preparing...';
    dialog.showModal();
    refreshPlan();
});

dialog.addEventListener('change', refreshPlan);

$('confirm-button').addEventListener('click', async () => {
    $('confirm-button').disabled = true;
    try {
        await api('/api/run', choices());
        backToList = false;
        dialog.close();
        selected.clear();
        $('results').replaceChildren();
        $('summary-box').hidden = true;
        await pollStatus();
    } catch (error) {
        $('plan').replaceChildren(el('li', '', `Could not start: ${error.message}`));
        $('confirm-button').disabled = false;
    }
});

// ---------- Progress ----------

function renderProgress({ progress, state, error }) {
    if (!progress) return;
    const { total, results, summary } = progress;
    const list = $('results');
    for (const r of results.slice(list.children.length)) {
        const item = el('li', `result-${r.status}`, r.name);
        if (r.error) item.append(el('small', '', r.error));
        list.append(item);
        item.scrollIntoView({ block: 'nearest' });
    }
    const ratio = total ? results.length / total : 1;
    $('bar-fill').style.width = `${Math.round(ratio * 100)}%`;
    $('bar').setAttribute('aria-valuemax', String(total));
    $('bar').setAttribute('aria-valuenow', String(results.length));
    $('progress-count').textContent = `${results.length} / ${total}`;

    const done = state === 'done';
    $('progress-title').textContent = done ? 'Done' : 'Processing groups';
    $('progress-note').hidden = done;
    $('summary-box').hidden = !done;
    $('summary').textContent = error ?? summary ?? '';
}

$('back-to-list').addEventListener('click', async () => {
    backToList = true;
    showScreen('list');
    await loadGroups();
});

// ---------- Session ----------

$('logout').addEventListener('click', async () => {
    $('logout').disabled = true;
    stopped = true;
    showEnd('Logging out', 'Waiting for changes to sync to your phone...');
    try {
        await api('/api/logout', {});
        $('logout').hidden = true;
        showEnd('Logged out', 'The linked device was removed. You can close this tab.');
    } catch (error) {
        showEnd('Could not log out', error.message);
    }
});

// ---------- Status loop ----------

async function pollStatus() {
    let status;
    try {
        status = await api('/api/status');
    } catch {
        if (!stopped) showEnd('Cannot reach the app', 'Make sure it is still running in your terminal.');
        return;
    }
    if (stopped) return;

    const previous = lastState;
    lastState = status.state;
    $('logout').hidden = !['ready', 'done', 'running', 'loading'].includes(status.state);

    if (status.state === 'qr' || status.state === 'starting') {
        $('qr').hidden = !status.qr;
        $('qr-wait').hidden = Boolean(status.qr);
        if (status.qr && $('qr').src !== status.qr) $('qr').src = status.qr;
    }
    if (status.state === 'disconnected') showEnd('Connection lost', status.error ?? '');
    if (status.state === 'closed') {
        showEnd('Logged out', 'You can close this tab.');
        stopped = true;
        return;
    }

    if (status.state === 'ready' && previous !== 'ready') {
        showScreen('list');
        await loadGroups();
        return;
    }
    if (status.state === 'done' && backToList) return;
    if (screenForState[status.state] !== 'end') showScreen(screenForState[status.state]);
    if (status.state === 'running' || status.state === 'done') renderProgress(status);
}

async function loop() {
    await pollStatus();
    if (!stopped) setTimeout(loop, 700);
}

if (!key) {
    showEnd('Missing key', 'Open this page with the address shown in your terminal.');
} else {
    showScreen('connect');
    loop();
}
