import { Grid } from "@react-three/drei";
import { observer } from "mobx-react-lite";

import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const GRID_CELL_COLOR = "#333333";
const GRID_SECTION_COLOR = "#555555";

/** 演播室地板是参考视频的空间基准，不属于截图/导出时需隐藏的编辑辅助物。 */
export const StudioFloorGrid = observer(function StudioFloorGrid() {
    const { studio } = useDirectorDeskStores();
    return (
        <Grid
            args={[studio.gridSizeMeters, studio.gridSizeMeters]}
            cellColor={GRID_CELL_COLOR}
            sectionColor={GRID_SECTION_COLOR}
        />
    );
});
