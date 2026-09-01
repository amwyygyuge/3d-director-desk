import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

/**
 * Storybook 验收面板:任务号 + 走查清单,叠在导演台下方居中。
 * 只服务 story;验收通过与否由验收人勾选 exec 文档,组件本身无状态。
 */
export function AcceptancePanel({ task, items }: { task: string; items: readonly string[] }) {
    return (
        <Paper
            elevation={3}
            sx={{
                position: "absolute",
                bottom: 12,
                left: "50%",
                transform: "translateX(-50%)",
                maxWidth: 560,
                p: 1.5,
                zIndex: 2,
                opacity: 0.94,
            }}
        >
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                验收走查 · {task}
            </Typography>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
                {items.map((item) => (
                    <li key={item}>
                        <Typography variant="caption" color="text.secondary">
                            {item}
                        </Typography>
                    </li>
                ))}
            </ol>
        </Paper>
    );
}
