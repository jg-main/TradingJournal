import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TimezoneProvider } from "@/lib/timezone-context";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Workstation — Trading Journal",
  description:
    "Terminal-dense trading workstation. Greenfield surface, isolated from the legacy dashboard.",
  icons: {
    icon: "/favicon.svg",
  },
};

// Workstation root layout: intentionally excludes the legacy Sidebar and
// KeyboardShortcutsProvider so /workspace is fully isolated from the legacy
// shell. TooltipProvider and TimezoneProvider are shared infra, not state.
export default function WorkstationRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: '(function(){try{var t=localStorage.getItem("theme");if(!t)t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})()' }} />
      </head>
      <body className="min-h-full">
        <TimezoneProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </TimezoneProvider>
      </body>
    </html>
  );
}
