import { useState, useRef, useEffect } from "react";

const WELCOME_RU =
  "Привет! Я здесь, чтобы помочь вам заполнить заявку на рассмотрение вашего проекта. Заполняйте форму слева, а если у вас возникнут вопросы — просто спросите меня. После каждого поля есть иконка ⓘ — нажмите её, и я объясню, что нужно заполнить и почему это важно для оценки.";

const WELCOME_EN =
  "Hi! I'm here to help you complete your investment application. Fill in the form on the left, and if you have any questions — just ask me. Each field has an ⓘ icon — click it and I'll explain what to fill in and why it matters for the evaluation.";

/**
 * AiChat — AI assistant chat panel for the VentureIQ founder application page.
 *
 * Props:
 *   lang      — "ru" | "en"  (default "ru")
 *   context   — object with current form state, passed to the backend so Claude
 *               can give context-aware answers (optional)
 *   apiUrl    — URL of the backend /api/chat endpoint
 *               default: "http://localhost:3001/api/chat"
 */
export default function AiChat({
  lang = "ru",
  context = null,
  apiUrl = "/api/chat",
}) {
  const welcome = lang === "en" ? WELCOME_EN : WELCOME_RU;

  const [messages, setMessages] = useState([
    { role: "assistant", content: welcome },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  // Update welcome message when lang changes
  useEffect(() => {
    setMessages([{ role: "assistant", content: lang === "en" ? WELCOME_EN : WELCOME_RU }]);
  }, [lang]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      // Build history — exclude the initial welcome message so it doesn't
      // pollute the Claude context window as a fake assistant turn
      const history = nextMessages.slice(1, -1); // drop welcome + last user msg

      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          context,
          history,
        }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Server error");

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            lang === "en"
              ? "Sorry, couldn't get a response. Please try again."
              : "Не удалось получить ответ. Попробуйте ещё раз.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const placeholder =
    lang === "en" ? "Ask a question about the form…" : "Задайте вопрос о форме…";
  const sendLabel = lang === "en" ? "Send" : "Отправить";

  return (
    <div style={styles.wrapper}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.dot} />
        <span style={styles.headerTitle}>
          {lang === "en" ? "AI Assistant" : "ИИ-ассистент"}
        </span>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{
              ...styles.bubble,
              ...(msg.role === "user" ? styles.userBubble : styles.aiBubble),
            }}
          >
            {msg.content}
          </div>
        ))}
        {loading && (
          <div style={{ ...styles.bubble, ...styles.aiBubble, opacity: 0.6 }}>
            {lang === "en" ? "Thinking…" : "Печатаю…"}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={styles.inputRow}>
        <textarea
          style={styles.textarea}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={placeholder}
          rows={2}
          disabled={loading}
        />
        <button
          style={{
            ...styles.sendBtn,
            opacity: loading || !input.trim() ? 0.5 : 1,
          }}
          onClick={sendMessage}
          disabled={loading || !input.trim()}
        >
          {sendLabel}
        </button>
      </div>
    </div>
  );
}

// ─── Inline styles (no external CSS dependency) ───────────────────────────────

const styles = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 400,
    maxHeight: 720,
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    overflow: "hidden",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 14,
    background: "#fff",
    boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 16px",
    background: "#0f172a",
    color: "#fff",
    flexShrink: 0,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#22c55e",
    display: "inline-block",
  },
  headerTitle: {
    fontWeight: 600,
    fontSize: 14,
    letterSpacing: 0.2,
  },
  messages: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    background: "#f8fafc",
  },
  bubble: {
    maxWidth: "85%",
    padding: "10px 14px",
    borderRadius: 10,
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  aiBubble: {
    alignSelf: "flex-start",
    background: "#fff",
    border: "1px solid #e2e8f0",
    color: "#1e293b",
    borderBottomLeftRadius: 2,
  },
  userBubble: {
    alignSelf: "flex-end",
    background: "#0f172a",
    color: "#fff",
    borderBottomRightRadius: 2,
  },
  inputRow: {
    display: "flex",
    gap: 8,
    padding: "10px 12px",
    borderTop: "1px solid #e2e8f0",
    background: "#fff",
    flexShrink: 0,
  },
  textarea: {
    flex: 1,
    resize: "none",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    lineHeight: 1.4,
    color: "#1e293b",
  },
  sendBtn: {
    padding: "8px 16px",
    background: "#0f172a",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    alignSelf: "flex-end",
    transition: "opacity 0.15s",
  },
};