import { createTheme } from "@mui/material/styles";

/**
 * 导演台默认主题:暗色专业工具向。
 * 不对外暴露换装契约——Monet 视觉一致性非目标(已决策);
 * 宿主如需调整,经 DirectorDesk 的 theme prop 传入 MUI theme 覆盖。
 */
export const directorDeskTheme = createTheme({
    palette: {
        mode: "dark",
        background: {
            default: "#171717",
            paper: "#242424",
        },
    },
    shape: {
        borderRadius: 8,
    },
    typography: {
        fontSize: 13,
    },
    components: {
        MuiButton: {
            defaultProps: { size: "small", disableElevation: true },
        },
        MuiSlider: {
            defaultProps: { size: "small" },
        },
    },
});
