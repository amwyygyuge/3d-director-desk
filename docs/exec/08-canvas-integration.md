# 08 · 无限画布接入

## 目标

将导演台作为 Monet 画布节点嵌入。一个节点对应一个隔离的导演台会话：宿主可导入模型，导演台可回传截图产物。

## 公共接入面

`DirectorDesk` 支持两种互斥的宿主接入方式：

- `host?: HostAdapter`：组件直嵌时注入，模型导入和截图回传直接走宿主回调。
- `hostBridge?: HostBridgeConfiguration`：iframe 接入时创建受信任的 `postMessage` 桥。

未提供两者时使用惰性适配器：不安装消息监听器，也不会向 `"*"` 发送消息。宿主不得同时依赖两个接入路径。

```ts
import { HostBridgeConfiguration, HostBridgeSession } from "@dm/3d-director-desk";

const hostBridge = new HostBridgeConfiguration(
    window.parent,
    "https://canvas.example.com",
    new HostBridgeSession("director-node-42"),
);
```

`HostBridgeConfiguration` 的构造参数为：

| 参数           | 类型                | 约束                                                     |
| -------------- | ------------------- | -------------------------------------------------------- |
| `targetWindow` | `Window`            | 唯一允许收发消息的宿主窗口                               |
| `targetOrigin` | `string`            | 具体 URL origin；拒绝 `"*"`                              |
| `session`      | `HostBridgeSession` | `new HostBridgeSession(id: string)` 创建的当前导演台会话 |

`HostAdapter` 是直嵌宿主的唯一回调契约：

- `onImportModel(handler)` 注册模型导入回调并返回解绑函数。
- `reportCapture({ blobUrl, width, height })` 接收截图产物。
- `reportReady(protocolVersion)` 接收就绪握手。
- `dispose?()` 在导演台卸载时调用。

## iframe 消息协议

从根入口导入 `PROTOCOL_VERSION`，并在宿主与导演台升级时据此判断兼容性。所有下列桥接消息均携带当前 `sessionId`：

```ts
// 宿主 → 导演台
{
    type: "director-desk:import-model";
    sessionId: string;
    payload: {
        url: string;
        name: string;
    }
}

// 导演台 → 宿主
{
    type: "director-desk:ready";
    sessionId: string;
    payload: {
        protocolVersion: number;
    }
}
{
    type: "director-desk:capture-produced";
    sessionId: string;
    payload: {
        blobUrl: string;
        width: number;
        height: number;
    }
}
{
    type: "director-desk:command-failed";
    sessionId: string;
    payload: {
        code: "invalid-message";
        message: string;
    }
}
```

桥接仅接受同时满足下列条件的入站消息：来源 origin 等于 `targetOrigin`、来源窗口等于 `targetWindow`、`sessionId` 匹配、消息类型受支持，且 payload 完整有效。origin、窗口或会话不匹配的消息静默丢弃；来自可信 origin 和窗口但格式错误的消息回传 `command-failed/invalid-message`。模型导入被命令层拒绝时通过 `UiStore.setApplicationNotice(...)` 呈现，不产生桥接失败消息。

`HostBridge.on(...)` 支持同一消息类型的多个订阅者，并返回各自的解绑函数。`PostMessageAdapter` 仅将这个受信任桥接映射为 `HostAdapter`；领域和 UI 代码不直接读写 `window.postMessage`。

## Monet 节点接入

1. 为每个画布节点生成稳定且唯一的 `session.id`。
2. iframe 方式将 `hostBridge` 传给 `DirectorDesk`；直嵌方式实现并传入 `HostAdapter`，不要再创建 bridge。
3. 收到 `ready` 后比较 `payload.protocolVersion` 与宿主支持的版本。
4. 发送完整的 `import-model` 消息；在收到 `capture-produced` 后上传或持久化 `blobUrl` 指向的内容，再写入节点 outputs。
5. 节点卸载时卸载 React 根；导演台负责取消订阅、释放 bridge 和自身资源。

## 手工验收

- 两个不同 session 的导演台并存时，导入消息只影响会话匹配的实例。
- 错误 origin、错误 source window 与错误 session 的消息均无副作用。
- 来自可信 origin/window 的畸形消息收到 `director-desk:command-failed`，且 `payload.code` 为 `invalid-message`。
- 有效模型消息进入命令层，加载完成后模型出现在对应场景。
- 截图回传带会话 ID、尺寸与可读取的 blob URL；宿主写入正确节点的 outputs。
- 卸载节点后不再保留消息监听器或异步导入任务。
