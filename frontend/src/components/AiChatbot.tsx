import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api'

type Turn = { role: 'user' | 'assistant'; content: string }

type ChatResponse = {
  reply: string
  provider?: string
}

/** Prefer plain punctuation in assistant copy (no em/en dashes). */
function scrubAssistantText(text: string) {
  return text
    .replace(/\u2014/g, ' - ')
    .replace(/\u2013/g, ' - ')
    .replace(/\s+-\s+/g, ' - ')
    .trim()
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

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, open])

  async function send(e?: FormEvent) {
    e?.preventDefault()
    const message = input.trim()
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

  return (
    <div className={`ai-chatbot${open ? ' open' : ''}`}>
      {open ? (
        <div className="ai-chatbot-panel" role="dialog" aria-label="Octavia AI chat">
          <header className="ai-chatbot-head">
            <div className="ai-chatbot-identity">
              <span className="ai-chatbot-mark" aria-hidden>
                AI
              </span>
              <div>
                <strong>Octavia AI</strong>
                <span className="muted">Plant assistant</span>
              </div>
            </div>
            <button type="button" className="ai-chatbot-close" onClick={() => setOpen(false)} title="Close">
              Close
            </button>
          </header>
          <div className="ai-chatbot-messages">
            {turns.map((t, i) => (
              <div key={`${t.role}-${i}`} className={`ai-chat-bubble ${t.role}`}>
                {t.content}
              </div>
            ))}
            {busy ? <div className="ai-chat-bubble assistant muted">Thinking…</div> : null}
            <div ref={endRef} />
          </div>
          {error ? <div className="ai-chatbot-error">{error}</div> : null}
          <form className="ai-chatbot-form" onSubmit={send}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about OEE, losses, scrap…"
              disabled={busy}
              aria-label="Chat message"
            />
            <button className="btn ai-chatbot-send" type="submit" disabled={busy || !input.trim()}>
              Send
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
      >
        {open ? '×' : 'AI'}
      </button>
    </div>
  )
}
