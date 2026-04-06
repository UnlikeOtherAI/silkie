export function shortId(id: string | undefined): string {
  if (!id) return "--";
  return id.length > 12 ? id.substring(0, 8) + "..." : id;
}

export function fmtTime(ts: string | undefined): string {
  if (!ts) return "--";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function timeAgo(ts: string | undefined): string {
  if (!ts) return "--";
  try {
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    return Math.floor(diff / 86400) + "d ago";
  } catch {
    return ts;
  }
}
