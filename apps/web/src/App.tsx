import { useCallback, useEffect, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";

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

type DashboardAuth = {
  isAuthenticated: boolean;
  isLoading: boolean;
  user?: { email?: string | null; name?: string | null };
  signIn?: () => Promise<void>;
  signOut?: () => void;
  getAccessToken?: () => Promise<string>;
};

export function CaregiverDashboard({ auth }: { auth: DashboardAuth }) {
  const { isAuthenticated, isLoading, user, signIn, signOut, getAccessToken } = auth;
  const [memories, setMemories] = useState<Memory[]>([]);
  const [paused, setPaused] = useState(false);
  const [message, setMessage] = useState("Loading local demo data…");

  const authenticatedFetch = useCallback(async (input: string, init: RequestInit = {}) => {
    const token = getAccessToken ? await getAccessToken() : undefined;
    return fetch(input, {
      ...init,
      headers: { ...init.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
  }, [getAccessToken]);

  const load = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const memoriesResponse = await authenticatedFetch(`${api}/memories`);
      if (!memoriesResponse.ok) throw new Error("Could not load memories.");
      setMemories((await memoriesResponse.json()).memories);
      if (selectedChatId) {
        const controlResponse = await authenticatedFetch(`${api}/capture-status/${encodeURIComponent(selectedChatId)}`);
        if (controlResponse.ok) setPaused((await controlResponse.json()).paused);
      }
      setMessage("Local demo only. Sign-in is required before deployment.");
    } catch {
      setMessage("Cannot reach the local API. Start it with npm run dev:api.");
    }
  }, [authenticatedFetch, isAuthenticated]);

  useEffect(() => void load(), [load]);

  async function setCaptureState(next: "pause" | "resume") {
    if (!selectedChatId) {
      setMessage("Set VITE_SELECTED_CHAT_ID in the root .env file first.");
      return;
    }
    const response = await authenticatedFetch(`${api}/controls/${encodeURIComponent(selectedChatId)}/${next}`, { method: "POST" });
    if (!response.ok) {
      setMessage("The capture control could not be updated.");
      return;
    }
    setPaused(next === "pause");
    setMessage(next === "pause" ? "Capture paused for the selected chat." : "Capture resumed for the selected chat.");
  }

  async function deleteMemory(id: string) {
    if (!window.confirm("Delete this derived memory? The source message remains available for the prototype audit trail.")) return;
    const response = await authenticatedFetch(`${api}/memories/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("That memory could not be deleted.");
      return;
    }
    setMemories((current) => current.filter((memory) => memory.id !== id));
    setMessage("Memory deleted. The original source remains retained.");
  }

  if (isLoading) return <main><p>Loading secure dashboard…</p></main>;
  if (!isAuthenticated) return <main className="login"><p className="eyebrow">Remember Me</p><h1>Caregiver dashboard</h1><p>Sign in to review and control the selected memory companion.</p><button className="primary" onClick={() => void signIn?.()}>Sign in as caregiver</button></main>;

  return (
    <main>
      <header>
        <p className="eyebrow">Remember Me</p>
        <h1>Caregiver dashboard</h1>
        <p className="intro">Signed in as {user?.email ?? user?.name ?? "caregiver"}. Review what the companion remembered, pause capture, and correct the record through deletion.</p>
        {signOut && <button className="text-button" onClick={signOut}>Sign out</button>}
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

export default function App() {
  const { isAuthenticated, isLoading, user, loginWithRedirect, logout, getAccessTokenSilently } = useAuth0();
  return (
    <CaregiverDashboard
      auth={{
        isAuthenticated,
        isLoading,
        user,
        signIn: loginWithRedirect,
        signOut: () => logout({ logoutParams: { returnTo: window.location.origin } }),
        getAccessToken: getAccessTokenSilently,
      }}
    />
  );
}
