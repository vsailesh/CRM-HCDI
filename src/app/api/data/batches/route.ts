import { ok } from "@/lib/api";
import { listBatches } from "@/lib/history";

export async function GET() {
  return ok(listBatches(100));
}
