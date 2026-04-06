import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { StatusDot } from "../components/StatusDot";
import type { SystemInfo } from "../lib/types";

export function RelayPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    apiFetch("/api/v1/system/info")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});
  }, []);

  const turnStatus = info?.turn_configured ? "running" : "offline";
  const turnLabel = info?.turn_configured
    ? `${info.turn_host}:${info.turn_port}`
    : "not configured";

  return (
    <div id="page-relay" className="space-y-5">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
          <p className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-2">
            Relay (coturn)
          </p>
          <div className="flex items-center gap-2">
            <StatusDot status={turnStatus} />
            <span
              className={`text-sm font-medium ${info?.turn_configured ? "text-emerald-400" : "text-slate-400"}`}
            >
              {info?.turn_configured ? "Running" : "Not configured"}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 font-mono">{turnLabel}</p>
        </div>
        <StatCard label="Active Allocations" value={0} />
        <StatCard label="Total Relayed" value={0} sub="sessions this week" />
      </div>

      {/* Allocations table */}
      <div className="bg-slate-800 rounded-lg border border-slate-700">
        <div className="px-5 py-3.5 border-b border-slate-700">
          <span className="text-sm font-semibold text-slate-100">
            Active Allocations
          </span>
        </div>
        <div className="px-5 py-10 text-center text-sm text-slate-600">
          No active relay allocations &mdash; all sessions using direct paths
        </div>
      </div>
    </div>
  );
}
