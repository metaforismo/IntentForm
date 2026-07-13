import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GeneratedApp as BeforeApp } from "./generated/before/App";
import { GeneratedApp as AfterApp } from "./generated/after/App";

const variant = new URLSearchParams(window.location.search).get("variant") === "after"
  ? "after"
  : "before";
document.documentElement.dataset.variant = variant;

const root = document.getElementById("root");
if (!root) throw new Error("React preview root is missing");

createRoot(root).render(
  <StrictMode>
    {variant === "after" ? <AfterApp /> : <BeforeApp />}
  </StrictMode>,
);
