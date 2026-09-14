import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { createId } from "@/core/createId";
import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import ScopedCssBaseline from "@mui/material/ScopedCssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { formatFromUrl } from "@/assets/ModelAsset";
import type { HostBridgeConfiguration } from "@/bridge/HostBridge";
import { PROTOCOL_VERSION } from "@/bridge/protocol";
import { PostMessageAdapter } from "@/host/HostAdapter";
import type { HostAdapter } from "@/host/HostAdapter";
import type { DeskShellPresentationInit } from "@/ui/shell/DeskShellPresentation";
import { HOME_DIRECTOR_POSE } from "@/store/CameraStore";
import { GIZMO_CLICK_GUARD_MS } from "@/store/UiStore";
import { BonePicker } from "@/ui/viewport/scene/BonePicker";
import { TransformGizmoController } from "@/ui/viewport/scene/TransformGizmoController";
import { FlyDrive } from "@/ui/viewport/scene/FlyDrive";
import { ShotNavigation } from "@/ui/viewport/scene/ShotNavigation";
import { LensNavigation } from "@/ui/viewport/scene/LensNavigation";
import type { AssetProvider } from "@/assets/catalog/AssetProvider";
import { TimelineSelection } from "@/authoring/TimelineSelection";
import { createDirectorDeskStores, DirectorDeskProvider } from "@/ui/shell/DirectorDeskContext";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { WorkspaceNavigator } from "@/ui/workspace/WorkspaceNavigator";
import { ApplicationNotice, SuccessNotice } from "@/ui/workspace/ApplicationNotice";
import { InspectorSheet } from "@/ui/workspace/InspectorSheet";
import { TimelineConsole } from "@/ui/workspace/TimelineConsole";
import { PresentationExitHint, TopPillBar } from "@/ui/workspace/TopPillBar";
import { RecordingHud } from "@/ui/workspace/RecordingHud";
import { CaptureProductDock } from "@/ui/viewport/CaptureProductDock";
import { CommandPalette } from "@/ui/shell/CommandPalette";
import { HelpOverlay } from "@/ui/shell/HelpOverlay";
import { Hotkeys } from "@/ui/shell/Hotkeys";
import { FrameRateIndicator } from "@/ui/viewport/FrameRateIndicator";
import { placementFor } from "@/ui/assets/importFiles";
import { LoadingChip } from "@/ui/viewport/LoadingChip";
import { NativeChromeGuard } from "@/ui/shell/NativeChromeGuard";
import {
    directorDeskTheme,
    SCROLLBAR_SX,
    TIMELINE_HEIGHT_VAR,
    TOOL_CHROME_SX,
    VIEWPORT_BACKGROUND,
} from "@/ui/shell/theme";
import { SceneRoot } from "@/ui/viewport/scene/SceneRoot";
import { PlaybackDriver } from "@/ui/viewport/scene/PlaybackDriver";
import { StudioRig, StudioShadowRig } from "@/ui/viewport/scene/StudioRig";
import { StudioFloorGrid } from "@/ui/viewport/scene/StudioFloorGrid";
import { CameraMotionRig } from "@/ui/viewport/scene/CameraMotionRig";
import { OrbitAuthorityRig } from "@/ui/viewport/scene/OrbitAuthorityRig";
import { MotionPathPreview } from "@/ui/viewport/scene/MotionPathPreview";
import { ObjectMotionPathPreview } from "@/ui/viewport/scene/ObjectMotionPathPreview";
import { WalkDraftController } from "@/ui/viewport/scene/WalkDraftController";
import type { MotionKeyContextRequest } from "@/ui/viewport/scene/MotionClipPathPreview";
import { ShotCameraRig } from "@/ui/viewport/scene/ShotCameraRig";
import { ShotMarkers } from "@/ui/viewport/scene/ShotMarkers";
import { OutputFrameOverlay } from "@/ui/viewport/OutputFrameOverlay";
import { ViewportInteractionHints } from "@/ui/viewport/ViewportInteractionHints";
import { useCaptureHelperRegistration } from "@/ui/viewport/scene/useCaptureHelperRegistration";

interface MotionKeyMenuPosition {
    readonly left: number;
    readonly top: number;
}

/** Canvas 相机初值与「重置视角」命令共用 HOME_DIRECTOR_POSE(单一真相源);Vec3 只读元组展开为可变 */
const STUDIO_CAMERA_FOV_DEGREES = HOME_DIRECTOR_POSE.fov;
const STUDIO_CAMERA_POSITION: [number, number, number] = [...HOME_DIRECTOR_POSE.position];
const STUDIO_CAMERA_MIN_DISTANCE_METERS = 2;
const STUDIO_CAMERA_MAX_DISTANCE_METERS = 18;
/** 根节点缺省尺寸:充满宿主容器(向后兼容基线) */
const ROOT_FILL = "100%" as const;

export interface DirectorDeskProps {
    /** 宿主可传 MUI theme 覆盖默认暗色主题 */
    theme?: Theme;
    /** 宿主适配器:直嵌形态直接注入，不创建 postMessage 监听器 */
    host?: HostAdapter;
    /** 宿主注入的资源 provider(直嵌形态;iframe 形态走 bridge register-assets 消息) */
    assetProviders?: readonly AssetProvider[];
    /**
     * 内置资源(包内 `dist/builtin-assets/`)的 serve 基址;缺省站点根 `/builtin-assets`。
     * 嵌入宿主时必须提供——站点根属宿主,缺省路径会 404 且资源面板空白。
     */
    builtinAssetBaseUrl?: string;
    /** iframe 宿主的精确 origin/source/session 信任边界；未提供时采用无通信安全缺省 */
    hostBridge?: HostBridgeConfiguration;
    /** 编排轨迹辅助物的初始可见性(Storybook/宿主播种);缺省即编排态默认(可见),运行时开关在顶栏。 */
    initialMotionPathVisible?: boolean;
    /** 实例就绪回调(每实例一次):Storybook 播种/宿主调试挂点;AI 面永远走命令层,不经此 */
    onReady?: (stores: DirectorDeskStores) => void;
    /** 壳层呈现定制(产品名/采集按钮文案/工具栏扩展位);仅创建期读取,运行期变更不生效 */
    presentation?: DeskShellPresentationInit;
    /** 桌面宽度:数字 = px,字符串 = CSS 长度;缺省充满宿主容器。渲染期响应式(Monet 节点缩放即时生效) */
    width?: number | string;
    /** 桌面高度;同 width */
    height?: number | string;
    /** 视口参考地板边长初始值(米);缺省 12。创建期注入——运行期由项目菜单经 studio.set-grid-size 接管 */
    initialGridSizeMeters?: number;
}

/**
 * 导演台主组件:全屏画布铺底 + 悬浮壳层覆盖其上(方案 D「液态悬浮界面」)。
 *
 * 每实例一套 stores:Monet 画布可同时存在多个导演台节点,禁全局单例。
 * ScopedCssBaseline:样式重置只作用于本组件子树,不污染宿主页面。
 * 壳层纪律:overlay 根容器放行指针事件,四区各自重新拦截——
 * 用户可在浮窗缝隙里直接拖拽镜头,面板折叠不再引起画布重排。
 * 性能铁律落实:
 * - frameloop="demand":静态场景不持续渲染,状态变更显式 invalidate;
 * - three 对象经 ref 注册进 SceneManager 运行时表,不进 observable;
 * - 面板订阅走 MobX 细粒度 observer,壳层显隐由 CSS transition 承担,不走 JS 重绘。
 */
export const DirectorDesk = observer(function DirectorDesk({
    theme,
    host,
    hostBridge,
    assetProviders,
    builtinAssetBaseUrl,
    onReady,
    initialMotionPathVisible,
    presentation,
    width = ROOT_FILL,
    height = ROOT_FILL,
    initialGridSizeMeters,
}: DirectorDeskProps) {
    const [stores] = useState<DirectorDeskStores>(() =>
        createDirectorDeskStores({
            host,
            hostBridge,
            assetProviders,
            builtinAssetBaseUrl,
            motionPathVisible: initialMotionPathVisible,
            presentation,
            gridSizeMeters: initialGridSizeMeters,
        }),
    );
    const deskRef = useRef<HTMLDivElement>(null);
    const registerCaptureHelpers = useCaptureHelperRegistration(stores.capture.helpers);
    const [motionKeyMenuPosition, setMotionKeyMenuPosition] = useState<MotionKeyMenuPosition | null>(null);
    const openMotionKeyMenu = useCallback((request: MotionKeyContextRequest): void => {
        setMotionKeyMenuPosition({ left: request.clientX, top: request.clientY });
    }, []);
    const closeMotionKeyMenu = useCallback((): void => {
        setMotionKeyMenuPosition(null);
    }, []);
    const selectedClipId = stores.timelineSelection.current.motionClipId;
    const selectedKeyId = stores.timelineSelection.current.motionKeyId;
    const selectedClip = selectedClipId ? stores.motion.clip(selectedClipId) : undefined;
    const selectedKey = selectedClip && selectedKeyId ? selectedClip.key(selectedKeyId) : undefined;

    // 每实例一次性就绪通知;onReady 变化不重复触发(播种语义)
    useEffect(() => {
        onReady?.(stores);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stores]);

    useEffect(() => {
        stores.lifecycle.activate();
        return () => {
            stores.lifecycle.scheduleDispose(() => {
                stores.capture.dispose();
                stores.ui.dispose();
                stores.assets.dispose();
                stores.documentImports.dispose();
                stores.animations.dispose();
                stores.playback.dispose();
                stores.binder.dispose();
                stores.models.dispose();
                stores.skeletons.dispose();
                // 人偶运行时持骨骼壳(DisposeBag):漏挂会在 Monet 画布反复挂卸载节点时漏 GPU 资源
                stores.actorRuntime.dispose();
                // 克隆材质只由注册表释放，画像写入者不得代为释放。
                stores.materials.dispose();
                stores.scene.manager.dispose();
                stores.host.dispose?.();
            });
        };
    }, [stores]);

    // 浏览器原生行为一律经 NativeChromeGuard 收口(右键菜单/原生拖拽/文件拖放/捏合缩放)。
    // 每实例一套,随根节点挂卸;拦截清单与理由见该类文档。
    useEffect(() => {
        const element = deskRef.current;
        if (!element) return;
        const guard = new NativeChromeGuard();
        guard.attach(element);
        return () => guard.dispose();
    }, []);

    // 宿主入站:import-model → 命令层;ready 握手(adapter 内部决定是否有意义)
    useEffect(() => {
        if (stores.host instanceof PostMessageAdapter) stores.host.activate();
        const detachRegisterAssets = stores.host.onRegisterAssets(({ assets }) => {
            stores.catalog.registerInjected(assets);
        });
        const detachImport = stores.host.onImportModel(({ url, name }) => {
            const result = stores.dispatcher.dispatch(
                {
                    type: "object.place",
                    payload: {
                        id: `model-${createId()}`,
                        kind: "model",
                        sourceUrl: url,
                        format: formatFromUrl(url) ?? undefined,
                        name,
                        transform: {
                            position: placementFor(stores.scene.objectCount),
                            rotation: [0, 0, 0],
                            scale: [1, 1, 1],
                        },
                    },
                },
                stores,
            );
            if (!result.ok) stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
        });
        stores.host.reportReady(PROTOCOL_VERSION);
        return () => {
            detachImport();
            detachRegisterAssets();
        };
    }, [stores]);

    return (
        <ThemeProvider theme={theme ?? directorDeskTheme}>
            <ScopedCssBaseline className="h-full" sx={{ ...SCROLLBAR_SX, ...TOOL_CHROME_SX }}>
                <DirectorDeskProvider value={stores}>
                    <div
                        ref={deskRef}
                        className="relative overflow-hidden"
                        data-desk-root
                        // 时间线高度以 CSS 变量下发:拖拽期直接改变量即可让侧栏与产物层跟随,不触发 React 重渲
                        style={
                            {
                                width,
                                height,
                                [TIMELINE_HEIGHT_VAR]: `${stores.layout.timelineChromeHeightPx}px`,
                            } as CSSProperties
                        }
                        tabIndex={-1}
                        onPointerDown={(event) => event.currentTarget.focus()}
                        // 输入类原生属性挂根节点由 DOM 继承:组件自带的 inputProps 会整体覆盖
                        // theme defaultProps 里的同名项,放这里才对每个输入框都生效
                        autoCorrect="off"
                        autoCapitalize="off"
                    >
                        {/* 画布全屏:一切 UI 悬浮其上,折叠/展开不再引起画面跳动 */}
                        <div className="absolute inset-0">
                            {/* key 绑画质档:antialias 是 WebGL 上下文属性,只能靠重建上下文切换。
                                shadows 必须由 Canvas 声明:R3F 托管 gl.shadowMap.enabled,运行时手动置 true
                                会被它复位回 false(实测),投影因此永远不出现。真正的开关在 StudioRig——
                                关闭时不挂投射光也不挂接收面,深度图不产生成本。 */}
                            <Canvas
                                key={stores.studio.renderQuality}
                                frameloop={
                                    stores.clock.isPlaying || stores.actionPreview.isPlaying || stores.ui.flying
                                        ? "always"
                                        : "demand"
                                }
                                camera={{ position: STUDIO_CAMERA_POSITION, fov: STUDIO_CAMERA_FOV_DEGREES }}
                                dpr={[...stores.studio.profile.dpr]}
                                shadows="soft"
                                gl={{
                                    antialias: stores.studio.profile.antialias,
                                    preserveDrawingBuffer: false,
                                }}
                                onCreated={(state) =>
                                    stores.capture.attach({
                                        gl: state.gl,
                                        scene: state.scene,
                                        camera: state.camera,
                                        invalidate: state.invalidate,
                                    })
                                }
                                onPointerMissed={() => {
                                    // 掌镜/镜头视角的转向 mouseup 也算"点空",不该清选中
                                    if (!stores.viewportCamera.isDirectorFree) return;
                                    // 点 gizmo 对 R3F 射线是空点;守卫窗内的 pointerMissed 是拖拽余波,不取消选中
                                    if (performance.now() - stores.ui.lastGizmoInteractionAt > GIZMO_CLICK_GUARD_MS) {
                                        stores.selection.clear();
                                    }
                                }}
                            >
                                <color attach="background" args={[VIEWPORT_BACKGROUND]} />
                                <StudioFloorGrid />
                                <group ref={registerCaptureHelpers}>
                                    <BonePicker />
                                    <TransformGizmoController />
                                    <ShotMarkers />
                                    <MotionPathPreview onKeyContextMenu={openMotionKeyMenu} />
                                    <ObjectMotionPathPreview />
                                    <WalkDraftController />
                                </group>
                                {/* 轨道启停统一由 OrbitAuthorityRig 执行:此处不再声明 enabled/阻尼开关 */}
                                <OrbitControls
                                    makeDefault
                                    minDistance={STUDIO_CAMERA_MIN_DISTANCE_METERS}
                                    maxDistance={STUDIO_CAMERA_MAX_DISTANCE_METERS}
                                />
                                <StudioRig />
                                {/* 投影与布光模式无关:custom 布光的工程同样需要接地线索 */}
                                <StudioShadowRig />
                                <SceneRoot />
                                <PlaybackDriver />
                                <ShotCameraRig />
                                <OrbitAuthorityRig />
                                <CameraMotionRig />
                                <FlyDrive />
                                <ShotNavigation />
                                <LensNavigation />
                            </Canvas>
                            <OutputFrameOverlay />
                            {stores.presentation.showsInternalCaptureProducts ? <CaptureProductDock /> : null}
                            <LoadingChip />
                            <FrameRateIndicator />
                            <ViewportInteractionHints />
                        </div>
                        {/* 悬浮壳层:根容器放行指针事件,四区各自 pointer-events-auto 重新拦截 */}
                        <div className="pointer-events-none absolute inset-0">
                            <TopPillBar />
                            <WorkspaceNavigator />
                            <InspectorSheet />
                            <TimelineConsole />
                            <PresentationExitHint />
                            <RecordingHud />
                        </div>
                        <ApplicationNotice />
                        <SuccessNotice />
                        <Hotkeys deskRef={deskRef} />
                        <HelpOverlay />
                        <CommandPalette />
                        <Menu
                            open={motionKeyMenuPosition !== null}
                            onClose={closeMotionKeyMenu}
                            anchorReference="anchorPosition"
                            anchorPosition={
                                motionKeyMenuPosition
                                    ? { top: motionKeyMenuPosition.top, left: motionKeyMenuPosition.left }
                                    : undefined
                            }
                        >
                            <MenuItem
                                disabled={!selectedClipId || !selectedKeyId}
                                onClick={() => {
                                    if (!selectedClipId || !selectedKeyId) return;
                                    const result = stores.dispatcher.dispatch(
                                        {
                                            type: "motion.remove-key",
                                            payload: { clipId: selectedClipId, keyId: selectedKeyId },
                                        },
                                        stores,
                                    );
                                    if (!result.ok)
                                        stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
                                    else stores.timelineSelection.select(TimelineSelection.motionClip(selectedClipId));
                                    closeMotionKeyMenu();
                                }}
                            >
                                删除关键帧
                            </MenuItem>
                            <MenuItem
                                disabled={!selectedClipId || !selectedKeyId}
                                onClick={() => {
                                    if (!selectedClipId || !selectedKeyId) return;
                                    const result = stores.dispatcher.dispatch(
                                        {
                                            type: "motion.reset-key-handles",
                                            payload: { clipId: selectedClipId, keyId: selectedKeyId },
                                        },
                                        stores,
                                    );
                                    if (!result.ok)
                                        stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
                                    closeMotionKeyMenu();
                                }}
                            >
                                恢复自动手柄
                            </MenuItem>
                            <MenuItem
                                disabled={!selectedClip || !selectedKey}
                                onClick={() => {
                                    if (!selectedClip || !selectedKey) return;
                                    const result = stores.dispatcher.dispatch(
                                        {
                                            type: "transport.seek",
                                            payload: { time: selectedClip.timeAtProgress(selectedKey.progress) },
                                        },
                                        stores,
                                    );
                                    if (!result.ok)
                                        stores.ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
                                    closeMotionKeyMenu();
                                }}
                            >
                                定位到此
                            </MenuItem>
                        </Menu>
                    </div>
                </DirectorDeskProvider>
            </ScopedCssBaseline>
        </ThemeProvider>
    );
});
