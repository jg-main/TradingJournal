import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";
import { KeyboardShortcutsProvider } from "@/components/keyboard-shortcuts";
import { TimezoneProvider } from "@/lib/timezone-context";
import { AccountProvider } from "@/lib/account-context";
import { OperationalDateRangeProvider } from "@/lib/operational-date-range-context";
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
  title: "Trading Journal",
  description: "Track, analyze, and improve your trading performance with structured journaling and process-driven reviews.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
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
      <body className="min-h-full flex">
        <TimezoneProvider>
          <TooltipProvider>
            <OperationalDateRangeProvider>
              <AccountProvider>
                <KeyboardShortcutsProvider>
                  <Sidebar />
                  <main className="flex-1 overflow-auto">{children}</main>
                </KeyboardShortcutsProvider>
              </AccountProvider>
            </OperationalDateRangeProvider>
          </TooltipProvider>
        </TimezoneProvider>
      </body>
    </html>
  );
}
