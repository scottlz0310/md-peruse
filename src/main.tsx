import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./App.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("ルート要素 #root が index.html に存在しません");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
