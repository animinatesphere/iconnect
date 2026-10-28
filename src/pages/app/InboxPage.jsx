import React, { useState } from 'react'
import { ArrowLeft, MoreHorizontal, Phone, Search, Send, Video } from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoConversations, demoMessages } from '../../data/demoContent.js'

export default function InboxPage() {
  const [activeId, setActiveId] = useState('sofia')
  const [message, setMessage] = useState('')
  const [sentMessages, setSentMessages] = useState({})
  const active = demoConversations.find((conversation) => conversation.id === activeId)
  const messages = [...(demoMessages[activeId] ?? []), ...(sentMessages[activeId] ?? [])]

  function sendMessage(event) {
    event.preventDefault()
    const trimmed = message.trim()
    if (!trimmed) return
    setSentMessages((current) => ({ ...current, [activeId]: [...(current[activeId] ?? []), { from: 'me', text: trimmed }] }))
    setMessage('')
  }

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="YOUR CONVERSATIONS" title="Messages" description="A preview of the unified inbox direction." />
      <div className="inbox-demo-banner"><span className="demo-indicator" /> Sample conversations only. No messaging services are connected.</div>
      <div className="inbox-layout">
        <section className="conversation-list-panel">
          <div className="conversation-list-heading"><h2>Inbox</h2><button className="quiet-icon-button" aria-label="Search conversations"><Search size={17} /></button></div>
          <div className="inbox-tabs"><button className="inbox-tab-active">All messages</button><button>Unread <span>2</span></button></div>
          <label className="conversation-search"><Search size={15} /><input placeholder="Search messages" aria-label="Search messages" /></label>
          <div className="conversation-list">{demoConversations.map((conversation) => <button className={`conversation-item ${conversation.id === activeId ? 'conversation-active' : ''}`} onClick={() => setActiveId(conversation.id)} key={conversation.id}>
            <span className="conversation-avatar"><Avatar person={conversation} />{conversation.online && <i />}</span>
            <span className="conversation-summary"><span><strong>{conversation.name}</strong><small>{conversation.time}</small></span><span><small>{conversation.message}</small>{conversation.unread > 0 && <i>{conversation.unread}</i>}</span></span>
          </button>)}</div>
        </section>
        <section className="chat-panel">
          <div className="chat-header">
            <button className="chat-back" aria-label="Back to inbox"><ArrowLeft size={17} /></button>
            <span className="conversation-avatar"><Avatar person={active} />{active.online && <i />}</span>
            <div><strong>{active.name}</strong><small>{active.online ? 'Around now' : 'Your iConnect connection'}</small></div>
            <div className="chat-header-actions"><button aria-label="Voice call preview"><Phone size={17} /></button><button aria-label="Video call preview"><Video size={18} /></button><button aria-label="More options"><MoreHorizontal size={19} /></button></div>
          </div>
          <div className="chat-history"><div className="chat-date-divider"><span>TODAY</span></div><div className="chat-privacy-note">This is an illustrative conversation in the product preview.</div>
            {messages.map((item, index) => <div className={`chat-message-row ${item.from === 'me' ? 'chat-message-mine' : ''}`} key={`${activeId}-${index}`}><div className="chat-message-bubble">{item.text}</div><span className="chat-message-time">{item.from === 'me' ? 'You' : active.name.split(' ')[0]} · 9:41</span></div>)}
          </div>
          <form className="chat-composer" onSubmit={sendMessage}><button type="button" aria-label="Add attachment">+</button><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={`Message ${active.name.split(' ')[0]}...`} aria-label="Write a message" /><button className="chat-send" type="submit" aria-label="Send preview message"><Send size={16} /></button></form>
          <p className="chat-preview-footnote">Messages stay in this temporary browser preview and are not delivered.</p>
        </section>
      </div>
    </div>
  )
}
