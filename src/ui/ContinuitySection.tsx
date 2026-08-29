import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import CheckIcon from "@mui/icons-material/Check";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { observer } from "mobx-react-lite";
import { useState } from "react";

import type { ContinuityIssue } from "../camera/ContinuityChecker";
import type { ContinuitySelectionOptions } from "../command/continuityCommands";
import { useDirectorDeskStores } from "./DirectorDeskContext";

const DEFAULT_TELEPORT_THRESHOLD = "2";

interface ContinuitySectionProps {
    readonly onNotice: (message: string) => void;
}

function readSelectionOptions(value: unknown): ContinuitySelectionOptions | null {
    if (
        typeof value !== "object" ||
        value === null ||
        !("subjects" in value) ||
        !("shots" in value) ||
        !("duration" in value) ||
        !Array.isArray(value.subjects) ||
        !Array.isArray(value.shots) ||
        typeof value.duration !== "number"
    ) {
        return null;
    }
    return value as ContinuitySelectionOptions;
}

function issueLabel(issue: ContinuityIssue): string {
    switch (issue.kind) {
        case "axis-crossing":
            return "越轴";
        case "axis-ambiguous":
            return "轴线不明确";
        case "teleport":
            return "位移突变";
    }
}

/** Manual, query-driven continuity authoring and transient diagnostics presentation. */
export const ContinuitySection = observer(function ContinuitySection({ onNotice }: ContinuitySectionProps) {
    const stores = useDirectorDeskStores();
    const { continuity, dispatcher, selection } = stores;
    const optionsResult = dispatcher.query({ type: "continuity.selection-options", payload: {} }, stores);
    const options = optionsResult.ok ? readSelectionOptions(optionsResult.value) : null;
    const [subjectId, setSubjectId] = useState("");
    const [orderedShotIds, setOrderedShotIds] = useState<readonly string[]>([]);
    const [sampleTimes, setSampleTimes] = useState<Record<string, string>>({});
    const [teleportThreshold, setTeleportThreshold] = useState(DEFAULT_TELEPORT_THRESHOLD);

    const toggleShot = (id: string) => {
        continuity.clear();
        setOrderedShotIds((current) => current.includes(id) ? current.filter((currentId) => currentId !== id) : [...current, id]);
    };
    const moveShot = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= orderedShotIds.length) return;
        continuity.clear();
        setOrderedShotIds((current) => {
            const next = [...current];
            const currentShot = next[index];
            const targetShot = next[target];
            if (!currentShot || !targetShot) return current;
            next[index] = targetShot;
            next[target] = currentShot;
            return next;
        });
    };
    const runCheck = () => {
        const request = {
            subjectId,
            shotIds: orderedShotIds,
            sampleTimes: orderedShotIds.map((id, index) => Number(sampleTimes[id] ?? String(index))),
            teleportThreshold: Number(teleportThreshold),
        };
        const result = dispatcher.query({ type: "continuity.check", payload: request }, stores);
        if (!result.ok) {
            continuity.clear();
            onNotice(result.issues?.join(";") ?? result.error);
            return;
        }
        const value = result.value as { readonly issues?: readonly ContinuityIssue[] };
        if (!Array.isArray(value.issues)) {
            continuity.clear();
            onNotice("一致性查询未返回诊断结果");
            return;
        }
        continuity.present(request, value.issues);
    };
    const focusIssue = (issue: ContinuityIssue) => {
        selection.clear();
        issue.shotIds.forEach((id, index) => selection.select(id, { additive: index > 0 }));
    };

    return (
        <>
            <Typography variant="subtitle2">一致性检查</Typography>
            <Select
                size="small"
                fullWidth
                displayEmpty
                value={subjectId}
                aria-label="一致性主体"
                onChange={(event) => {
                    continuity.clear();
                    setSubjectId(event.target.value as string);
                }}
            >
                <MenuItem value="">选择主体</MenuItem>
                {options?.subjects.map((subject) => (
                    <MenuItem key={subject.id} value={subject.id}>
                        {subject.name} ({subject.id})
                    </MenuItem>
                ))}
            </Select>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                手动选择机位并用箭头确定镜头顺序
            </Typography>
            <List dense disablePadding aria-label="一致性机位顺序">
                {options?.shots.map(({ id }) => {
                    const index = orderedShotIds.indexOf(id);
                    const selected = index >= 0;
                    return (
                        <ListItem
                            key={id}
                            disablePadding
                            secondaryAction={selected && (
                                <Box>
                                    <IconButton size="small" disabled={index === 0} aria-label={`机位 ${id} 上移`} onClick={() => moveShot(index, -1)}>
                                        <ArrowUpwardIcon fontSize="small" />
                                    </IconButton>
                                    <IconButton size="small" disabled={index === orderedShotIds.length - 1} aria-label={`机位 ${id} 下移`} onClick={() => moveShot(index, 1)}>
                                        <ArrowDownwardIcon fontSize="small" />
                                    </IconButton>
                                </Box>
                            )}
                        >
                            <ListItemButton selected={selected} onClick={() => toggleShot(id)}>
                                <ListItemText primary={`${selected ? `${index + 1}. ` : ""}${id}`} />
                            </ListItemButton>
                        </ListItem>
                    );
                })}
            </List>
            {orderedShotIds.map((id, index) => (
                <TextField
                    key={id}
                    size="small"
                    fullWidth
                    type="number"
                    label={`${index + 1}. ${id} 采样秒数`}
                    value={sampleTimes[id] ?? String(index)}
                    sx={{ mt: 0.5 }}
                    slotProps={{ htmlInput: { min: 0, max: options?.duration, step: 0.1 } }}
                    onChange={(event) => {
                        continuity.clear();
                        setSampleTimes((current) => ({ ...current, [id]: event.target.value }));
                    }}
                />
            ))}
            <TextField
                size="small"
                fullWidth
                type="number"
                label="位移突变阈值"
                value={teleportThreshold}
                sx={{ mt: 0.5 }}
                slotProps={{ htmlInput: { min: 0, step: 0.1 } }}
                onChange={(event) => {
                    continuity.clear();
                    setTeleportThreshold(event.target.value);
                }}
            />
            <Button size="small" fullWidth variant="outlined" startIcon={<CheckIcon />} sx={{ mt: 0.5 }} onClick={runCheck}>
                检查一致性
            </Button>
            <List dense disablePadding aria-label="一致性问题">
                {continuity.issues.map((issue, index) => (
                    <ListItem key={`${issue.kind}:${issue.shotIds.join(":")}:${index}`} disablePadding>
                        <ListItemButton onClick={() => focusIssue(issue)}>
                            <ListItemText primary={`${issueLabel(issue)} · ${issue.shotIds.join(" → ")}`} secondary={issue.detail} />
                        </ListItemButton>
                    </ListItem>
                ))}
            </List>
        </>
    );
});
