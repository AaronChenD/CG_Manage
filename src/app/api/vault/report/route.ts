import { getVaultReport } from "@/lib/vault";
import { errorResponse } from "@/lib/api-error";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getVaultReport());
  } catch (error) {
    return errorResponse(error, "关系表统计读取失败。");
  }
}
