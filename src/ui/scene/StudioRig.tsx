import { useThree } from "@react-three/fiber";
import { observer } from "mobx-react-lite";
import { useEffect } from "react";

import { LIGHTING_MODE } from "../../store/SceneStore";
import { useDirectorDeskStores } from "../DirectorDeskContext";

const AMBIENT_INTENSITY = 0.5;
const KEY_LIGHT_INTENSITY = 1.4;
const FILL_LIGHT_INTENSITY = 0.65;
const RIM_LIGHT_INTENSITY = 0.9;
const KEY_LIGHT_COLOR = "#ffffff";
const FILL_LIGHT_COLOR = "#b7d4ff";
const RIM_LIGHT_COLOR = "#ffd1a6";
const KEY_LIGHT_POSITION = [5, 6, 4] as const;
const FILL_LIGHT_POSITION = [-4, 2, 4] as const;
const RIM_LIGHT_POSITION = [0, 5, -6] as const;

/** 演播室三点布光：仅模式为 studio 时创建，不参与用户灯光实体与其历史。 */
export const StudioRig = observer(function StudioRig() {
    const { scene } = useDirectorDeskStores();
    const invalidate = useThree((state) => state.invalidate);
    const lightingMode = scene.lightingMode;
    const revision = scene.revision;

    useEffect(() => {
        invalidate();
    }, [invalidate, lightingMode, revision]);

    if (lightingMode !== LIGHTING_MODE.STUDIO) return null;

    return (
        <>
            <ambientLight intensity={AMBIENT_INTENSITY} />
            <directionalLight color={KEY_LIGHT_COLOR} intensity={KEY_LIGHT_INTENSITY} position={KEY_LIGHT_POSITION} />
            <directionalLight
                color={FILL_LIGHT_COLOR}
                intensity={FILL_LIGHT_INTENSITY}
                position={FILL_LIGHT_POSITION}
            />
            <directionalLight color={RIM_LIGHT_COLOR} intensity={RIM_LIGHT_INTENSITY} position={RIM_LIGHT_POSITION} />
        </>
    );
});
