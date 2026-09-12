import { useCallback, useEffect, useState } from "react";

type Memory = {
  id: string;
  summary: string;
  people: string[];
  event_title: string | null;
  occurred_at: string | null;
  importance: "low" | "medium" | "high";
  confidence: string;
  chat_id: string;
  message_id: number;
  message_text: string;
  sent_at: string;
};

const api = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3000";
const selectedChatId = import.meta.env.VITE_SELECTED_CHAT_ID as string | undefined;

export default function App() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState("Loading local demo data…");

  const load = useCallback(async () => {
    try {
      const memoriesResponse = await fetch(`${api}/memories`);
      if (!memoriesResponse.ok) throw new Error("Could not load memories.");
      setMemories((await memoriesResponse.json()).memories);
      if (selectedChatId) {
        const controlResponse = await fetch(`${api}/capture-status/${encodeURIComponent(selectedChatId)}`);
        if (controlResponse.ok) setPaused((await controlResponse.json()).paused);
      }
      setMessage("Local demo only. Sign-in is required before deployment.");
    } catch {
      setMessage("Cannot reach the local API. Start it with npm run dev:api.");
    }
  }, []);

  useEffect(() => void load(), [load]);

  async function setCaptureState(next: "pause" | "resume") {
    if (!selectedChatId) {
      setMessage("Set VITE_SELECTED_CHAT_ID in the root .env file first.");
      return;
    }
    const response = await fetch(`${api}/controls/${encodeURIComponent(selectedChatId)}/${next}`, { method: "POST" });
    if (!response.ok) {
      setMessage("The capture control could not be updated.");
      return;
    }
    setPaused(next === "pause");
    setMessage(next === "pause" ? "Capture paused for the selected chat." : "Capture resumed for the selected chat.");
  }

  async function deleteMemory(id: string) {
    if (!window.confirm("Delete this derived memory? The source message remains available for the prototype audit trail.")) return;
    const response = await fetch(`${api}/memories/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("That memory could not be deleted.");
      return;
    }
    setMemories((current) => current.filter((memory) => memory.id !== id));
    setMessage("Memory deleted. The original source remains retained.");
  }

  return (
    <main>
      <header>
        <p className="eyebrow">Remember Me</p>
        <h1>Caregiver dashboard</h1>
        <p className="intro">Review what the companion remembered, pause capture, and correct the record through deletion.</p>
      </header>

      <section className="controls" aria-label="Capture controls">
        <div>
          <p className="label">Selected test chat</p>
          <p className="chat-id">{selectedChatId ?? "Not configured"}</p>
        </div>
        <div className={`status ${paused ? "paused" : "active"}`}>{paused ? "Capture paused" : "Capture active"}</div>
        <button className={paused ? "primary" : "secondary"} onClick={() => void setCaptureState(paused ? "resume" : "pause")}>
          {paused ? "Resume capture" : "Pause capture"}
        </button>
      </section>

      <p className="notice">{message}</p>

      <section aria-label="Saved memories">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Evidence backed</p>
            <h2>Saved memories</h2>
          </div>
          <button className="text-button" onClick={() => void load()}>Refresh</button>
        </div>
        {memories.length === 0 ? <p className="empty">No memories have been saved yet.</p> : (
          <div className="memory-list">
            {memories.map((memory) => (
              <article className="memory" key={memory.id}>
                <div className="memory-topline">
                  <span className={`importance ${memory.importance}`}>{memory.importance}</span>
                  <span>Confidence {Math.round(Number(memory.confidence) * 100)}%</span>
                </div>
                <h3>{memory.summary}</h3>
                {memory.event_title && <p className="event">Event: {memory.event_title}</p>}
                <details>
                  <summary>Show original message</summary>
                  <p className="source">{memory.message_text}</p>
                  <p className="source-meta">Chat {memory.chat_id} · Message {memory.message_id} · {new Date(memory.sent_at).toLocaleString()}</p>
                </details>
                <button className="delete" onClick={() => void deleteMemory(memory.id)}>Delete memory</button>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
