<h1 align="center">nabilcode</h1>

<p align="center">A desktop harness for coding agents, wired into your <a href="https://github.com/latrael/cabinet">Cabinet</a> library.</p>

<p align="center">
  <img src="./docs/screenshots/board.png" width="100%" alt="nabilcode with a Claude thread as the main card, a Cabinet note and a Cabinet PDF beside it, the Cabinet file drawer in the sidebar, and the Memory Proposals dock along the bottom" />
</p>

nabilcode runs the coding agents already installed on your machine (Claude Code, Codex, and ACP agents such as Grok, Kiro, Antigravity, and fx) and puts each project on a board next to its notes, PDFs, and diffs. Cabinet, a separate local app, holds what your agents know about a project. nabilcode reads from it, writes to it, and gives agents Cabinet's MCP tools.

It is a hard fork of [T3 Code](https://github.com/pingdotgg/t3code), reduced to the desktop app and the local web client it runs on.

## What you get

- **A bento board per project.** Pick Focus, Split, Bento (8+4), or 2×2. Drag cards between slots and drag an edge to resize; widths snap to a 12-column grid. Each project keeps its own layout.
- **Thread cards.** The live chat is the main card. Open other threads beside it, then click **Focus** to swap one into the main card.
- **Notes, PDFs, and diffs as cards.** In the Files drawer, click a `.md` or `.pdf` from the repo or from Cabinet. Diff cards show a thread's full diff.
- **Cabinet notes that stay in sync.** `[[wikilinks]]` open the linked note. Ticking a checklist box saves it to Cabinet. Edits made in Cabinet appear in the open card.
- **Quote from PDFs.** Select text and choose **Cite to thread** to attach it to your next message, or **Save quote to Cabinet** to keep it.
- **`@` mentions for Cabinet.** Type `@` in the composer to mention a Cabinet note. The agent gets its id and fetches the full note with Cabinet's tools.
- **Agents that know your project.** **Ingest into Cabinet** links a repo to a Cabinet project and copies its README, AGENTS.md, CLAUDE.md, and `docs/` into Cabinet as notes. Agents then get Cabinet's MCP tools and a short project brief on their first turn.
- **Memory proposals.** When an agent wants Cabinet to remember something, it proposes it instead of writing it. Approve, edit, or reject proposals in the dock under the board. Badges show which threads and projects have proposals waiting.
- **Your subscriptions.** nabilcode drives the agents you are already signed in to. It does not resell tokens.

<p align="center">
  <img src="./docs/screenshots/cabinet-settings.png" width="80%" alt="Settings, Cabinet panel showing a connected Cabinet, agent tools active, the base URL, harness and agent tokens, MCP transport, and Test connection" />
</p>

## Run it

### 1. Install the toolchain

nabilcode uses [Vite+](https://viteplus.dev). Install its `vp` command, then install dependencies from the repository root:

```bash
curl -fsSL https://vite.plus | bash
```

```bash
vp i
```

If your shell can't find `vp` (nvm can reorder `PATH`), call it directly as `~/.local/share/vite-plus/bin/vp`.

You also need at least one agent installed and signed in, for example `claude auth login` for Claude Code or `codex login` for Codex.

### 2. Start the app

To run the server and the web app:

```bash
vp run dev
```

Open the **pairing URL** the dev runner prints. The bare address alone won't sign a new browser in.

To run the desktop app instead:

```bash
vp run dev:desktop
```

If another process already uses the default ports (5733 and 13773), shift them:

```bash
T3CODE_PORT_OFFSET=100 vp run dev
```

Dev state lives in `~/.t3/dev`, separate from any installed copy.

### 3. Connect Cabinet

Start Cabinet from its own repository. Use a sandbox library while you try things out:

```bash
pnpm cabinet init ~/Cabinet-Sandbox --sample
```

```bash
pnpm cabinet start --library ~/Cabinet-Sandbox
```

In Cabinet, under **Settings → Agents**, create two tokens:

- a **harness token** with **Can review memory proposals** turned on. nabilcode uses it for reading, writing, and reviewing proposals. Agents never receive it.
- a plain **agent token**. Agents use it for Cabinet's MCP tools.

Then in nabilcode, go to **Settings → Cabinet**. Turn Cabinet on, set the base URL (use `http://127.0.0.1:4747` rather than `localhost`), and paste both tokens. The status should read **Connected**, and **Agent tools** should read **Active**.

### 4. Try it

1. In the sidebar, hover a project and choose **Ingest into Cabinet**.
2. Start a thread and ask the agent to check Cabinet before it works.
3. Switch the Files drawer to **Cabinet**, then open notes and PDFs as cards.
4. Review anything the agent proposes in the **Memory Proposals** dock.

To watch a turn without paying for a model, pick the free **Replay (dev)** provider in the model picker. It replays recorded turns through the real pipeline.

## Checks

```bash
vp run check:changed
```

This runs format, lint, knip, typecheck, and the tests next to your changes. For a single file, run `vp test run <file>`. Browser tests need Playwright's Chromium once:

```bash
cd apps/web && vp exec playwright install chromium
```

## License

[MIT](./LICENSE). nabilcode is based on T3 Code by T3 Tools.
