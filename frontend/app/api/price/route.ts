import { NextResponse } from "next/server";
import crypto from "crypto";

const BASE = "https://web3.okx.com";
const API_KEY = process.env.ONCHAINOS_API_KEY!;
const SECRET = process.env.ONCHAINOS_SECRET_KEY!;
const PASSPHRASE = process.env.ONCHAINOS_PASSPHRASE!;

const OKB = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDC = "0x74b7f16337b8972027f6196a17a631ac6de26d22";

function sign(ts: string, method: string, path: string, body: string) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(ts + method + path + body)
    .digest("base64");
}

export async function GET() {
  try {
    const ts = new Date().toISOString();
    const path = `/api/v6/dex/aggregator/quote?chainId=196&fromTokenAddress=${OKB}&toTokenAddress=${USDC}&amount=1000000000000000000`;
    const sig = sign(ts, "GET", path, "");

    const res = await fetch(`${BASE}${path}`, {
      headers: {
        "OK-ACCESS-KEY": API_KEY,
        "OK-ACCESS-SIGN": sig,
        "OK-ACCESS-PASSPHRASE": PASSPHRASE,
        "OK-ACCESS-TIMESTAMP": ts,
      },
      next: { revalidate: 30 },
    });

    const data = await res.json();
    const toAmount = data?.data?.[0]?.toTokenAmount;
    const price = toAmount ? (Number(toAmount) / 1e6).toFixed(2) : "—";
    return NextResponse.json({ price, source: "OnchainOS DEX (Uniswap V4, X Layer)" });
  } catch {
    return NextResponse.json({ price: "—", source: "unavailable" });
  }
}
