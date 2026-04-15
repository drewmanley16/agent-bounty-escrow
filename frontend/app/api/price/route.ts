import { NextResponse } from "next/server";
import crypto from "crypto";

const OKB = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDC = "0x74b7f16337b8972027f6196a17a631ac6de26d22";

export const dynamic = "force-dynamic";

async function getOnchainOSPrice(): Promise<string | null> {
  const API_KEY = process.env.ONCHAINOS_API_KEY ?? "";
  const SECRET = process.env.ONCHAINOS_SECRET_KEY ?? "";
  const PASSPHRASE = process.env.ONCHAINOS_PASSPHRASE ?? "";

  if (!API_KEY || !SECRET || !PASSPHRASE) return null;

  const ts = new Date().toISOString();
  const path = `/api/v6/dex/aggregator/quote?chainIndex=196&fromTokenAddress=${OKB}&toTokenAddress=${USDC}&amount=1000000000000000000`;
  const sig = crypto.createHmac("sha256", SECRET).update(ts + "GET" + path + "").digest("base64");

  const res = await fetch(`https://web3.okx.com${path}`, {
    method: "GET",
    headers: {
      "OK-ACCESS-KEY": API_KEY,
      "OK-ACCESS-SIGN": sig,
      "OK-ACCESS-PASSPHRASE": PASSPHRASE,
      "OK-ACCESS-TIMESTAMP": ts,
    },
    cache: "no-store",
  });
  const data = await res.json();
  if (data?.code !== "0") return null;
  const toAmount = data?.data?.[0]?.toTokenAmount;
  return toAmount ? (Number(toAmount) / 1e6).toFixed(2) : null;
}

async function getCoinGeckoPrice(): Promise<string | null> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=okb&vs_currencies=usd",
    { cache: "no-store" }
  );
  const data = await res.json();
  const p = data?.okb?.usd;
  return p ? Number(p).toFixed(2) : null;
}

export async function GET() {
  try {
    // Try OnchainOS first (Uniswap V4 on X Layer)
    const onchainPrice = await getOnchainOSPrice();
    if (onchainPrice) {
      return NextResponse.json({ price: onchainPrice, source: "OnchainOS DEX (Uniswap V4, X Layer)" });
    }

    // Fallback to CoinGecko
    const cgPrice = await getCoinGeckoPrice();
    if (cgPrice) {
      return NextResponse.json({ price: cgPrice, source: "CoinGecko" });
    }

    return NextResponse.json({ price: "—", source: "unavailable" });
  } catch {
    return NextResponse.json({ price: "—", source: "unavailable" });
  }
}
