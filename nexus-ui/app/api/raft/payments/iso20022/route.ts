import { NextRequest, NextResponse } from "next/server";
import { raftRequest } from "@/lib/raft/client";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ref = req.nextUrl.searchParams.get("ref");
    const tenantId = req.nextUrl.searchParams.get("tenantId") || "default";

    if (!ref) {
      return NextResponse.json({ error: "Missing 'ref' parameter" }, { status: 400 });
    }

    const xml = await raftRequest<string>(
      `/v1/payments/iso20022?ref=${encodeURIComponent(ref)}&tenantId=${encodeURIComponent(tenantId)}`,
      { isXml: true }
    );

    return new NextResponse(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `attachment; filename="pacs.008_${ref}.xml"`,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load ISO 20022 XML";
    return NextResponse.json({ error: msg }, { status: 404 });
  }
}

