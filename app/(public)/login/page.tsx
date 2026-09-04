"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error || "Unable to sign in");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setMessage("Unable to reach the server");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={login} className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Lock className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold">UK Trade Leads</h1>
          <p className="text-muted-foreground text-sm">Enter the dashboard password to continue</p>
        </div>
        <div className="space-y-3">
          <label className="sr-only" htmlFor="password">Dashboard password</label>
          <input id="password" name="password" type="password" required autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoFocus
            className="w-full px-4 py-3 bg-card border border-border rounded-xl focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50" />
          {message && <p role="alert" className="text-sm text-destructive">{message}</p>}
          <button type="submit" disabled={pending}
            className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-medium rounded-xl disabled:opacity-50">
            {pending ? "Signing in..." : "Sign in"}
          </button>
        </div>
      </form>
    </main>
  );
}
