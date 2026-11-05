import React, { useEffect, useRef, useState } from 'react'
import { Bot, CirclePlus, Lightbulb, LoaderCircle, LockKeyhole, MessageSquareText, Send, Sparkles, WandSparkles } from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import { apiRequest } from '../../utils/api.js'

const suggestedPrompts = [
  { icon: Lightbulb, title: 'Help me brainstorm', prompt: 'Help me brainstorm a few fresh ideas for a small community project.' },
  { icon: MessageSquareText, title: 'Write something', prompt: 'Help me write a warm, clear introduction for a community post.' },
  { icon: WandSparkles, title: 'Make a plan', prompt: 'Help me turn a goal I have into a simple, realistic step-by-step plan.' },
]

function buildConversationContext(messages, latestMessage) {
  const history = [...messages, latestMessage]
  const selected = []

  for (const message of [...history].reverse()) {
    if (selected.length >= 12) break
    const candidate = [{ role: message.role, text: message.text }, ...selected]
    if (new TextEncoder().encode(JSON.stringify({ messages: candidate })).length > 15000) break
    selected.unshift({ role: message.role, text: message.text })
  }
  return selected
}

export default function AssistantPage() {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const conversationRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    conversationRef.current?.scrollTo({
      top: conversationRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages, sending])

  async function sendMessage(value = draft) {
    const text = value.trim()
    if (!text || sending) return

    const userMessage = { role: 'user', text, id: `${Date.now()}-user` }
    const previousMessages = messages
    setMessages((current) => [...current, userMessage])
    setDraft('')
    setError('')
    setSending(true)

    try {
      const result = await apiRequest('/api/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: buildConversationContext(previousMessages, userMessage),
        }),
      })
      setMessages((current) => [
        ...current,
        { role: 'model', text: result.reply, id: `${Date.now()}-assistant` },
      ])
    } catch (sendError) {
      setMessages((current) => current.filter((message) => message.id !== userMessage.id))
      setError(sendError instanceof Error ? sendError.message : 'Your message could not be sent. Please try again.')
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  function startNewChat() {
    if (sending) return
    setMessages([])
    setDraft('')
    setError('')
    inputRef.current?.focus()
  }

  function handleSubmit(event) {
    event.preventDefault()
    sendMessage()
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  return (
    <div className="app-content-width assistant-page">
      <AppPageHeader
        eyebrow="AI ASSISTANT · GEMINI"
        title="A little help, whenever you need it."
        description="Brainstorm, write, learn, and make your next idea easier to start."
      >
        {messages.length > 0 && (
          <button type="button" className="assistant-new-chat" onClick={startNewChat} disabled={sending}>
            <CirclePlus size={16} /> New chat
          </button>
        )}
      </AppPageHeader>

      <section className="assistant-workspace" aria-label="AI assistant chat">
        {messages.length === 0 ? (
          <div className="assistant-welcome">
            <span className="assistant-orb"><Sparkles size={24} /></span>
            <span className="app-page-eyebrow">YOUR CREATIVE SIDEKICK</span>
            <h2>What would you like to work on?</h2>
            <p>Ask a question or choose a starting point. You can refine the answer together.</p>
            <div className="assistant-prompts">
              {suggestedPrompts.map(({ icon: Icon, title, prompt }) => (
                <button key={title} type="button" onClick={() => sendMessage(prompt)} disabled={sending}>
                  <span><Icon size={18} /></span>
                  <strong>{title}</strong>
                  <small>{prompt}</small>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="assistant-conversation" ref={conversationRef} aria-live="polite">
            {messages.map((message) => (
              <article className={`assistant-message assistant-message-${message.role}`} key={message.id}>
                {message.role === 'model' && <span className="assistant-message-avatar"><Sparkles size={15} /></span>}
                <div className="assistant-message-bubble">
                  {message.role === 'model' && <strong>iConnect Assistant</strong>}
                  <p>{message.text}</p>
                </div>
              </article>
            ))}
            {sending && (
              <div className="assistant-message assistant-message-model" role="status">
                <span className="assistant-message-avatar"><Sparkles size={15} /></span>
                <div className="assistant-message-bubble assistant-thinking">
                  <LoaderCircle size={16} className="assistant-spinner" /> Thinking…
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="assistant-error" role="alert">{error}</p>}

        <form className="assistant-input" onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={3000}
            rows={2}
            placeholder="Ask anything…"
            aria-label="Message the AI assistant"
            disabled={sending}
          />
          <button type="submit" aria-label="Send message" disabled={!draft.trim() || sending}>
            {sending ? <LoaderCircle size={19} className="assistant-spinner" /> : <Send size={18} />}
          </button>
        </form>
        <div className="assistant-footer-note"><LockKeyhole size={13} /><span>Enter to send · Shift + Enter for a new line</span><span>{draft.length}/3000</span></div>
      </section>

      <aside className="assistant-privacy-note">
        <LockKeyhole size={17} />
        <p><strong>A note about privacy</strong> Your message is sent to Google Gemini to generate a reply. iConnect doesn’t save this chat. Avoid sharing passwords, financial details, or other sensitive information.</p>
      </aside>
    </div>
  )
}
