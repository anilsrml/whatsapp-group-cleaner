# WhatsApp Group Cleaner

Leave and delete many WhatsApp groups at once. Pick groups in a simple web page on your computer, confirm, and the app works through them for you.

![Group list with labels and selection](docs/screenshots/2-groups.png)

> [!WARNING]
> This app is **not affiliated with WhatsApp or Meta**. It controls WhatsApp Web automatically, and that is against [WhatsApp's Terms of Service](https://www.whatsapp.com/legal/terms-of-service). The risk is low but not zero: WhatsApp can restrict accounts that it sees as automated. The app waits between actions to lower this risk. Use it at your own risk, and only on your own account.

## Contents

- [What it does](#what-it-does)
- [Requirements](#requirements)
- [Install](#install)
- [Use it, step by step](#use-it-step-by-step)
- [How it works](#how-it-works)
- [Privacy and security](#privacy-and-security)
- [Terminal version](#terminal-version)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## What it does

- Shows all your groups with their photo, last message date, and labels.
- Lets you search by name and filter by label.
- For each group you select, it does one of two things:
  - **Leave and delete**: you leave the group, and the chat is removed from your list.
  - **Leave only**: you leave the group, and the chat history stays in your list.
- Shows the plan and an estimated time before anything happens.
- Shows live progress and a summary, for example `18 succeeded, 2 failed (Group A, Group B)`.

### Labels

| Label | Meaning |
|---|---|
| **Admin** | You are an admin. If you are the only admin, WhatsApp makes a random member the new admin when you leave. |
| **Community** | The group belongs to a WhatsApp Community. Leaving it also removes you from the entire community. The app asks you separately before it touches these groups. |
| **Archived** | The chat is archived. |
| **Left** | You already left this group. "Leave and delete" only deletes it. "Leave only" skips it. |

## Requirements

- **Node.js 20 or later**. Check with `node -v`.
- **Google Chrome or Chromium**. On Linux, the app uses `/usr/bin/google-chrome` if it exists. On other systems, it uses the Chrome that `npm install` downloads.
- **WhatsApp on your phone**, with internet access.
- macOS, Linux, or Windows.

## Install

```bash
git clone https://github.com/anilsrml/whatsapp-group-cleaner.git
cd whatsapp-group-cleaner
npm install
```

## Use it, step by step

The full process takes about 5 minutes, plus about 10 seconds for each group.

### 1. Start the app

```bash
npm run ui
```

Your browser opens the app. If it does not open, copy the address that the terminal shows (`http://127.0.0.1:4747/#...`) into your browser. Keep the terminal open while you use the app.

### 2. Link your phone

![Connect screen with QR code](docs/screenshots/1-connect.png)

1. Open WhatsApp on your phone.
2. Go to **Settings** → **Linked devices** → **Link a device**.
3. Scan the QR code on the screen.

WhatsApp then loads your chats. This takes 1–2 minutes.

### 3. Select groups

- Click a group to select it. Click it again to clear it.
- Type in **Search groups** to find groups by name.
- Click a label (**Admin**, **Community**, **Archived**, **Left**) to show only those groups.
- Click **Select all shown** to select every group that is on the screen.

When you are ready, click **Continue**.

### 4. Check the plan and confirm

![Confirmation dialog with plan and estimated time](docs/screenshots/3-confirm.png)

1. Choose **Leave and delete** or **Leave only**.
2. If you selected community groups, a yellow box appears. These groups are skipped unless you tick **Also process community groups**.
3. Check the list of actions and the estimated time.
4. Click **Yes, process N groups**. To stop here, click **Cancel**.

### 5. Wait for the result

![Progress screen with summary](docs/screenshots/4-done.png)

Keep the tab open. The app waits 4–8 seconds between groups, and takes a 1-minute break after every 20 groups. 100 groups take about 30 minutes.

If a group fails, the app skips it and continues. The summary lists the groups that failed. You can select them again and retry.

Click **Back to list** to process more groups.

### 6. Log out

Click **Log out** in the top-right corner. The app waits 10 seconds so the changes reach your phone. Then it removes the linked device from your phone and stops.

You can also press **Ctrl+C** in the terminal. This also removes the linked device.

To make sure, open **Linked devices** on your phone. The app's device ("Google Chrome") must not be in the list.

## How it works

```
┌──────────────┐   HTTP (127.0.0.1 only)   ┌──────────────┐  Puppeteer  ┌────────────────────┐
│ Your browser │ ────────────────────────▶ │ Local server │ ──────────▶ │ Hidden Chrome with │ ──▶ WhatsApp
│  (the app)   │ ◀──────────────────────── │  (Node.js)   │ ◀────────── │   WhatsApp Web     │
└──────────────┘    status every 0.7 s     └──────────────┘             └────────────────────┘
```

1. `npm run ui` starts a small web server on your computer. The server only accepts connections from your own computer (`127.0.0.1`).
2. The server starts a hidden Chrome window that opens WhatsApp Web. It uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) and Puppeteer.
3. When you scan the QR code, your phone links this hidden WhatsApp Web like any other linked device.
4. The app reads your groups directly from WhatsApp Web, one group at a time. If one group cannot be read, the others still load.
5. For **Leave and delete**, the app leaves the group, waits until WhatsApp confirms that you are no longer a member, and only then deletes the chat. If it deleted the chat at once, the "You left" message from WhatsApp would put the chat back in your list.
6. When you log out, the app logs out of WhatsApp Web. This removes the linked device from your phone. Then it closes Chrome.

### Project layout

| File | Purpose |
|---|---|
| `src/arayuz.js` | Starts the web UI: WhatsApp session, local server, opens the browser. |
| `src/sunucu.js` | Local HTTP server and API. |
| `src/oturum.js` | WhatsApp session for the web UI. |
| `src/whatsapp.js` | Reads groups, leaves, deletes, and loads photos in WhatsApp Web. |
| `src/cekirdek.js` | Core logic with no WhatsApp dependency: labels, plan, timing, summary. |
| `src/index.js`, `src/akis.js` | Terminal version. |
| `public/` | The web page (HTML, CSS, JavaScript). |
| `test/`, `e2e/` | Unit tests and browser tests. |

## Privacy and security

- **Nothing is sent to any other server.** The app talks only to WhatsApp, the same way WhatsApp Web does.
- **No session is saved.** The WhatsApp session is not stored. Chrome uses a temporary profile that is deleted when the app stops. You scan the QR code each time you start the app.
- **No message content is read or stored.** The app reads only group names, labels, dates, and photos.
- **Only your computer can use the app.** The server listens on `127.0.0.1`, and it rejects requests that use another host name.
- **Other websites cannot control the app.** Each start creates a new random key. The key is in the address after `#`, so the browser never sends it to any server. The app rejects every API request without this key. Because of this, another website that is open in your browser cannot start a job in the background.

## Terminal version

If you prefer the terminal:

```bash
npm run dry-run   # shows what would happen, changes nothing
npm start         # does the work
```

Use the arrow keys and **Space** to select groups, then **Enter**. Type `yes` to confirm.

## Troubleshooting

| Problem | Solution |
|---|---|
| `Port 4747 is in use` | Another copy of the app is running. Stop it, or use another port: `PORT=4848 npm run ui` |
| Chrome not found | Give the path to Chrome: `CHROME_PATH=/path/to/chrome npm run ui` |
| The browser does not open | Copy the address from the terminal into your browser. |
| Some groups have no photo | Those groups have no photo, or WhatsApp did not send it. The app shows the initials instead. |
| A group still shows on the phone | Wait a few seconds. Changes can take time to reach the phone. |
| "Google Chrome" is still in Linked devices | Remove it on your phone: **Linked devices** → tap the device → **Log out**. |

## Development

```bash
npm test      # unit tests
npm run e2e   # browser tests in a real, hidden Chrome
```

The tests use a fake WhatsApp session, so they do not need a phone. The code was built test-first.

## License

[MIT](LICENSE)
