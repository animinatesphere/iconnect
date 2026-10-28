import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, MoreHorizontal, Phone, Search, Send, Video } from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoConversations, demoMessages } from '../../data/demoContent.js'
import { emptyDemoFeedState, readDemoFeedState, writeDemoFeedState } from '../../utils/demoFeed.js'

export default function InboxPage() {
  const [activeId, setActiveId] = useState('sofia')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('All messages')
  const [feedState, setFeedState] = useState(emptyDemoFeedState)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const messagesEnd = useRef(null)
  const active = demoConversations.find((conversation) => conversation.id === activeId) ?? demoConversations[0]
  const messages = [...(demoMessages[active.id] ?? []), ...(feedState.messages[active.id] ?? [])]
  const filteredConversations = demoConversations.filter((conversation) => {
    const matchesSearch = `${conversation.name} ${conversation.message}`.toLowerCase().includes(search.trim().toLowerCase())
    const unread = conversation.unread > 0 && !feedState.readConversationIds.includes(conversation.id)
    return matchesSearch && (activeTab !== 'Unread' || unread)
  })

  useEffect(() => {
    try {
      setFeedState(readDemoFeedState())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your local demo messages.')
    }
  }, [])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [activeId, messages.length])

  function updateState(nextState) {
    try {
      writeDemoFeedState(nextState)
      setFeedState(nextState)
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your message in this browser.')
    }
  }

  function openConversation(id) {
    setActiveId(id)
    setMobileChatOpen(true)
    try {
      const state = readDemoFeedState()
      if (!state.readConversationIds.includes(id)) {
        updateState({ ...state, readConversationIds: [...state.readConversationIds, id] })
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not update your unread messages.')
    }
  }

  function sendMessage(event) {
    event.preventDefault()
    const trimmed = message.trim()
    if (!trimmed) return
    updateState({
      ...feedState,
      messages: {
        ...feedState.messages,
        [active.id]: [...(feedState.messages[active.id] ?? []), { from: 'me', text: trimmed, time: 'just now' }],
      },
    })
    setMessage('')
  }

  function clearConversation() {
    updateState({ ...feedState, messages: { ...feedState.messages, [active.id]: [] } })
    setNotice(`Your local messages with ${active.name} were cleared.`)
    setMenuOpen(false)
  }

  function showCallPreview(type) {
    setNotice(`${type} calling is a preview only; no call will be placed.`)
  }

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="YOUR CONVERSATIONS" title="Messages" description="A private-message concept with local demo conversations." />
      <div className="inbox-demo-banner"><span className="demo-indicator" /> Your messages stay in this browser. No one else receives them.</div>
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      <div className={`inbox-layout ${mobileChatOpen ? 'inbox-chat-open' : ''}`}>
        <section className="conversation-list-panel">
          <div className="conversation-list-heading"><h2>Inbox</h2><button type="button" className="quiet-icon-button" aria-label="Focus conversation search" onClick={() => document.getElementById('inbox-search')?.focus()}><Search size={17} /></button></div>
          <div className="inbox-tabs">{['All messages', 'Unread'].map((tab) => <button type="button" className={activeTab === tab ? 'inbox-tab-active' : ''} onClick={() => setActiveTab(tab)} key={tab}>{tab}{tab === 'Unread' && <span>{demoConversations.filter((item) => item.unread > 0 && !feedState.readConversationIds.includes(item.id)).length}</span>}</button>)}</div>
          <label className="conversation-search"><Search size={15} /><input id="inbox-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages" aria-label="Search messages" /></label>
          <div className="conversation-list">{filteredConversations.map((conversation) => {
            const thread = [...(demoMessages[conversation.id] ?? []), ...(feedState.messages[conversation.id] ?? [])]
            const lastMessage = thread[thread.length - 1]?.text ?? conversation.message
            const unread = conversation.unread > 0 && !feedState.readConversationIds.includes(conversation.id)
            return <button type="button" className={`conversation-item ${conversation.id === activeId ? 'conversation-active' : ''}`} onClick={() => openConversation(conversation.id)} key={conversation.id}>
              <span className="conversation-avatar"><Avatar person={conversation} />{conversation.online && <i />}</span>
              <span className="conversation-summary"><span><strong>{conversation.name}</strong><small>{feedState.messages[conversation.id]?.at(-1)?.time ?? conversation.time}</small></span><span><small>{lastMessage}</small>{unread && <i>{conversation.unread}</i>}</span></span>
            </button>
          })}{!filteredConversations.length && <p className="inbox-empty-state">{search ? 'No conversations match your search.' : 'You have no unread conversations.'}</p>}</div>
        </section>
        <section className="chat-panel">
          <div className="chat-header">
            <button type="button" className="chat-back" aria-label="Back to inbox list" onClick={() => setMobileChatOpen(false)}><ArrowLeft size={17} /></button>
            <span className="conversation-avatar"><Avatar person={active} />{active.online && <i />}</span>
            <div><strong>{active.name}</strong><small>{active.online ? 'Demo presence · around now' : 'Your iConnect connection'}</small></div>
            <div className="chat-header-actions"><button type="button" aria-label="Voice call preview" onClick={() => showCallPreview('Voice')}><Phone size={17} /></button><button type="button" aria-label="Video call preview" onClick={() => showCallPreview('Video')}><Video size={18} /></button><button type="button" aria-label="More conversation options" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={19} /></button></div>
            {menuOpen && <div className="chat-options-menu"><button type="button" onClick={clearConversation}>Clear my local messages</button></div>}
          </div>
          <div className="chat-history"><div className="chat-date-divider"><span>TODAY</span></div><div className="chat-privacy-note">Sample incoming messages are illustrative. Your replies are saved only in this browser.</div>
            {messages.map((item, index) => <div className={`chat-message-row ${item.from === 'me' ? 'chat-message-mine' : ''}`} key={`${active.id}-${index}`}><div className="chat-message-bubble">{item.text}</div><span className="chat-message-time">{item.from === 'me' ? 'You' : active.name.split(' ')[0]} · {item.time ?? '9:41'}</span></div>)}<div ref={messagesEnd} />
          </div>
          <form className="chat-composer" onSubmit={sendMessage}><button type="button" aria-label="Insert a wave emoji" onClick={() => setMessage((current) => `${current}${current ? ' ' : ''}👋`)}>+</button><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={`Message ${active.name.split(' ')[0]}...`} aria-label="Write a message" /><button className="chat-send" type="submit" aria-label="Send demo message" disabled={!message.trim()}><Send size={16} /></button></form>
          <p className="chat-preview-footnote">Local demo only · Messages are not delivered to other people.</p>
        </section>
      </div>
    </div>
  )
}
