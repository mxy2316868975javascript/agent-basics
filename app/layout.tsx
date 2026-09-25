import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 基础实验室",
  description: "用一个可运行的 Demo 看懂 LLM、Token、Embedding、SSE 和 Function Calling。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
