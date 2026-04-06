import { getToken, removeToken } from "./auth";

export async function apiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(options.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (options.body && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  const resp = await fetch(path, { ...options, headers });

  if (resp.status === 401) {
    removeToken();
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  return resp;
}
