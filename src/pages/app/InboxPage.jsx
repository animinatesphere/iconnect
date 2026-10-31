import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, MoreHorizontal, Phone, Search, Send, UserPlus, Video } from 'lucide-react'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { demoConversations, demoMessages } from '../../data/demoContent.js'
import { emptyDemoFeedState, readDemoFeedState, writeDemoFeedState } from '../../utils/demoFeed.js'
import { getConversations, getDirectMessages, openConversation as openDirectConversation, searchMessageUsers, sendDirectMessage } from '../../utils/messageApi.js'

export default function InboxPage() {
  const [activeId, setActiveId] = useState('sofia')
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('All messages')
  const [feedState, setFeedState] = useState(emptyDemoFeedState)
  const [conversations, setConversations] = useState([])
  const [remoteMessages, setRemoteMessages] = useState([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileChatOpen, setMobileChatOpen] = useState(false)
  const [newMessageOpen, setNewMessageOpen] = useState(false)
  const [recipientQuery, setRecipientQuery] = useState('')
  const [recipients, setRecipients] = useState([])
  const [searchingRecipients, setSearchingRecipients] = useState(false)
  const [startingConversation, setStartingConversation] = useState(false)
  const [sending, setSending] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const messagesEnd = useRef(null)
  const activeRemote = conversations.find((conversation) => conversation.id === activeId)
  const activeDemo = demoConversations.find((conversation) => conversation.id === activeId)
  const active = activeRemote ?? activeDemo ?? demoConversations[0]
  const isPersistent = Boolean(activeRemote)
  const messages = isPersistent
    ? remoteMessages
    : [...(demoMessages[active.id] ?? []), ...(feedState.messages[active.id] ?? [])]
  const allConversations = useMemo(() => [
    ...conversations,
    ...demoConversations.map((conversation) => ({ ...conversation, unreadCount: conversation.unread })),
  ], [conversations])
  const filteredConversations = allConversations.filter((conversation) => {
    const localThread = conversation.isPersistent
      ? []
      : [...(demoMessages[conversation.id] ?? []), ...(feedState.messages[conversation.id] ?? [])]
    const searchableText = `${conversation.name} ${conversation.username ?? ''} ${conversation.message ?? ''} ${localThread.map((item) => item.text).join(' ')}`
    const matchesSearch = searchableText.toLowerCase().includes(search.trim().toLowerCase())
    const unread = conversation.isPersistent
      ? conversation.unreadCount > 0
      : conversation.unreadCount > 0 && !feedState.readConversationIds.includes(conversation.id)
    return matchesSearch && (activeTab !== 'Unread' || unread)
  })

  useEffect(() => {
    try {
      setFeedState(readDemoFeedState())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your local demo messages.')
    }
    getConversations()
      .then((loadedConversations) => {
        setConversations(loadedConversations)
        if (loadedConversations.length) {
          setActiveId((current) => current === 'sofia' ? loadedConversations[0].id : current)
        }
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not load your conversations.'))
  }, [])

  useEffect(() => {
    if (!activeRemote) {
      setRemoteMessages([])
      setLoadingMessages(false)
      return
    }
    let activeRequest = true
    let firstLoad = true
    setLoadingMessages(true)
    function refreshMessages() {
      getDirectMessages(activeRemote.id)
        .then((loadedMessages) => {
          if (!activeRequest) return
          setRemoteMessages(loadedMessages)
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
          if (activeRequest) setError(loadError instanceof Error ? loadError.message : 'Could not load this conversation.')
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

  function updateState(nextState) {
    try {
      writeDemoFeedState(nextState)
      setFeedState(nextState)
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save your demo message.')
    }
  }

  function selectDemoConversation(id) {
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

  async function startConversation(recipient) {
    setStartingConversation(true)
    try {
      const conversationId = await openDirectConversation(recipient.id)
      const loadedConversations = await getConversations()
      setConversations(loadedConversations)
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
    if (!trimmed) return
    if (isPersistent) {
      setSending(true)
      try {
        const sentMessage = await sendDirectMessage(active.id, trimmed)
        setRemoteMessages((current) => [...current, sentMessage])
        setConversations((current) => current.map((conversation) => (
          conversation.id === active.id
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
      return
    }
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
    if (isPersistent) {
      setNotice('Deleting or clearing delivered messages is not available yet.')
    } else {
      updateState({ ...feedState, messages: { ...feedState.messages, [active.id]: [] } })
      setNotice(`Your local sample messages with ${active.name} were cleared.`)
    }
    setMenuOpen(false)
  }

  function showCallPreview(type) {
    setNotice(`${type} calling is a preview only; no call will be placed.`)
  }

  const unreadCount = allConversations.reduce((total, conversation) => (
    total + (conversation.isPersistent
      ? conversation.unreadCount
      : feedState.readConversationIds.includes(conversation.id) ? 0 : conversation.unreadCount)
  ), 0)

  return (
    <div className="app-content-width">
      <AppPageHeader eyebrow="YOUR CONVERSATIONS" title="Messages" description="Private text conversations with your iConnect community." />
      <div className="inbox-demo-banner"><span className="demo-indicator" /> Delivered messages are saved to your account. Sample conversations, calling, and attachments are previews.</div>
      {error && <p className="feed-interaction-notice feed-error" role="alert">{error}</p>}
      {notice && <p className="feed-interaction-notice" role="status">{notice}</p>}
      <div className={`inbox-layout ${mobileChatOpen ? 'inbox-chat-open' : ''}`}>
        <section className="conversation-list-panel">
          <div className="conversation-list-heading"><h2>Inbox</h2><button type="button" className="quiet-icon-button" aria-label="Start a new message" aria-expanded={newMessageOpen} onClick={() => { setNewMessageOpen((open) => !open); setNotice(''); setError('') }}><UserPlus size={17} /></button></div>
          <div className="inbox-tabs">{['All messages', 'Unread'].map((tab) => <button type="button" className={activeTab === tab ? 'inbox-tab-active' : ''} onClick={() => setActiveTab(tab)} key={tab}>{tab}{tab === 'Unread' && unreadCount > 0 && <span>{unreadCount}</span>}</button>)}</div>
          <label className="conversation-search"><Search size={15} /><input id="inbox-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search messages" aria-label="Search messages" /></label>
          {newMessageOpen && <div className="new-message-panel">
            <label htmlFor="recipient-search">New message</label>
            <div className="new-message-search"><Search size={14} /><input id="recipient-search" value={recipientQuery} onChange={(event) => setRecipientQuery(event.target.value)} placeholder="Find by name or @username" autoComplete="off" /></div>
            {searchingRecipients && <p className="new-message-hint">Searching accounts…</p>}
            {!searchingRecipients && recipientQuery.trim().length >= 2 && !recipients.length && <p className="new-message-hint">No verified accounts found.</p>}
            <div className="new-message-results">{recipients.map((recipient) => <button type="button" key={recipient.id} onClick={() => startConversation(recipient)} disabled={startingConversation}><Avatar person={{ name: recipient.name }} /><span><strong>{recipient.name}</strong><small>@{recipient.username}</small></span></button>)}</div>
          </div>}
          <div className="conversation-list">{filteredConversations.map((conversation) => {
            const isUnread = conversation.isPersistent
              ? conversation.unreadCount > 0
              : conversation.unreadCount > 0 && !feedState.readConversationIds.includes(conversation.id)
            const lastMessage = conversation.isPersistent
              ? conversation.message || 'Start a conversation'
              : [...(demoMessages[conversation.id] ?? []), ...(feedState.messages[conversation.id] ?? [])].at(-1)?.text ?? conversation.message
            return <button type="button" className={`conversation-item ${conversation.id === activeId ? 'conversation-active' : ''}`} onClick={() => conversation.isPersistent ? (setActiveId(conversation.id), setMobileChatOpen(true)) : selectDemoConversation(conversation.id)} key={`${conversation.isPersistent ? 'persistent' : 'demo'}-${conversation.id}`}>
              <span className="conversation-avatar"><Avatar person={conversation} />{conversation.online && <i />}</span>
              <span className="conversation-summary"><span><strong>{conversation.name}</strong><small>{conversation.time}</small></span><span><small>{lastMessage}</small>{isUnread && <i>{conversation.unreadCount}</i>}</span></span>
            </button>
          })}{!filteredConversations.length && <p className="inbox-empty-state">{search ? 'No conversations match your search.' : activeTab === 'Unread' ? 'You have no unread conversations.' : 'No conversations yet. Start one with a verified account.'}</p>}</div>
        </section>
        <section className="chat-panel">
          <div className="chat-header">
            <button type="button" className="chat-back" aria-label="Back to inbox list" onClick={() => setMobileChatOpen(false)}><ArrowLeft size={17} /></button>
            <span className="conversation-avatar"><Avatar person={active} />{active.online && <i />}</span>
            <div><strong>{active.name}</strong><small>{isPersistent ? `@${active.username}` : active.online ? 'Sample conversation' : 'Illustrative conversation'}</small></div>
            <div className="chat-header-actions"><button type="button" aria-label="Voice call preview" onClick={() => showCallPreview('Voice')}><Phone size={17} /></button><button type="button" aria-label="Video call preview" onClick={() => showCallPreview('Video')}><Video size={18} /></button><button type="button" aria-label="More conversation options" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={19} /></button></div>
            {menuOpen && <div className="chat-options-menu"><button type="button" onClick={clearConversation}>{isPersistent ? 'Message options' : 'Clear local sample messages'}</button></div>}
          </div>
          <div className="chat-history">
            <div className="chat-date-divider"><span>{isPersistent ? 'PRIVATE CONVERSATION' : 'SAMPLE PREVIEW'}</span></div>
            <div className="chat-privacy-note">{isPersistent ? 'Messages are visible only to the two people in this conversation.' : 'Illustrative messages are samples. Your replies stay in this browser.'}</div>
            {loadingMessages && isPersistent && <p className="inbox-empty-state">Loading messages…</p>}
            {!loadingMessages && !messages.length && <p className="inbox-empty-state">{isPersistent ? 'This conversation is ready. Send the first message.' : 'No local replies yet.'}</p>}
            {messages.map((item) => <div className={`chat-message-row ${item.from === 'me' ? 'chat-message-mine' : ''}`} key={item.id ?? `${active.id}-${item.from}-${item.time}-${item.text}`}><div className="chat-message-bubble">{item.text}</div><span className="chat-message-time">{item.from === 'me' ? 'You' : active.name.split(' ')[0]} · {item.time ?? '9:41'}</span></div>)}<div ref={messagesEnd} />
          </div>
          <form className="chat-composer" onSubmit={sendMessage}><button type="button" aria-label="Insert a wave emoji" onClick={() => setMessage((current) => `${current}${current ? ' ' : ''}👋`)}>+</button><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={`Message ${active.name.split(' ')[0]}...`} aria-label="Write a message" maxLength={2000} disabled={sending || (isPersistent && loadingMessages)} /><button className="chat-send" type="submit" aria-label={isPersistent ? 'Send message' : 'Send demo message'} disabled={!message.trim() || sending || (isPersistent && loadingMessages)}><Send size={16} /></button></form>
          <p className="chat-preview-footnote">{isPersistent ? 'Text message · Attachments and calls are not connected.' : 'Sample conversation · Your replies are saved only in this browser.'}</p>
        </section>
      </div>
    </div>
  )
}
