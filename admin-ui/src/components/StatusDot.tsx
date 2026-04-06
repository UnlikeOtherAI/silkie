const colors: Record<string, string> = {
  active: "bg-emerald-400",
  online: "bg-emerald-400",
  ok: "bg-emerald-400",
  healthy: "bg-emerald-400",
  established: "bg-emerald-400",
  success: "bg-emerald-400",
  allow: "bg-emerald-400",
  running: "bg-emerald-400",
  offline: "bg-slate-600",
  pending: "bg-amber-400",
  revoked: "bg-red-700",
  error: "bg-red-500",
  failure: "bg-red-500",
  deny: "bg-red-500",
  "no-op": "bg-slate-500",
};

export function StatusDot({ status }: { status: string }) {
  const color = colors[status] || "bg-slate-500";
  return <span className={`status-dot ${color}`} />;
}
