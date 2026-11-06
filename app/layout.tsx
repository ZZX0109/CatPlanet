import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "喵星 · 留一间温柔的小房间",
  description: "为想念的它留一间小房间，记录你们真实的回忆。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
