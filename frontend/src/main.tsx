import React from "react";
import ReactDOM from "react-dom/client";
import {Providers} from "@/components/Providers";
import {Shell} from "@/components/Shell";
import App from "@/App";
import "@/app/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Providers>
      <Shell>
        <App />
      </Shell>
    </Providers>
  </React.StrictMode>
);
