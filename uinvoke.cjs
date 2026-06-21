const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, ComputeBudgetProgram, sendAndConfirmTransaction } = require("@solana/web3.js");
const fs = require("fs");
const idl = require("./target/idl/unicorn_spike.json");
const PROGRAM = new PublicKey(idl.address);
const conn = new Connection((process.env.RPC_URL || "http://localhost:8899"), "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.PAYER || process.env.HOME+"/.config/solana/id.json"))));
const crypto = require("crypto");
const disc = name => { const f = idl.instructions.find(i=>i.name===name); return f && f.discriminator ? Buffer.from(f.discriminator) : crypto.createHash("sha256").update("global:"+name).digest().subarray(0,8); };
async function run(name){
  const ix = new TransactionInstruction({ programId: PROGRAM, keys:[{pubkey:payer.publicKey,isSigner:true,isWritable:true}], data: disc(name) });
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:1_400_000})).add(ix);
  try {
    const sig = await sendAndConfirmTransaction(conn, tx, [payer], {commitment:"confirmed"});
    const t = await conn.getTransaction(sig, {commitment:"confirmed", maxSupportedTransactionVersion:0});
    console.log(`${name}: OK  CU=${t.meta.computeUnitsConsumed}`);
  } catch(e){
    const logs = (e.logs||[]).filter(l=>/call depth|Error|failed|Panic|exceeded/i.test(l)).slice(-5);
    console.log(`${name}: FAIL  ${String(e.message).split("\n")[0]}`);
    logs.forEach(l=>console.log("    "+l));
  }
}
(async()=>{ for(const n of (process.argv.slice(2).length?process.argv.slice(2):["baseline","verify_groth16","verify_groth16_ours"])) await run(n); })();
