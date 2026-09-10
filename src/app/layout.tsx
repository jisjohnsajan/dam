import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dam Break Lab — Real-time 3D Hydrodynamics",
  description:
    "Interactive 3D dam-break simulation: GPU shallow-water equations, breach erosion, spillway gates, foam, spray and flood-wave propagation in your browser.",
  keywords: ["dam break", "shallow water equations", "hydrodynamics", "3D simulation", "WebGL", "Three.js"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "Dam Break Lab — Real-time 3D Hydrodynamics",
    description: "Break a dam and watch the physics unfold — real Saint-Venant equations on GPU.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
