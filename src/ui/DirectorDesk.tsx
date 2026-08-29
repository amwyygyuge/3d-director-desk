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
import { BonePicker } from "../pose/BonePicker";
import { STAGE_DEFS } from "../workspace/stages";
import { TransformGizmoController } from "../transform/TransformGizmoController";
import { FlyDrive } from "../navigation/FlyDrive";
import { ShotNavigation } from "../navigation/ShotNavigation";
import { createDirectorDeskStores, DirectorDeskProvider } from "./DirectorDeskContext";
import type { DirectorDeskStores } from "./DirectorDeskContext";
import { CapturePreview } from "./CapturePreview";
import { Dock } from "./Dock";
import { HelpOverlay } from "./HelpOverlay";
import { Hotkeys } from "./Hotkeys";
import { placementFor } from "./importFiles";
import { Inspector } from "./Inspector";
import { LoadingChip } from "./LoadingChip";
import { OutlinerPanel } from "./OutlinerPanel";
import { directorDeskTheme } from "./theme";
import { SceneRoot } from "./scene/SceneRoot";
import { PlaybackDriver } from "./scene/PlaybackDriver";
import { StudioRig } from "./scene/StudioRig";
import { CameraMotionRig } from "./scene/CameraMotionRig";
import { MotionPathPreview } from "./scene/MotionPathPreview";
import { ShotCameraRig } from "./scene/ShotCameraRig";
import { ShotMarkers } from "./scene/ShotMarkers";
import { ShotAxisOverlay } from "./scene/ShotAxisOverlay";
import { ShotFrameOverlay } from "./ShotFrameOverlay";
import { ShotPanel } from "./ShotPanel";
import { Toolbar } from "./Toolbar";
import { TimelinePanel } from "./TimelinePanel";

export interface DirectorDeskProps {
    /** 宿主可传 MUI theme 覆盖默认暗色主题 */
    theme?: Theme;
    /** 宿主适配器:直嵌形态直接注入，不创建 postMessage 监听器 */
    host?: HostAdapter;
    /** iframe 宿主的精确 origin/source/session 信任边界；未提供时采用无通信安全缺省 */
    hostBridge?: HostBridgeConfiguration;
    /** Storybook/host initial local visibility for the non-persistent motion preview helper. */
    initialMotionPreviewVisible?: boolean;
    /** 实例就绪回调(每实例一次):Storybook 播种/宿主调试挂点;AI 面永远走命令层,不经此 */
    onReady?: (stores: DirectorDeskStores) => void;
}

/**
 * 导演台主组件(阶段一骨架)。
 *
 * 每实例一套 stores:Monet 画布可同时存在多个导演台节点,禁全局单例。
 * ScopedCssBaseline:样式重置只作用于本组件子树,不污染宿主页面。
 * 性能铁律落实:
 * - frameloop="demand":静态场景不持续渲染,状态变更显式 invalidate;
 * - three 对象经 ref 注册进 SceneManager 运行时表,不进 observable;
 * - 面板订阅走 MobX 细粒度 observer；仅本桌局部的轨迹预览开关会重建对应 helper。
 */
export const DirectorDesk = observer(function DirectorDesk({
    theme,
    host,
    hostBridge,
    onReady,
    initialMotionPreviewVisible = false,
}: DirectorDeskProps) {
    const [stores] = useState<DirectorDeskStores>(() => createDirectorDeskStores({ host, hostBridge }));
    const deskRef = useRef<HTMLDivElement>(null);
    const [motionPreviewVisible, setMotionPreviewVisible] = useState(initialMotionPreviewVisible);
    // 掌镜视角下左右/底 Dock 自动收成细条(不压画布);退出即恢复用户原折叠态
    const shotLive = stores.camera.activeShotId !== null;
    const hasSelection = stores.selection.selectedIds.length > 0;
    const stageDef = STAGE_DEFS[stores.ui.stage];

    // 每实例一次性就绪通知;onReady 变化不重复触发(播种语义)
    useEffect(() => {
        onReady?.(stores);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stores]);

    useEffect(() => {
        stores.lifecycle.activate();
        return () => {
            stores.lifecycle.scheduleDispose(() => {
                stores.continuity.dispose();
                stores.capture.detach();
                stores.ui.dispose();
                stores.assets.dispose();
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
        return detachImport;
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
                            <Canvas
                                frameloop={stores.clock.isPlaying || stores.ui.flying ? "always" : "demand"}
                                camera={{ position: [6, 4, 8], fov: 45 }}
                                gl={{ antialias: true, preserveDrawingBuffer: false }}
                                onCreated={(state) =>
                                    stores.capture.attach({
                                        gl: state.gl,
                                        scene: state.scene,
                                        camera: state.camera,
                                        invalidate: state.invalidate,
                                    })
                                }
                                onPointerMissed={() => {
                                    // 点 gizmo 对 R3F 射线是空点;守卫窗内的 pointerMissed 是拖拽余波,不取消选中
                                    if (performance.now() - stores.ui.lastGizmoInteractionAt > GIZMO_CLICK_GUARD_MS) {
                                        stores.selection.clear();
                                    }
                                }}
                            >
                                <color attach="background" args={["#171717"]} />
                                <Grid
                                    args={[40, 40]}
                                    cellColor="#333333"
                                    sectionColor="#555555"
                                    infiniteGrid
                                    userData={{ helper: true }}
                                />
                                <OrbitControls makeDefault enableDamping={stores.camera.activeShotId === null} />
                                <StudioRig />
                                <SceneRoot />
                                <BonePicker />
                                <TransformGizmoController />
                                <ShotMarkers />
                                <ShotAxisOverlay />
                                <PlaybackDriver />
                                <ShotCameraRig />
                                <CameraMotionRig />
                                <MotionPathPreview visible={motionPreviewVisible && stageDef.helpers.motionPaths} />
                                <FlyDrive />
                                <ShotNavigation />
                            </Canvas>
                            <ShotFrameOverlay />
                            <CapturePreview />
                            <LoadingChip />
                        </div>
                        <Toolbar />
                        <Dock
                            side="left"
                            title="场景"
                            collapsed={stores.ui.leftDockCollapsed || shotLive}
                            onToggle={() => stores.ui.toggleLeftDock()}
                        >
                            <OutlinerPanel />
                            {stores.ui.stage === "camera" && (
                                <ShotPanel
                                    motionPreviewVisible={motionPreviewVisible}
                                    onMotionPreviewVisibleChange={setMotionPreviewVisible}
                                />
                            )}
                        </Dock>
                        {hasSelection && (
                            <Dock
                                side="right"
                                title="属性"
                                collapsed={stores.ui.rightDockCollapsed || shotLive}
                                onToggle={() => stores.ui.toggleRightDock()}
                            >
                                <Inspector />
                            </Dock>
                        )}
                        {stageDef.timeline && (
                            <Dock
                                side="bottom"
                                title="时间轴"
                                collapsed={stores.ui.timelineCollapsed || shotLive}
                                onToggle={() => stores.ui.toggleTimelineDock()}
                            >
                                <TimelinePanel />
                            </Dock>
                        )}
                        <Hotkeys deskRef={deskRef} />
                        <HelpOverlay />
                    </div>
                </DirectorDeskProvider>
            </ScopedCssBaseline>
        </ThemeProvider>
    );
});
