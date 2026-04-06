import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { timeAgo } from "../lib/format";
import { StatusDot } from "../components/StatusDot";
import { usePagination, PaginatorFooter } from "../components/Paginator";
import type { Device } from "../lib/types";

const STATUS_TEXT: Record<string, string> = {
  active: "text-emerald-400",
  offline: "text-slate-400",
  pending: "text-amber-400",
  revoked: "text-red-400",
};

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const loadDevices = () => {
    setLoading(true);
    setError("");
    apiFetch("/api/v1/devices")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load devices: " + r.status);
        return r.json();
      })
      .then((data) => {
        setDevices(Array.isArray(data) ? data : data.devices || []);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(loadDevices, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return devices.filter(
      (d) =>
        (!q || d.hostname?.toLowerCase().includes(q) || d.id?.includes(q)) &&
        (!statusFilter || d.status === statusFilter),
    );
  }, [devices, search, statusFilter]);

  const pag = usePagination(filtered);

  const revokeDevice = (id: string) => {
    if (!confirm("Revoke this device? It will need to re-enroll.")) return;
    apiFetch(`/api/v1/devices/${id}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok) throw new Error("Failed to revoke: " + r.status);
        loadDevices();
      })
      .catch((e: Error) => alert("Error: " + e.message));
  };

  return (
    <div id="page-devices" className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <input
            id="device-search"
            type="text"
            placeholder="Search devices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-64"
          />
          <select
            id="device-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">All statuses</option>
            <option value="active">Online</option>
            <option value="offline">Offline</option>
            <option value="pending">Pending</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>
        <Link
          to="/admin/pair"
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-1.5 rounded transition-colors"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 4v16m8-8H4" />
          </svg>
          Enrol Device
        </Link>
      </div>

      {/* Loading / error */}
      {loading && (
        <p className="text-sm text-slate-400">Loading devices...</p>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Table */}
      {!loading && !error && (
        <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wider">
                <th className="text-left px-5 py-3 font-medium">Device</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Overlay IP</th>
                <th className="text-left px-4 py-3 font-medium">Platform</th>
                <th className="text-left px-4 py-3 font-medium">Last Seen</th>
                <th className="text-left px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody id="devices-body" className="divide-y divide-slate-700/60">
              {pag.slice.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-5 py-10 text-center text-sm text-slate-600"
                  >
                    No devices found
                  </td>
                </tr>
              ) : (
                pag.slice.map((d) => {
                  const dim = d.status === "offline" || d.status === "revoked";
                  return (
                    <tr key={d.id} className="hover:bg-slate-700/30">
                      <td className="px-5 py-3">
                        <p
                          className={`font-medium ${dim ? "text-slate-400" : "text-slate-200"}`}
                        >
                          {d.hostname || "--"}
                        </p>
                        <p className="text-xs text-slate-500 font-mono">
                          {d.id}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`flex items-center gap-1.5 ${STATUS_TEXT[d.status] || "text-slate-400"} text-xs font-medium`}
                        >
                          <StatusDot status={d.status} />
                          {d.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-400">
                        {d.overlay_ip || "--"}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {d.os_platform || "--"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {timeAgo(d.last_seen_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {d.status !== "revoked" && (
                            <button
                              onClick={() => revokeDevice(d.id)}
                              className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-slate-700 transition-colors"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <PaginatorFooter {...pag} />
        </div>
      )}
    </div>
  );
}
