import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useState } from "react";

import { labelBone } from "@/actor/BoneLabeler";
import type { BoneLabel } from "@/actor/BoneLabeler";
import type { BoneKey, QuaternionTuple } from "@/pose/PoseSnapshot";
import type { BoneTreeNodeDto, SkeletonDiscoveryDto } from "@/pose/SkeletonRuntimeRegistry";
import type { InspectorSectionProps } from "@/ui/inspector/Inspector";
import { INSPECTOR_FIELD_SX } from "@/ui/inspector/TransformFields";
import { useDirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

const CONTROL_GAP = 1;
const CHIP_GAP = 0.5;
const ROW_MIN_HEIGHT_PX = 28;
const INDENT_PX = 14;
/** 缩进封顶:深链(手指/扭转骨)不再被推出可视区,层级关系改由连接线语义承担 */
const MAX_INDENT_DEPTH = 8;
const TREE_MAX_HEIGHT_VH = 40;
const DIRTY_DOT_PX = 6;
const GROUP_KEY_PREFIX = "fingers:";

/** 骨骼树渲染视图模型:标签在构建期解析一次,渲染期零分词 */
interface BoneNodeVM {
    readonly key: BoneKey;
    readonly label: BoneLabel;
    readonly plainChildren: readonly BoneNodeVM[];
    readonly fingerChildren: readonly BoneNodeVM[];
}

function buildBoneNodeVM(node: BoneTreeNodeDto): BoneNodeVM {
    const children = node.children.map(buildBoneNodeVM);
    const label = labelBone(node.name);
    // 分组只发生在链根(手腕→指根):链内各节是顺序层级,照常展开,不再各自成组
    return {
        key: node.key,
        label,
        plainChildren: children.filter((child) => label.isFinger || !child.label.isFinger),
        fingerChildren: label.isFinger ? [] : children.filter((child) => child.label.isFinger),
    };
}

function subtreeMatches(vm: BoneNodeVM, normalizedQuery: string): boolean {
    if (normalizedQuery === "") return true;
    const selfHit = vm.label.zh.includes(normalizedQuery);
    return (
        selfHit ||
        vm.plainChildren.some((child) => subtreeMatches(child, normalizedQuery)) ||
        vm.fingerChildren.some((child) => subtreeMatches(child, normalizedQuery))
    );
}

/** 树渲染上下文:每级递归只传一个对象,行组件自取 stores */
interface BoneTreeContext {
    readonly objectId: string;
    readonly editing: boolean;
    readonly poseBones: Readonly<Record<BoneKey, QuaternionTuple>> | undefined;
    readonly normalizedQuery: string;
    readonly expandedGroups: ReadonlySet<string>;
    readonly onToggleGroup: (groupKey: string) => void;
}

function rowIndentSx(depth: number) {
    return { pl: `${4 + Math.min(depth, MAX_INDENT_DEPTH) * INDENT_PX}px`, minHeight: ROW_MIN_HEIGHT_PX };
}

/** 手指链分组行(渲染助手,非组件):整链默认折叠,一行取代满屏指节 */
function renderFingerGroupRow(ctx: BoneTreeContext, vm: BoneNodeVM, depth: number, isExpanded: boolean) {
    return (
        <ListItemButton
            dense
            disableGutters
            onClick={() => ctx.onToggleGroup(`${GROUP_KEY_PREFIX}${vm.key}`)}
            sx={rowIndentSx(depth)}
        >
            {isExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            <Typography variant="body2" color="text.secondary" noWrap>
                手指 ×{vm.fingerChildren.length}
            </Typography>
        </ListItemButton>
    );
}

/** 单根骨骼行:选中态/脏标记各自 observer 追踪;原始名与 key 收进原生 tooltip */
const BoneNodeRow = observer(function BoneNodeRow({
    ctx,
    vm,
    depth,
}: {
    readonly ctx: BoneTreeContext;
    readonly vm: BoneNodeVM;
    readonly depth: number;
}) {
    const { ui } = useDirectorDeskStores();
    const isSelected = ui.posePickingObjectId === ctx.objectId && ui.posePickingBoneKey === vm.key;
    const hasPoseEdit = ctx.poseBones?.[vm.key] !== undefined;
    const isFiltering = ctx.normalizedQuery !== "";
    const isGroupExpanded = isFiltering || ctx.expandedGroups.has(`${GROUP_KEY_PREFIX}${vm.key}`);
    return (
        <>
            <ListItemButton
                dense
                disableGutters
                selected={isSelected}
                disabled={!ctx.editing}
                onClick={() => ui.setPosePicking(ctx.objectId, vm.key)}
                sx={rowIndentSx(depth)}
            >
                <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                    {vm.label.zh}
                </Typography>
                {hasPoseEdit && (
                    <Box
                        component="span"
                        aria-label="已有姿态编辑"
                        sx={{
                            width: DIRTY_DOT_PX,
                            height: DIRTY_DOT_PX,
                            borderRadius: "50%",
                            bgcolor: "primary.main",
                            ml: 0.5,
                            flexShrink: 0,
                        }}
                    />
                )}
            </ListItemButton>
            {!isFiltering && vm.fingerChildren.length > 0 && renderFingerGroupRow(ctx, vm, depth + 1, isGroupExpanded)}
            {(isFiltering || isGroupExpanded) && renderBoneTreeLevel(ctx, vm.fingerChildren, depth + 2)}
            {renderBoneTreeLevel(ctx, vm.plainChildren, depth + 1)}
        </>
    );
});

function renderBoneTreeLevel(ctx: BoneTreeContext, nodes: readonly BoneNodeVM[], depth: number) {
    return nodes
        .filter((vm) => subtreeMatches(vm, ctx.normalizedQuery))
        .map((vm) => <BoneNodeRow key={vm.key} ctx={ctx} vm={vm} depth={depth} />);
}

/**
 * 骨骼树面板:搜索过滤 + 手指链折叠 + 编辑脏标记。
 * 列表收进定高滚动容器,长骨架不再把检查器撑到屏外。
 */
export const BoneTreePanel = observer(function BoneTreePanel({
    objectId,
    roots,
    editing,
}: {
    readonly objectId: string;
    readonly roots: readonly BoneTreeNodeDto[];
    readonly editing: boolean;
}) {
    const stores = useDirectorDeskStores();
    const [query, setQuery] = useState("");
    const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
    const poseBones = stores.scene.manager.getEntity(objectId)?.pose?.bones;
    const vmRoots = useMemo(() => roots.map(buildBoneNodeVM), [roots]);

    const toggleGroup = (groupKey: string) =>
        setExpandedGroups((previous) => {
            const next = new Set(previous);
            if (next.has(groupKey)) next.delete(groupKey);
            else next.add(groupKey);
            return next;
        });

    const ctx: BoneTreeContext = {
        objectId,
        editing,
        poseBones,
        normalizedQuery: query.trim().toLowerCase(),
        expandedGroups,
        onToggleGroup: toggleGroup,
    };

    return (
        <Box>
            <TextField
                size="small"
                fullWidth
                placeholder="搜索骨骼"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                slotProps={{ htmlInput: { "aria-label": "搜索骨骼" } }}
            />
            <List dense disablePadding sx={{ maxHeight: `${TREE_MAX_HEIGHT_VH}vh`, overflowY: "auto", mt: 0.5 }}>
                {renderBoneTreeLevel(ctx, vmRoots, 0)}
            </List>
        </Box>
    );
});

/** 语义候选按钮组:唯一匹配的语义骨直选,与原始树视觉分区 */
const SemanticCandidateChips = observer(function SemanticCandidateChips({
    objectId,
    candidates,
    editing,
}: {
    readonly objectId: string;
    readonly candidates: SkeletonDiscoveryDto["semanticCandidates"];
    readonly editing: boolean;
}) {
    const { ui } = useDirectorDeskStores();
    return (
        <Box>
            <Typography variant="caption" color="text.secondary">
                语义候选（唯一匹配）
            </Typography>
            <Stack direction="row" spacing={CHIP_GAP} sx={{ flexWrap: "wrap" }}>
                {candidates.map((candidate) => (
                    <Button
                        key={candidate.label}
                        size="small"
                        variant={
                            ui.posePickingObjectId === objectId && ui.posePickingBoneKey === candidate.boneKey
                                ? "contained"
                                : "text"
                        }
                        disabled={!editing}
                        onClick={() => ui.setPosePicking(objectId, candidate.boneKey)}
                    >
                        {candidate.label}
                    </Button>
                ))}
            </Stack>
        </Box>
    );
});

/** 姿态 tab:骨骼自动发现、骨骼树点选与姿态清除;持久变更一律走 Dispatcher。 */
export const ModelPoseSection = observer(function ModelPoseSection({ primaryId, report }: InspectorSectionProps) {
    const objectId = primaryId;
    const stores = useDirectorDeskStores();
    const entity = stores.scene.manager.getEntity(objectId);
    const [discovery, setDiscovery] = useState<SkeletonDiscoveryDto | null>(null);

    // 骨骼树在模型加载时已建好(SkeletonRuntimeRegistry),查询是纯读:打开即出,不再手动点「发现骨骼」
    useEffect(() => {
        const result = stores.dispatcher.query({ type: "pose.bones.discover", payload: { objectId } }, stores);
        if (result.ok) setDiscovery(result.value as SkeletonDiscoveryDto);
    }, [stores, objectId]);

    if (!entity || entity.kind !== "model") return null;
    const editing = !stores.clock.isPlaying;
    /** 仅当发现结果属于当前对象且骨骼就绪才渲染树;切换对象的间隙显示重试位 */
    const readyDiscovery = discovery !== null && discovery.objectId === objectId && discovery.ready ? discovery : null;

    const rediscover = () => {
        const result = stores.dispatcher.query({ type: "pose.bones.discover", payload: { objectId } }, stores);
        if (!result.ok) {
            report(result);
            return;
        }
        setDiscovery(result.value as SkeletonDiscoveryDto);
    };

    return (
        <Box sx={INSPECTOR_FIELD_SX}>
            <Typography variant="overline">姿态精修</Typography>
            <Stack spacing={CONTROL_GAP}>
                {stores.ui.posePickingObjectId === objectId && (
                    <Button size="small" disabled={!editing} onClick={() => stores.ui.setPosePicking(null, null)}>
                        退出骨骼编辑
                    </Button>
                )}
                {readyDiscovery === null ? (
                    <>
                        <Typography variant="caption">
                            {discovery?.objectId === objectId
                                ? "模型骨骼尚未就绪,请等待加载完成。"
                                : "骨骼信息尚未就绪,请稍候或点重试。"}
                        </Typography>
                        <Button size="small" variant="outlined" onClick={rediscover}>
                            重新发现骨骼
                        </Button>
                    </>
                ) : (
                    <>
                        {readyDiscovery.semanticCandidates.length > 0 && (
                            <SemanticCandidateChips
                                objectId={objectId}
                                candidates={readyDiscovery.semanticCandidates}
                                editing={editing}
                            />
                        )}
                        <BoneTreePanel objectId={objectId} roots={readyDiscovery.roots} editing={editing} />
                    </>
                )}
                <Button
                    size="small"
                    color="warning"
                    disabled={!editing || entity.pose === null}
                    onClick={() =>
                        report(stores.dispatcher.dispatch({ type: "pose.clear", payload: { objectId } }, stores))
                    }
                >
                    清除姿态
                </Button>
                {!editing && <Typography variant="caption">播放期间姿态编辑已禁用。</Typography>}
            </Stack>
        </Box>
    );
});
