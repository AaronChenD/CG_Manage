import { deletePathAlias, updatePathAlias } from "@/lib/vault";
import { errorResponse } from "@/lib/api-error";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    const body = await request.json();
    return Response.json({ alias: await updatePathAlias(id, body) });
  } catch (error) {
    return errorResponse(error, "路径别名更新失败。");
  }
}

export async function DELETE(_: Request, { params }: RouteContext) {
  const { id } = await params;
  try {
    await deletePathAlias(id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, "路径别名删除失败。");
  }
}
