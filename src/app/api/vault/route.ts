import { createAsset, ensureVaultSeed, getVaultSnapshot } from "@/lib/vault";
import { errorResponse } from "@/lib/api-error";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureVaultSeed();
    const url = new URL(request.url);
    return Response.json(
      await getVaultSnapshot({
        query: url.searchParams.get("q") ?? "",
        kind: url.searchParams.get("kind") ?? undefined,
        categoryId: url.searchParams.get("categoryId") ?? undefined,
        page: Number(url.searchParams.get("page") ?? 0) || undefined,
        pageSize: Number(url.searchParams.get("pageSize") ?? 0) || undefined,
      }),
    );
  } catch (error) {
    return errorResponse(error, "代码库数据加载失败。");
  }
}

export async function POST(request: Request) {
  try {
    await ensureVaultSeed();
    const body = await request.json();
    return Response.json({ asset: await createAsset(body) }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "资产创建失败，请检查本地文件夹是否可写。");
  }
}
