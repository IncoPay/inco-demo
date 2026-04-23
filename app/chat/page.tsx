"use client";

import dynamic from "next/dynamic";

// Wallet adapter pulls browser-only deps; force client-side render.
const ChatClient = dynamic(() => import("../../components/ChatClient"), {
  ssr: false,
});

export default function ChatPage() {
  return <ChatClient />;
}
