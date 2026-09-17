import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BufferAttribute, BufferGeometry, Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Mesh, Object3D } from "three";

import { WalkDraftCompiler } from "@/authoring/WalkDraftCompiler";
import { SetTimelineTrackCommand } from "@/command/timelineCommands";
import type { Vec3 } from "@/core/SceneObject";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { reportCommandFailure } from "@/ui/shell/commandFeedback";
import { collectSurfaceSnapCandidates, pickUpwardSurfacePoint } from "@/core/surfaceSnap";

/** 绘制平面尺寸:覆盖常见场景范围,超出即认为不是走位而是换场。 */
const DRAFT_PLANE_SIZE_METERS = 200;
/** 笔迹上限:超过即停止收点(抽稀前的原始点没有保留价值,只会拖慢松手那一刻)。 */
const MAX_RAW_POINTS = 2000;
/** 相邻采样点的最小间距:滤掉指针抖动,抽稀前先降一个数量级。 */
const MIN_SAMPLE_DISTANCE_METERS = 0.05;
const DRAFT_PLANE_HEIGHT_METERS = 0;
const DRAFT_LINE_COLOR = "#34d399";
const DRAFT_PLANE_COLOR = "#10b981";
const DRAFT_PLANE_OPACITY = 0.06;
const TRANSFORM_TRACK_PREFIX = "transform-";
const NOTICE = {
    NO_TARGET: "先选中一个对象,再绘制它的走位",
    TOO_SHORT: "笔迹太短,没有生成走位",
    EXTENDED: "走位比时间轴长,时间轴已延长至 ",
} as const;

const TMP_POINTER = new Vector2();
const TMP_RAYCASTER = new Raycaster();
const TMP_INTERSECTION = new Vector3();
/** 地面绘制平面:走位天然贴地,高度不参与绘制(升降是后续能力)。 */
const GROUND_PLANE = new Plane(new Vector3(0, 1, 0), -DRAFT_PLANE_HEIGHT_METERS);
const NDC_SPAN = 2;
const COMPILER = new WalkDraftCompiler();

function squaredDistance(from: Vec3, x: number, y: number, z: number): number {
    const dx = x - from[0];
    const dy = y - from[1];
    const dz = z - from[2];
    return dx * dx + dy * dy + dz * dz;
}

/** 笔迹几何预分配一次,绘制期只改 drawRange 与已写入的分量,零重建。 */
function createStrokeGeometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(MAX_RAW_POINTS * 3), 3));
    geometry.setDrawRange(0, 0);
    return geometry;
}

function commitDraft({
    stores,
    points,
    targetId,
}: {
    readonly stores: DirectorDeskStores;
    readonly points: readonly Vec3[];
    readonly targetId: string;
}): void {
    const entity = stores.scene.manager.getEntity(targetId);
    if (!entity) return;
    const keyframes = COMPILER.compile({
        points,
        base: entity.transform,
        startSeconds: stores.clock.time,
    });
    if (keyframes.length === 0) {
        stores.ui.setApplicationNotice(NOTICE.TOO_SHORT);
        return;
    }
    // 整条笔迹落成单条命令:一次撤销回到绘制前,半途失败也不会留下半截轨道
    const durationBefore = stores.timeline.document.duration;
    const result = stores.dispatcher.dispatch(
        {
            type: SetTimelineTrackCommand.TYPE,
            payload: { trackId: `${TRANSFORM_TRACK_PREFIX}${targetId}`, targetId, keyframes },
        },
        stores,
    );
    if (!result.ok) {
        reportCommandFailure(stores, result);
        return;
    }
    // 时间轴被内容撑长是全局改动,作者有权知道:静默改工程时长等于偷改成片长度
    const durationAfter = stores.timeline.document.duration;
    if (durationAfter > durationBefore) {
        stores.ui.setApplicationNotice(`${NOTICE.EXTENDED}${durationAfter.toFixed(1)}s`);
    }
}

/**
 * 走位草绘控制器:在地面平面上拖出一条笔迹,松手编译成该对象的整条走位轨。
 *
 * 边界:本组件只负责「把指针轨迹变成世界坐标点」与预览渲染,抽稀与配速归
 * WalkDraftCompiler(领域服务),持久化归命令层——组件不写 store、不算时间。
 */
export const WalkDraftController = observer(function WalkDraftController() {
    const stores = useDirectorDeskStores();
    const { selection, viewportCamera } = stores;
    const camera = useThree((state) => state.camera);
    const canvas = useThree((state) => state.gl.domElement);
    const invalidate = useThree((state) => state.invalidate);
    const pointsRef = useRef<Vec3[]>([]);
    // 贴面候选在笔画起点快照(排除走位对象自身);绘制期沿指针射线取站面命中点,笔迹沿台阶/台面爬升
    const snapCandidatesRef = useRef<readonly Object3D[]>([]);
    const strokeRef = useRef<Mesh | null>(null);
    const [drawing, setDrawing] = useState(false);
    const geometry = useMemo(createStrokeGeometry, []);

    useEffect(() => () => geometry.dispose(), [geometry]);

    const pushPoint = useCallback(
        (clientX: number, clientY: number): void => {
            const points = pointsRef.current;
            if (points.length >= MAX_RAW_POINTS) return;
            const bounds = canvas.getBoundingClientRect();
            TMP_POINTER.set(
                ((clientX - bounds.left) / bounds.width) * NDC_SPAN - 1,
                -((clientY - bounds.top) / bounds.height) * NDC_SPAN + 1,
            );
            TMP_RAYCASTER.setFromCamera(TMP_POINTER, camera);
            // 指针直取站面:笔尖指着哪块地板(含布景楼面/台面)就画在哪,消除隐形平面的视差错位;
            // 指到没有布景的空处再退回 y=0 绘制平面
            const hasSurface = pickUpwardSurfacePoint(TMP_RAYCASTER, snapCandidatesRef.current, TMP_INTERSECTION);
            if (!hasSurface && !TMP_RAYCASTER.ray.intersectPlane(GROUND_PLANE, TMP_INTERSECTION)) return;
            const last = points[points.length - 1];
            const { x, y, z } = TMP_INTERSECTION;
            if (last && squaredDistance(last, x, y, z) < MIN_SAMPLE_DISTANCE_METERS * MIN_SAMPLE_DISTANCE_METERS) {
                return;
            }
            points.push([x, y, z]);
            const attribute = geometry.getAttribute("position");
            if (attribute instanceof BufferAttribute) {
                attribute.setXYZ(points.length - 1, x, y, z);
                attribute.needsUpdate = true;
            }
            geometry.setDrawRange(0, points.length);
            invalidate();
        },
        [camera, canvas, geometry, invalidate],
    );

    const beginStroke = useCallback(
        (event: ThreeEvent<PointerEvent>): void => {
            if (event.button !== 0) return;
            if (!selection.primaryId) {
                stores.ui.setApplicationNotice(NOTICE.NO_TARGET);
                return;
            }
            event.stopPropagation();
            pointsRef.current = [];
            snapCandidatesRef.current = collectSurfaceSnapCandidates(stores.scene.manager, selection.primaryId);
            geometry.setDrawRange(0, 0);
            setDrawing(true);
            pushPoint(event.nativeEvent.clientX, event.nativeEvent.clientY);
        },
        [geometry, pushPoint, selection, stores],
    );

    // 指针跟踪挂 window:笔尖一旦划出绘制平面,对象级 pointermove 就断供,笔迹会突然截断
    useEffect(() => {
        if (!drawing) return undefined;
        const onMove = (event: PointerEvent) => pushPoint(event.clientX, event.clientY);
        const onUp = () => {
            const targetId = selection.primaryId;
            if (targetId) commitDraft({ stores, points: pointsRef.current, targetId });
            pointsRef.current = [];
            geometry.setDrawRange(0, 0);
            setDrawing(false);
            invalidate();
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        return () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
        };
    }, [drawing, geometry, invalidate, pushPoint, selection, stores]);

    if (!viewportCamera.isDraftActive) return null;
    return (
        <group userData={{ helper: true }}>
            <mesh
                ref={strokeRef}
                onPointerDown={beginStroke}
                position={[0, DRAFT_PLANE_HEIGHT_METERS, 0]}
                rotation={[-Math.PI / 2, 0, 0]}
            >
                <planeGeometry args={[DRAFT_PLANE_SIZE_METERS, DRAFT_PLANE_SIZE_METERS]} />
                <meshBasicMaterial
                    color={DRAFT_PLANE_COLOR}
                    depthWrite={false}
                    opacity={DRAFT_PLANE_OPACITY}
                    transparent
                />
            </mesh>
            <line>
                <primitive object={geometry} attach="geometry" />
                <lineBasicMaterial color={DRAFT_LINE_COLOR} toneMapped={false} />
            </line>
        </group>
    );
});
