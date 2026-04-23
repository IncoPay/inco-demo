import Link from "next/link";

export default function Home() {
  return (
    <div className="wrap">
      <h1>IncoPay Chat</h1>
      <h2>Pay-per-inference private AI chat · Solana devnet · Inco Lightning</h2>
      <div className="card">
        <p style={{ marginBottom: 16 }}>
          A session-based x402 payment demo. Sign once to approve a cap; each
          chat message settles confidentially via the facilitator without
          another wallet prompt or gas from you.
        </p>
        <Link href="/chat">
          <button>Open chat →</button>
        </Link>
      </div>
      <div className="card">
        <div className="label">Before you begin</div>
        <ul style={{ marginTop: 8, paddingLeft: 20, color: "#9ca3af", fontSize: 14, lineHeight: 1.6 }}>
          <li>Install the Phantom or Solflare wallet, set it to <b>Devnet</b>.</li>
          <li>Import one of the pre-funded users from <code>.keys/user1.json</code>..<code>user5.json</code> — those hold 1000 pUSDC.</li>
          <li>Make sure the facilitator (<code>:4021</code>), Kora (<code>:8080</code>), and Ollama (<code>:11434</code>) are running locally.</li>
        </ul>
      </div>
    </div>
  );
}
