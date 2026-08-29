import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./vault-files.css";

export const metadata: Metadata = {
  title: "CG Vault — CG 技术资产库",
  description: "用于集中管理 CG Pipeline 代码、脚本、参考资料和历史版本的网页版工具箱。",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning 只作用于 <html> 自身的属性。
    // 翻译类 / 划词类浏览器扩展（例如 Trancy）会在注水前给 <html> 注入
    // trancy-version 之类的属性，这里忽略这类注入属性以避免误报水合错误。
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
