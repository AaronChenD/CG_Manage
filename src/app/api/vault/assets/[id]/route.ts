import { deleteAsset, getAssetById, getAssetHistory, updateAsset } from "@/lib/vault";
import { errorResponse } from "@/lib/api-error";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const [asset, history] = await Promise.all([getAssetById(id), getAssetHistory(id)]);
    if (!asset) return Response.json({ error: "该资产不存在或已被删除。" }, { status: 404 });
    return Response.json({ asset, history });
  } catch (error) {
    return errorResponse(error, "该资产读取失败。");
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const body = await request.json();
    return Response.json({ asset: await updateAsset(id, body) });
  } catch (error) {
    return errorResponse(error, "保存失败，请检查本地 JSON 文件夹是否可写。");
  }
}

export async function DELETE(_: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    await deleteAsset(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "删除失败，请稍后重试。");
  }
}
