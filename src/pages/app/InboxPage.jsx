import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Search, Send, UserPlus } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { getConversations, getDirectMessages, openConversation as openDirectConversation, searchMessageUsers, sendDirectMessage } from '../../utils/messageApi.js'

export default function InboxPage() {
  const location = useLocation()
  const [activeId, setActiveId] = useState('')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('All messages')
  const [conversations, setConversations] = useState([])
  const [remoteMessageState, setRemoteMessageState] = useState({ conversationId: '', messages: [] })
  const [error, setError] = useState('')
  const [conversationsLoadError, setConversationsLoadError] = useState('')
  const [messagesLoadError, setMessagesLoadError] = useState('')
  const [notice, setNotice] = useState('')
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [newMessageOpen, setNewMessageOpen] = useState(false)
  const [recipientQuery, setRecipientQuery] = useState('')
  const [recipients, setRecipients] = useState([])
  const [searchingRecipients, setSearchingRecipients] = useState(false)
  const [startingConversation, setStartingConversation] = useState(false)
  const [sending, setSending] = useState(false)
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const messagesEnd = useRef(null)
  const requestedConversationId = useRef(location.state?.conversationId ?? '')
  const activeRemote = conversations.find((conversation) => conversation.id === activeId)
  const messages = remoteMessageState.conversationId === activeId ? remoteMessageState.messages : []
  const unreadCount = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0)
  const filteredConversations = useMemo(() => conversations.filter((conversation) => {
    const searchableText = `${conversation.name} ${conversation.username} ${conversation.message}`
    const matchesSearch = searchableText.toLowerCase().includes(search.trim().toLowerCase())
    return matchesSearch && (activeTab !== 'Unread' || conversation.unreadCount > 0)
  }), [activeTab, conversations, search])

  useEffect(() => {
    let active = true
    async function refreshConversations() {
      try {
        const loadedConversations = await getConversations()
        if (active) {
          setConversations(loadedConversations)
          if (requestedConversationId.current) {
            setActiveId(requestedConversationId.current)
            setMobileChatOpen(true)
            requestedConversationId.current = ''
          }
          setConversationsLoadError('')
          setError('')
        }
      } catch (loadError) {
        if (active) {
          const message = loadError instanceof Error ? loadError.message : 'Could not load your conversations.'
          setConversationsLoadError(message)
          setError(message)
        }
      } finally {
        if (active) setLoadingConversations(false)
      }
    }
    refreshConversations()
    const refreshTimer = window.setInterval(refreshConversations, 10000)
    return () => {
      active = false
      window.clearInterval(refreshTimer)
    }
  }, [])

  useEffect(() => {
    if (!activeRemote) {
      setRemoteMessageState({ conversationId: '', messages: [] })
      setMessagesLoadError('')
      setLoadingMessages(false)
      return
    }
    let activeRequest = true
    let firstLoad = true
    setLoadingMessages(true)
    setMessagesLoadError('')
    function refreshMessages() {
      getDirectMessages(activeRemote.id)
        .then((loadedMessages) => {
          if (!activeRequest) return
          setRemoteMessageState({ conversationId: activeRemote.id, messages: loadedMessages })
          setMessagesLoadError('')
          const latestMessage = loadedMessages.at(-1)
          setConversations((current) => current.map((conversation) => {
            if (conversation.id !== activeRemote.id) return conversation
            return {
              ...conversation,
              ...(latestMessage ? {
                message: latestMessage.text,
                time: latestMessage.relativeTime,
              } : {}),
              unreadCount: 0,
            }
          }))
          setError('')
        })
        .catch((loadError) => {
          if (activeRequest) {
            const message = loadError instanceof Error ? loadError.message : 'Could not load this conversation.'
            setMessagesLoadError(message)
            setError(message)
          }
        })
        .finally(() => {
          if (activeRequest && firstLoad) {
            setLoadingMessages(false)
            firstLoad = false
          }
        })
    }
    refreshMessages()
    const refreshTimer = window.setInterval(refreshMessages, 10000)
    return () => {
      activeRequest = false
      window.clearInterval(refreshTimer)
    }
  }, [activeId])

  useEffect(() => {
    if (!newMessageOpen || recipientQuery.trim().replace(/^@/, '').length < 2) {
      setRecipients([])
      setSearchingRecipients(false)
      return undefined
    }
    let activeRequest = true
    setRecipients([])
    setSearchingRecipients(true)
    const timeout = window.setTimeout(() => {
      searchMessageUsers(recipientQuery.trim())
        .then((users) => {
          if (activeRequest) {
            setRecipients(users)
            setError('')
          }
        })
        .catch((loadError) => {
          if (activeRequest) setError(loadError instanceof Error ? loadError.message : 'Could not search for accounts.')
        })
        .finally(() => {
          if (activeRequest) setSearchingRecipients(false)
        })
    }, 250)
    return () => {
      activeRequest = false
      window.clearTimeout(timeout)
    }
  }, [newMessageOpen, recipientQuery])

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [activeId, messages.length])

  async function startConversation(recipient) {
    setStartingConversation(true)
    try {
      const conversationId = await openDirectConversation(recipient.id)
      const loadedConversations = await getConversations()
      setConversations(loadedConversations)
      setConversationsLoadError('')
      setActiveId(conversationId)
      setMobileChatOpen(true)
      setNewMessageOpen(false)
      setRecipientQuery('')
      setNotice(`Message ${recipient.name} directly. Only you and ${recipient.name} can see this conversation.`)
      setError('')
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not open this conversation.')
    } finally {
      setStartingConversation(false)
    }
  }

  async function sendMessage(event) {
    event.preventDefault()
    const trimmed = message.trim()
    if (!trimmed || !activeRemote) return
    setSending(true)
    try {
      const sentMessage = await sendDirectMessage(activeRemote.id, trimmed)
      setRemoteMessageState((current) => ({
        conversationId: activeRemote.id,
        messages: current.conversationId === activeRemote.id
          ? [...current.messages, sentMessage]
          : [sentMessage],
      }))
      setConversations((current) => current.map((conversation) => (
        conversation.id === activeRemote.id
          ? { ...conversation, message: sentMessage.text, time: 'just now', unreadCount: 0 }
          : conversation
      )))
      setMessage('')
      setError('')
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Your message could not be sent.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="YOUR CONVERSATIONS" title="Messages" description="Private text conversations with your iConnect community." />
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      <div className={`inbox-layout ${mobileChatOpen ? 'inbox-chat-open' : ''}`}>
        <section className="conversation-list-panel">
          <div className="conversation-list-heading"><h2>Inbox</h2><button type="button" className="quiet-icon-button" aria-label="Start a new message" aria-expanded={newMessageOpen} onClick={() => { setNewMessageOpen((open) => !open); setNotice(''); setError('') }}><UserPlus size={17} /></button></div>
          <div className="inbox-tabs">{['All messages', 'Unread'].map((tab) => <button type="button" className={activeTab === tab ? 'inbox-tab-active' : ''} onClick={() => setActiveTab(tab)} key={tab}>{tab}{tab === 'Unread' && unreadCount > 0 && <span>{unreadCount}</span>}</button>)}</div>
          <label className="conversation-search"><Search size={15} /><input id="inbox-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></label>
          {newMessageOpen && <div className="new-message-panel">
            <label htmlFor="recipient-search">New message</label>
            <div className="new-message-search"><Search size={14} /><input id="recipient-search" value={recipientQuery} onChange={(event) => setRecipientQuery(event.target.value)} placeholder="Find by name or @username" autoComplete="off" /></div>
            {searchingRecipients && <p className="new-message-hint">Searching accounts…</p>}
            {!searchingRecipients && recipientQuery.trim().length >= 2 && !recipients.length && <p className="new-message-hint">No verified accounts found.</p>}
            <div className="new-message-results">{recipients.map((recipient) => <button type="button" key={recipient.id} onClick={() => startConversation(recipient)} disabled={startingConversation}><Avatar person={{ name: recipient.name }} /><span><strong>{recipient.name}</strong><small>@{recipient.username}</small></span></button>)}</div>
          </div>}
          <div className="conversation-list">
            {filteredConversations.map((conversation) => <button type="button" className={`conversation-item ${conversation.id === activeId ? 'conversation-active' : ''}`} onClick={() => { setActiveId(conversation.id); setMobileChatOpen(true) }} key={conversation.id}>
              <span className="conversation-avatar"><Avatar person={conversation} /></span>
              <span className="conversation-summary"><span><strong>{conversation.name}</strong><small>{conversation.time}</small></span><span><small>{conversation.message || 'Start a conversation'}</small>{conversation.unreadCount > 0 && <i>{conversation.unreadCount}</i>}</span></span>
            </button>)}
            {loadingConversations && <p className="inbox-empty-state">Loading your conversations…</p>}
            {!loadingConversations && conversationsLoadError && <p className="inbox-empty-state" role="alert">Your conversations couldn’t be loaded. {conversationsLoadError}</p>}
            {!loadingConversations && !conversationsLoadError && !filteredConversations.length && <p className="inbox-empty-state">{search ? 'No conversations match your search.' : activeTab === 'Unread' ? 'You have no unread conversations.' : 'No conversations yet. Start one with a verified account.'}</p>}
          </div>
        </section>
        <section className="chat-panel">
          {!activeRemote
            ? <div className="inbox-empty-state chat-no-selection"><h2>Select a conversation</h2><p>Choose a conversation from your inbox or start a new message.</p><button type="button" className="app-primary-button" onClick={() => setNewMessageOpen(true)}>Start a message</button></div>
            : <>
              <div className="chat-header">
                <button type="button" className="chat-back" aria-label="Back to inbox list" onClick={() => setMobileChatOpen(false)}><ArrowLeft size={17} /></button>
                <span className="conversation-avatar"><Avatar person={activeRemote} /></span>
                <div><strong>{activeRemote.name}</strong><small>@{activeRemote.username}</small></div>
              </div>
              <div className="chat-history">
                <div className="chat-date-divider"><span>PRIVATE CONVERSATION</span></div>
                <div className="chat-privacy-note">Messages are visible only to the two people in this conversation.</div>
                {loadingMessages && <p className="inbox-empty-state">Loading messages…</p>}
                {!loadingMessages && messagesLoadError && <p className="inbox-empty-state" role="alert">Messages couldn’t be loaded. {messagesLoadError}</p>}
                {!loadingMessages && !messagesLoadError && !messages.length && <p className="inbox-empty-state">This conversation is ready. Send the first message.</p>}
                {messages.map((item) => <div className={`chat-message-row ${item.from === 'me' ? 'chat-message-mine' : ''}`} key={item.id}><div className="chat-message-bubble">{item.text}</div><span className="chat-message-time">{item.from === 'me' ? 'You' : activeRemote.name.split(' ')[0]} · {item.time}</span></div>)}<div ref={messagesEnd} />
              </div>
              <form className="chat-composer" onSubmit={sendMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={`Message ${activeRemote.name.split(' ')[0]}...`} aria-label="Write a message" maxLength={2000} disabled={sending || loadingMessages} /><button className="chat-send" type="submit" aria-label="Send message" disabled={!message.trim() || sending || loadingMessages}><Send size={16} /></button></form>
              <p className="chat-account-footnote">Private text message · Delivered messages are stored in your account.</p>
            </>}
        </section>
      </div>
    </div>
  )
}
