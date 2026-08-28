# 3D Director Desk — Agent 工作规范

本仓是 Monet「3D 导演台」的独立工程:`@dm/3d-director-desk`,以 npm 包(内部 registry)形式被 Monet 插件壳消费。

## 红线(违反即返工)

1. **禁止编写单元测试**——本阶段(阶段一)不建 vitest/jest 等任何测试设施,不写 `*.test.*` / `*.spec.*`;验证手段为 Storybook 人工走查 + playground 运行。
2. **设计第一,一切以类为主**——任何能力先回答:领域边界是什么、由哪个类承载。管理器/实体/值对象/领域服务/适配器职责见 `docs/phase1-design.md`;禁止函数式平铺实现。
3. **性能第一(铁律)**:
    - three 对象(Object3D/Geometry/Material/Texture)**永不进 MobX observable**;运行时引用走 `SceneManager` 的普通 Map;store 只放纯数据实体。
    - Canvas 常驻 `frameloop="demand"`,状态变更显式 `invalidate()`;动画播放期才切回。
    - 渲染循环/动画回调内**零分配**(复用 Vector3/Quaternion/Matrix4 模块级临时对象)。
    - 一切进入场景的资源登记 `DisposeBag`,卸载零泄漏。
    - 禁止场景树重复 `traverse`:建立运行期索引,按 id 直查。
4. **单实例约束**:`react` / `react-dom` / `three` / `@react-three/*` / `mobx*` 全部 peerDependencies,禁止打包进产物(`vite.config.ts` EXTERNALS 已锁)。
5. **实例化纪律**:stores / SceneManager / TimeTransport 一律每 `DirectorDesk` 实例一套(`createDirectorDeskStores`),**禁止全局单例**——Monet 画布可同时挂多个导演台节点。
6. **可序列化纪律(阶段四地基)**:一切进入场景的状态必须是纯数据实体(可 JSON 往返),three 运行时引用只允许在 `SceneManager.runtimes` 等普通 Map;新增实体字段前自问「这个字段 JSON 序列化后还能还原吗」。
7. **UI 组件纪律**:一切 UI **优先找现成组件**——先查 `src/components/ui/`(shadcn copy-in 已有),没有再 `npx shadcn@latest add`,shadcn 也没有才手写。**禁止成品 UI 依赖库**(@bedrock/* 等);shadcn 生成物源码自有不算依赖,原语后端固定 Base UI。生成物内部禁止就地魔改,定制走 className 覆盖或主题变量层。样式一律 Tailwind 工具类,颜色只消费 shadcn 语义类,其值经 `--dd-*` 主题契约由 Monet 宿主换装。
8. **命令层收口(AI 地基)**:一切改变场景/机位状态的写操作——UI 交互、HostBridge 消息、未来 AI 工具调用——必须收敛为 `DirectorCommand` 经 `CommandDispatcher` 分发;**禁止组件/适配器直写 store**。命令 payload 必须纯数据可序列化。
9. **禁止裸数值入口**:来自 AI/宿主的坐标、fov 等数值必须经命令 `validate()` 的有限性/范围检查(空间幻觉围栏),LLM 输出不直接触达领域类。
10. **许可纪律**:可参考 `xiaozangao/3d-director-desk`(MIT)的思路,禁止整段搬运代码;awplanet(非商用)/ CozyClay(AGPL)/ shotblock(无许可)的代码一行都不许进本仓。

## 兼容矩阵(不可单方面升级)

| 依赖               | 版本                 | 原因                                            |
| ------------------ | -------------------- | ----------------------------------------------- |
| react / react-dom  | ^18.2.0              | Monet 前端为 React 18,R3F v9 需 React 19,不可升 |
| three              | >=0.184(dev 0.185.1) | Monet 钉 0.184;API 使用须兼容 0.184+            |
| @react-three/fiber | ^8.18.0              | React 18 兼容线最后一版                         |
| @react-three/drei  | ^9.122.0             | 与 fiber 8 配对                                 |

## 工程命令

- `pnpm dev` — playground 调试
- `pnpm storybook` — 组件走查(代替单测的验证手段)
- `pnpm typecheck` / `pnpm lint` / `pnpm format`
- `pnpm build` — 发包构建(vite lib ESM + tsc 声明)
- `pnpm pa/mi/ma` — 发版(patch/minor/major,直发内部 registry)
