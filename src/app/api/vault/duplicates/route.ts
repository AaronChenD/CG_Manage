import { findDuplicates } from "@/lib/vault";
import { errorResponse } from "@/lib/api-error";
export const dynamic = "force-dynamic";
export async function GET() { try { return Response.json(await findDuplicates()); } catch (e) { return errorResponse(e, "重复资产检查失败。"); } }
