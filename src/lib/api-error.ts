import { VaultError } from "@/lib/vault";

/**
 * Next.js 会在路由之间重新抛出错误对象，因此这里既识别 VaultError 实例，
 * 也识别被序列化后只剩 status/message 的普通对象。
 */
export function errorResponse(error: unknown, fallback: string) {
  const candidate = error as { status?: unknown; message?: unknown } | null;
  const isVaultError = error instanceof VaultError || (candidate && typeof candidate.status === "number" && typeof candidate.message === "string");
  if (isVaultError) {
    return Response.json({ error: candidate?.message ?? "请求失败。" }, { status: Number(candidate?.status) });
  }
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}
