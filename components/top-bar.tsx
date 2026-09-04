"use client";

import { useEffect, useState } from "react";
import { Activity, LogOut, RefreshCw, Sun, Moon } from "lucide-react";
import { useRouter } from "next/navigation";

type SyncState = "never" | "running" | "fresh" | "stale" | "failed";

function formatAge(ms: number | null): string {
  if (ms == null) return "never";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function TopBar() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncIso, setLastSyncIso] = useState<string | null>(null);
  const [syncAgeMs, setSyncAgeMs] = useState<number | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("never");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const json = await res.json();
      if (res.ok) {
        setLastSyncIso(new Date().toISOString());
        setSyncState("fresh");
        setSyncError(null);
        window.dispatchEvent(new CustomEvent("ads-dashboard:refresh", { detail: json }));
      } else {
        if (res.status === 409) {
          setSyncState("running");
          setSyncError("A Meta sync is already running");
        } else {
          setSyncState("failed");
          setSyncError(typeof json?.error === "string" ? json.error : "Meta sync failed");
        }
        console.error("Refresh failed:", json);
      }
    } catch (error) {
      setSyncState("failed");
      setSyncError("The sync request could not be completed.");
      console.error("Refresh request failed:", error instanceof Error ? error.name : "unknown error");
    } finally {
      setRefreshing(false);
    }
  }

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  }

  // Read syncedAt from the API every time the dashboard renders.
  useEffect(() => {
    fetch("/api/dashboard/state")
      .then((r) => r.json())
      .then((s) => {
        if (s?.meta?.lastSuccessfulSyncAt) setLastSyncIso(s.meta.lastSuccessfulSyncAt);
        if (s?.meta?.syncState) setSyncState(s.meta.syncState as SyncState);
        if (s?.meta?.lastSyncError) setSyncError(s.meta.lastSyncError);
      })
      .catch(() => {});
  }, []);

  // Tick the live "sync age" once per second so the badge feels alive.
  useEffect(() => {
    function tick() {
      if (!lastSyncIso) {
        setSyncAgeMs(null);
        return;
      }
      setSyncAgeMs(Date.now() - new Date(lastSyncIso).getTime());
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastSyncIso]);

  // Auto-refresh dashboard state every 60s by dispatching the refresh event.
  useEffect(() => {
    const id = setInterval(() => {
      window.dispatchEvent(new CustomEvent("ads-dashboard:refresh"));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Theme toggle persisted to localStorage; controls .dark on <html>.
  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem("ads-theme")) as "dark" | "light" | null;
    const preferred = stored ?? "dark";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(preferred);
    document.documentElement.classList.toggle("dark", preferred === "dark");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem("ads-theme", next);
  }

  const isFresh = syncState === "fresh" && syncAgeMs != null && syncAgeMs < 5 * 60 * 1000;
  const statusText = syncState === "failed"
    ? "Sync failed"
    : syncState === "stale"
      ? `Stale · ${formatAge(syncAgeMs)}`
      : syncState === "running"
        ? "Sync running"
        : syncState === "never"
          ? "Never synced"
          : `Synced ${formatAge(syncAgeMs)}`;
  const statusColor = syncState === "failed" ? "bg-destructive" : isFresh ? "bg-emerald-500" : "bg-amber-500";

  return (
    <header className="border-b border-border sticky top-0 z-10 bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-screen-2xl items-center gap-2 px-4 py-3 sm:gap-4 sm:px-8">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h1 className="text-sm sm:text-lg font-semibold whitespace-nowrap shrink-0">UK Trade Leads</h1>
        </div>
        <div className="text-xs text-muted-foreground hidden sm:block">
          Meta Ads Command Centre · UK trades acquisition
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:gap-3">
          <div className="flex items-center gap-1.5">
            <span className={`relative inline-flex h-2 w-2 rounded-full ${statusColor}`} title={syncError ?? undefined}>
              {isFresh && <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />}
            </span>
            <span className="hidden sm:inline" title={syncError ?? undefined}>{statusText}</span>
          </div>
          <button
            onClick={toggleTheme}
            className="inline-flex items-center justify-center rounded-md border border-border w-8 h-8 hover:bg-muted"
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          >
            {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={refresh}
            disabled={refreshing}
            aria-label="Sync now"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border px-0 py-1.5 hover:bg-muted disabled:opacity-50 sm:h-auto sm:w-auto sm:justify-start sm:px-3"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{refreshing ? "Syncing..." : "Sync now"}</span>
          </button>
          <button onClick={logout} aria-label="Log out" className="inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border px-0 py-1.5 hover:bg-muted sm:h-auto sm:w-auto sm:justify-start sm:px-3">
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Log out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
