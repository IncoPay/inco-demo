/**
 * Simple 402-gated chat endpoint.
 *
 * Flow:
 *   1. client POSTs { prompt }
 *   2. if no PAYMENT-SIGNATURE header → return 402 with PAYMENT-REQUIRED
 *   3. if header present → forward to facilitator /settle; on success, call Ollama
 */
import { NextRequest, NextResponse } from "next/server";

const FACILITATOR_URL =
  process.env.NEXT_PUBLIC_FACILITATOR_URL || "http://localhost:4021";
const RECIPIENT = process.env.NEXT_PUBLIC_RECIPIENT_PUBKEY || "";
const MINT = process.env.NEXT_PUBLIC_TOKEN_MINT || "";
const NETWORK = process.env.NEXT_PUBLIC_NETWORK || "solana:devnet";
const PER_CALL_BASE_UNITS = "10000"; // 0.01 pUSDC (@ 6 decimals)
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:1b";

function b64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}
function b64dec(s: string): string {
  return Buffer.from(s, "base64").toString("utf8");
}

function paymentRequired(url: string) {
  const pr = {
    x402Version: 2,
    error: "payment_required",
    resource: { url },
    accepts: [
      {
        scheme: "session",
        network: NETWORK,
        asset: MINT,
        amount: PER_CALL_BASE_UNITS,
        payTo: RECIPIENT,
        maxTimeoutSeconds: 60,
        extra: { facilitatorUrl: FACILITATOR_URL, per: "message" },
      },
    ],
  };
  return new NextResponse(JSON.stringify(pr), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": b64(JSON.stringify(pr)),
    },
  });
}

export async function POST(req: NextRequest) {
  if (!RECIPIENT || !MINT) {
    return NextResponse.json(
      {
        error:
          "server not configured: set NEXT_PUBLIC_RECIPIENT_PUBKEY and NEXT_PUBLIC_TOKEN_MINT",
      },
      { status: 500 }
    );
  }

  const paymentHeader =
    req.headers.get("PAYMENT-SIGNATURE") ||
    req.headers.get("X-PAYMENT") ||
    req.headers.get("payment-signature") ||
    req.headers.get("x-payment");

  if (!paymentHeader) return paymentRequired(req.url);

  let payload: any;
  try {
    payload = JSON.parse(b64dec(paymentHeader));
  } catch {
    return NextResponse.json(
      { error: "bad_payment_payload" },
      { status: 400 }
    );
  }

  const paymentRequirements = payload.accepted;
  if (!paymentRequirements) return paymentRequired(req.url);

  // settle via facilitator
  const settleRes = await fetch(`${FACILITATOR_URL}/settle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      paymentPayload: payload,
      paymentRequirements,
    }),
  });
  const settle = await settleRes.json();
  if (!settle.success) {
    return new NextResponse(
      JSON.stringify({ error: "settle_failed", details: settle }),
      {
        status: 402,
        headers: {
          "content-type": "application/json",
          "PAYMENT-RESPONSE": b64(JSON.stringify(settle)),
        },
      }
    );
  }

  // call Ollama
  const body = await req.json().catch(() => ({} as any));
  const prompt = body?.prompt;
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "missing_prompt" }, { status: 400 });
  }

  let reply = "(ollama unreachable, but payment settled ✓)";
  try {
    const oll = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
      }),
    });
    if (oll.ok) {
      const j = await oll.json();
      reply = j.response || "(empty ollama reply)";
    }
  } catch {
    // keep fallback
  }

  return NextResponse.json({
    reply,
    paymentTx: settle.transaction,
    remaining: settle.extensions?.session?.remaining,
    spent: settle.extensions?.session?.spent,
  });
}
