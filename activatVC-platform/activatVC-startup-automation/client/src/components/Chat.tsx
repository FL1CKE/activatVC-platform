import { useMemo, useState } from "react";
import type { ChatMessage } from "../types";
import { IconSend } from "./icons";

type ChatProps = {
  title: string;
  initialMessage: string;
  knowledgeBase: Record<string, string>;
  quickQuestions?: string[];
  className?: string;
};

export default function Chat({
  title,
  initialMessage,
  knowledgeBase,
  quickQuestions = [],
  className = "",
}: ChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: initialMessage },
  ]);
  const [input, setInput] = useState("");

  const keys = useMemo(
    () => Object.keys(knowledgeBase).filter((key) => key !== "default"),
    [knowledgeBase],
  );

  const send = (rawText?: string) => {
    const text = (rawText ?? input).trim();
    if (!text) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");

    const lower = text.toLowerCase();
    const matchKey = keys.find((key) => lower.includes(key));
    const answer = knowledgeBase[matchKey ?? "default"] || "";
    setMessages((prev) => [...prev, { role: "assistant", text: answer }]);
  };

  return (
    <div className={`rounded-2xl border border-gray-200 bg-white ${className}`}>
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>

      <div className="max-h-96 overflow-y-auto px-4 py-3 space-y-2">
        {messages.map((message, idx) => (
          <div
            key={`${message.role}-${idx}`}
            className={
              message.role === "user"
                ? "ml-10 rounded-xl rounded-tr-sm bg-blue-50 px-3 py-2 text-sm text-blue-800"
                : "mr-10 rounded-xl rounded-tl-sm bg-gray-100 px-3 py-2 text-sm text-gray-800"
            }
          >
            {message.text}
          </div>
        ))}
      </div>

      {quickQuestions.length > 0 && (
        <div className="space-y-2 px-4 pb-3">
          {quickQuestions.map((question) => (
            <button
              key={question}
              type="button"
              onClick={() => send(question)}
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-left text-xs text-gray-600 transition hover:border-blue-200 hover:bg-blue-50"
            >
              {question}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2 border-t border-gray-100 p-3">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Задайте вопрос..."
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-blue-400"
        />
        <button
          type="button"
          onClick={() => send()}
          disabled={!input.trim()}
          className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-3 py-2 text-white disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          <IconSend className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
