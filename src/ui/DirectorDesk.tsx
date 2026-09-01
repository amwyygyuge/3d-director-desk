import { Grid, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import ScopedCssBaseline from "@mui/material/ScopedCssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import type { Theme } from "@mui/material/styles";
import { observer } from "mobx-react-lite";
import { useEffect, useRef, useState } from "react";

import { formatFromUrl } from "../assets/ModelAsset";
import type { HostBridgeConfiguration } from "../bridge/HostBridge";
import { PROTOCOL_VERSION } from "../bridge/protocol";
import { PostMessageAdapter } from "../host/HostAdapter";
import type { HostAdapter } from "../host/HostAdapter";
import { GIZMO_CLICK_GUARD_MS } from "../store/UiStore";
import { RENDER_QUALITY_PROFILES } from "../store/WorkbenchLayoutStore";
import { BonePicker } from "./scene/BonePicker";
import { TransformGizmoController } from "./scene/TransformGizmoController";
import { FlyDrive } from "./scene/FlyDrive";
import { ShotNavigation } from "./scene/ShotNavigation";
import type { AssetProvider } from "../assets/catalog/AssetProvider";
import { createDirectorDeskStores, DirectorDeskProvider } from "./DirectorDeskContext";
import type { DirectorDeskStores } from "./DirectorDeskContext";
import { AssetRail } from "./chrome/AssetRail";
import { ApplicationNotice } from "./chrome/ApplicationNotice";
import { InspectorSheet } from "./chrome/InspectorSheet";
import { TimelineConsole } from "./chrome/TimelineConsole";
import { PresentationExitHint, TopPillBar } from "./chrome/TopPillBar";
import { CapturePreview } from "./CapturePreview";
import { HelpOverlay } from "./HelpOverlay";
import { Hotkeys } from "./Hotkeys";
import { FrameRateIndicator } from "./FrameRateIndicator";
import { placementFor } from "./importFiles";
import { LoadingChip } from "./LoadingChip";
import { directorDeskTheme, VIEWPORT_BACKGROUND } from "./theme";
import { SceneRoot } from "./scene/SceneRoot";
import { PlaybackDriver } from "./scene/PlaybackDriver";
import { StudioRig } from "./scene/StudioRig";
import { CameraMotionRig } from "./scene/CameraMotionRig";
import { MotionPathPreview } from "./scene/MotionPathPreview";
import { ShotCameraRig } from "./scene/ShotCameraRig";
import { ShotMarkers } from "./scene/ShotMarkers";
import { ShotFrameOverlay } from "./ShotFrameOverlay";
import { ViewportInteractionHints } from "./ViewportInteractionHints";

const STUDIO_CAMERA_FOV_DEGREES = 45;
const STUDIO_CAMERA_POSITION: [number, number, number] = [6, 4, 8];
const STUDIO_GRID_SIZE_METERS = 12;
const STUDIO_CAMERA_MIN_DISTANCE_METERS = 2;
const STUDIO_CAMERA_MAX_DISTANCE_METERS = 18;

export interface DirectorDeskProps {
    /** 宿主可传 MUI theme 覆盖默认暗色主题 */
    theme?: Theme;
    /** 宿主适配器:直嵌形态直接注入，不创建 postMessage 监听器 */
    host?: HostAdapter;
    /** 宿主注入的资源 provider(直嵌形态;iframe 形态走 bridge register-assets 消息) */
    assetProviders?: readonly AssetProvider[];
    /** iframe 宿主的精确 origin/source/session 信任边界；未提供时采用无通信安全缺省 */
    hostBridge?: HostBridgeConfiguration;
    /** 运镜轨迹预览的初始可见性(Storybook/宿主播种);运行时开关在左栏机位面板 */
    initialMotionPreviewVisible?: boolean;
    /** 实例就绪回调(每实例一次):Storybook 播种/宿主调试挂点;AI 面永远走命令层,不经此 */
    onReady?: (stores: DirectorDeskStores) => void;
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
    onReady,
    initialMotionPreviewVisible = false,
}: DirectorDeskProps) {
    const [stores] = useState<DirectorDeskStores>(() =>
        createDirectorDeskStores({
            host,
            hostBridge,
            assetProviders,
            motionPathPreviewVisible: initialMotionPreviewVisible,
        }),
    );
    const deskRef = useRef<HTMLDivElement>(null);

    // 每实例一次性就绪通知;onReady 变化不重复触发(播种语义)
    useEffect(() => {
        onReady?.(stores);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stores]);

    useEffect(() => {
        stores.lifecycle.activate();
        return () => {
            stores.lifecycle.scheduleDispose(() => {
                stores.capture.detach();
                stores.ui.dispose();
                stores.assets.dispose();
                stores.documentImports.dispose();
                stores.animations.dispose();
                stores.playback.dispose();
                stores.binder.dispose();
                stores.models.dispose();
                stores.skeletons.dispose();
                stores.scene.manager.dispose();
                stores.host.dispose?.();
            });
        };
    }, [stores]);
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
                        id: `model-${crypto.randomUUID()}`,
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
            <ScopedCssBaseline className="h-full">
                <DirectorDeskProvider value={stores}>
                    <div
                        ref={deskRef}
                        className="relative h-full w-full overflow-hidden"
                        tabIndex={-1}
                        onPointerDown={(event) => event.currentTarget.focus()}
                    >
                        {/* 画布全屏:一切 UI 悬浮其上,折叠/展开不再引起画面跳动 */}
                        <div className="absolute inset-0">
                            {/* key 绑画质档:antialias 是 WebGL 上下文属性,只能靠重建上下文切换 */}
                            <Canvas
                                key={stores.layout.renderQuality}
                                frameloop={
                                    stores.clock.isPlaying || stores.actionPreview.isPlaying || stores.ui.flying
                                        ? "always"
                                        : "demand"
                                }
                                camera={{ position: STUDIO_CAMERA_POSITION, fov: STUDIO_CAMERA_FOV_DEGREES }}
                                dpr={[...RENDER_QUALITY_PROFILES[stores.layout.renderQuality].dpr]}
                                gl={{
                                    antialias: RENDER_QUALITY_PROFILES[stores.layout.renderQuality].antialias,
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
                                    // 掌镜中拖拽转向的 mouseup 也算"点空",不该清选中
                                    if (stores.camera.activeShotId !== null) return;
                                    // 点 gizmo 对 R3F 射线是空点;守卫窗内的 pointerMissed 是拖拽余波,不取消选中
                                    if (performance.now() - stores.ui.lastGizmoInteractionAt > GIZMO_CLICK_GUARD_MS) {
                                        stores.selection.clear();
                                    }
                                }}
                            >
                                <color attach="background" args={[VIEWPORT_BACKGROUND]} />
                                {stores.layout.authoringVisible && (
                                    <Grid
                                        args={[STUDIO_GRID_SIZE_METERS, STUDIO_GRID_SIZE_METERS]}
                                        cellColor="#333333"
                                        sectionColor="#555555"
                                        userData={{ helper: true }}
                                    />
                                )}
                                <OrbitControls
                                    makeDefault
                                    enableDamping={stores.camera.activeShotId === null}
                                    minDistance={STUDIO_CAMERA_MIN_DISTANCE_METERS}
                                    maxDistance={STUDIO_CAMERA_MAX_DISTANCE_METERS}
                                />
                                <StudioRig />
                                <SceneRoot />
                                <BonePicker />
                                <TransformGizmoController />
                                <ShotMarkers />
                                <PlaybackDriver />
                                <ShotCameraRig />
                                <CameraMotionRig />
                                <MotionPathPreview visible={stores.layout.motionPathPreviewActive} />
                                <FlyDrive />
                                <ShotNavigation />
                            </Canvas>
                            <ShotFrameOverlay />
                            <CapturePreview />
                            <LoadingChip />
                            <FrameRateIndicator />
                            <ViewportInteractionHints />
                        </div>
                        {/* 悬浮壳层:根容器放行指针事件,四区各自 pointer-events-auto 重新拦截 */}
                        <div className="pointer-events-none absolute inset-0">
                            <TopPillBar />
                            <AssetRail />
                            <InspectorSheet />
                            <TimelineConsole />
                            <PresentationExitHint />
                        </div>
                        <ApplicationNotice />
                        <Hotkeys deskRef={deskRef} />
                        <HelpOverlay />
                    </div>
                </DirectorDeskProvider>
            </ScopedCssBaseline>
        </ThemeProvider>
    );
});
