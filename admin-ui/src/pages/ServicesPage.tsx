import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { usePagination, PaginatorFooter } from "../components/Paginator";
import type { Service } from "../lib/types";

export function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/api/v1/services")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load services: " + r.status);
        return r.json();
      })
      .then((data) => {
        setServices(Array.isArray(data) ? data : data.services || []);
        setLoading(false);
      })
      .catch((e: Error) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const pag = usePagination(services);

  if (loading)
    return <p className="text-sm text-slate-400">Loading services...</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;

  return (
    <div id="page-services" className="space-y-5">
      <div className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-700 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-100">
            Service Catalog
          </span>
          <span className="text-xs text-slate-500">
            Reported by device agents on heartbeat
          </span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-xs text-slate-400 uppercase tracking-wider">
              <th className="text-left px-5 py-3 font-medium">Device</th>
              <th className="text-left px-4 py-3 font-medium">Service</th>
              <th className="text-left px-4 py-3 font-medium">Protocol</th>
              <th className="text-left px-4 py-3 font-medium">Bind</th>
              <th className="text-left px-4 py-3 font-medium">Health</th>
            </tr>
          </thead>
          <tbody id="services-body" className="divide-y divide-slate-700/60">
            {pag.slice.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-10 text-center text-sm text-slate-600"
                >
                  No services reported
                </td>
              </tr>
            ) : (
              pag.slice.map((s) => (
                <tr key={s.id} className="hover:bg-slate-700/30">
                  <td className="px-5 py-3 text-slate-300 font-medium">
                    {s.device_hostname || "--"}
                  </td>
                  <td className="px-4 py-3 text-slate-200">{s.name}</td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-400">
                    {s.protocol}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-400">
                    {s.bind_address}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-emerald-400">{s.health}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <PaginatorFooter {...pag} />
      </div>
    </div>
  );
}
