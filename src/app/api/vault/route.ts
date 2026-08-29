import { createAsset, ensureVaultSeed, getVaultSnapshot } from "@/lib/vault";
import { errorResponse } from "@/lib/api-error";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureVaultSeed();
    return Response.json(await getVaultSnapshot());
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
