/**
 * OnchainOS API client — V6 with HMAC auth
 */
import { createHmac } from "crypto";

const BASE = "https://web3.okx.com";
const CHAIN_INDEX = "196"; // X Layer

export function makeHeaders(method, path, body = "") {
  const key = process.env.ONCHAINOS_API_KEY;
  const secret = process.env.ONCHAINOS_SECRET_KEY;
  const passphrase = process.env.ONCHAINOS_PASSPHRASE;
  const ts = new Date().toISOString();
  const msg = ts + method.toUpperCase() + path + (body || "");
  const sign = createHmac("sha256", secret).update(msg).digest("base64");
  return {
    "OK-ACCESS-KEY": key,
    "OK-ACCESS-SIGN": sign,
    "OK-ACCESS-PASSPHRASE": passphrase,
    "OK-ACCESS-TIMESTAMP": ts,
    "Content-Type": "application/json",
  };
}

async function get(path) {
  const res = await fetch(BASE + path, { headers: makeHeaders("GET", path) });
  const d = await res.json();
  if (d.code !== "0") throw new Error(`OnchainOS error ${d.code}: ${d.msg}`);
  return d.data;
}

async function post(path, body) {
  const bodyStr = JSON.stringify(body);
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: makeHeaders("POST", path, bodyStr),
    body: bodyStr,
  });
  const d = await res.json();
  if (d.code !== "0") throw new Error(`OnchainOS error ${d.code}: ${d.msg}`);
  return d.data;
}

// ── Wallet ────────────────────────────────────────────────────────────────────

export async function getBalance(address) {
  return get(`/api/v6/wallet/asset/token-balances-by-address?address=${address}&chains=${CHAIN_INDEX}`);
}

export async function getTotalValue(address) {
  return get(`/api/v6/wallet/asset/total-value?address=${address}&chains=${CHAIN_INDEX}`);
}

// ── DEX / Trade ───────────────────────────────────────────────────────────────

export async function getTokens() {
  return get(`/api/v6/dex/aggregator/all-tokens?chainIndex=${CHAIN_INDEX}`);
}

export async function getQuote(fromToken, toToken, amount) {
  return get(
    `/api/v6/dex/aggregator/quote?chainIndex=${CHAIN_INDEX}` +
    `&fromTokenAddress=${fromToken}&toTokenAddress=${toToken}&amount=${amount}`
  );
}

export async function getSwapTx(fromToken, toToken, amount, userAddress, slippage = "0.5") {
  return get(
    `/api/v6/dex/aggregator/swap?chainIndex=${CHAIN_INDEX}` +
    `&fromTokenAddress=${toToken}&toTokenAddress=${toToken}` +
    `&amount=${amount}&userWalletAddress=${userAddress}&slippage=${slippage}`
  );
}

export async function broadcastTx(signedTx, address) {
  return post("/api/v6/dex/pre-transaction/broadcast-transaction", {
    signedTx,
    chainIndex: CHAIN_INDEX,
    address,
  });
}

// ── Security ──────────────────────────────────────────────────────────────────

export async function scanToken(tokenAddress) {
  return get(`/api/v6/wallet/pre-transaction/token-risk-scan?chainIndex=${CHAIN_INDEX}&tokenContractAddress=${tokenAddress}`);
}

// ── Market ────────────────────────────────────────────────────────────────────

export async function getPrice(tokenAddress) {
  return get(`/api/v6/dex/market/price?chainIndex=${CHAIN_INDEX}&tokenContractAddress=${tokenAddress}`);
}
