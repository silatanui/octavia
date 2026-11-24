import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api'

type Turn = { role: 'user' | 'assistant'; content: string }

type ChatResponse = {
  reply: string
  provider?: string
}

const QUICK_PROMPTS = [
  'Where is OEE losing most?',
  'Top downtime reasons',
  'Which machines are behind target?',
]

/** Prefer plain punctuation in assistant copy (no em/en dashes). */
function scrubAssistantText(text: string) {
  return text
    .replace(/\u2014/g, ' - ')
    .replace(/\u2013/g, ' - ')
    .trim()
}

function formatInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/)
    if (bold) return <strong key={i}>{bold[1]}</strong>
    return <span key={i}>{part}</span>
  })
}

/** Break common one-line dash lists into real list lines. */
function normalizeListNewlines(text: string) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/([.:])\s+-\s+/g, '$1\n- ')
    .replace(/\s+-\s+(?=\*\*[^*]+\*\*)/g, '\n- ')
}

/** Safe light markdown: paragraphs, dash/star lists, **bold**. */
function formatAssistantContent(text: string): ReactNode {
  const lines = normalizeListNewlines(text).split('\n')
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let listItems: string[] = []
  let key = 0

  const flushParagraph = () => {
    if (!paragraph.length) return
    const body = paragraph.join(' ').trim()
    if (body) {
      blocks.push(
        <p key={`p-${key++}`} className="ai-chat-p">
          {formatInline(body)}
        </p>,
      )
    }
    paragraph = []
  }

  const flushList = () => {
    if (!listItems.length) return
    blocks.push(
      <ul key={`ul-${key++}`} className="ai-chat-list">
        {listItems.map((item, i) => (
          <li key={i}>{formatInline(item)}</li>
        ))}
      </ul>,
    )
    listItems = []
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flushParagraph()
      flushList()
      continue
    }
    const listMatch = line.match(/^[-*]\s+(.+)$/)
    if (listMatch) {
      flushParagraph()
      listItems.push(listMatch[1])
      continue
    }
    flushList()
    paragraph.push(line)
  }
  flushParagraph()
  flushList()

  if (!blocks.length) return formatInline(text)
  return blocks
}

function reportFiltersFromContext(search: string) {
  const stored = sessionStorage.getItem('octavia_report_filters') || ''
  const p = new URLSearchParams(stored || search)
  return {
    days: Number(p.get('days') || 30),
    department_id: p.get('department_id') ? Number(p.get('department_id')) : null,
    line_id: p.get('line_id') ? Number(p.get('line_id')) : null,
    machine_id: p.get('machine_id') ? Number(p.get('machine_id')) : null,
    shift_id: p.get('shift_id') ? Number(p.get('shift_id')) : null,
  }
}

export function AiChatbot() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [turns, setTurns] = useState<Turn[]>([
    {
      role: 'assistant',
      content:
        'Hi. I am Octavia AI. Ask about OEE, downtime, scrap, or machines. On Reports I use your current filter context.',
    },
  ])
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' })
      window.setTimeout(() => inputRef.current?.focus(), 40)
    }
  }, [turns, open])

  async function sendMessage(raw: string) {
    const message = raw.trim()
    if (!message || busy) return
    setInput('')
    setError('')
    const history = turns.map((t) => ({ role: t.role, content: t.content }))
    setTurns((prev) => [...prev, { role: 'user', content: message }])
    setBusy(true)
    try {
      const filters = reportFiltersFromContext(location.search)
      const res = await api.post<ChatResponse>('/reports/ai-chat', {
        message,
        history,
        ...filters,
      })
      setTurns((prev) => [
        ...prev,
        { role: 'assistant', content: scrubAssistantText(res.reply || '') },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chat failed')
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry. I could not reach the AI service just now.',
        },
      ])
    } finally {
      setBusy(false)
    }
  }

  async function send(e?: FormEvent) {
    e?.preventDefault()
    await sendMessage(input)
  }

  return (
    <div className={`ai-chatbot${open ? ' open' : ''}`}>
      {open ? (
        <div className="ai-chatbot-panel" role="dialog" aria-label="Octavia AI chat">
          <header className="ai-chatbot-head">
            <div className="ai-chatbot-identity">
              <span className="ai-chatbot-mark" aria-hidden>
                O
              </span>
              <div>
                <strong>Octavia AI</strong>
                <span className="ai-chatbot-status">
                  <i className="ai-chatbot-status-dot" aria-hidden />
                  Plant assistant
                </span>
              </div>
            </div>
            <button
              type="button"
              className="ai-chatbot-close"
              onClick={() => setOpen(false)}
              title="Close"
              aria-label="Close chat"
            >
              ×
            </button>
          </header>

          <div className="ai-chatbot-messages">
            {turns.map((t, i) => (
              <div key={`${t.role}-${i}`} className={`ai-chat-bubble ${t.role}`}>
                {t.role === 'assistant' ? (
                  <span className="ai-chat-bubble-label">Octavia</span>
                ) : null}
                <div className="ai-chat-bubble-body">
                  {t.role === 'assistant' ? formatAssistantContent(t.content) : t.content}
                </div>
              </div>
            ))}
            {busy ? (
              <div className="ai-chat-bubble assistant thinking" aria-live="polite">
                <span className="ai-chat-bubble-label">Octavia</span>
                <div className="ai-chat-thinking" aria-label="Thinking">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            ) : null}
            {turns.length <= 1 && !busy ? (
              <div className="ai-chat-suggestions" aria-label="Suggested questions">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="ai-chat-chip"
                    onClick={() => void sendMessage(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          {error ? (
            <div className="ai-chatbot-error" role="alert">
              {error}
            </div>
          ) : null}

          <form className="ai-chatbot-form" onSubmit={send}>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about OEE, losses, scrap…"
              disabled={busy}
              aria-label="Chat message"
            />
            <button
              className="ai-chatbot-send"
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send message"
            >
              <svg viewBox="0 0 16 16" aria-hidden>
                <path
                  d="M2 8h10.2M8.5 3.5 13.5 8l-5 4.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        className="ai-chatbot-fab"
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Close AI chat' : 'Open AI chat'}
        aria-expanded={open}
        aria-label={open ? 'Close AI chat' : 'Open AI chat'}
      >
        {open ? (
          <span aria-hidden>×</span>
        ) : (
          <>
            <span className="ai-chatbot-fab-mark" aria-hidden>
              O
            </span>
            <span className="ai-chatbot-fab-label">AI</span>
          </>
        )}
      </button>
    </div>
  )
}
