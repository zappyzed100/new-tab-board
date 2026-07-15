// main.tsx — 新しいタブページのエントリポイント
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "@radix-ui/themes/styles.css";
import "./styles/tokens.css";
import "./styles/layout.css";
import "./styles/components.css";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
