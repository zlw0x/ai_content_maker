const key = "sdelano-recipe-visit";

export function recipeFunnelVisit(enabled: boolean): string | null {
  if (!enabled) return null;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch { return null; }
}

export function trackRecipeFunnel(enabled: boolean, stage: "example" | "start" | "free_export") {
  const visitId = recipeFunnelVisit(enabled);
  if (!visitId) return;
  const marker = `${key}:${stage}`;
  try {
    if (sessionStorage.getItem(marker) === visitId) return;
  } catch { return; }
  void fetch("/api/v1/recipe-funnel", {
    method: "POST", keepalive: true, credentials: "same-origin",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ visitId, stage }),
  }).then(response => { if (response.ok) sessionStorage.setItem(marker, visitId); }).catch(() => {});
}
