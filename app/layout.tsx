import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UK Trade Leads Meta Ads Command Centre",
  description: "Internal UK Trade Leads command centre for reviewing Meta acquisition and lead quality",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-GB"
      className="h-full antialiased dark"
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
