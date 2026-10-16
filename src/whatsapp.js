import { waitUntil } from './core.js';

// The layer that talks to the WhatsApp Web page (system boundary).
// The library's getChats() and getChatById() convert every chat to a model and crash
// with an "r" error on the current WhatsApp Web version. So groups are read straight
// from the page, one at a time, and one bad group does not stop the others.

export async function readGroups(client) {
    return client.pupPage.evaluate(async () => {
        const collections = window.require('WAWebCollections');
        const metadata = collections.GroupMetadata || collections.WAWebGroupMetadataCollection;
        const attempt = (fn) => {
            try {
                return fn();
            } catch {
                return null;
            }
        };
        const groups = [];
        for (const chat of collections.Chat.getModelsArray()) {
            const gm = chat.groupMetadata;
            if (!gm) continue;
            try {
                await metadata.update(chat.id);
            } catch {
                // If fresh data is not available, the cached data is used.
            }
            const participants = gm.participants;
            groups.push({
                id: chat.id._serialized,
                name: chat.formattedTitle || chat.name || gm.subject || '',
                t: typeof chat.t === 'number' ? chat.t : 0,
                archived: Boolean(chat.archive),
                member: attempt(() => participants.iAmMember()),
                admin: Boolean(attempt(() => participants.iAmAdmin() || participants.iAmSuperAdmin())),
                community: Boolean(gm.parentGroup || gm.isParentGroup),
            });
        }
        return groups;
    });
}

function isMember(client, id) {
    return client.pupPage.evaluate((chatId) => {
        const chat = window.require('WAWebCollections').Chat.get(chatId);
        try {
            return chat?.groupMetadata?.participants?.iAmMember() ?? false;
        } catch {
            return false;
        }
    }, id);
}

// If the chat is deleted right after leaving, the "You left" message that follows puts the
// group back in the list. So the chat is deleted only after the leave is confirmed.
// A deleted group stays in WhatsApp Web's memory for a while, so there is no check after delete.
export function chatActions(client, id, wait) {
    return {
        leave: async () => {
            await client.pupPage.evaluate(async (chatId) => {
                const chat = await window.WWebJS.getChat(chatId, { getAsModel: false });
                if (!chat) throw new Error('chat not found');
                await window.require('WAWebExitGroupAction').sendExitGroup(chat);
            }, id);
            const left = await waitUntil({ condition: async () => !(await isMember(client, id)), wait });
            if (!left) throw new Error('could not confirm leaving the group');
            // Give the "You left" message a moment to arrive.
            await wait(2000);
        },
        delete: () => client.pupPage.evaluate((chatId) => window.WWebJS.sendDeleteChat(chatId), id),
    };
}

// Returns the group photo as base64, or undefined if there is none.
// First it checks WhatsApp Web's cache of small photos. The hidden browser never opens a
// chat, so this cache is often empty; then the photo address is requested from the server.
// The library's getProfilePicUrl() is not used because it goes through the broken getChatModel path.
export async function readPhoto(client, id) {
    const found = await client.pupPage.evaluate(async (chatId) => {
        const wid = window.require('WAWebWidFactory').createWid(chatId);
        try {
            const thumb = await window.WWebJS.getProfilePicThumbToBase64(wid);
            if (thumb) return { base64: thumb };
        } catch {
            // Not in the cache; ask the server.
        }
        const bridge = window.require('WAWebContactProfilePicThumbBridge');
        const chat = await window.WWebJS.getChat(chatId, { getAsModel: false }).catch(() => null);
        for (const arg of [chat, wid]) {
            if (!arg) continue;
            try {
                const photo = await bridge.requestProfilePicFromServer(arg);
                if (photo?.eurl) return { url: photo.eurl };
                if (photo) return {};
            } catch (error) {
                // ServerStatusCodeError: the group has no photo.
                if (error?.name === 'ServerStatusCodeError') return {};
            }
        }
        return {};
    }, id);
    if (found.base64) return found.base64;
    if (!found.url) return undefined;
    // The CDN address is downloaded here instead of in the browser, so CORS does not block it.
    const res = await fetch(found.url);
    if (!res.ok) return undefined;
    return Buffer.from(await res.arrayBuffer()).toString('base64');
}
