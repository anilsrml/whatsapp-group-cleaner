// Local HTTP server for the browser UI.
// It accepts API requests only from 127.0.0.1 and only with the correct key.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ACTION_DESCRIPTIONS,
    durationText,
    estimateDuration,
    formatDate,
    labelList,
    makePlan,
    runPlan,
    summary,
} from './core.js';

const DEFAULT_PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
};
const MAX_BODY = 100_000;

class RequestError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
}

async function readBody(req) {
    let body = '';
    for await (const chunk of req) {
        body += chunk;
        if (body.length > MAX_BODY) throw new RequestError(413, 'request too large');
    }
    if (!body) return {};
    try {
        return JSON.parse(body);
    } catch {
        throw new RequestError(400, 'invalid JSON');
    }
}

export function createAppServer({ session, key, wait, random = Math.random, qrImage, publicDir = DEFAULT_PUBLIC_DIR }) {
    const status = { state: 'starting', qr: null, error: null, progress: null };
    let groups = [];
    let running = false;
    // WhatsApp Web keeps a deleted group in memory; groups deleted in this session are remembered.
    const deletedIds = new Set();
    // id → Promise<Buffer|null>; each photo is requested from WhatsApp only once.
    const photos = new Map();
    const refreshGroups = async () => {
        groups = (await session.groups()).filter((g) => !deletedIds.has(g.id));
    };

    session.on('qr', async (text) => {
        status.qr = await qrImage(text);
        status.state = 'qr';
    });
    session.on('authenticated', () => {
        status.state = 'loading';
        status.qr = null;
    });
    session.on('ready', () => {
        status.state = 'ready';
        status.qr = null;
    });
    session.on('disconnected', (reason) => {
        status.state = 'disconnected';
        status.error = `WhatsApp connection lost: ${reason}`;
    });

    const canList = () => status.state === 'ready' || status.state === 'done';

    async function preparePlan({ ids, mode, includeCommunities }) {
        if (!canList()) throw new RequestError(409, 'WhatsApp is not ready yet');
        if (groups.length === 0) await refreshGroups();
        if (mode !== 'leave-delete' && mode !== 'leave') throw new RequestError(400, 'invalid mode');
        if (!Array.isArray(ids)) throw new RequestError(400, 'ids must be a list');
        const idSet = new Set(ids);
        const selected = groups.filter((g) => idSet.has(g.id));
        const communities = selected.filter((g) => g.community && !g.left);
        const toProcess = includeCommunities ? selected : selected.filter((g) => !communities.includes(g));
        return { plan: makePlan(toProcess, mode), communities };
    }

    async function sendPhoto(res, id) {
        if (!canList() && status.state !== 'running') throw new RequestError(409, 'WhatsApp is not ready yet');
        if (!id) throw new RequestError(400, 'missing id');
        if (!photos.has(id)) {
            photos.set(
                id,
                session
                    .photo(id)
                    .then((base64) => (base64 ? Buffer.from(base64, 'base64') : null))
                    .catch(() => null),
            );
        }
        const data = await photos.get(id);
        if (!data) throw new RequestError(404, 'no photo');
        const isPng = data[0] === 0x89 && data[1] === 0x50;
        res.writeHead(200, {
            'content-type': isPng ? 'image/png' : 'image/jpeg',
            'cache-control': 'private, max-age=3600',
        });
        res.end(data);
    }

    async function handleApi(req, res, url) {
        const path = url.pathname;
        if (req.method === 'GET' && path === '/api/status') return sendJson(res, 200, status);
        if (req.method === 'GET' && path === '/api/photo') return sendPhoto(res, url.searchParams.get('id'));

        if (req.method === 'GET' && path === '/api/groups') {
            if (!canList()) throw new RequestError(409, 'WhatsApp is not ready yet');
            await refreshGroups();
            return sendJson(
                res,
                200,
                groups.map((g) => ({
                    id: g.id,
                    name: g.name,
                    date: g.lastMessageAt ? formatDate(g.lastMessageAt) : null,
                    labels: labelList(g),
                    left: g.left,
                    community: g.community,
                })),
            );
        }

        if (req.method === 'POST' && path === '/api/plan') {
            const { plan, communities } = await preparePlan(await readBody(req));
            return sendJson(res, 200, {
                steps: plan.map(({ group, action }) => ({
                    id: group.id,
                    name: group.name,
                    action,
                    description: ACTION_DESCRIPTIONS[action],
                })),
                communities: communities.map((g) => g.name),
                duration: durationText(estimateDuration(plan)),
            });
        }

        if (req.method === 'POST' && path === '/api/run') {
            // The lock is taken before the first await, so two requests at the same time cannot both pass.
            if (running) throw new RequestError(409, 'a job is already running');
            running = true;
            let plan;
            try {
                ({ plan } = await preparePlan(await readBody(req)));
            } catch (error) {
                running = false;
                throw error;
            }
            status.state = 'running';
            status.progress = { total: plan.length, results: [], summary: null };
            runPlan(plan, {
                getChat: (id) => session.getChat(id),
                wait,
                random,
                onResult: (result) => {
                    status.progress.results.push(result);
                    if (result.status === 'succeeded' && result.action !== 'leave') deletedIds.add(result.id);
                },
            })
                .then((results) => {
                    status.progress.summary = summary(results);
                })
                .catch((error) => {
                    status.error = `Job stopped: ${error.message}`;
                })
                .finally(() => {
                    running = false;
                    status.state = 'done';
                });
            return sendJson(res, 202, { total: plan.length });
        }

        if (req.method === 'POST' && path === '/api/logout') {
            await session.close();
            status.state = 'closed';
            return sendJson(res, 200, { ok: true });
        }

        throw new RequestError(404, 'not found');
    }

    async function sendFile(res, path) {
        const relative = normalize(path === '/' ? '/index.html' : path).replace(/^([/\\])+/, '');
        const fullPath = join(publicDir, relative);
        if (!fullPath.startsWith(publicDir)) throw new RequestError(404, 'not found');
        let content;
        try {
            content = await readFile(fullPath);
        } catch {
            throw new RequestError(404, 'not found');
        }
        res.writeHead(200, {
            'content-type': CONTENT_TYPES[extname(fullPath)] ?? 'application/octet-stream',
            'cache-control': 'no-store',
        });
        res.end(content);
    }

    const server = createServer(async (req, res) => {
        try {
            const port = server.address().port;
            // The Host header is checked to block DNS rebinding attacks.
            if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) {
                throw new RequestError(403, 'host not allowed');
            }
            const url = new URL(req.url, 'http://local');
            if (url.pathname.startsWith('/api/')) {
                if (req.headers['x-key'] !== key) throw new RequestError(403, 'invalid key');
                return await handleApi(req, res, url);
            }
            if (req.method !== 'GET') throw new RequestError(405, 'method not allowed');
            return await sendFile(res, url.pathname);
        } catch (error) {
            const statusCode = error instanceof RequestError ? error.statusCode : 500;
            if (!res.headersSent) sendJson(res, statusCode, { error: error.message });
        }
    });
    return server;
}
