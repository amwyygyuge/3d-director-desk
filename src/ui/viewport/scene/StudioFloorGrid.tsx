import { Grid } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";

import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const GRID_CELL_COLOR = "#333333";
const GRID_SECTION_COLOR = "#555555";
/**
 * 实心地面略微沉在网格之下:两者共面会 z-fighting,网格线会随视角闪烁。
 * 量级取到肉眼不可辨,但足够拉开深度精度。
 */
const FLOOR_SURFACE_DROP = 0.004;
/** 地面粗糙度:参考地板是漫反射基准面,不该出现镜面高光抢主体。 */
const FLOOR_ROUGHNESS = 0.95;
const FLOOR_METALNESS = 0;

/** 演播室地板是参考视频的空间基准，不属于截图/导出时需隐藏的编辑辅助物。 */
export const StudioFloorGrid = observer(function StudioFloorGrid() {
    const { studio } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    const gridSizeMeters = studio.gridSizeMeters;
    const floorColor = studio.floorColor;

    useEffect(() => {
        invalidate();
    }, [invalidate, gridSizeMeters, floorColor]);

    return (
        <>
            <StudioFloorSurface />
            <Grid
                args={[gridSizeMeters, gridSizeMeters]}
                cellColor={GRID_CELL_COLOR}
                sectionColor={GRID_SECTION_COLOR}
            />
        </>
    );
});

/**
 * 实心地面(独立 observer):承载地板颜色,并作为投影的接收面。
 *
 * 必须是一张真实的面而不是 `Grid` 的属性——drei 的 `Grid` 只画线,没有填充色,
 * 且投影需要一个 `receiveShadow` 的表面才能落下来。两件事由同一张面承担:
 * 换颜色与接投影本就都属于「地面」这一个概念,拆成两张面会同时带来共面闪烁与双份绘制。
 */
const StudioFloorSurface = observer(function StudioFloorSurface() {
    const { studio } = useDirectorDeskStores();
    const gridSizeMeters = studio.gridSizeMeters;
    const floorColor = studio.floorColor;

    return (
        <mesh receiveShadow position={[0, -FLOOR_SURFACE_DROP, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[gridSizeMeters, gridSizeMeters]} />
            <meshStandardMaterial color={floorColor} roughness={FLOOR_ROUGHNESS} metalness={FLOOR_METALNESS} />
        </mesh>
    );
});
