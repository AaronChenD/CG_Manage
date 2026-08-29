import { createPathAlias, ensureVaultSeed, getPathAliases } from "@/lib/vault";
import { errorResponse } from "@/lib/api-error";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureVaultSeed();
    return Response.json({ aliases: await getPathAliases() });
  } catch (error) {
    return errorResponse(error, "路径别名读取失败。");
  }
}

export async function POST(request: Request) {
  try {
    await ensureVaultSeed();
    const body = await request.json();
    return Response.json({ alias: await createPathAlias(body) }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "路径别名创建失败，请检查 config 目录是否可写。");
  }
}
