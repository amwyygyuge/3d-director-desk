import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { reaction } from "mobx";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, Color } from "three";
import type { Mesh } from "three";

import { createPositionSample } from "@/motion/MotionTrajectory";
import { TimelineSelection } from "@/authoring/TimelineSelection";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
import type { TimelineTrack } from "@/timeline/TimelineTrack";
import { createTransformSample, evaluateTransformTrack } from "@/timeline/TimelineSampler";
import type { TransformSample } from "@/timeline/TimelineSampler";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { WalkKeyHelper } from "@/ui/viewport/scene/WalkKeyHelper";

/** 曲线细分:段数 × 本值,足以让转弯不显折角又不铺张顶点。 */
const PATH_SAMPLES_PER_SEGMENT = 24;
/** 等时刻度间隔:点的疏密即速度——密=慢,疏=快,不必打开曲线编辑器就能读出加减速。 */
const TICK_INTERVAL_SECONDS = 0.5;
const TICK_POINT_SIZE_PX = 5;
const MARKER_RADIUS_METERS = 0.12;
const MARKER_SEGMENTS = 12;

/** 走位色(emerald):与运镜的 Indigo 区分开,一眼分辨这条线是谁在走。 */
const PATH_COLOR = "#10b981";
/** 起幅暗、落幅亮:同一条 emerald 的明度渐变解决「这条线往哪个方向走」的歧义。 */
const PATH_COLOR_START = new Color("#065f46");
const PATH_COLOR_END = new Color("#6ee7b7");
/** 当前时刻恒为红:与时间轴播放头同色,三维里认得出它是同一个东西。 */
const PLAYHEAD_COLOR = "#ef4444";

/** 辅助物求值缓冲:reaction 每次 playhead 变更都会走到,复用即零分配。 */
const MARKER_SAMPLE: TransformSample = createTransformSample();

interface TrackPathGeometry {
    readonly path: BufferGeometry;
    readonly ticks: BufferGeometry;
}

function createPathGeometry(track: TimelineTrack): BufferGeometry {
    const trajectory = track.trajectory;
    const geometry = new BufferGeometry();
    if (!trajectory) return geometry;
    const sampleCount = trajectory.segmentCount * PATH_SAMPLES_PER_SEGMENT;
    const positions = new Float32Array((sampleCount + 1) * 3);
    const colors = new Float32Array((sampleCount + 1) * 3);
    const sample = createPositionSample();
    const color = new Color();
    for (let step = 0; step <= sampleCount; step += 1) {
        const progress = step / sampleCount;
        trajectory.samplePosition(progress, sample);
        const offset = step * 3;
        positions[offset] = sample.x;
        positions[offset + 1] = sample.y;
        positions[offset + 2] = sample.z;
        color.lerpColors(PATH_COLOR_START, PATH_COLOR_END, progress);
        colors[offset] = color.r;
        colors[offset + 1] = color.g;
        colors[offset + 2] = color.b;
    }
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    return geometry;
}

/** 刻度点走轨道求值(而非轨迹的均匀参数),缓动因此如实反映在点距上。 */
function createTickGeometry(track: TimelineTrack): BufferGeometry {
    const first = track.keyframes[0];
    const last = track.keyframes[track.keyframes.length - 1];
    const geometry = new BufferGeometry();
    if (!first || !last) return geometry;
    const span = last.time - first.time;
    const tickCount = Math.floor(span / TICK_INTERVAL_SECONDS);
    const positions = new Float32Array((tickCount + 1) * 3);
    const sample = createTransformSample();
    for (let index = 0; index <= tickCount; index += 1) {
        evaluateTransformTrack(track, first.time + index * TICK_INTERVAL_SECONDS, sample);
        const offset = index * 3;
        positions[offset] = sample.position[0];
        positions[offset + 1] = sample.position[1];
        positions[offset + 2] = sample.position[2];
    }
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    return geometry;
}

function createTrackPathGeometry(track: TimelineTrack): TrackPathGeometry {
    return {
        path: createPathGeometry(track),
        ticks: createTickGeometry(track),
    };
}

interface ObjectTrackPathProps {
    readonly trackId: string;
}

/**
 * 单条走位轨的场景辅助物:曲线 + 等时刻度 + 可拖关键帧把手 + 当前时刻位置球。
 *
 * 几何随不可变轨道重建(编辑期低频);当前时刻球不走 React 重渲——reaction 直写
 * Three ref,播放期零 DOM 变更、零调和。
 */
const ObjectTrackPath = observer(function ObjectTrackPath({ trackId }: ObjectTrackPathProps) {
    const { timeline, clock, timelineSelection, selection, ui } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    const markerRef = useRef<Mesh>(null);
    const track = timeline.document.track(trackId);
    const geometry = useMemo(() => (track?.trajectory ? createTrackPathGeometry(track) : null), [track]);

    useEffect(
        () => () => {
            geometry?.path.dispose();
            geometry?.ticks.dispose();
        },
        [geometry],
    );

    useEffect(() => {
        if (!track || !geometry) return;
        return reaction(
            () => clock.time,
            (time) => {
                const marker = markerRef.current;
                if (!marker) return;
                const covered = evaluateTransformTrack(track, time, MARKER_SAMPLE);
                marker.visible = covered;
                if (covered) {
                    marker.position.set(
                        MARKER_SAMPLE.position[0],
                        MARKER_SAMPLE.position[1],
                        MARKER_SAMPLE.position[2],
                    );
                }
                invalidate();
            },
            { fireImmediately: true },
        );
    }, [clock, track, geometry, invalidate]);

    if (!track || !geometry) return null;
    // 变换模式下指针归 gizmo:走位辅助物与手柄在空间上重叠,抢走这次按下会当场解除变换
    const selectTrack = (event: ThreeEvent<PointerEvent>) => {
        if (ui.isGizmoEngaged) return;
        event.stopPropagation();
        selection.clear();
        timelineSelection.select(TimelineSelection.walkTrack(track.id));
    };
    return (
        <group onPointerDown={selectTrack} userData={{ helper: true, timelineTrackId: track.id }}>
            <line>
                <primitive object={geometry.path} attach="geometry" />
                <lineBasicMaterial vertexColors toneMapped={false} />
            </line>
            <points>
                <primitive object={geometry.ticks} attach="geometry" />
                <pointsMaterial
                    color={PATH_COLOR}
                    size={TICK_POINT_SIZE_PX}
                    sizeAttenuation={false}
                    toneMapped={false}
                />
            </points>
            {track.keyframes.map((keyframe) => (
                <WalkKeyHelper key={keyframe.id} keyframeId={keyframe.id} trackId={track.id} />
            ))}
            <mesh ref={markerRef} visible={false}>
                <sphereGeometry args={[MARKER_RADIUS_METERS, MARKER_SEGMENTS, MARKER_SEGMENTS]} />
                <meshBasicMaterial color={PLAYHEAD_COLOR} toneMapped={false} />
            </mesh>
        </group>
    );
});

/** 走位轨迹辅助物:与运镜轨迹共用显隐开关(成片画面里不出现编排辅助物)。 */
export const ObjectMotionPathPreview = observer(function ObjectMotionPathPreview() {
    const { timeline, motionAuthoring } = useDirectorDeskStores();
    if (!motionAuthoring.pathHelpersVisible) return null;
    return (
        <group userData={{ helper: true }}>
            {timeline.document.tracks
                .filter((track) => track.kind === TIMELINE_TRACK_KIND.TRANSFORM)
                .map((track) => (
                    <ObjectTrackPath key={track.id} trackId={track.id} />
                ))}
        </group>
    );
});
