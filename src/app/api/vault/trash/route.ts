import { getTrash, purgeTrash, restoreAsset } from "@/lib/vault";
import { errorResponse } from "@/lib/api-error";
export const dynamic = "force-dynamic";
export async function GET() { try { return Response.json({ items: await getTrash() }); } catch (e) { return errorResponse(e, "回收站读取失败。"); } }
export async function PATCH(request: Request) { try { const { id } = await request.json(); return Response.json({ asset: await restoreAsset(String(id)) }); } catch (e) { return errorResponse(e, "资产恢复失败。"); } }
export async function DELETE(request: Request) { try { const { id } = await request.json(); await purgeTrash(String(id)); return Response.json({ ok: true }); } catch (e) { return errorResponse(e, "资产永久删除失败。"); } }
