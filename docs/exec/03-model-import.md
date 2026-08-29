# 03 · 对象放置(游戏模型导入)

## 目标

导入游戏 3D 模型(FBX/GLB/OBJ)放入场景;Monet 生成的模型经受信任的 HostBridge 进入。**本仓最贵的性能风险点:大模型加载。**

## 范围

- 做:本地文件导入、URL 导入、资产注册表、异步加载态、大模型不卡 UI
- 不做:模型库面板美化(06 后面板统一)、快照缓存(性能专项,见文末)

## 类设计

```mermaid
classDiagram
    class ModelImporter {
        <<领域服务>>
        +acquire(url, format, options) Promise~ModelHandle~
        +dispose() void
    }
    class ModelHandle {
        +object3d Object3D
        +animations AnimationClip[]
        +release() void
    }
    class AssetLibrary {
        <<仓储>>
        +assets ModelAsset[]
        +register(init) { asset, duplicate }
    }
    class PlaceObjectCommand {
        +validate() 格式/位置/重复检查
    }
    ModelImporter --> ModelHandle
    PlaceObjectCommand --> AssetLibrary
```

- `ModelImporter`:通过 `acquire(url, format, { signal?, onProgress? })` 解析、缓存并克隆模型，返回带 `object3d`、`animations` 与幂等 `release()` 的 `ModelHandle`。最后一个 handle 释放后回收缓存资源；`dispose()` 取消未完成加载并释放缓存。
- `AssetLibrary`:暴露 `assets` 数组；`register({ name, url, format, sizeBytes })` 返回 `{ asset, duplicate }`。Monet 模型经已配置的 HostBridge `import-model` 消息进入 `object.place` 命令;消息必须匹配该导演台的 origin、source window 与 session。
- 格式判定: `formatFromFileName` / `formatFromUrl` 返回 `ModelFormat | null`; blob URL 必须显式随 `object.place` 提供格式。

## 实现步骤

1. `AssetLibrary.register({ name, url, format, sizeBytes })` 注册纯数据资产，并基于返回的 `duplicate` 决定是否回收新建 object URL。
2. `ModelImporter.acquire(url, format, { signal, onProgress })` 负责格式查表、并发复用和取消；渲染或动作消费者完成后必须调用 handle 的 `release()`。
3. `object.place` 命令为模型提供 `sourceUrl`、`format`、`name` 与初始 transform；命令验证后将对象加入场景。
4. 工具条「导入模型」:文件选择 → `URL.createObjectURL` → 资产注册 → `object.place` 命令。
5. 加载纪律:异步不阻塞交互；组件卸载或请求被替换时用 `AbortSignal` 取消；最后一个消费者释放 handle 后回收 three 资源。
6. playground 走查:导入 `public/test-assets` 的测试 GLB/FBX；这些 Storybook 验收资产不属于发布产物。

## 验收清单

- [ ] GLB/FBX/OBJ 各导入一个,正常显示、可删除
- [ ] 重复导入同一文件 → 资产去重提示,不重复加载
- [ ] 50MB+ 模型导入过程中界面可交互(loading 态,无白屏)
- [ ] 全仓 grep 无 `readAsDataURL` / base64 模型路径
- [ ] 删除模型后 geometry/material/texture 已 dispose(Scene 面板内存回落)
- [ ] 使用匹配 origin、source window 与 session 的 HostBridge `import-model` 消息后，模型出现在对应场景(postMessage 手工模拟验收)

## 性能专项(后置,不在本任务)

@dm/3d-viewer 的解析产物快照缓存(15s→<1s)在阶段一功能跑通后单独立项接入;需先验证其 `ModelCache` 可否脱离 viewer 组件单独使用。
