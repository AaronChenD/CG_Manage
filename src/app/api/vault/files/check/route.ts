import { checkPaths } from "@/lib/vault";
import { errorResponse } from "@/lib/api-error";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const results = await checkPaths(body.entries ?? body.paths, Boolean(body.withHash));
    return Response.json({ results });
  } catch (error) {
    return errorResponse(error, "路径校验失败。");
  }
}
