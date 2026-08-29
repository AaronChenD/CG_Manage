import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const configDirectory = join(process.cwd(), "config");
    const storedTextsDirectory = join(process.cwd(), "stored_texts");
    await mkdir(configDirectory, { recursive: true });
    await mkdir(storedTextsDirectory, { recursive: true });
    await access(configDirectory);
    await access(storedTextsDirectory);
    return Response.json({ ok: true, storage: "json", config: "config/cg_manager_config.json", texts: "stored_texts/" });
  } catch {
    return Response.json({ ok: false, storage: "json" }, { status: 500 });
  }
}
