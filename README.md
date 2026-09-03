# @dm/3d-director-desk

Embeddable React director desk for placing game models, mounting actions, composing camera shots, and producing still captures.

## Requirements

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

## Install and render

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

## Host bridge contract

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

## AI agent bridge

`AgentBridge` is a standalone module (`src/ai/`) that turns a desk instance into an agent-facing tool surface; feature modules never know the agent exists. Construct one per desk from the `onReady` stores:

```ts
import { AgentBridge } from "@dm/3d-director-desk";

const bridge = new AgentBridge(stores); // stores from DirectorDesk onReady
const tools = bridge.listToolSchemas(); // { name, description, kind, permissions, inputSchema }[]
```

- Tool schemas are derived from the same capability contracts the dispatcher enforces, so tool definitions never drift from validation; a capability missing its description throws in dev (fail-closed warn-and-skip in production).
- Relay a tool call with `dispatcher.dispatch({ type, payload }, stores, { permissions })`; omit `permissions` only for same-process UI paths. `bridge.fullPermissions` is the grant-everything set.
- `capture.frame` / `capture.video` are fire-and-forget; pair them with `await bridge.awaitFrameCapture(requestId)` / `awaitVideoCapture(requestId)` to reconcile the async artifact by idempotency key (`null` on timeout).

## Project document compatibility

`desk.export-document` produces document version `8`; imports accept only that exact version and validate entity, reference, timeline, camera-motion, and Program links before atomically replacing the current project. There is no legacy migration path before the first release.

Documents contain scene data and resource URLs, not model or action binaries. Every referenced URL must remain available to the importing desk. In particular, browser `blob:` URLs from locally selected files are session-local and cannot be restored after a refresh; the playground detects and clears those transient snapshots rather than presenting a broken project.

## Public API

The root entry exports the UI and integration surface above, plus:

- `DirectorDesk` and `DirectorDeskProps` for the embeddable component.
- `createDirectorDeskStores`, `DirectorDeskProvider`, `useDirectorDeskStores`, and `DirectorDeskStores` for a controlled composition.
- Scene, camera, capture, asset, animation, shortcut, time, and store classes for command-driven integrations.
- `CommandDispatcher`, `CommandHistory`, `DirectorCommand`, built-in command classes, command registration helpers, and their contract types.

Use root named exports only; `@dm/3d-director-desk/style.css` is the only public subpath. Deep imports, Storybook stories, playground code, fixtures, and test assets are not package APIs.

## Manual Storybook verification

Phase one has no unit-test command. Verify the package surface manually with Storybook:

```sh
bun run storybook
```

At `http://localhost:6087`, open the **验收** stories and confirm model import, object selection and transform, action mounting/playback, camera shots, and capture output. For an iframe host integration, also send a correctly scoped `director-desk:import-model` message and confirm the matching desk imports it, while a different session or origin has no effect.

## Release gate

```sh
bun run release-check
bun publish
```

`release-check` runs static type checking, linting, a production Storybook build, the library/declaration build, artifact sanitation, and `bun pm pack --dry-run`. `prepublishOnly` runs that same gate, and `prepack` repeats artifact sanitation for direct pack workflows, so normal publishing cannot skip it. Do not publish or pack with lifecycle scripts disabled.

The publish allowlist contains only `dist` (plus npm-required package metadata and this README). `artifact:clean` removes generated fixture and Storybook declaration paths before packing. Source, Storybook support declarations, playground code, fixture assets, and the Storybook build output are excluded.
