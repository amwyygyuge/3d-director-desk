# 3D Director Desk

[中文](README.zh-CN.md) | English

An embeddable React 3D director desk: place game models, mount actions, compose camera shots and camera moves, light the scene, and export stills and MP4 video — with every write operation funneled through a serializable command layer, so the same verbs drive UI clicks, host messages, and AI agents.

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

Open http://localhost:4002 — the page connects to the bridge automatically. To run the bridge standalone (e.g. against the hosted Pages demo), use `bun run bridge` and open the page with an explicit bridge URL: `?bridge=ws://127.0.0.1:4005`.

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

### Security model

**The bridge has no authentication.** This is safe only because it binds `127.0.0.1` and rejects browser origins outside its allowlist. `--host=0.0.0.0` exposes full control of your desk to the LAN — do it only on trusted networks, and put an authenticated TLS reverse proxy in front for anything public. Never enable `--allow-eval` outside local debugging.

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
