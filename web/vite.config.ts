import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { apiProxyPlugin } from "./server/api-proxy";

const webDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3001;

function resolvePort() {
    // Keep the desktop launcher and Vite dev/preview servers on one port.
    // APP_PORT is intentionally shared with start.bat for rare local overrides.
    const configured = Number.parseInt(process.env.APP_PORT || "", 10);
    return Number.isInteger(configured) && configured >= 1 && configured <= 65535 ? configured : DEFAULT_PORT;
}

const appPort = resolvePort();

export default defineConfig({
    base: process.env.VITE_BASE || "/",
    plugins: [react(), apiProxyPlugin()],
    server: {
        host: "127.0.0.1",
        port: appPort,
        strictPort: true,
    },
    preview: {
        host: "127.0.0.1",
        port: appPort,
        strictPort: true,
    },
    resolve: {
        alias: {
            "@": resolve(webDir, "src"),
        },
    },
});
