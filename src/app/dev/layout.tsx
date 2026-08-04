import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { notFound } from "next/navigation";
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
  title: "Token Proof — Trading Journal",
  description:
    "Dev-only visual proof surface for the M014 Graphite + Steel Blue semantic token system. Not part of the product navigation.",
  icons: {
    icon: "/favicon.svg",
  },
};

// Dev route root layout: intentionally standalone (no Sidebar, no app state
// providers) so /dev/* surfaces render tokens in isolation from the product
// shell. Theme persistence follows the same localStorage + `.dark` class
// contract as every other root layout in the app.
export default function DevRootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_DEV_SURFACES !== "true"
  ) {
    notFound();
  }

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: '(function(){try{var t=localStorage.getItem("theme");if(!t)t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}})()',
          }}
        />
      </head>
      <body className="min-h-full bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
