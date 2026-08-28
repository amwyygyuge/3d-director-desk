import { createRoot } from "react-dom/client";

import { DirectorDesk } from "../src";
import "../src/styles/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("playground: #root not found");

createRoot(container).render(
    <div style={{ width: "100vw", height: "100vh", margin: 0 }}>
        <DirectorDesk />
    </div>,
);
