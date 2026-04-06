import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { shortId, fmtTime } from "../lib/format";
import { StatusDot } from "../components/StatusDot";
import { usePagination, PaginatorFooter } from "../components/Paginator";
import type { Session } from "../lib/types";

export function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/v1/sessions")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load sessions: " + r.status);
        return r.json();
      })
      .then((data) => {
        setSessions(Array.isArray(data) ? data : data.sessions || []);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const active = sessions.filter(
    (s) => s.status !== "closed" && s.status !== "expired" && s.status !== "denied",
  );
  const closed = sessions.filter(
    (s) => s.status === "closed" || s.status === "expired" || s.status === "denied",
  );

  const activePag = usePagination(active);
  const closedPag = usePagination(closed);

  if (loading) return <p className="text-sm text-slate-400">Loading sessions...</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;

  return (
    <div id="page-sessions" className="space-y-5">
      {/* Active sessions */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-700">
          <span className="text-sm font-semibold text-slate-100">
            Active Sessions
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wider">
              <th className="text-left px-5 py-3 font-medium">Session ID</th>
              <th className="text-left px-4 py-3 font-medium">Requester</th>
              <th className="text-left px-4 py-3 font-medium">Target</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Opened</th>
              <th className="text-left px-4 py-3 font-medium">Expires</th>
            </tr>
          </thead>
          <tbody id="sessions-active-body" className="divide-y divide-slate-700/60">
            {activePag.slice.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-5 py-10 text-center text-sm text-slate-600"
                >
                  No active sessions
                </td>
              </tr>
            ) : (
              activePag.slice.map((s) => (
                <tr key={s.id} className="hover:bg-slate-700/30">
                  <td className="px-5 py-3 font-mono text-xs text-slate-400">
                    {shortId(s.id)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">
                    {shortId(s.requester_device_id)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">
                    {shortId(s.target_device_id)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
                      <StatusDot status={s.status} />
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 font-mono">
                    {fmtTime(s.created_at)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400 font-mono">
                    {fmtTime(s.expires_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <PaginatorFooter {...activePag} />
      </div>

      {/* Closed sessions */}
      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-700">
          <span className="text-sm font-semibold text-slate-100">
            Closed Sessions
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wider">
              <th className="text-left px-5 py-3 font-medium">Session ID</th>
              <th className="text-left px-4 py-3 font-medium">Requester</th>
              <th className="text-left px-4 py-3 font-medium">Target</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Closed</th>
            </tr>
          </thead>
          <tbody id="sessions-closed-body" className="divide-y divide-slate-700/60">
            {closedPag.slice.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-10 text-center text-sm text-slate-600"
                >
                  No closed sessions
                </td>
              </tr>
            ) : (
              closedPag.slice.map((s) => (
                <tr key={s.id} className="hover:bg-slate-700/30">
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">
                    {shortId(s.id)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {shortId(s.requester_device_id)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {shortId(s.target_device_id)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {s.status}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                    {fmtTime(s.closed_at || s.expires_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <PaginatorFooter {...closedPag} />
      </div>
    </div>
  );
}
