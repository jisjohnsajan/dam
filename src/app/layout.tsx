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
  title: "DAMSAFE 3D — Real-Time Dam Risk Prediction & Flood Digital Twin",
  description:
    "Dam risk monitoring, what-if failure scenarios, GPU shallow-water flood simulation, depth/velocity/arrival layers, impact analysis and evacuation planning for Idukki and Mullaperiyar dams.",
  keywords: ["dam safety", "dam break", "flood simulation", "digital twin", "shallow water equations", "Idukki", "Mullaperiyar", "GIS", "risk assessment"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "DAMSAFE 3D — Real-Time Dam Risk Prediction & Flood Digital Twin",
    description: "From reservoir monitoring to dam-failure scenarios, hydrodynamic flood prediction, impact analysis and evacuation — one 3D geospatial platform.",
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
