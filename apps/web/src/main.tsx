import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App.tsx";
import { initTheme, ThemeProvider } from "./design/theme.tsx";
import "./design/tokens.css";
import "./design/design.css";
import "./design/signature.css";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing root element");
}

initTheme();

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);
