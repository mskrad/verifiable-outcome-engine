import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import anchor from "@coral-xyz/anchor";

// Storage for committed participant snapshots. Whatever URI the provider returns goes on-chain as
// snapshot_uri, so switching providers changes new draws only; the verifier checks every copy against
// snapshot_hash and falls back to the hash-addressed mirror served by this server.

const IRYS_DEVNET_READ_BASE = "https://devnet.irys.xyz";
const DEFAULT_IRYS_TOPUP_LAMPORTS = 20_000_000n;

export function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export function publicBaseUrl(env = process.env) {
  return String(env.PUBLIC_BASE_URL || "https://verifiableoutcome.online").replace(/\/+$/, "");
}

export function mirrorPath(storeDir, snapshotHash) {
  return path.join(storeDir, "sha256", `${snapshotHash}.jsonl`);
}

export function mirrorUrl(snapshotHash, env = process.env) {
  return `${publicBaseUrl(env)}/sha256/${snapshotHash}.jsonl`;
}

/** Writes the snapshot under its SHA-256; refuses bytes that do not match the hash. */
export function storeMirrorCopy(storeDir, snapshotHash, bytes) {
  if (sha256Hex(bytes) !== snapshotHash) {
    throw new Error("snapshot bytes do not match snapshot_hash");
  }
  const target = mirrorPath(storeDir, snapshotHash);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const partial = `${target}.${process.pid}.partial`;
    fs.writeFileSync(partial, bytes);
    fs.renameSync(partial, target);
  }
  return target;
}

function expandHome(value) {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function irysSecretKey(env) {
  if (env.PARTNER_SNAPSHOT_IRYS_PRIVATE_KEY) {
    return String(env.PARTNER_SNAPSHOT_IRYS_PRIVATE_KEY).trim();
  }
  const walletPath = env.PARTNER_SNAPSHOT_IRYS_WALLET || env.LIVE_RAFFLE_WALLET || env.ANCHOR_WALLET || "";
  if (!walletPath) {
    throw new Error("set PARTNER_SNAPSHOT_IRYS_WALLET (or LIVE_RAFFLE_WALLET) to a funded devnet keypair");
  }
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(expandHome(walletPath), "utf8")));
  return anchor.utils.bytes.bs58.encode(secret);
}

function irysDevnetStorage(env) {
  const rpcUrl = String(
    env.PARTNER_SNAPSHOT_IRYS_PROVIDER_URL || env.LIVE_RAFFLE_RPC_URL || env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com"
  ).trim();
  const topUp = BigInt(env.PARTNER_SNAPSHOT_IRYS_TOPUP_LAMPORTS || DEFAULT_IRYS_TOPUP_LAMPORTS);
  let uploaderPromise;

  async function uploader() {
    if (!uploaderPromise) {
      uploaderPromise = (async () => {
        const { Uploader } = await import("@irys/upload");
        const { Solana } = await import("@irys/upload-solana");
        return Uploader(Solana).withWallet(irysSecretKey(env)).withRpc(rpcUrl).devnet();
      })().catch((error) => {
        uploaderPromise = undefined;
        throw error;
      });
    }
    return uploaderPromise;
  }

  return {
    name: "irys-devnet",
    async publish(bytes, { snapshotHash }) {
      const client = await uploader();
      const price = BigInt((await client.getPrice(bytes.length)).toString());
      const balance = BigInt((await client.getBalance()).toString());
      if (balance < price) {
        // Top up ahead of need: funding waits for a devnet confirmation, the upload itself does not.
        const amount = price * 2n > topUp ? price * 2n : topUp;
        await client.fund(amount.toString());
      }
      const receipt = await client.upload(bytes, {
        tags: [
          // text/plain so gateways show the list in a browser instead of downloading it; the hash covers
          // the bytes only, so the type does not change what the draw commits to.
          { name: "Content-Type", value: "text/plain; charset=utf-8" },
          { name: "VRE-Snapshot-SHA256", value: snapshotHash },
        ],
      });
      return {
        uri: `irys-devnet://${receipt.id}`,
        url: `${IRYS_DEVNET_READ_BASE}/${receipt.id}`,
        receiptId: receipt.id,
      };
    },
  };
}

function mirrorOnlyStorage(env) {
  return {
    name: "mirror",
    async publish(_bytes, { snapshotHash }) {
      const url = mirrorUrl(snapshotHash, env);
      return { uri: url, url, receiptId: null };
    },
  };
}

/**
 * PARTNER_SNAPSHOT_STORAGE selects where snapshots are published before a draw is committed:
 * `irys-devnet` (default) or `mirror` (this server's /sha256/<hash>.jsonl, for local runs).
 */
export function createSnapshotStorage(env = process.env) {
  const name = String(env.PARTNER_SNAPSHOT_STORAGE || "irys-devnet").trim().toLowerCase();
  if (name === "irys-devnet") return irysDevnetStorage(env);
  if (name === "mirror") return mirrorOnlyStorage(env);
  throw new Error(`unknown PARTNER_SNAPSHOT_STORAGE "${name}" (supported: irys-devnet, mirror)`);
}
