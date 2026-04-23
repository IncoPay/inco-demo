"use client";

import { useState, useMemo, useEffect } from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useWallet,
  useConnection,
} from "@solana/wallet-adapter-react";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import {
  WalletModalProvider,
  WalletMultiButton,
} from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  createSession,
  type SessionHandle,
  type ClientSvmSigner,
  type Network,
} from "inco-x402-sessions";

import "@solana/wallet-adapter-react-ui/styles.css";

const FACILITATOR_URL =
  process.env.NEXT_PUBLIC_FACILITATOR_URL || "http://localhost:4021";
const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
const MINT = process.env.NEXT_PUBLIC_TOKEN_MINT || "";
const RECIPIENT = process.env.NEXT_PUBLIC_RECIPIENT_PUBKEY || "";
const NETWORK = (process.env.NEXT_PUBLIC_NETWORK ||
  "solana:devnet") as Network;

interface Msg {
  role: "user" | "bot" | "err";
  text: string;
}

import { wrapFetch } from "inco-x402-sessions";

const LS_KEY = "inco-x402-session:v1";

interface PersistedSession {
  sessionId: string;
  user: string;
  spender: string;
  asset: string;
  recipient: string;
  cap: string;
  expirationUnix: number;
  network: Network;
  facilitatorUrl: string;
}

function loadStored(walletPubkey: string): PersistedSession | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed: PersistedSession = JSON.parse(raw);
    if (parsed.user !== walletPubkey) return null;
    if (parsed.expirationUnix * 1000 < Date.now()) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
function storeSession(s: SessionHandle) {
  const copy: PersistedSession = {
    sessionId: s.sessionId,
    user: s.user,
    spender: s.spender,
    asset: s.asset,
    recipient: s.recipient,
    cap: s.cap,
    expirationUnix: s.expirationUnix,
    network: s.network,
    facilitatorUrl: s.facilitatorUrl,
  };
  localStorage.setItem(LS_KEY, JSON.stringify(copy));
}

function ChatInner() {
  const { publicKey, signMessage, signTransaction } = useWallet();
  const [session, setSession] = useState<SessionHandle | null>(null);
  const [cap, setCap] = useState("1");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<{
    spent?: string;
    remaining?: string;
    lastTx?: string;
  }>({});

  // On wallet connect, rehydrate session from localStorage if still valid on facilitator.
  useEffect(() => {
    if (!publicKey) return;
    const stored = loadStored(publicKey.toBase58());
    if (!stored) return;
    (async () => {
      try {
        const r = await fetch(`${stored.facilitatorUrl}/sessions/${stored.sessionId}`);
        if (!r.ok) {
          localStorage.removeItem(LS_KEY);
          return;
        }
        const row = await r.json();
        const handle: SessionHandle = {
          ...stored,
          fetch: wrapFetch(stored.sessionId, stored.facilitatorUrl),
        };
        setSession(handle);
        setStats({ spent: row.spent, remaining: (BigInt(row.cap) - BigInt(row.spent)).toString() });
        setMsgs((m) => [
          ...m,
          { role: "bot", text: `Resumed session ${stored.sessionId.slice(0, 8)}… (spent ${row.spent}/${row.cap})` },
        ]);
      } catch {
        // ignore
      }
    })();
  }, [publicKey]);

  const canCreateSession =
    publicKey && signMessage && signTransaction && MINT && RECIPIENT;

  const createSvmSigner = useMemo((): ClientSvmSigner | null => {
    if (!publicKey || !signMessage || !signTransaction) return null;
    return {
      publicKey: publicKey.toBase58(),
      signMessage: async (msg: Uint8Array) => signMessage(msg),
      signTransaction: async (txB64: string) => {
        const tx = Transaction.from(Buffer.from(txB64, "base64"));
        const signed = await signTransaction(tx);
        return (signed as Transaction)
          .serialize({
            requireAllSignatures: false,
            verifySignatures: false,
          })
          .toString("base64");
      },
    };
  }, [publicKey, signMessage, signTransaction]);

  async function onCreateSession() {
    if (!createSvmSigner) return;
    setBusy(true);
    try {
      const s = await createSession({
        facilitatorUrl: FACILITATOR_URL,
        network: NETWORK,
        asset: MINT,
        recipient: RECIPIENT,
        cap,
        expirationSeconds: 3600,
        signer: createSvmSigner,
        solanaRpcUrl: RPC_URL,
      });
      setSession(s);
      storeSession(s);
      setMsgs((m) => [
        ...m,
        { role: "bot", text: `Session opened: ${s.sessionId.slice(0, 8)}… (cap: ${cap} pUSDC)` },
      ]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: "err", text: `create-session failed: ${(e as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function onSend() {
    if (!session || !input) return;
    const prompt = input;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: prompt }]);
    setBusy(true);
    try {
      const r = await session.fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!r.ok) {
        const body = await r.text();
        setMsgs((m) => [
          ...m,
          { role: "err", text: `${r.status}: ${body.slice(0, 200)}` },
        ]);
        return;
      }
      const j = await r.json();
      setMsgs((m) => [...m, { role: "bot", text: j.reply }]);
      setStats({
        spent: j.spent,
        remaining: j.remaining,
        lastTx: j.paymentTx,
      });
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { role: "err", text: (e as Error).message },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <h1>Private AI Chat</h1>
      <h2>
        Each message settles 0.01 pUSDC confidentially · no gas, no extra prompts
      </h2>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="label">Wallet</div>
            <div className="value">
              {publicKey ? publicKey.toBase58() : "not connected"}
            </div>
          </div>
          <WalletMultiButton />
        </div>
      </div>

      {!session ? (
        <div className="card">
          <div className="label">Open a session</div>
          <div
            className="row"
            style={{ marginTop: 10, gap: 12 }}
          >
            <input
              type="text"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
              placeholder="cap (pUSDC)"
              style={{ maxWidth: 140 }}
            />
            <button
              disabled={!canCreateSession || busy}
              onClick={onCreateSession}
            >
              {busy ? "Signing…" : "Create session"}
            </button>
          </div>
          {!MINT && (
            <p style={{ marginTop: 10, color: "#f87171", fontSize: 13 }}>
              NEXT_PUBLIC_TOKEN_MINT not set. Deploy the mint with{" "}
              <code>npm run deploy</code> in <code>inco-token-deploy/</code>.
            </p>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="label">Session</div>
          <div className="stat"><span>id</span><span className="value">{session.sessionId}</span></div>
          <div className="stat"><span>cap</span><span className="value">{session.cap} base units</span></div>
          <div className="stat"><span>spent</span><span className="value">{stats.spent ?? "0"}</span></div>
          <div className="stat"><span>remaining</span><span className="value">{stats.remaining ?? session.cap}</span></div>
          {stats.lastTx && (
            <div className="stat">
              <span>last tx</span>
              <a
                className="value"
                target="_blank"
                rel="noreferrer"
                href={`https://solscan.io/tx/${stats.lastTx}?cluster=devnet`}
              >
                {stats.lastTx.slice(0, 16)}…
              </a>
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ minHeight: 260 }}>
        <div className="chat">
          {msgs.length === 0 && (
            <div style={{ color: "#7c7c8a", fontSize: 14 }}>No messages yet.</div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.text}
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <input
            type="text"
            placeholder={
              session ? "Say something…" : "Open a session first"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSend();
            }}
            disabled={!session || busy}
          />
          <button disabled={!session || busy || !input} onClick={onSend}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatClient() {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <ChatInner />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
