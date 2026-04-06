import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import type { JWTClaims } from "../lib/auth";

const titles: Record<string, string> = {
  "/admin": "Overview",
  "/admin/devices": "Devices",
  "/admin/sessions": "Sessions",
  "/admin/services": "Service Catalog",
  "/admin/relay": "Relay",
  "/admin/system": "System",
  "/admin/pair": "Enrol Device",
};

export function Layout({ claims }: { claims: JWTClaims | null }) {
  const location = useLocation();
  const title = titles[location.pathname] || "Admin";

  return (
    <div className="flex h-full">
      <Sidebar claims={claims} />
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar title={title} />
        <div className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </div>
        <footer className="shrink-0 border-t border-slate-800 px-6 py-3 flex items-center justify-center">
          <p className="text-xs text-slate-600">
            Made with love in Scotland &copy; 2026{" "}
            <a
              href="https://unlikeotherai.com"
              className="text-slate-200 font-medium hover:text-white transition-colors"
            >
              UnlikeOtherAI
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
