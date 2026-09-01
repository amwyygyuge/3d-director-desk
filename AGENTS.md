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
7. **UI 组件纪律**:一切 UI **优先用 MUI 现成组件**(`@mui/material` + `@mui/icons-material`);布局排版用 Tailwind 工具类(preflight 已关,只当布局层)。主题统一走 `src/ui/theme.ts` 的 MUI theme 对象;组件定制走 `sx`/slot props,禁止引入第二套 UI 库(@bedrock/* 等)。根组件用 `ScopedCssBaseline`,样式重置不外泄宿主页面。Monet 视觉一致性非目标(已决策),宿主如确需换装经 `DirectorDesk` 的 `theme` prop 注入。
8. **命令层收口(AI 地基)**:一切改变场景/机位状态的写操作——UI 交互、HostBridge 消息、未来 AI 工具调用——必须收敛为 `DirectorCommand` 经 `CommandDispatcher` 分发;**禁止组件/适配器直写 store**。命令 payload 必须纯数据可序列化。
9. **禁止裸数值入口**:来自 AI/宿主的坐标、fov 等数值必须经命令 `validate()` 的有限性/范围检查(空间幻觉围栏),LLM 输出不直接触达领域类。
10. **许可纪律**:可参考 `xiaozangao/3d-director-desk`(MIT)的思路,禁止整段搬运代码;awplanet(非商用)/ CozyClay(AGPL)/ shotblock(无许可)的代码一行都不许进本仓。
11. **零兼容纪律(功能未上线)**:本产品尚未正式上线,**不存在任何线上数据与历史版本**。因此严禁编写迁移代码、版本分支、字段兜底、别名/re-export、`legacy*` 类型与「读旧档」路径;领域模型演进一律**清洁切换**——改结构就直接改,旧格式档案由版本号直接判不支持。遇到既有兼容代码立即删除,不得沿用。
12. **状态管理纪律(MobX 单轨)**:一切共享/领域状态必须是 `makeAutoObservable` 类实体;React 组件一律 `observer`(具名 function,来自 `mobx-react-lite`)渲染期直读。**禁止手搓响应式**:版本号计数器与 `void x.revision` 锚定、自建 `listeners`/`subscribe`/`emit` pub/sub、`useState` 镜像 observable、`useEffect` 把 observable 同步进本地 state、渲染外快照缓存集合。`createContext` 唯一合法用途是 `DirectorDeskContext` 每实例注入(value 必须稳定引用,禁放变化状态);禁全局单例,禁 mobx-react 的 `Provider`/`inject`。`useState` 白名单仅限局部瞬时 UI 态(输入草稿、开关、Snackbar)。集合消费统一 `values`/`entries`/`get`,禁手搓展开。惰性副作用统一 `onBecomeObserved`/`onBecomeUnobserved`,disposer 进 dispose 链;观察者常驻的 observable 禁挂 lazy。渲染纪律:传引用晚解引用、列表渲染独立组件、禁 index 作 key、`observer` 已含 `memo` 勿重复包裹、非 observer 第三方组件经 function props 或 `<Observer>` 桥接。高频(帧级)observable 禁渲染期直读,经 `reaction`/`autorun`/`useFrame` 消费;UI 显示值用 lazy 低频派生(见 `ui/PlayheadDisplay`)。细则与正误对照见 `docs/state-management.md`。
13. **props 边界纪律(值型状态禁下传)**:组件一律 `useDirectorDeskStores()` **自取**状态。props 只准装三类东西——**身份 id**(`shotId`/`objectId`/`section`)、**回调**(`onCommit`/`onClose`/`report`)、**DOM ref / children**。数字、布尔、数组、快照对象一律禁止下传(`duration`/`playhead`/`objectCount`/`programClips`/`actionId`/`fov`/`shot` 全部自取)。理由:值型 props 把子组件的重渲染绑到父组件的读集合上,`observer` 的细粒度追踪当场失效;父组件一旦读了帧级 observable 再下传,整棵子树跟着它的频率重建。唯一例外是**无领域身份的叶子控件**(通用数值输入如 `ShotNumberField`),判据是「能用 id 换到状态的一律自取,换不到的才允许收值」。细则与正误对照见 `docs/state-management.md` 的「props 边界纪律」。
14. **画布之上的渲染性能红线(踩过的坑,禁重演)**:悬浮壳层压在活动的 WebGL 画布上,以下四条已造成过实测掉帧,**禁止再次引入**:
    - **禁 `backdrop-filter`**:毛玻璃要求合成器在画布每一帧重绘后重新读回并模糊背景,播放/飞行期 = 60fps × 壳层块数。壳层一律不透明底色(见 `ui/theme.ts` 的 `SURFACE`),视觉服从性能。
    - **禁对 width/height/padding 做 CSS 过渡**:这三个属性无法交给合成器,过渡期每帧重排,与画布渲染叠加。只允许 `opacity` 过渡;`theme.ts` 因此不提供过渡时长 token。
    - **禁大半径 `box-shadow`**:同样按层重绘计价,壳层阴影上限 `0 2px 8px`。
    - **收起/不可见的重面板必须卸载**,不是 `opacity: 0` 留在树里——它照样跟着 observable 重渲(时间轴轨道编辑器就栽在这里)。
      验收线:播放期用 `MutationObserver` 采样 3 秒,**DOM 节点增删必须为 0**,属性/文本变更数应等于「节流频率 × 直读帧级 observable 的叶子个数」。

## 强制工程闸门（每次迭代必经）

架构、性能与设计是与功能同级的发布门槛；**禁止以迭代速度、临时可用或功能完成为由交换或降低本节及上述红线**。

1. **编码前（MUST）**：明确并记录领域边界、负责的类/接口、生命周期与不变量、运行时所有权、性能关键路径，以及验收标准和回滚影响；上述任一项不清晰时**禁止编码**。
2. **编码中（MUST NOT）**：禁止为求快绕过领域/命令/资源边界；禁止未经度量就在热路径引入分配、场景遍历或额外重渲染；禁止扩张功能范围而削弱既定阶段设计、可序列化状态、每实例隔离、Three/MobX 分离、按需渲染、资源释放等约束。
3. **交付前（MUST）**：针对既有边界完成架构、设计与性能审查；UI 或运行时变更必须在实际界面或运行面验证。任何有意权衡必须记录其影响并确认不触碰红线；若触碰红线或无法证明符合本节，**禁止交付，必须阻塞**。

### AI 可访问性与集成闸门（每个面向用户的新能力必经）

1. **能力契约（MUST）**：实现前必须定义 AI 可调用的用例词汇、能力/发现元数据（名称、版本、适用条件、权限）及稳定的序列化输入、输出、错误 schema；错误必须为结构化失败并给出下一步可选项，**禁止**暴露原始运行时异常、Three 对象或引用。
2. **边界与命令（MUST）**：必须明确权限与校验边界；读/查询与写/命令必须分离。所有改变场景或机位状态的 UI、HostBridge 与 AI 路径必须复用同一领域命令/应用服务路径，**禁止** AI 或适配器直接读写 store、持有 Three 对象/引用、调用 UI 内部实现或绕过 `CommandDispatcher`。
3. **执行语义（MUST）**：对可重试或异步能力，必须定义确定性的幂等键、重试/去重语义、生命周期、取消方式与异步结果所有权；未定义时**禁止**发布为 AI 能力。
4. **演进与验收（MUST）**：必须评估协议/版本迁移、兼容与回滚影响；交付前必须具备覆盖真实 UI 与 AI 集成的验收场景，验证发现、权限拒绝、校验失败、命令执行、取消/重试与结构化失败路径。

## 兼容矩阵(不可单方面升级)

| 依赖               | 版本                 | 原因                                            |
| ------------------ | -------------------- | ----------------------------------------------- |
| react / react-dom  | ^18.2.0              | Monet 前端为 React 18,R3F v9 需 React 19,不可升 |
| three              | >=0.184(dev 0.185.1) | Monet 钉 0.184;API 使用须兼容 0.184+            |
| @react-three/fiber | ^8.18.0              | React 18 兼容线最后一版                         |
| @react-three/drei  | ^9.122.0             | 与 fiber 8 配对                                 |

## 工程命令

- `bun run dev` — playground 调试
- `bun run storybook` — 组件走查(代替单测的验证手段)
- `bun run typecheck` / `bun run lint` / `bun run format`
- `bun run build` — 发包构建(vite lib ESM + tsc 声明)
- `bun run pa/mi/ma` — 发版(patch/minor/major,直发内部 registry)
