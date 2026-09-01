import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import { ACTOR_SURFACE, ACTOR_SURFACE_LABEL_ZH } from "@/actor/ActorAppearance";
import type { ActorSurface } from "@/actor/ActorAppearance";
import { ACTOR_GIRTH_SCALE, ACTOR_HEIGHT_METERS, ACTOR_SHOULDER_SCALE, ActorBuild } from "@/actor/ActorBuild";
import type { ActorBuildInit, ActorBuildRange } from "@/actor/ActorBuild";
import { ACTOR_PALETTE } from "@/actor/ActorPalette";
import { BUILD_PRESETS, matchBuildPreset } from "@/actor/BuildPresetCompiler";
import type { InspectorSectionProps, ReportCommandResult } from "@/ui/inspector/Inspector";
import { INSPECTOR_FIELD_SX } from "@/ui/inspector/TransformFields";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import { MONO_FONT_STACK } from "@/ui/shell/theme";

const SWATCH_GRID_COLUMNS = "repeat(5, minmax(0, 1fr))";
const SWATCH_HEIGHT_PX = 26;
const SWATCH_RADIUS = 1;
const SELECTED_SWATCH_BORDER = "2px solid #fff";
const IDLE_SWATCH_BORDER = "2px solid rgba(255,255,255,0.14)";
const CONTROL_GAP = 1;
const CHIP_GAP = 0.5;
const HEIGHT_STEP_METERS = 0.01;
const SCALE_STEP = 0.01;
const HEIGHT_DECIMALS = 2;
const SCALE_DECIMALS = 2;

interface ActorControlsProps {
    readonly objectId: string;
    readonly report: ReportCommandResult;
}

const SURFACE_ORDER: readonly ActorSurface[] = [ACTOR_SURFACE.MATTE, ACTOR_SURFACE.SHEEN];

/** 色板一击到底:标签即 AI 词表,选中态用描边表达(画布之上禁大半径阴影)。 */
const ActorPaletteGrid = observer(function ActorPaletteGrid({ objectId, report }: ActorControlsProps) {
    const stores = useDirectorDeskStores();
    const appearance = stores.scene.manager.getEntity(objectId)?.actor?.appearance;
    if (!appearance) return null;

    return (
        <Box sx={{ display: "grid", gap: CHIP_GAP, gridTemplateColumns: SWATCH_GRID_COLUMNS }}>
            {ACTOR_PALETTE.map((swatch) => (
                <Tooltip key={swatch.id} title={swatch.labelZh}>
                    <ButtonBase
                        aria-label={`人偶颜色 ${swatch.labelZh}`}
                        sx={{
                            bgcolor: swatch.hex,
                            border:
                                appearance.baseColorHex === swatch.hex ? SELECTED_SWATCH_BORDER : IDLE_SWATCH_BORDER,
                            borderRadius: SWATCH_RADIUS,
                            height: SWATCH_HEIGHT_PX,
                        }}
                        onClick={() =>
                            report(
                                stores.dispatcher.dispatch(
                                    { type: "actor.appearance.set", payload: { objectId, baseColorHex: swatch.hex } },
                                    stores,
                                ),
                            )
                        }
                    />
                </Tooltip>
            ))}
        </Box>
    );
});

/**
 * 自定义取色器:拖色轮期间只重写材质 uniform(不写实体、不进历史),失焦才落一条命令。
 * 与 BonePicker 的拖拽范式一致——一次连续调节在撤销栈里是一条记录。
 */
const ActorColorPicker = observer(function ActorColorPicker({ objectId, report }: ActorControlsProps) {
    const stores = useDirectorDeskStores();
    const appearance = stores.scene.manager.getEntity(objectId)?.actor?.appearance;
    const [draft, setDraft] = useState(() => appearance?.baseColorHex ?? "");
    if (!appearance) return null;

    const preview = (baseColorHex: string) => {
        setDraft(baseColorHex);
        stores.actorRuntime.paint(objectId, appearance.withColor(baseColorHex));
        stores.playback.requestRender();
    };

    return (
        <TextField
            size="small"
            type="color"
            label="自定义颜色"
            value={draft || appearance.baseColorHex}
            slotProps={{ htmlInput: { "aria-label": "人偶自定义颜色" } }}
            onChange={(event) => preview(event.target.value)}
            onBlur={() =>
                report(
                    stores.dispatcher.dispatch(
                        { type: "actor.appearance.set", payload: { objectId, baseColorHex: draft } },
                        stores,
                    ),
                )
            }
        />
    );
});

/** 质感二选一而不是 metalness 滑杆:用户不认识渲染参数,而不压金属度颜色根本看不出来。 */
const ActorSurfaceToggle = observer(function ActorSurfaceToggle({ objectId, report }: ActorControlsProps) {
    const stores = useDirectorDeskStores();
    const appearance = stores.scene.manager.getEntity(objectId)?.actor?.appearance;
    if (!appearance) return null;

    return (
        <ToggleButtonGroup
            exclusive
            size="small"
            fullWidth
            value={appearance.surface}
            aria-label="人偶质感"
            onChange={(_, surface: ActorSurface | null) => {
                if (!surface) return;
                report(
                    stores.dispatcher.dispatch(
                        { type: "actor.appearance.set", payload: { objectId, surface } },
                        stores,
                    ),
                );
            }}
        >
            {SURFACE_ORDER.map((surface) => (
                <ToggleButton key={surface} value={surface}>
                    {ACTOR_SURFACE_LABEL_ZH[surface]}
                </ToggleButton>
            ))}
        </ToggleButtonGroup>
    );
});

interface BuildSliderProps {
    readonly label: string;
    readonly unit: string;
    readonly range: ActorBuildRange;
    readonly step: number;
    readonly decimals: number;
    readonly value: number;
    readonly onPreview: (value: number) => void;
    readonly onCommit: (value: number) => void;
}

/** 无领域身份的叶子控件(值型 props 的白名单):拖拽期实时预览,松手才提交。 */
const BuildSlider = observer(function BuildSlider({
    label,
    unit,
    range,
    step,
    decimals,
    value,
    onPreview,
    onCommit,
}: BuildSliderProps) {
    const [draft, setDraft] = useState(value);

    return (
        <Box>
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: MONO_FONT_STACK }}>
                {label} {draft.toFixed(decimals)}
                {unit}
            </Typography>
            <Slider
                size="small"
                min={range.min}
                max={range.max}
                step={step}
                value={draft}
                aria-label={label}
                onChange={(_, next) => {
                    if (typeof next !== "number") return;
                    setDraft(next);
                    onPreview(next);
                }}
                onChangeCommitted={(_, next) => {
                    if (typeof next === "number" && next !== value) onCommit(next);
                }}
            />
        </Box>
    );
});

/** 微调滑杆组:只在展开时挂载(收起即卸载,画布之上不留跟渲的重面板)。 */
const ActorBuildSliders = observer(function ActorBuildSliders({ objectId, report }: ActorControlsProps) {
    const stores = useDirectorDeskStores();
    const build = stores.scene.manager.getEntity(objectId)?.actor?.build;
    if (!build) return null;

    const preview = (patch: ActorBuildInit) => {
        stores.actorRuntime.shape(objectId, new ActorBuild({ ...build.toJSON(), ...patch }));
        stores.playback.requestRender();
    };
    const commit = (patch: ActorBuildInit) =>
        report(
            stores.dispatcher.dispatch(
                { type: "actor.build.set", payload: { objectId, build: { ...build.toJSON(), ...patch } } },
                stores,
            ),
        );

    return (
        <Stack spacing={CONTROL_GAP} sx={{ mt: CONTROL_GAP }}>
            <BuildSlider
                key={`height-${build.heightMeters}`}
                label="身高"
                unit=" m"
                range={ACTOR_HEIGHT_METERS}
                step={HEIGHT_STEP_METERS}
                decimals={HEIGHT_DECIMALS}
                value={build.heightMeters}
                onPreview={(heightMeters) => preview({ heightMeters })}
                onCommit={(heightMeters) => commit({ heightMeters })}
            />
            <BuildSlider
                key={`girth-${build.girthScale}`}
                label="围度"
                unit="×"
                range={ACTOR_GIRTH_SCALE}
                step={SCALE_STEP}
                decimals={SCALE_DECIMALS}
                value={build.girthScale}
                onPreview={(girthScale) => preview({ girthScale })}
                onCommit={(girthScale) => commit({ girthScale })}
            />
            <BuildSlider
                key={`shoulder-${build.shoulderScale}`}
                label="肩宽"
                unit="×"
                range={ACTOR_SHOULDER_SCALE}
                step={SCALE_STEP}
                decimals={SCALE_DECIMALS}
                value={build.shoulderScale}
                onPreview={(shoulderScale) => preview({ shoulderScale })}
                onCommit={(shoulderScale) => commit({ shoulderScale })}
            />
        </Stack>
    );
});

/** 预设是参数空间里的命名点:点 chip 写数值,拖滑杆偏离即显示「自定义」,两者共用一份状态。 */
const ActorBuildControls = observer(function ActorBuildControls({ objectId, report }: ActorControlsProps) {
    const stores = useDirectorDeskStores();
    const build = stores.scene.manager.getEntity(objectId)?.actor?.build;
    const [isTuning, setTuning] = useState(false);
    if (!build) return null;
    const activePresetId = matchBuildPreset(build);

    return (
        <Box sx={INSPECTOR_FIELD_SX}>
            <Typography variant="overline">体型 / BUILD</Typography>
            <Stack direction="row" sx={{ flexWrap: "wrap", gap: CHIP_GAP, mt: CHIP_GAP }}>
                {BUILD_PRESETS.map((preset) => (
                    <Chip
                        key={preset.id}
                        size="small"
                        label={preset.labelZh}
                        color={activePresetId === preset.id ? "primary" : "default"}
                        variant={activePresetId === preset.id ? "filled" : "outlined"}
                        onClick={() =>
                            report(
                                stores.dispatcher.dispatch(
                                    { type: "actor.build.apply-preset", payload: { objectId, presetId: preset.id } },
                                    stores,
                                ),
                            )
                        }
                    />
                ))}
                {activePresetId === null && <Chip size="small" label="自定义" variant="filled" />}
            </Stack>
            <Button size="small" sx={{ mt: CHIP_GAP }} onClick={() => setTuning((current) => !current)}>
                {isTuning ? "收起微调" : "微调"}
            </Button>
            {isTuning && <ActorBuildSliders objectId={objectId} report={report} />}
        </Box>
    );
});

const ActorAppearanceControls = observer(function ActorAppearanceControls({ objectId, report }: ActorControlsProps) {
    return (
        <Box sx={INSPECTOR_FIELD_SX}>
            <Typography variant="overline">外观 / APPEARANCE</Typography>
            <Stack spacing={CONTROL_GAP} sx={{ mt: CONTROL_GAP }}>
                <ActorPaletteGrid objectId={objectId} report={report} />
                <ActorColorPicker objectId={objectId} report={report} />
                <ActorSurfaceToggle objectId={objectId} report={report} />
            </Stack>
        </Box>
    );
});

/** tab 可见性谓词:纯函数,在 observer 渲染期求值,读 observable 会被追踪。 */
export function hasActorProfile(stores: Pick<DirectorDeskStores, "scene">, objectId: string): boolean {
    return Boolean(stores.scene.manager.getEntity(objectId)?.actor);
}

/** 形象 tab:外观与体型两组;仅人偶实体注册可见(判据是实体自带画像,不再反查资源目录)。 */
export const ActorImageSection = observer(function ActorImageSection({ primaryId, report }: InspectorSectionProps) {
    const stores = useDirectorDeskStores();
    if (!hasActorProfile(stores, primaryId)) return null;

    return (
        <>
            <ActorAppearanceControls objectId={primaryId} report={report} />
            <ActorBuildControls objectId={primaryId} report={report} />
        </>
    );
});
