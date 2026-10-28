import React, { useState } from 'react'
import { ArrowRight, Bot, Check, Copy, Lightbulb, PenLine } from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'

const suggestions = [
  { title: 'Help me write', prompt: 'Help me write a warm, genuine introduction for my profile.' },
  { title: 'Make this clearer', prompt: 'Give me a few friendly ways to make my writing clearer.' },
  { title: 'Find my next step', prompt: 'Suggest a few thoughtful questions to help me explore my career interests.' },
]

const sampleReplies = [
  'Here’s a starting point: “Curious by nature, happiest when I’m learning something new or sharing a good recommendation. Currently making time for music, slow walks, and meeting kind people.” Make it your own before sharing.',
  'Try leading with the main idea, then add one detail that makes it yours. Short sentences can keep a warm tone while making the point easier to follow.',
  'You could start by listing what energizes you, what skills you want to grow, and what kind of team helps you do your best work. Use those answers to guide your next conversation.',
]

export default function AssistantPage() {
  const [prompt, setPrompt] = useState('')
  const [reply, setReply] = useState('')
  const [copied, setCopied] = useState(false)

  function ask(question) {
    const index = suggestions.findIndex((suggestion) => suggestion.prompt === question)
    setPrompt(question)
    setReply(sampleReplies[index >= 0 ? index : 0])
    setCopied(false)
  }

  function submitPrompt(event) {
    event.preventDefault()
    if (!prompt.trim()) return
    setReply('This is a demo response, not a connected AI service. A future iConnect assistant could help you draft, summarize, or explore ideas—with your review before anything is used.')
  }

  return (
    <div className="app-content-width assistant-page">
      <AppPageHeader eyebrow="A THOUGHTFUL HELPER, WHEN YOU WANT ONE" title="AI assistant" description="A concept for helpful drafting and guidance that keeps you in control." />
      <div className="assistant-disclaimer"><Lightbulb size={16} /><span><strong>AI is not connected in this preview.</strong> The example responses below are static design content.</span></div>
      <section className="assistant-workspace">
        <div className="assistant-welcome"><span className="assistant-orb"><Bot size={24} /></span><span className="app-page-eyebrow">YOUR CREATIVE SIDEKICK</span><h2>What would you<br />like a hand with?</h2><p>Get a first draft, untangle an idea, or find a way to say what you mean.</p></div>
        <div className="assistant-prompts">{suggestions.map((suggestion, index) => <button onClick={() => ask(suggestion.prompt)} key={suggestion.title}><span>{index === 0 ? <PenLine size={17} /> : index === 1 ? <Check size={17} /> : <Lightbulb size={17} />}</span><strong>{suggestion.title}</strong><ArrowRight size={15} /></button>)}</div>
        {reply && <div className="assistant-response"><div className="assistant-response-header"><span className="assistant-mini-icon"><Bot size={16} /></span><strong>iConnect preview assistant</strong><button onClick={() => { navigator.clipboard?.writeText(reply); setCopied(true) }} aria-label="Copy response">{copied ? <Check size={15} /> : <Copy size={15} />}</button></div><p>{reply}</p><span>Review and edit AI suggestions before you use them.</span></div>}
        <form className="assistant-input" onSubmit={submitPrompt}><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask a question or describe what you’re working on..." rows={2} aria-label="Ask the preview assistant" /><button type="submit" disabled={!prompt.trim()} aria-label="Send prompt"><ArrowRight size={18} /></button></form>
        <p className="assistant-footer-note">Please don’t enter personal, private, or sensitive information.</p>
      </section>
    </div>
  )
}
