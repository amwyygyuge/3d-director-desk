import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Input from "@mui/material/Input";
import Popover from "@mui/material/Popover";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";

import { directorDeskTheme } from "@/ui/shell/theme";
import { ThemeProvider } from "@mui/material/styles";
import ScopedCssBaseline from "@mui/material/ScopedCssBaseline";

/** UI 套件走查:MUI 组件在默认暗色主题下的观感 */
const meta: Meta = {
    title: "壳层/UIKit 套件",
};

export default meta;

type Story = StoryObj;

export const Panel: Story = {
    name: "面板组件",
    render: function UIKitPanel() {
        const [fov, setFov] = useState(45);
        const [gridOn, setGridOn] = useState(true);
        const [tab, setTab] = useState(0);
        const [anchor, setAnchor] = useState<HTMLElement | null>(null);

        return (
            <ThemeProvider theme={directorDeskTheme}>
                <ScopedCssBaseline>
                    <Box sx={{ width: 320, p: 2, bgcolor: "background.default" }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                            <Button variant="contained">截图</Button>
                            <Button variant="outlined">重置机位</Button>
                            <Tooltip title="添加机位">
                                <IconButton size="small">
                                    <AddPhotoAlternateIcon />
                                </IconButton>
                            </Tooltip>
                        </Stack>
                        <Divider sx={{ my: 2 }} />
                        <FormControlLabel
                            control={<Switch checked={gridOn} onChange={(_, v) => setGridOn(v)} />}
                            label="显示网格"
                        />
                        <Typography variant="body2">FOV: {fov}°</Typography>
                        <Slider value={fov} onChange={(_, v) => setFov(v as number)} min={10} max={120} />
                        <Input placeholder="机位名称" fullWidth size="small" />
                        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mt: 1 }}>
                            <Tab label="场景" />
                            <Tab label="机位" />
                        </Tabs>
                        <Typography variant="body2" sx={{ p: 1 }}>
                            {tab === 0 ? "场景对象面板" : "机位面板"}
                        </Typography>
                        <Button variant="text" onClick={(e) => setAnchor(e.currentTarget)}>
                            更多
                        </Button>
                        <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}>
                            <Box sx={{ p: 2 }}>浮层内容</Box>
                        </Popover>
                    </Box>
                </ScopedCssBaseline>
            </ThemeProvider>
        );
    },
};
