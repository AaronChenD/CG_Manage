import { NextResponse, type NextRequest } from "next/server";

/**
 * 默认只允许运行服务的本机写入，远程访问仍可浏览和搜索。
 * CG_ALLOW_REMOTE_WRITE=true 仅适用于明确受信任的内网部署，不建议开启。
 * 反向代理必须正确传递 x-forwarded-for / x-real-ip；未识别来源按远程处理。
 */
export function middleware(request: NextRequest) {
  if (process.env.CG_ALLOW_REMOTE_WRITE === "true" || request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return NextResponse.next();
  }

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip")?.trim();
  const host = request.headers.get("host")?.split(":")[0];
  const local = !forwarded || forwarded === "127.0.0.1" || forwarded === "::1" || forwarded === host || host === "localhost" || host === "127.0.0.1";
  if (local) return NextResponse.next();

  return NextResponse.json({ error: "远程访问为只读模式，写入操作必须在运行 CG Vault 的本机执行。" }, { status: 403 });
}

export const config = { matcher: ["/api/:path*"] };
