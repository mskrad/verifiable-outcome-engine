import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SDK_DIR = path.dirname(fileURLToPath(import.meta.url));
const IDL_PATH_CANDIDATES = [
  path.resolve(SDK_DIR, "../artifacts/outcome_idl.json"),
  path.resolve(SDK_DIR, "../../artifacts/outcome_idl.json"),
  path.resolve(process.cwd(), "artifacts/outcome_idl.json"),
];

function loadOutcomeIdl(): unknown {
  for (const idlPath of IDL_PATH_CANDIDATES) {
    if (fs.existsSync(idlPath)) {
      return JSON.parse(fs.readFileSync(idlPath, "utf8"));
    }
  }
  throw new Error(
    `Unable to locate outcome IDL. Checked: ${IDL_PATH_CANDIDATES.join(", ")}`
  );
}

export const OUTCOME_IDL = loadOutcomeIdl();
