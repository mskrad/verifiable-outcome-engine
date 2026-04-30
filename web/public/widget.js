(function () {
  "use strict";

  const PUBLIC_ORIGIN = "https://verifiableoutcome.online";
  const DEFAULT_RPC = "https://api.devnet.solana.com";
  const DEFAULT_PROGRAM_ID = "9tEramtR21bLBHvXqa4sofVBPa1ZBho4WzhCkCimFE1F";
  const DEFAULT_SIGNATURE =
    "5wZUU5YQ8Nu5RddNeEEigYUEM5Q45C2SJmwLgdLhQcLQi4S3vYhAUvLc6YchYnxqU5b1pvEsBSD1USZPPDEaRVd2";

  function short(value) {
    return String(value || "").slice(0, 8);
  }

  function localOrigin() {
    return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? location.origin : "";
  }

  function defaultLabel(replay, signature) {
    if (signature === DEFAULT_SIGNATURE) return "Raffle";

    const version = Number(replay?.artifact_format_version || 0);
    const formula = String(replay?.resolution_formula || "").trim();
    const winners = Number(replay?.winners_count || 0);

    if (formula) {
      return `W3O1 v${version || 3} ${formula}`;
    }
    if (version === 2 && winners > 1) {
      return `W3O1 v2 · ${winners} winners`;
    }
    if (version > 0) {
      return `W3O1 v${version}`;
    }
    return "Verified Outcome";
  }

  async function fetchReplay(signature, rpc, programId) {
    let lastError;
    const origins = [PUBLIC_ORIGIN, localOrigin()].filter(Boolean);

    for (const origin of origins) {
      try {
        const response = await fetch(`${origin}/api/replay`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ signature, rpc, programId }),
        });
        const json = await response.json();
        if (!response.ok || !json.ok) {
          throw new Error(json.error || "replay failed");
        }
        return json.replay || {};
      } catch (error) {
        lastError = error;
        if (!localOrigin() || origin === localOrigin()) {
          throw lastError;
        }
      }
    }

    throw lastError || new Error("replay failed");
  }

  class VerifyWidget extends HTMLElement {
    connectedCallback() {
      this.attachShadow({ mode: "open" });
      this.verify();
    }

    render(state, title, meta) {
      const tone = state === "bad" ? "bad" : state === "load" ? "load" : "ok";
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: inline-block;
            max-width: 100%;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          }
          .box {
            background: #0d0f14;
            color: #e8eaf0;
            border: 1px solid #252835;
            border-radius: 8px;
            padding: 13px 15px;
            min-width: 220px;
            box-sizing: border-box;
          }
          .top {
            font-size: 14px;
            font-weight: 800;
            overflow-wrap: anywhere;
          }
          .meta {
            margin-top: 5px;
            color: #8b91a8;
            font-size: 12px;
            overflow-wrap: anywhere;
          }
          .ok { color: #14f195; }
          .bad { color: #f14d4d; }
          .load { color: #e8eaf0; }
        </style>
        <div class="box" role="status" aria-live="polite">
          <div class="top ${tone}" id="title"></div>
          <div class="meta" id="meta"></div>
        </div>
      `;
      this.shadowRoot.getElementById("title").textContent = title;
      this.shadowRoot.getElementById("meta").textContent = meta || "";
    }

    async verify() {
      const signature = (this.getAttribute("sig") || "").trim();
      const rpc = this.getAttribute("rpc") || DEFAULT_RPC;
      const programId = this.getAttribute("program-id") || DEFAULT_PROGRAM_ID;

      if (!signature) {
        this.render("bad", "⚠ Could not verify", "Missing signature");
        return;
      }

      this.render("load", "⏳ Verifying...", short(signature));

      try {
        const replay = await fetchReplay(signature, rpc, programId);
        const status = replay.verification_result || "ERROR";
        const reason = replay.verification_reason || "";

        if (status !== "MATCH") {
          this.render("bad", `❌ ${status}`, reason || "Replay did not match");
          return;
        }

        const label = this.getAttribute("label") || defaultLabel(replay, signature);
        const slot = this.getAttribute("slot") || "";
        const detail = slot
          ? `slot ${slot}`
          : replay.runtime_id
            ? `runtime ${short(replay.runtime_id)}`
            : `artifact ${short(replay.compiled_artifact_hash)}`;

        this.render("ok", `✅ ${status} / ${reason || "OK"}`, `${label} · ${detail}`);
      } catch (_) {
        this.render("bad", "⚠ Could not verify", "Check signature, RPC, or network access");
      }
    }
  }

  class VerifyFormWidget extends HTMLElement {
    connectedCallback() {
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `
        <style>
          :host {
            display: block;
            max-width: 620px;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          }
          .box {
            background: #0d0f14;
            color: #e8eaf0;
            border: 1px solid #252835;
            border-radius: 10px;
            padding: 14px;
            box-sizing: border-box;
          }
          label {
            display: block;
            margin: 8px 0 4px;
            color: #8b91a8;
            font-size: 11px;
          }
          input {
            width: 100%;
            box-sizing: border-box;
            background: #1a1d28;
            color: #e8eaf0;
            border: 1px solid #2e3245;
            border-radius: 7px;
            padding: 9px;
            font: inherit;
            font-size: 12px;
          }
          button {
            margin: 10px 0 12px;
            background: #14f195;
            color: #0d0f14;
            border: 0;
            border-radius: 7px;
            padding: 9px 14px;
            font-weight: 800;
            cursor: pointer;
          }
          .out {
            min-height: 48px;
          }
        </style>
        <form class="box">
          <label>Signature</label>
          <input name="sig" required placeholder="Paste tx signature" />
          <label>RPC URL</label>
          <input name="rpc" value="${DEFAULT_RPC}" />
          <label>Program ID</label>
          <input name="pid" value="${DEFAULT_PROGRAM_ID}" />
          <button>Verify</button>
          <div class="out"></div>
        </form>
      `;

      this.shadowRoot.querySelector("form").onsubmit = (event) => {
        event.preventDefault();
        const fields = event.currentTarget.elements;
        const output = this.shadowRoot.querySelector(".out");
        const widget = document.createElement("vre-verify");
        output.innerHTML = "";
        widget.setAttribute("sig", fields.sig.value.trim());
        widget.setAttribute("rpc", fields.rpc.value.trim());
        widget.setAttribute("program-id", fields.pid.value.trim());
        output.appendChild(widget);
      };
    }
  }

  if (!customElements.get("vre-verify")) {
    customElements.define("vre-verify", VerifyWidget);
  }
  if (!customElements.get("vre-verify-form")) {
    customElements.define("vre-verify-form", VerifyFormWidget);
  }
})();
