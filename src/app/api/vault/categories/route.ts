import { createCategory, ensureVaultSeed, VaultError } from "@/lib/vault";

export const dynamic = "force-dynamic";

function errorResponse(error: unknown, fallback: string) {
  const candidate = error as { status?: unknown; message?: unknown } | null;
  if (error instanceof VaultError || (candidate && typeof candidate.status === "number" && typeof candidate.message === "string")) {
    return Response.json({ error: candidate?.message ?? "请求失败。" }, { status: Number(candidate?.status) });
  }
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    await ensureVaultSeed();
    const body = await request.json();
    return Response.json({ category: await createCategory(body) }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "软件空间创建失败，请检查本地 JSON 文件夹是否可写。");
  }
}
