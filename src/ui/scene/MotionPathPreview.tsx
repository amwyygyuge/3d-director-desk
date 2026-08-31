import { observer } from "mobx-react-lite";

import { MotionClipPathPreview } from "./MotionClipPathPreview";
import { useDirectorDeskStores } from "../DirectorDeskContext";

const PATH_COLORS = ["#00bcd4", "#9c7ae8", "#467fd0", "#d67db4"] as const;

/** Immutable clip geometry is built only when authored path data changes; helpers are excluded from capture. */
export const MotionPathPreview = observer(function MotionPathPreview({ visible }: { readonly visible: boolean }) {
    const { motion } = useDirectorDeskStores();
    if (!visible) return null;
    return (
        <group userData={{ helper: true }}>
            {motion.clips.map((clip, index) => (
                <MotionClipPathPreview
                    key={clip.id}
                    clip={clip}
                    color={PATH_COLORS[index % PATH_COLORS.length] ?? PATH_COLORS[0]}
                />
            ))}
        </group>
    );
});
