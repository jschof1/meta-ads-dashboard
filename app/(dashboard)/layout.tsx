import { TopBar } from "@/components/top-bar";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export default async function DashboardLayout({
  children,
}: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token, process.env.AUTH_SECRET))) redirect("/login");

  return (
      <div className="min-h-screen flex flex-col">
        <TopBar />
        <main className="flex-1 px-4 sm:px-8 py-6 max-w-screen-2xl w-full mx-auto">
          {children}
        </main>
      </div>
  );
}
