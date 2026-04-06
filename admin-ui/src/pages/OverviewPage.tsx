import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/format";
import { StatCard } from "../components/StatCard";
import { StatusDot } from "../components/StatusDot";
import type { Device, Session, SystemInfo } from "../lib/types";

export function OverviewPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [info, setInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    apiFetch("/api/v1/devices")
      .then((r) => r.json())
      .then((data) => setDevices(Array.isArray(data) ? data : data.devices || []))
      .catch(() => {});

    apiFetch("/api/v1/sessions")
      .then((r) => r.json())
      .then((data) => setSessions(Array.isArray(data) ? data : data.sessions || []))
      .catch(() => {});

    apiFetch("/api/v1/system/info")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});
  }, []);

  const activeDevices = info?.active_devices ?? devices.filter((d) => d.status === "active").length;
  const activeSessions = info?.active_sessions ?? 0;

  return (
    <div id="page-overview" className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="Devices Online"
          value={activeDevices}
          sub={`of ${devices.length} registered`}
        />
        <StatCard
          label="Active Sessions"
          value={activeSessions}
          sub="0 via relay"
        />
        <StatCard label="Relay Rate" value="0%" sub="100% direct" />
      </div>

      {/* Recent sessions */}
      <div className="bg-slate-800 rounded-lg border border-slate-700">
        <div className="px-5 py-3.5 border-b border-slate-700 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-100">
            Recent Sessions
          </span>
          <Link
            to="/admin/sessions"
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            View all &rarr;
          </Link>
        </div>
        <div className="divide-y divide-slate-700/60">
          {sessions.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-600">
              No sessions yet
            </div>
          ) : (
            sessions.slice(0, 5).map((s) => (
              <div
                key={s.id}
                className="px-5 py-3 flex items-center gap-4 text-sm"
              >
                <StatusDot
                  status={s.status === "closed" ? "offline" : "active"}
                />
                <span className="text-slate-300 flex-1">
                  {s.requester_device_id} &rarr; {s.target_device_id}
                </span>
                <span className="text-xs text-emerald-400 font-medium">
                  {s.status}
                </span>
                <span className="font-mono text-xs text-slate-500">
                  {timeAgo(s.created_at)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Device quick view */}
      <div className="bg-slate-800 rounded-lg border border-slate-700">
        <div className="px-5 py-3.5 border-b border-slate-700 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-100">Devices</span>
          <Link
            to="/admin/devices"
            className="text-xs text-indigo-400 hover:text-indigo-300"
          >
            Manage &rarr;
          </Link>
        </div>
        <div className="divide-y divide-slate-700/60">
          {devices.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-600">
              No devices enrolled
            </div>
          ) : (
            devices.slice(0, 5).map((d) => (
              <div
                key={d.id}
                className="px-5 py-3 flex items-center gap-4 text-sm"
              >
                <StatusDot status={d.status} />
                <span
                  className={`font-medium w-40 shrink-0 ${d.status === "offline" ? "text-slate-400" : "text-slate-200"}`}
                >
                  {d.hostname}
                </span>
                <span className="text-slate-500 text-xs font-mono w-28 shrink-0">
                  {d.overlay_ip || "--"}
                </span>
                <span className="text-slate-500 text-xs">
                  {d.os_platform || "--"}
                </span>
                <span className="ml-auto text-xs text-slate-500 font-mono">
                  {timeAgo(d.last_seen_at)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
