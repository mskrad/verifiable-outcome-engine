import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const SOL_MINT = "11111111111111111111111111111111";
const DEFAULT_BASE_URL = "https://core-api-dev.vanish.trade";

export type VanishPayoutParams = {
  apiKey: string;
  amountLamports: bigint;
  winnerAddress: string;
  operatorKeypair: Keypair;
  rpcUrl: string;
  baseUrl?: string;
};

export type VanishPayoutResult = {
  depositTx: string;
  withdrawTx: string;
  mock?: boolean;
};

async function vanishGet(
  baseUrl: string,
  apiKey: string,
  path: string
): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "x-api-key": apiKey },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Vanish GET ${path} ${res.status}: ${text}`);
  }
  return res.json();
}

async function vanishPost(
  baseUrl: string,
  apiKey: string,
  path: string,
  body: unknown
): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Vanish POST ${path} ${res.status}: ${text}`);
  }
  return res.json();
}

export async function vanishPayoutRoute(
  params: VanishPayoutParams
): Promise<VanishPayoutResult> {
  const base = params.baseUrl ?? DEFAULT_BASE_URL;
  const connection = new Connection(params.rpcUrl, "confirmed");

  // Step 1 — get deposit address
  const depositData = await vanishGet(
    base,
    params.apiKey,
    `/deposit_address?mint=${SOL_MINT}`
  ) as { address: string };
  const depositAddress = depositData.address;
  if (!depositAddress) throw new Error("Vanish: no deposit address returned");

  // Step 2 — on-chain transfer operator → deposit address
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: params.operatorKeypair.publicKey,
      toPubkey: new PublicKey(depositAddress),
      lamports: params.amountLamports,
    })
  );
  const depositTx = await sendAndConfirmTransaction(
    connection,
    tx,
    [params.operatorKeypair],
    { commitment: "confirmed" }
  );

  // Step 3 — commit deposit
  await vanishPost(base, params.apiKey, "/commit", {
    mint: SOL_MINT,
    signature: depositTx,
  });

  // Step 4 — create withdraw (Vanish routes from internal pool to winner)
  const withdrawData = await vanishPost(
    base,
    params.apiKey,
    "/withdraw/create",
    {
      mint: SOL_MINT,
      amount: params.amountLamports.toString(),
      destination: params.winnerAddress,
    }
  ) as { transaction?: string; unsigned_transaction?: string };

  const unsignedTxBase64 =
    withdrawData.transaction ?? withdrawData.unsigned_transaction;
  if (!unsignedTxBase64) {
    throw new Error("Vanish: withdraw/create returned no transaction");
  }

  // Step 5 — sign and broadcast the withdraw transaction
  const unsignedTxBuf = Buffer.from(unsignedTxBase64, "base64");
  const withdrawTxObj = Transaction.from(unsignedTxBuf);
  withdrawTxObj.partialSign(params.operatorKeypair);
  const rawWithdraw = withdrawTxObj.serialize();
  const withdrawTx = await connection.sendRawTransaction(rawWithdraw, {
    skipPreflight: false,
  });
  await connection.confirmTransaction(withdrawTx, "confirmed");

  // Step 6 — commit withdraw
  await vanishPost(base, params.apiKey, "/commit", { signature: withdrawTx });

  return { depositTx, withdrawTx };
}
