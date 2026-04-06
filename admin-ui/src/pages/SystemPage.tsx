import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { fmtTime, shortId } from "../lib/format";
import { StatusDot } from "../components/StatusDot";
import type { AuditEvent, SystemInfo } from "../lib/types";
import { getToken, parseJWT } from "../lib/auth";

function HealthCheck({
  id,
  label,
  path,
}: {
  id?: string;
  label: string;
  path: string;
}) {
  const [status, setStatus] = useState<"checking" | "ok" | "error">("checking");

  useEffect(() => {
    fetch(path)
      .then((r) => setStatus(r.ok ? "ok" : "error"))
      .catch(() => setStatus("error"));
  }, [path]);

  return (
    <div className="px-5 py-3 flex items-center justify-between text-sm">
      <span className="text-slate-300">{label}</span>
      <span
        id={id}
        className={`flex items-center gap-1.5 text-xs ${status === "ok" ? "text-emerald-400" : status === "error" ? "text-red-400" : "text-slate-400"}`}
      >
        <StatusDot status={status === "checking" ? "pending" : status} />
        {status === "checking" ? "checking..." : status}
      </span>
    </div>
  );
}

export function SystemPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditError, setAuditError] = useState("");
  const [auditLoading, setAuditLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/v1/system/info")
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {});

    apiFetch("/api/v1/audit?limit=50")
      .then((r) => {
        if (r.status === 403) {
          setAuditError("Super-user access required to view audit log.");
          return null;
        }
        if (!r.ok) throw new Error("Failed to load audit events");
        return r.json();
      })
      .then((data) => {
        if (data) setAuditEvents(Array.isArray(data) ? data : []);
        setAuditLoading(false);
      })
      .catch((e: Error) => {
        setAuditError(e.message);
        setAuditLoading(false);
      });
  }, []);

  const token = getToken();
  const claims = token ? parseJWT(token) : null;

  return (
    <div id="page-system" className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        {/* Health checks */}
        <div className="bg-slate-800 rounded-lg border border-slate-700">
          <div className="px-5 py-3.5 border-b border-slate-700">
            <span className="text-sm font-semibold text-slate-100">
              Health Checks
            </span>
          </div>
          <div className="divide-y divide-slate-700/60">
            <HealthCheck id="health-healthz" label="Control API" path="/healthz" />
            <HealthCheck id="health-readyz" label="Readiness" path="/readyz" />
          </div>
        </div>

        {/* Version & info */}
        <div className="bg-slate-800 rounded-lg border border-slate-700">
          <div className="px-5 py-3.5 border-b border-slate-700">
            <span className="text-sm font-semibold text-slate-100">
              Version &amp; Info
            </span>
          </div>
          <div className="divide-y divide-slate-700/60">
            <div className="px-5 py-3 flex items-center justify-between text-sm">
              <span className="text-slate-400">Server version</span>
              <span id="sys-version" className="font-mono text-xs text-slate-300">
                {info?.version || "--"}
              </span>
            </div>
            <div className="px-5 py-3 flex items-center justify-between text-sm">
              <span className="text-slate-400">Overlay CIDR</span>
              <span className="font-mono text-xs text-slate-300">
                {info?.overlay_cidr || "not configured"}
              </span>
            </div>
            <div className="px-5 py-3 flex items-center justify-between text-sm">
              <span className="text-slate-400">TURN relay</span>
              <span
                id="sys-turn"
                className="flex items-center gap-1.5 text-xs text-slate-400"
              >
                <StatusDot
                  status={info?.turn_configured ? "active" : "no-op"}
                />
                {info?.turn_configured
                  ? `${info.turn_host}:${info.turn_port}`
                  : "not configured"}
              </span>
            </div>
            <div className="px-5 py-3 flex items-center justify-between text-sm">
              <span className="text-slate-400">Policy (OPA)</span>
              <span
                id="sys-opa"
                className="flex items-center gap-1.5 text-xs text-slate-400"
              >
                <StatusDot
                  status={info?.opa_configured ? "active" : "no-op"}
                />
                {info?.opa_configured ? "enabled" : "allow-all (no OPA)"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="bg-slate-800 rounded-lg border border-slate-700">
        <div className="px-5 py-3.5 border-b border-slate-700">
          <span className="text-sm font-semibold text-slate-100">
            Key Metrics
          </span>
        </div>
        <div className="grid grid-cols-4 divide-x divide-slate-700">
          <div className="px-5 py-4">
            <p className="text-xs text-slate-500 mb-1">active_devices</p>
            <p className="text-2xl font-semibold text-slate-100">
              {info?.active_devices ?? "--"}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs text-slate-500 mb-1">active_sessions</p>
            <p className="text-2xl font-semibold text-slate-100">
              {info?.active_sessions ?? "--"}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs text-slate-500 mb-1">direct_connect_ratio</p>
            <p className="text-2xl font-semibold text-slate-100">100%</p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs text-slate-500 mb-1">auth_failures_total</p>
            <p className="text-2xl font-semibold text-slate-100">0</p>
          </div>
        </div>
      </div>

      {/* JWT Claims */}
      <div className="bg-slate-800 rounded-lg border border-slate-700">
        <div className="px-5 py-3.5 border-b border-slate-700">
          <span className="text-sm font-semibold text-slate-100">
            JWT Claims
          </span>
        </div>
        <div className="p-5">
          <pre
            id="jwt-claims"
            className="font-mono text-xs text-slate-300 bg-slate-900 rounded-xl p-4 overflow-auto max-h-64"
          >
            {claims ? JSON.stringify(claims, null, 2) : "No token"}
          </pre>
        </div>
      </div>

      {/* Audit Log */}
      <div className="bg-slate-800 rounded-lg border border-slate-700">
        <div className="px-5 py-3.5 border-b border-slate-700 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-100">
            Audit Log
          </span>
          <span id="audit-count" className="text-xs text-slate-400">
            {auditEvents.length} events
          </span>
        </div>
        {auditLoading && (
          <div className="px-5 py-4 text-sm text-slate-400">
            Loading audit events...
          </div>
        )}
        {auditError && (
          <div className="px-5 py-4 text-sm text-red-400">{auditError}</div>
        )}
        {!auditLoading && !auditError && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-medium">Time</th>
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-left px-4 py-3 font-medium">Outcome</th>
                <th className="text-left px-4 py-3 font-medium">Actor</th>
                <th className="text-left px-4 py-3 font-medium">Target</th>
                <th className="text-left px-4 py-3 font-medium">IP</th>
              </tr>
            </thead>
            <tbody id="audit-body" className="divide-y divide-slate-700/60">
              {auditEvents.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-sm text-slate-600"
                  >
                    No audit events
                  </td>
                </tr>
              ) : (
                auditEvents.map((e) => {
                  const outcomeColor =
                    e.outcome === "success" || e.outcome === "allow"
                      ? "text-emerald-400"
                      : e.outcome === "failure" || e.outcome === "deny"
                        ? "text-red-400"
                        : "text-slate-400";
                  return (
                    <tr
                      key={e.event_uuid}
                      className="hover:bg-slate-700/30"
                    >
                      <td className="px-5 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {fmtTime(e.occurred_at)}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-200">
                        {e.action}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${outcomeColor}`}>
                          {e.outcome}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-300">
                        {shortId(e.actor_user_id)}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-300">
                        {e.target_table || ""}
                        {e.target_id ? `/${shortId(e.target_id)}` : ""}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">
                        {e.remote_ip || "--"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Danger zone */}
      <div className="bg-slate-800 rounded-lg border border-red-900/40">
        <div className="px-5 py-3.5 border-b border-red-900/40">
          <span className="text-sm font-semibold text-red-400">
            Danger Zone
          </span>
        </div>
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-300">Terminate all sessions</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Immediately close every active session and invalidate credentials
            </p>
          </div>
          <button className="text-xs font-medium text-red-400 border border-red-900 hover:border-red-700 hover:bg-red-950 px-3 py-1.5 rounded transition-colors">
            Terminate all
          </button>
        </div>
        <div className="px-5 py-4 flex items-center justify-between border-t border-red-900/40">
          <div>
            <p className="text-sm text-slate-300">
              Revoke all device registrations
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              All devices will need to re-enroll with new bootstrap tokens
            </p>
          </div>
          <button className="text-xs font-medium text-red-400 border border-red-900 hover:border-red-700 hover:bg-red-950 px-3 py-1.5 rounded transition-colors">
            Revoke all devices
          </button>
        </div>
      </div>
    </div>
  );
}
