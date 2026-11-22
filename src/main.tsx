import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource-variable/jetbrains-mono";
import "./styles/hud.css";
import { App } from "./App";

const THEME_STORAGE_KEY = "optimizer-theme";

try {
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  document.documentElement.classList.toggle("dark", savedTheme === "dark");
} catch {
  // Ignore storage access errors in restricted contexts.
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Elemento #root não encontrado no documento.");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
