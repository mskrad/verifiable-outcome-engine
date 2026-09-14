import type { Connection, PublicKey, Transaction } from "@solana/web3.js";

// Sends a transaction and confirms it without web3.js `confirmTransaction` / `sendAndConfirmTransaction`
// (and Anchor `.rpc()` / `sendAndConfirm`, which call it). See `pollSignature` for why.
export async function sendAndConfirmSigned(
  connection: Connection,
  tx: Transaction,
  feePayer: PublicKey,
  sign: (tx: Transaction) => Transaction | Promise<Transaction>
): Promise<string> {
  // A transaction dropped before it lands expires with its blockhash; sign it again with a fresh one.
  for (let attempt = 1; ; attempt += 1) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = feePayer;
    tx.recentBlockhash = blockhash;
    const signed = await sign(tx);
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      preflightCommitment: "confirmed",
    });
    try {
      await pollSignature(connection, signature, lastValidBlockHeight);
      return signature;
    } catch (error) {
      if (attempt >= SEND_ATTEMPTS || !(error instanceof BlockhashExpiredError)) throw error;
    }
  }
}

export const SEND_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 2000;
const POLL_DEADLINE_MS = 90_000;

export class BlockhashExpiredError extends Error {}

// Confirms without `confirmTransaction`: web3.js runs that call's status lookup in a detached
// promise with no catch, so a 429 from public RPC there becomes an unhandled rejection that
// kills a Node process mid-draw. The websocket notification usually arrives within a slot and
// costs no HTTP request; a slow status poll backs it up, and every failed RPC call is retried.
export async function pollSignature(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number
): Promise<void> {
  let notified: { err: unknown } | undefined;
  let wake = () => {};
  let subscriptionId: number | undefined;
  try {
    subscriptionId = connection.onSignature(
      signature,
      (result) => {
        notified = { err: result.err };
        wake();
      },
      "confirmed"
    );
  } catch {
    // No websocket: the status poll below still confirms.
  }
  try {
    const deadline = Date.now() + POLL_DEADLINE_MS;
    for (let tick = 1; Date.now() < deadline; tick += 1) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (notified) resolve();
        else setTimeout(resolve, POLL_INTERVAL_MS);
      });
      let err = notified?.err;
      let done = notified !== undefined;
      let blockHeight: number | undefined;
      if (!done) {
        try {
          const status = (await connection.getSignatureStatuses([signature])).value[0];
          err = status?.err;
          done =
            Boolean(status?.err) ||
            status?.confirmationStatus === "confirmed" ||
            status?.confirmationStatus === "finalized";
          if (!done && tick % 5 === 0) blockHeight = await connection.getBlockHeight("confirmed");
        } catch {
          continue;
        }
      }
      if (err) {
        throw new Error(
          `Transaction ${signature} failed: ${JSON.stringify(err)}. Logs: ${await fetchLogs(connection, signature)}`
        );
      }
      if (done) return;
      if (blockHeight !== undefined && blockHeight > lastValidBlockHeight) {
        throw new BlockhashExpiredError(`Transaction ${signature} expired: blockhash is no longer valid`);
      }
    }
    throw new Error(`Transaction ${signature} was not confirmed within ${POLL_DEADLINE_MS / 1000}s`);
  } finally {
    // A delivered notification already disposed of its subscription.
    if (subscriptionId !== undefined && !notified) {
      connection.removeSignatureListener(subscriptionId).catch(() => {});
    }
  }
}

async function fetchLogs(connection: Connection, signature: string): Promise<string> {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    return JSON.stringify(tx?.meta?.logMessages?.slice(-10) ?? []);
  } catch {
    return "[]";
  }
}
