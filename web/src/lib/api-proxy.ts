// Both Vite dev and preview serve this same-origin API forwarding endpoint.
// Static deployments must provide /api-proxy on their own application server.
export function proxyApiUrl(directUrl: string): string {
    if (typeof window === "undefined") return directUrl;
    try {
        const target = new URL(directUrl);
        if (!["https:", "http:"].includes(target.protocol)) return directUrl;
        if (target.origin === window.location.origin) return directUrl;
        return `/api-proxy?target=${encodeURIComponent(directUrl)}`;
    } catch {
        return directUrl;
    }
}

export function isApiProxyUrl(url: string): boolean {
    try {
        return new URL(url, "http://localhost").pathname === "/api-proxy";
    } catch {
        return false;
    }
}
