import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArchiveRestore, ArrowLeft, Ban, Check, CheckCheck, ImagePlus, Search, Send, Settings2, UserPlus, Volume2, VolumeX, X } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import AppPageHeader from '../../components/AppPageHeader.jsx'
import Avatar from '../../components/Avatar.jsx'
import { getConversations, getDirectMessages, openConversation as openDirectConversation, searchMessageUsers, sendDirectMessage, setConversationBlocked, updateConversationPreferences } from '../../utils/messageApi.js'
import { uploadImage } from '../../utils/mediaApi.js'
import { subscribeRealtime } from '../../utils/realtime.js'

function playIncomingMessageSound(audioContext) {
  if (!audioContext || audioContext.state !== 'running') return
  const oscillator = audioContext.createOscillator()
  const volume = audioContext.createGain()
  const now = audioContext.currentTime
  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(740, now)
  oscillator.frequency.setValueAtTime(880, now + 0.1)
  volume.gain.setValueAtTime(0.0001, now)
  volume.gain.exponentialRampToValueAtTime(0.12, now + 0.025)
  volume.gain.exponentialRampToValueAtTime(0.0001, now + 0.28)
  oscillator.connect(volume)
  volume.connect(audioContext.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.29)
}

export default function InboxPage() {
  const location = useLocation()
  const [activeId, setActiveId] = useState('')
  const [message, setMessage] = useState('')
  const [messageImage, setMessageImage] = useState(null)
  const [messageImagePreview, setMessageImagePreview] = useState('')
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('All messages')
  const [conversations, setConversations] = useState([])
  const [remoteMessageState, setRemoteMessageState] = useState({ conversationId: '', messages: [] })
  const [searchedMessageState, setSearchedMessageState] = useState({ conversationId: '', query: '', messages: [] })
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
  const [searchingMessages, setSearchingMessages] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatSearch, setChatSearch] = useState('')
  const [updatingChatSetting, setUpdatingChatSetting] = useState(false)
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const messagesEnd = useRef(null)
  const audioContext = useRef(null)
  const mutedConversationIds = useRef(new Set())
  const requestedConversationId = useRef(location.state?.conversationId ?? '')
  const activeRemote = conversations.find((conversation) => conversation.id === activeId)
  const messages = remoteMessageState.conversationId === activeId ? remoteMessageState.messages : []
  const normalizedChatSearch = chatSearch.trim()
  const hasLoadedChatSearch = searchedMessageState.conversationId === activeId
    && searchedMessageState.query === normalizedChatSearch
  const visibleMessages = useMemo(() => {
    return normalizedChatSearch
      ? hasLoadedChatSearch ? searchedMessageState.messages : []
      : messages
  }, [hasLoadedChatSearch, messages, normalizedChatSearch, searchedMessageState.messages])
  const unreadCount = conversations.reduce(
    (total, conversation) => total + (conversation.isArchived ? 0 : conversation.unreadCount),
    0,
  )
  const filteredConversations = useMemo(() => conversations.filter((conversation) => {
    const searchableText = `${conversation.name} ${conversation.username} ${conversation.message}`
    const matchesSearch = searchableText.toLowerCase().includes(search.trim().toLowerCase())
    const matchesTab = activeTab === 'Archived'
      ? conversation.isArchived
      : !conversation.isArchived && (activeTab !== 'Unread' || conversation.unreadCount > 0)
    return matchesSearch && matchesTab
  }), [activeTab, conversations, search])

  useEffect(() => {
    mutedConversationIds.current = new Set(
      conversations.filter((conversation) => conversation.isMuted).map((conversation) => conversation.id),
    )
  }, [conversations])

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
    const refreshTimer = window.setInterval(refreshConversations, 60000)
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
    const refreshTimer = window.setInterval(refreshMessages, 60000)
    return () => {
      activeRequest = false
      window.clearInterval(refreshTimer)
    }
  }, [activeId])

  useEffect(() => {
    if (!chatSearchOpen || !activeId || !normalizedChatSearch) {
      setSearchingMessages(false)
      return undefined
    }
    let activeRequest = true
    setSearchingMessages(true)
    const timeout = window.setTimeout(() => {
      getDirectMessages(activeId, normalizedChatSearch)
        .then((loadedMessages) => {
          if (activeRequest) {
            setSearchedMessageState({
              conversationId: activeId,
              query: normalizedChatSearch,
              messages: loadedMessages,
            })
            setError('')
          }
        })
        .catch((searchError) => {
          if (activeRequest) setError(searchError instanceof Error ? searchError.message : 'Could not search this conversation.')
        })
        .finally(() => {
          if (activeRequest) setSearchingMessages(false)
        })
    }, 250)
    return () => {
      activeRequest = false
      window.clearTimeout(timeout)
    }
  }, [activeId, chatSearchOpen, normalizedChatSearch])

  useEffect(() => {
    const unlockAudio = () => {
      if (!audioContext.current && window.AudioContext) {
        audioContext.current = new window.AudioContext()
      }
    }
    window.addEventListener('pointerdown', unlockAudio, { once: true })
    window.addEventListener('keydown', unlockAudio, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }
  }, [])

  useEffect(() => {
    function refreshConversationList() {
      getConversations()
        .then(setConversations)
        .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Could not refresh your conversations.'))
    }

    function refreshActiveConversation(conversationId, errorMessage) {
      getDirectMessages(conversationId)
        .then((loadedMessages) => {
          setRemoteMessageState({ conversationId, messages: loadedMessages })
          setConversations((current) => current.map((conversation) => (
            conversation.id === conversationId
              ? { ...conversation, unreadCount: 0 }
              : conversation
          )))
        })
        .catch((loadError) => setError(loadError instanceof Error ? loadError.message : errorMessage))
    }

    return subscribeRealtime((event) => {
      if (event.type === 'message.created') {
        if (!mutedConversationIds.current.has(event.conversationId)) {
          playIncomingMessageSound(audioContext.current)
        }
        refreshConversationList()
        if (event.conversationId === activeId) {
          refreshActiveConversation(activeId, 'Could not refresh this conversation.')
        }
      } else if (event.type === 'message.read' && event.conversationId === activeId) {
        refreshActiveConversation(activeId, 'Could not refresh read receipts.')
      } else if (event.type === 'sync' || event.type === 'connected') {
        refreshConversationList()
        if (activeId) {
          refreshActiveConversation(activeId, 'Could not refresh this conversation.')
        }
      }
    })
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

  useEffect(() => {
    if (!messageImage) {
      setMessageImagePreview('')
      return undefined
    }
    const preview = URL.createObjectURL(messageImage)
    setMessageImagePreview(preview)
    return () => URL.revokeObjectURL(preview)
  }, [messageImage])

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
    if ((!trimmed && !messageImage) || !activeRemote) return
    setSending(true)
    try {
      const imageUrl = messageImage ? await uploadImage(messageImage) : null
      const sentMessage = await sendDirectMessage(activeRemote.id, trimmed, imageUrl)
      setRemoteMessageState((current) => ({
        conversationId: activeRemote.id,
        messages: current.conversationId === activeRemote.id
          ? [...current.messages, sentMessage]
          : [sentMessage],
      }))
      setConversations((current) => current.map((conversation) => (
        conversation.id === activeRemote.id
          ? { ...conversation, message: sentMessage.text || (sentMessage.imageUrl ? 'Photo' : ''), time: 'just now', unreadCount: 0 }
          : conversation
      )))
      setMessage('')
      setMessageImage(null)
      setError('')
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Your message could not be sent.')
    } finally {
      setSending(false)
    }
  }

  async function saveChatPreferences(nextPreferences) {
    if (!activeRemote || updatingChatSetting) return
    setUpdatingChatSetting(true)
    try {
      const savedPreferences = await updateConversationPreferences(activeRemote.id, {
        isMuted: nextPreferences.isMuted ?? activeRemote.isMuted,
        isArchived: nextPreferences.isArchived ?? activeRemote.isArchived,
      })
      setConversations((current) => current.map((conversation) => (
        conversation.id === activeRemote.id ? { ...conversation, ...savedPreferences } : conversation
      )))
      setNotice('Chat settings saved.')
      setSettingsOpen(false)
      setError('')
    } catch (settingError) {
      setError(settingError instanceof Error ? settingError.message : 'Could not save chat settings.')
    } finally {
      setUpdatingChatSetting(false)
    }
  }

  async function toggleBlocked() {
    if (!activeRemote || updatingChatSetting) return
    setUpdatingChatSetting(true)
    try {
      const isBlockedByMe = await setConversationBlocked(activeRemote.id, !activeRemote.isBlockedByMe)
      setConversations((current) => current.map((conversation) => (
        conversation.id === activeRemote.id ? { ...conversation, isBlockedByMe } : conversation
      )))
      setNotice(isBlockedByMe ? `${activeRemote.name} is blocked. They can no longer message you.` : `${activeRemote.name} has been unblocked.`)
      setSettingsOpen(false)
      setError('')
    } catch (settingError) {
      setError(settingError instanceof Error ? settingError.message : 'Could not update this contact.')
    } finally {
      setUpdatingChatSetting(false)
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
          <div className="inbox-tabs">{['All messages', 'Unread', 'Archived'].map((tab) => <button type="button" className={activeTab === tab ? 'inbox-tab-active' : ''} onClick={() => setActiveTab(tab)} key={tab}>{tab}{tab === 'Unread' && unreadCount > 0 && <span>{unreadCount}</span>}</button>)}</div>
          <label className="conversation-search"><Search size={15} /><input id="inbox-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></label>
          {newMessageOpen && <div className="new-message-panel">
            <label htmlFor="recipient-search">New message</label>
            <div className="new-message-search"><Search size={14} /><input id="recipient-search" value={recipientQuery} onChange={(event) => setRecipientQuery(event.target.value)} placeholder="Find by name or @username" autoComplete="off" /></div>
            {searchingRecipients && <p className="new-message-hint">Searching accounts…</p>}
            {!searchingRecipients && recipientQuery.trim().length >= 2 && !recipients.length && <p className="new-message-hint">No verified accounts found.</p>}
            <div className="new-message-results">{recipients.map((recipient) => <button type="button" key={recipient.id} onClick={() => startConversation(recipient)} disabled={startingConversation}><Avatar person={recipient} /><span><strong>{recipient.name}</strong><small>@{recipient.username}</small></span></button>)}</div>
          </div>}
          <div className="conversation-list">
            {loadingConversations && <div className="inbox-skeleton-list" role="status" aria-label="Loading conversations">{[0, 1, 2, 3].map((item) => <div className="inbox-skeleton-conversation" key={item}><span className="inbox-skeleton inbox-skeleton-avatar" /><span><i className="inbox-skeleton inbox-skeleton-name" /><i className="inbox-skeleton inbox-skeleton-preview" /></span></div>)}</div>}
            {!loadingConversations && filteredConversations.map((conversation) => <button type="button" className={`conversation-item ${conversation.id === activeId ? 'conversation-active' : ''}`} onClick={() => { setActiveId(conversation.id); setMobileChatOpen(true); setChatSearch(''); setChatSearchOpen(false) }} key={conversation.id}>
              <span className="conversation-avatar"><Avatar person={conversation} /></span>
              <span className="conversation-summary"><span><strong>{conversation.name}</strong><small>{conversation.time}</small></span><span><small>{conversation.message || 'Start a conversation'}</small>{conversation.isMuted && <VolumeX size={12} aria-label="Muted" />}{conversation.unreadCount > 0 && <i>{conversation.unreadCount}</i>}</span></span>
            </button>)}
            {!loadingConversations && conversationsLoadError && <p className="inbox-empty-state" role="alert">Your conversations couldn’t be loaded. {conversationsLoadError}</p>}
            {!loadingConversations && !conversationsLoadError && !filteredConversations.length && <p className="inbox-empty-state">{search ? 'No conversations match your search.' : activeTab === 'Unread' ? 'You have no unread conversations.' : activeTab === 'Archived' ? 'No archived conversations.' : 'No conversations yet. Start one with a verified account.'}</p>}
          </div>
        </section>
        <section className="chat-panel">
          {!activeRemote
            ? <div className="inbox-empty-state chat-no-selection"><h2>Select a conversation</h2><p>Choose a conversation from your inbox or start a new message.</p><button type="button" className="app-primary-button" onClick={() => setNewMessageOpen(true)}>Start a message</button></div>
            : <>
              <div className="chat-header">
                <button type="button" className="chat-back" aria-label="Back to inbox list" onClick={() => setMobileChatOpen(false)}><ArrowLeft size={17} /></button>
                <span className="conversation-avatar"><Avatar person={activeRemote} /></span>
                <div><strong>{activeRemote.name}</strong><small>@{activeRemote.username} · Private conversation</small></div>
                <button type="button" className={`quiet-icon-button chat-header-action ${chatSearchOpen ? 'chat-header-action-active' : ''}`} aria-label="Search messages in this chat" aria-expanded={chatSearchOpen} onClick={() => { setChatSearchOpen((open) => !open); setChatSearch(''); setSearchedMessageState({ conversationId: '', query: '', messages: [] }) }}><Search size={17} /></button>
                <div className="chat-settings-wrap">
                  <button type="button" className="quiet-icon-button chat-header-action" aria-label="Chat settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={17} /></button>
                  {settingsOpen && <div className="chat-settings-menu" role="menu" aria-label="Chat settings">
                    <button type="button" role="menuitem" onClick={() => saveChatPreferences({ isMuted: !activeRemote.isMuted })} disabled={updatingChatSetting}><span>{activeRemote.isMuted ? <Volume2 size={15} /> : <VolumeX size={15} />}</span>{activeRemote.isMuted ? 'Unmute notifications' : 'Mute notifications'}</button>
                    <button type="button" role="menuitem" onClick={() => saveChatPreferences({ isArchived: !activeRemote.isArchived })} disabled={updatingChatSetting}><span>{activeRemote.isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}</span>{activeRemote.isArchived ? 'Unarchive chat' : 'Archive chat'}</button>
                    <button type="button" role="menuitem" className="chat-settings-block" onClick={toggleBlocked} disabled={updatingChatSetting}><span><Ban size={15} /></span>{activeRemote.isBlockedByMe ? 'Unblock contact' : 'Block contact'}</button>
                  </div>}
                </div>
              </div>
              <div className="chat-history">
                <div className="chat-date-divider"><span>PRIVATE CONVERSATION</span></div>
                <div className="chat-privacy-note">Messages are visible only to the two people in this conversation.</div>
                {chatSearchOpen && <label className="chat-search-toolbar"><Search size={15} /><input autoFocus value={chatSearch} onChange={(event) => setChatSearch(event.target.value)} placeholder="Search messages in this chat" aria-label="Search messages in this chat" /><span>{normalizedChatSearch ? searchingMessages ? 'Searching…' : `${visibleMessages.length} found` : 'All messages'}</span><button type="button" aria-label="Close chat search" onClick={() => { setChatSearchOpen(false); setChatSearch('') }}><X size={15} /></button></label>}
                {activeRemote.isBlockedByMe && <div className="chat-blocked-banner" role="status"><Ban size={15} /><span>You blocked {activeRemote.name}. They can’t message you.</span><button type="button" onClick={toggleBlocked} disabled={updatingChatSetting}>Unblock</button></div>}
                {loadingMessages && <div className="chat-skeleton-list" role="status" aria-label="Loading messages">{[0, 1, 2, 3].map((item) => <div className={`chat-skeleton-message ${item % 2 ? 'chat-skeleton-message-mine' : ''}`} key={item}><i className="inbox-skeleton" /><span className="inbox-skeleton inbox-skeleton-time" /></div>)}</div>}
                {!loadingMessages && messagesLoadError && <p className="inbox-empty-state" role="alert">Messages couldn’t be loaded. {messagesLoadError}</p>}
                {!loadingMessages && !messagesLoadError && !messages.length && <p className="inbox-empty-state">This conversation is ready. Send the first message.</p>}
                {!loadingMessages && !messagesLoadError && normalizedChatSearch && !searchingMessages && !visibleMessages.length && <p className="inbox-empty-state">No messages match “{normalizedChatSearch}”.</p>}
                {visibleMessages.map((item) => <div className={`chat-message-row ${item.from === 'me' ? 'chat-message-mine' : ''}`} key={item.id}>
                  <div className="chat-message-bubble">
                    {item.imageUrl && <a className="chat-message-image-link" href={item.imageUrl} target="_blank" rel="noreferrer"><img className="chat-message-image" src={item.imageUrl} alt="Photo attachment" loading="lazy" /></a>}
                    {item.text && <p className="chat-message-text">{item.text}</p>}
                  </div>
                  <div className="chat-message-meta">
                    {item.from === 'them' && <span className="chat-message-sender">{activeRemote.name.split(' ')[0]}</span>}
                    <time className="chat-message-time">{item.time}</time>
                    {item.from === 'me' && <span className={`chat-message-receipt ${item.readAt ? 'chat-message-receipt-read' : ''}`} title={item.readAt ? `Read ${new Date(item.readAt).toLocaleString()}` : 'Sent'} aria-label={item.readAt ? 'Read' : 'Sent'}>
                      {item.readAt ? <CheckCheck size={14} /> : <Check size={14} />}
                    </span>}
                  </div>
                </div>)}<div ref={messagesEnd} />
              </div>
              {messageImagePreview && <div className="chat-selected-image-preview"><img src={messageImagePreview} alt="Selected photo attachment" /><button type="button" aria-label="Remove selected photo" onClick={() => setMessageImage(null)} disabled={sending}><X size={14} /></button></div>}
              {!activeRemote.isBlockedByMe && <form className="chat-composer" onSubmit={sendMessage}>
                <label className="chat-image-picker" aria-label="Attach a photo"><ImagePlus size={17} /><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                    setError('Choose a JPEG, PNG, or WebP photo.')
                    return
                  }
                  setMessageImage(file)
                  setError('')
                }} disabled={sending || loadingMessages} /></label>
                <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={`Message ${activeRemote.name.split(' ')[0]}...`} aria-label="Write a message" maxLength={2000} disabled={sending || loadingMessages} />
                <button className="chat-send" type="submit" aria-label="Send message" disabled={(!message.trim() && !messageImage) || sending || loadingMessages}><Send size={16} /></button>
              </form>}
              <p className="chat-account-footnote">Private messages and photos are stored in your account.</p>
            </>}
        </section>
      </div>
    </div>
  )
}
