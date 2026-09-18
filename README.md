# 3D Director Desk

[中文](README.zh-CN.md) | English

An embeddable React 3D director desk — an **AI-agent-controllable scene editor** for placing game models, mounting actions, composing camera shots and moves, lighting scenes, and exporting stills and MP4 video. Every write operation is a serializable command through one dispatcher, so UI clicks, host-app messages, and **LLM agents** share the same verbs — a local HTTP + WebSocket bridge (`scripts/bridge.mjs`) exposes them to any agent or script, no SDK required.

![Director Desk demo](docs/media/director-desk-demo.gif)

▶ [Full-quality demo video (MP4, 10s)](docs/media/director-desk-demo.mp4)

**Live demo (GitHub Pages):** https://amwyygyuge.github.io/3d-director-desk/
The hosted page is standalone (no bridge). It persists your scene in `localStorage`; open the project menu to import/export documents.

**Importable example:** [`examples/cinematic-scene.json`](examples/cinematic-scene.json) — the demo scene above (14 entities: two humanoids, scenery, five lights; one shot, custom lighting, 10s timeline). Download it, then in the live demo use the project menu → **导入工程…** and pick the file. Documents are version-gated: the desk accepts only documents matching its current `DESK_DOCUMENT_VERSION` and rejects the rest with a structured error.

## UI at a glance

| Camera viewfinder (lens optics, rule-of-thirds grid) | Timeline (multi-track keyframes, walk/action/camera segments) |
| --- | --- |
| ![Camera viewfinder](docs/media/screenshot-viewfinder.webp) | ![Timeline](docs/media/screenshot-timeline.webp) |
| Asset catalog (built-in actors/scenery + local import) | Overview (resource outline, studio lighting, gizmo layout) |
| ![Asset catalog](docs/media/screenshot-assets.webp) | ![Overview](docs/media/screenshot-overview.webp) |

## Features

- **Scene layout** — built-in asset catalog (rigged humanoid + basic scenery), local model import (GLB/GLTF/FBX/OBJ), gizmo transform with surface snapping, drag-to-place with walk-target drafting.
- **Actors and actions** — 28-clip action library mounted per actor, pose presets, appearance/build customization, loop modes and scheduled timeline segments.
- **Cameras and motion** — shot management with lens optics (aperture, focus distance), keyframed camera moves, viewpoint drop-to-surface.
- **Timeline** — multi-track keyframes, walk tracks, loop playback, markers, playback ranges.
- **Lighting** — studio presets (with solid-floor toggle) or fully custom light entities.
- **Output** — still-frame capture and MP4 video export (WebCodecs), with async artifact reconciliation by idempotency key.
- **Project documents** — JSON export/import with a strict version gate, reference validation, and undoable atomic replace; full undo/redo history for every command.

## AI integration: the local bridge

The desk never lets an agent poke its internals. Every state change is a `DirectorCommand` dispatched through the `CommandDispatcher`, and the **Director Bridge** (`scripts/bridge.mjs`) is simply an HTTP + WebSocket egress for that command layer — the capability list the dispatcher enforces is the tool list an agent sees.

### Run it

```sh
bun install
bun run dev        # playground on :4002, bridge auto-starts on :4005
```

Open http://127.0.0.1:4002 — the page connects to the bridge automatically (the dev server pins IPv4 loopback, matching the bridge). To run the bridge standalone (e.g. against the hosted Pages demo), use `bun run bridge` and open the page with an explicit bridge URL: `?bridge=ws://127.0.0.1:4005`.

Headless agents without browser tooling: keep a throwaway headless Chrome resident on the page — it auto-connects, and `GET /status` shows it as a client:
`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --remote-debugging-port=0 --user-data-dir=$(mktemp -d) http://127.0.0.1:4002/`

### MCP clients (recommended)

MCP-aware clients (Claude Code, Cursor, Codex) get the desk as a native tool surface via `scripts/mcp-server.mjs` — a thin adapter that asks the connected page for its capability-derived tool schemas, so tools never drift from validation. A repo-root `.mcp.json` template is included:

```json
{
    "mcpServers": {
        "3d-director-desk": { "command": "bun", "args": ["run", "mcp"] }
    }
}
```

Behavior: command types map to tool names with dots as underscores (`assets.place` → `assets_place`); when no page is connected, only the meta tools `desk_status` / `desk_refresh_tools` are exposed — connect the page, refresh, and the full verb set arrives with a `list_changed` notification. Measured context cost of the full surface: ~54KB of schema for ~128 tools (single load, not per-turn).

### Endpoints (`http://127.0.0.1:4005`)

| Endpoint        | Purpose                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `GET /status`   | Connected display clients (`clientId`, user agent, viewport, readyState) and feature flags.       |
| `GET /skill`    | The full AI operation manual ([`skills/director-desk/SKILL.md`](skills/director-desk/SKILL.md)) over HTTP — agents read this first; no local file access needed. |
| `POST /rpc`     | `dispatch` a write command (broadcast to all clients, or `targetClientId` for unicast) / `query` for structured reads. |
| `POST /save-file` | Persist browser capture artifacts (base64) into `bridge-output/` — filename-only, traversal rejected. |

### Minimal call

```bash
curl http://127.0.0.1:4005/status

curl -X POST http://127.0.0.1:4005/rpc \
    -H 'Content-Type: application/json' \
    -d '{"method":"dispatch","action":{"type":"transport.play","payload":{}}}'
```

```ts
async function deskRpc(method: string, action: unknown) {
    const res = await fetch("http://127.0.0.1:4005/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, action }),
    });
    return res.json();
}

await deskRpc("dispatch", { type: "assets.place", payload: { id: "hero", assetId: "builtin.humanoid-generic" } });
```

Command payloads are plain serializable data and are validated at the command boundary (finite ranges on coordinates/FOV/etc.) — malformed agent output gets a structured failure with actionable options, never a raw runtime exception. Discover the current verbs at runtime via `GET /skill`, or in the page console: `window.__directorDesk.dispatcher.listCapabilities()`.

### Copy-paste bootstrap prompt

Fastest way to watch an agent block out a scene: paste one of these into a shell-capable AI client (Codex CLI, Claude Code).

**A. Raw RPC — zero setup:**

```text
Clone https://github.com/amwyygyuge/3d-director-desk into a temp dir and get it running, then block out a scene for me — I want to watch live.

1. git clone, then bun install (bun >=1.3.14).
2. Follow README "AI integration": bun run dev starts the playground on 127.0.0.1:4002 and the bridge on 127.0.0.1:4005.
3. Open a VISIBLE Chrome window on the page (throwaway profile, do not touch my existing browser, never --headless):
   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
     --user-data-dir=$(mktemp -d) --no-first-run --new-window http://127.0.0.1:4002/ &
   (adapt the Chrome path on Windows/Linux). Confirm a client is online: curl http://127.0.0.1:4005/status
4. curl http://127.0.0.1:4005/skill and follow that manual; writes go through POST /rpc (dispatch), reads via query; inspect current scene state first.
5. Task: place a humanoid actor (explicit id=hero), one scenery prop, one light, and compose one basic shot.
6. Report clientId, entity list, shot list. Do NOT stop the servers or close the window — I will keep tweaking manually.

On any failure, re-read the repo docs before asking me.
```

**B. MCP — one-time client config, then native tools.** Register the server once (Codex: `~/.codex/config.toml`; Claude Code reads the repo-root `.mcp.json` automatically):

```toml
[mcp_servers.3d-director-desk]
command = "bun"
args = ["run", "mcp"]
cwd = "/path/to/3d-director-desk"
```

```text
Use the 3d-director-desk MCP tools to block out a scene — I want to watch live:
1. In /path/to/3d-director-desk, run bun run dev in the background (playground :4002 + bridge :4005).
2. Open a VISIBLE Chrome window at http://127.0.0.1:4002 (throwaway profile, never --headless, do not touch my existing browser).
3. Call desk_status to confirm the page is online, then desk_refresh_tools to load the full tool surface.
4. Fetch http://127.0.0.1:4005/skill and follow the manual, then: place a humanoid actor (id=hero), one scenery prop, one light, and compose one shot.
5. Report the entity and shot lists; leave the servers and the window running — I will keep tweaking manually.
```

### Security model

**The bridge has no authentication.** This is safe only because it binds `127.0.0.1` and rejects browser origins outside its allowlist. `--host=0.0.0.0` exposes full control of your desk to the LAN — do it only on trusted networks, and put an authenticated TLS reverse proxy in front for anything public. Never enable `--allow-eval` outside local debugging.

### Which surface for which agent

One command layer (`CommandDispatcher` + capability contracts) is the single source of truth; every adapter below is thin and drift-free:

| Surface | Audience |
| --- | --- |
| MCP server (`bun run mcp`) | External AI clients — Claude Code, Cursor, Codex |
| Raw bridge RPC (`POST /rpc`) | Scripts, CI, custom automation |
| `AgentBridge` (in-process) | Host apps embedding the desk and driving their own LLM |
| `skills/director-desk/SKILL.md` | The operation manual every surface shares (served at `GET /skill`) |

## Embedding as a package

> The npm package is published to a private registry. If `bun add @dm/3d-director-desk` does not resolve for you, clone this repo and use the playground instead — the package surface below is the contract for hosts inside the registry.

### Requirements

- Node.js `^20.19.0 || >=22.12.0` (required by the Vite/Storybook toolchain).
- Bun `>=1.3.14` and the package peers listed below.
- A sized parent element: `DirectorDesk` fills its container.

| Peer                                   | Supported range |
| -------------------------------------- | --------------- |
| `react`, `react-dom`                   | `^18.2.0`       |
| `three`                                | `>=0.184.0`     |
| `@react-three/fiber`                   | `^8.18.0`       |
| `@react-three/drei`                    | `^9.122.0`      |
| `mobx`                                 | `^7.0.0`        |
| `mobx-react-lite`                      | `^5.0.0`        |
| `@mui/material`, `@mui/icons-material` | `^9.3.1`        |
| `@emotion/react`, `@emotion/styled`    | `^11.14.0`      |

### Install and render

```sh
bun add @dm/3d-director-desk
```

Import the package stylesheet from its only supported subpath, then render the desk inside a container with a real height.

```tsx
import "@dm/3d-director-desk/style.css";
import { DirectorDesk } from "@dm/3d-director-desk";

export function DirectorNode(): JSX.Element {
    return (
        <div style={{ height: "720px" }}>
            <DirectorDesk />
        </div>
    );
}
```

`DirectorDesk` accepts `theme`, `onReady`, and one host integration mechanism:

- `host?: HostAdapter` injects an in-process adapter for a directly embedded host.
- `hostBridge?: HostBridgeConfiguration` configures a trusted `postMessage` bridge for an iframe integration.
- With neither prop, the desk uses an inert adapter: it does not install a message listener or post to a wildcard origin.

### Host toolbar extensions

`presentation` is fixed when `DirectorDesk` is created. Use `rightmostExtensions` for host window controls: its actions render after every built-in control, including the project menu. The final extension is therefore the toolbar's rightmost action.

```tsx
import CloseIcon from "@mui/icons-material/Close";
import RemoveIcon from "@mui/icons-material/Remove";

<DirectorDesk
    presentation={{
        rightmostExtensions: [
            { key: "minimize", icon: <RemoveIcon />, tooltip: "Minimize", onClick: minimizeWindow },
            { key: "close", icon: <CloseIcon />, tooltip: "Close", onClick: closeWindow },
        ],
    }}
/>;
```

`toolbarExtensions` remains beside capture actions. `trailingExtensions` remains between full-screen preview and the built-in help/project controls. Both remain available for host actions that do not require the rightmost position.

### Host bridge contract

Use a specific host window, a concrete URL origin, and a per-desk session. `"*"` is rejected as a target origin.

```tsx
import { DirectorDesk, HostBridgeConfiguration, HostBridgeSession } from "@dm/3d-director-desk";

const hostBridge = new HostBridgeConfiguration(
    window.parent,
    "https://canvas.example.com",
    new HostBridgeSession("director-node-42"),
);

export function EmbeddedDirectorNode(): JSX.Element {
    return <DirectorDesk hostBridge={hostBridge} />;
}
```

`HostAdapter` is the direct-embedding contract: `onImportModel(handler)` returns its unsubscribe function; `reportCapture({ blobUrl, width, height, requestId })` receives captures (`requestId` echoes the capture command's idempotency key so hosts and agents can reconcile async artifacts); `reportReady(protocolVersion)` receives the readiness handshake; and `dispose?()` runs during desk teardown.

The bridge exports `HostBridge`, `HostBridgeConfiguration`, `HostBridgeSession`, `HostAdapter`, `PostMessageAdapter`, `PROTOCOL_VERSION`, `HOST_INBOUND_MESSAGE_TYPE`, `HOST_OUTBOUND_MESSAGE_TYPE`, `HOST_BRIDGE_FAILURE_CODE`, `isDirectorDeskMessage`, `HostInboundMessage`, `HostOutboundRequest`, `HostOutboundMessage`, and `HostBridgeFailureCode`.

All bridged messages include the configured `sessionId` where applicable:

- Inbound import: `{ type: "director-desk:import-model", sessionId, payload: { url, name } }`.
- Outbound ready: `{ type: "director-desk:ready", sessionId, payload: { protocolVersion } }`.
- Outbound capture: `{ type: "director-desk:capture-produced", sessionId, payload: { blobUrl, width, height, requestId } }`.
- Structured failure: `{ type: "director-desk:command-failed", sessionId, payload: { code: "invalid-message", message } }`.

The bridge accepts an inbound message only when its origin, source window, session, message type, and full payload are valid. Wrong origin, source, or session messages are ignored. A malformed message from the configured trusted source receives `invalid-message`. Rejected imports are reported through `UiStore.setApplicationNotice(...)`, not as an outbound bridge event.

### In-process agent surface

For hosts embedding the desk directly, `AgentBridge` (`src/ai/`) is the in-process equivalent of the local bridge: it turns a desk instance into an agent-facing tool surface without any network hop, and feature modules never know the agent exists. Construct one per desk from the `onReady` stores:

```ts
import { AgentBridge } from "@dm/3d-director-desk";

const bridge = new AgentBridge(stores); // stores from DirectorDesk onReady
const tools = bridge.listToolSchemas(); // { name, description, kind, permissions, inputSchema }[]
```

- Tool schemas are derived from the same capability contracts the dispatcher enforces, so tool definitions never drift from validation; a capability missing its description throws in dev (fail-closed warn-and-skip in production).
- Relay a tool call with `dispatcher.dispatch({ type, payload }, stores, { permissions })`; omit `permissions` only for same-process UI paths. `bridge.fullPermissions` is the grant-everything set.
- `capture.frame` / `capture.video` are fire-and-forget; pair them with `await bridge.awaitFrameCapture(requestId)` / `awaitVideoCapture(requestId)` to reconcile the async artifact by idempotency key (`null` on timeout).

### Project document compatibility

`desk.export-document` produces the current `DESK_DOCUMENT_VERSION`; imports accept only that exact version and validate entity, reference, timeline, camera-motion, and Program links before atomically replacing the current project. There is no legacy migration path before the first release. Read the constant rather than hard-coding the number: `import { DESK_DOCUMENT_VERSION } from "@dm/3d-director-desk"`.

Documents contain scene data and resource URLs, not model or action binaries. Every referenced URL must remain available to the importing desk. In particular, browser `blob:` URLs from locally selected files are session-local and cannot be restored after a refresh; the playground detects and clears those transient snapshots rather than presenting a broken project.

### Built-in asset hosting

The package ships its built-in model and action library in `dist/builtin-assets/`. The desk loads it at runtime by `fetch`, so a host must serve that directory and say where it lives:

```tsx
<DirectorDesk builtinAssetBaseUrl="/my-vendor-path/builtin-assets" />
```

`builtinAssetBaseUrl` defaults to the site-root path `/builtin-assets`, which is correct only when the desk itself is served from the site root (this repository's playground and Storybook). An embedded host's site root belongs to the host, so leaving the default in place makes the catalog request resolve against the host's root and the asset panel stays empty. Catalog entry URLs are rewritten to the configured base, so the catalog file needs no per-host edit.

Copy or sync `dist/builtin-assets/` into whatever path the host serves; do not symlink it to a source checkout, which breaks on any clean clone or CI build. When the catalog cannot be loaded, the desk reports the failing URL through `UiStore.setApplicationNotice(...)` instead of failing silently.

### Public API

The root entry exports the UI and integration surface above, plus:

- `DirectorDesk` and `DirectorDeskProps` for the embeddable component.
- `createDirectorDeskStores`, `DirectorDeskProvider`, `useDirectorDeskStores`, and `DirectorDeskStores` for a controlled composition.
- Scene, camera, capture, asset, animation, shortcut, time, and store classes for command-driven integrations.
- `CommandDispatcher`, `CommandHistory`, `DirectorCommand`, built-in command classes, command registration helpers, and their contract types.

Use root named exports only; `@dm/3d-director-desk/style.css` is the only public subpath. Deep imports, Storybook stories, playground code, fixtures, and test assets are not package APIs.

## Development

| Command                  | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `bun run dev`            | Playground on :4002 with the bridge auto-attached on :4005.     |
| `bun run bridge`         | Standalone bridge on :4005.                                     |
| `bun run storybook`      | Manual verification stories on :6087 (the phase-one test gate). |
| `bun run build`          | Library build (vite lib ESM + `tsc` declarations).              |
| `bun run build:playground` | Static playground build into `dist-playground/` (what Pages serves). |
| `bun run typecheck` / `bun run lint` / `bun run format` | Static checks.                        |

### Manual Storybook verification

Phase one has no unit-test command. Verify the package surface manually with Storybook:

```sh
bun run storybook
```

At `http://localhost:6087`, open the **验收** stories and confirm model import, object selection and transform, action mounting/playback, camera shots, and capture output. For an iframe host integration, also send a correctly scoped `director-desk:import-model` message and confirm the matching desk imports it, while a different session or origin has no effect.

### Release gate

```sh
bun run release-check
bun publish
```

`release-check` runs static type checking, linting, a production Storybook build, the library/declaration build, artifact sanitation, and `bun pm pack --dry-run`. `prepublishOnly` runs that same gate, and `prepack` repeats artifact sanitation for direct pack workflows, so normal publishing cannot skip it. Do not publish or pack with lifecycle scripts disabled.

Publishing targets a scoped registry resolved from a **local, untracked `.npmrc`** (kept out of version control); a fresh clone needs that file before `bun run pa` / `mi` / `ma` will reach the internal registry.

The publish allowlist contains only `dist` (plus npm-required package metadata and this README). `artifact:clean` removes generated fixture and Storybook declaration paths before packing. Source, Storybook support declarations, playground code, fixture assets, and the Storybook build output are excluded.
