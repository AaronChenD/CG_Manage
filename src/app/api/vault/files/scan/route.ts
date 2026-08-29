import { scanDirectory } from "@/lib/vault";
import { errorResponse } from "@/lib/api-error";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await scanDirectory(body.target ?? body.path, { extensions: body.extensions, includeDirectories: body.includeDirectories });
    return Response.json(result);
  } catch (error) {
    return errorResponse(error, "目录浏览失败。");
  }
}
