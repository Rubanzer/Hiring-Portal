import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hiring Portal",
  description: "Agency submissions and candidate funnel in one place",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
