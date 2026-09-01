import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import DeleteIcon from "@mui/icons-material/Delete";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import VideocamIcon from "@mui/icons-material/Videocam";
import ViewInArIcon from "@mui/icons-material/ViewInAr";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { observer } from "mobx-react-lite";
import type { MouseEvent, ReactNode } from "react";

import { RemoveShotCommand } from "../command/cameraCommands";
import { RemoveObjectCommand } from "../command/commands";
import { FrameViewCommand } from "../command/navigationCommands";
import type { SceneObjectKind } from "../core/SceneObject";
import { useDirectorDeskStores } from "./DirectorDeskContext";
import { OutlineRow } from "./outline/OutlineRow";
import { OutlineSection } from "./outline/OutlineSection";

const KIND_ICONS: Record<SceneObjectKind, ReactNode> = {
    model: <ViewInArIcon fontSize="small" />,
    camera: <VideocamIcon fontSize="small" />,
    light: <LightbulbIcon fontSize="small" />,
};

const SECTION_GAP = 1.5;

/** 机位行:机位住在 CameraDirector,不是场景实体,故删除走 camera.remove-shot。 */
const ShotOutlineRow = observer(function ShotOutlineRow({ shotId }: { readonly shotId: string }) {
    const stores = useDirectorDeskStores();
    const { camera, dispatcher, selection, ui } = stores;
    const active = camera.activeShotId === shotId;
    const viewLabel = active ? `切换至自由视角 ${shotId}` : `切换至机位视图 ${shotId}`;

    const removeShot = (event: MouseEvent<HTMLElement>): void => {
        event.stopPropagation();
        const result = dispatcher.dispatch({ type: RemoveShotCommand.TYPE, payload: { id: shotId } }, stores);
        if (result.ok) {
            selection.remove(shotId);
            return;
        }
        ui.setApplicationNotice(result.issues?.join(";") ?? result.error);
    };

    const toggleShotView = (event: MouseEvent<HTMLElement>): void => {
        event.stopPropagation();
        dispatcher.dispatch(
            { type: active ? "camera.deactivate" : "camera.activate", payload: active ? {} : { id: shotId } },
            stores,
        );
    };

    return (
        <OutlineRow
            selected={selection.isSelected(shotId)}
            icon={<VideocamIcon fontSize="small" />}
            label={shotId}
            secondary={active ? "机位视图中" : undefined}
            onSelect={(event) => selection.select(shotId, { additive: event.metaKey || event.ctrlKey })}
            actions={
                <>
                    <Tooltip title={viewLabel}>
                        <IconButton
                            size="small"
                            color={active ? "primary" : "default"}
                            aria-label={viewLabel}
                            onClick={toggleShotView}
                        >
                            <VideocamIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <IconButton size="small" aria-label={`删除 ${shotId}`} onClick={removeShot}>
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </>
            }
        />
    );
});

/** 场景实体行:聚焦与删除。 */
const EntityOutlineRow = observer(function EntityOutlineRow({ objectId }: { readonly objectId: string }) {
    const stores = useDirectorDeskStores();
    const { dispatcher, scene, selection } = stores;
    const entity = scene.manager.getEntity(objectId);
    if (!entity) return null;
    const name = entity.name;

    const frameObject = (event: MouseEvent<HTMLElement>): void => {
        event.stopPropagation();
        dispatcher.dispatch({ type: FrameViewCommand.TYPE, payload: { ids: [objectId] } }, stores);
    };

    const removeObject = (event: MouseEvent<HTMLElement>): void => {
        event.stopPropagation();
        dispatcher.dispatch({ type: RemoveObjectCommand.TYPE, payload: { id: objectId } }, stores);
    };

    return (
        <OutlineRow
            selected={selection.isSelected(objectId)}
            icon={KIND_ICONS[entity.kind]}
            label={name}
            onSelect={(event) => selection.select(objectId, { additive: event.metaKey || event.ctrlKey })}
            actions={
                <>
                    <Tooltip title={`聚焦 ${name}`}>
                        <IconButton size="small" aria-label={`聚焦 ${name}`} onClick={frameObject}>
                            <CenterFocusStrongIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <IconButton size="small" aria-label={`删除 ${name}`} onClick={removeObject}>
                        <DeleteIcon fontSize="small" />
                    </IconButton>
                </>
            }
        />
    );
});

/** 机位分组:CameraDirector 是它的唯一数据源。 */
const ShotOutlineSection = observer(function ShotOutlineSection() {
    const { camera } = useDirectorDeskStores();
    const shots = camera.director.listShots();
    return (
        <OutlineSection title="机位" count={shots.length} emptyHint="暂无机位,可在「机位与运镜」面板把当前视角存为机位">
            {shots.map(([id]) => (
                <ShotOutlineRow key={id} shotId={id} />
            ))}
        </OutlineSection>
    );
});

/** 对象分组:SceneManager 是它的唯一数据源。 */
const EntityOutlineSection = observer(function EntityOutlineSection() {
    const { scene } = useDirectorDeskStores();
    const entities = scene.manager.list();
    return (
        <OutlineSection title="对象" count={entities.length} emptyHint="场景为空,请从「模型资产」放置或导入模型">
            {entities.map((entity) => (
                <EntityOutlineRow key={entity.id} objectId={entity.id} />
            ))}
        </OutlineSection>
    );
});

/**
 * 场景大纲(左栏):机位与场景实体的统一索引。
 *
 * 两个分组各自绑定一个数据源(CameraDirector / SceneManager),共享同一份 SelectionStore——
 * 这也是机位选中/进出/删除的唯一入口,机位面板不再重复列一份(Rule of Two)。
 */
export const OutlinerPanel = observer(function OutlinerPanel() {
    return (
        <Box sx={{ display: "flex", flexDirection: "column", gap: SECTION_GAP, p: SECTION_GAP }}>
            <ShotOutlineSection />
            <EntityOutlineSection />
        </Box>
    );
});
