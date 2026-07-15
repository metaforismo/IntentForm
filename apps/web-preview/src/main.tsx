import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./generated/app";

const root = document.getElementById("root");
if (!root) throw new Error("Responsive-web preview root is missing");
createRoot(root).render(<StrictMode><App /></StrictMode>);
