use std::{env, fs, path::PathBuf};

const DEFAULT_PROGRAM_ID: &str = "9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F";

fn main() {
    let program_id =
        env::var("OUTCOME_PROGRAM_ID").unwrap_or_else(|_| DEFAULT_PROGRAM_ID.to_string());
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR must be set"));
    let generated = format!("anchor_lang::declare_id!(\"{}\");\n", program_id);
    fs::write(out_dir.join("program_id.rs"), generated).expect("write program_id.rs");
    println!("cargo:rerun-if-env-changed=OUTCOME_PROGRAM_ID");
}
