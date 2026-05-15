import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./i18n";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container #root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
