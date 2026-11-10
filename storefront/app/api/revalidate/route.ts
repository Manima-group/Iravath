import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

/** Called by the backend after admin edits (product/offer saved) so changes show instantly instead of within 60s. */
export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || req.headers.get("x-revalidate-secret") !== secret) return NextResponse.json({ ok: false }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { paths?: string[] };
  const paths = (body.paths?.length ? body.paths : ["/"]).filter((p) => typeof p === "string" && p.startsWith("/")).slice(0, 50);
  revalidatePath("/", "layout"); // header offers + category lists
  paths.forEach((p) => revalidatePath(p));
  return NextResponse.json({ ok: true, revalidated: paths });
}
