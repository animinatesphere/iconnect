import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Ban, Flag, Heart, Send, ShieldAlert } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '../../components/Avatar.jsx'
import { apiRequest } from '../../utils/api.js'
import { blockDatingUser, getDatingMatches, getDatingMessages, reportDatingUser, sendDatingMessage, unmatchDatingUser } from '../../utils/datingApi.js'

export default function DatingInboxPage() {
  const { matchId = '' } = useParams()
  const navigate = useNavigate()
  const [matches, setMatches] = useState([])
  const [messages, setMessages] = useState([])
  const [currentUserId, setCurrentUserId] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const bottomRef = useRef(null)
  const selectedMatch = matches.find((match) => match.id === matchId)

  useEffect(() => {
    let active = true
    Promise.all([getDatingMatches(), apiRequest('/api/auth/me')])
      .then(([loadedMatches, session]) => {
        if (!active) return
        setMatches(loadedMatches)
        setCurrentUserId(String(session.user?.id ?? ''))
      })
      .catch((loadError) => { if (active) setError(loadError.message || 'Could not load dating matches.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!matchId) {
      setMessages([])
      return undefined
    }
    let active = true
    const refresh = () => getDatingMessages(matchId)
      .then((loadedMessages) => { if (active) { setMessages(loadedMessages); setError('') } })
      .catch((loadError) => { if (active) setError(loadError.message || 'Could not load this dating conversation.') })
    refresh()
    const timer = window.setInterval(refresh, 12000)
    return () => { active = false; window.clearInterval(timer) }
  }, [matchId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  async function submitMessage(event) {
    event.preventDefault()
    const body = text.trim()
    if (!body || !matchId) return
    setSending(true)
    setError('')
    try {
      const sent = await sendDatingMessage(matchId, body)
      setMessages((current) => [...current, sent])
      setText('')
    } catch (sendError) {
      setError(sendError.message || 'Could not send this message.')
    } finally {
      setSending(false)
    }
  }

  async function safetyAction(action) {
    if (!selectedMatch) return
    const person = selectedMatch.profile
    setError('')
    setNotice('')
    try {
      if (action === 'block') {
        if (!window.confirm(`Block ${person.name} and end this dating connection?`)) return
        await blockDatingUser(person.user_id)
        setMatches((current) => current.filter((match) => match.id !== matchId))
        navigate('/app/dating/messages', { replace: true })
        return
      }
      if (action === 'unmatch') {
        if (!window.confirm(`Unmatch ${person.name}? The dating conversation will be removed.`)) return
        await unmatchDatingUser(matchId)
        setMatches((current) => current.filter((match) => match.id !== matchId))
        navigate('/app/dating/messages', { replace: true })
        return
      }
      const reason = window.prompt('Report reason: inappropriate, fake_profile, harassment, or other', 'other')
      if (!reason) return
      const normalizedReason = reason.trim().toLowerCase()
      if (!['inappropriate', 'fake_profile', 'harassment', 'other'].includes(normalizedReason)) {
        setError('Choose inappropriate, fake_profile, harassment, or other as the report reason.')
        return
      }
      const details = window.prompt('Add details (optional):', '') ?? ''
      await reportDatingUser(person.user_id, { reason: normalizedReason, details })
      setNotice('Your report has been submitted for review.')
    } catch (actionError) {
      setError(actionError.message || 'Could not complete this safety action.')
    }
  }

  return (
    <div className="app-content-width dating-inbox-page">
      <header className="dating-inbox-heading"><div><span className="app-page-eyebrow">PRIVATE · MUTUAL MATCHES ONLY</span><h1>Dating inbox</h1><p>These conversations are separate from your regular iConnect messages.</p></div><Link to="/app/dating"><Heart size={15} /> Back to dating</Link></header>
      {error && <p className="dating-feedback dating-error" role="alert">{error}</p>}
      {notice && <p className="dating-feedback dating-notice" role="status">{notice}</p>}
      <section className="dating-inbox-layout">
        <aside className={`dating-inbox-matches ${matchId ? 'dating-inbox-matches-mobile-hidden' : ''}`}>
          <div className="dating-inbox-list-heading"><strong>Your matches</strong><span>{matches.length}</span></div>
          {loading ? <p className="dating-inbox-empty">Loading matches…</p>
            : !matches.length ? <div className="dating-inbox-empty"><Heart size={20} /><span>Your mutual matches will appear here.</span><Link to="/app/dating">Discover people</Link></div>
              : matches.map((match) => <Link key={match.id} to={`/app/dating/messages/${match.id}`} className={`dating-inbox-person ${matchId === match.id ? 'is-selected' : ''}`}>
                <Avatar person={{ name: match.profile.name, image: match.profile.image_urls[0] }} />
                <span><strong>{match.profile.name}</strong><small>{match.last_message || `${match.profile.age} · ${match.profile.location}`}</small></span>
              </Link>)}
        </aside>
        <section className="dating-chat-panel" aria-label="Dating conversation">
          {!matchId ? <div className="dating-chat-placeholder"><Heart size={25} /><h2>Your dating conversations</h2><p>Select a mutual match to start chatting.</p></div>
            : !selectedMatch && !loading ? <div className="dating-chat-placeholder"><ShieldAlert size={25} /><h2>This match is no longer available</h2><p>The match may have ended or its profile may be paused.</p><Link to="/app/dating/messages">Back to matches</Link></div>
              : <><header className="dating-chat-header">
                <Link to="/app/dating/messages" className="dating-chat-back" aria-label="Back to dating matches"><ArrowLeft size={17} /></Link>
                {selectedMatch && <Avatar person={{ name: selectedMatch.profile.name, image: selectedMatch.profile.image_urls[0] }} />}
                <div><strong>{selectedMatch?.profile.name ?? 'Dating match'}</strong><span>Mutual match</span></div>
                {selectedMatch && <div className="dating-chat-safety"><button type="button" aria-label="Report profile" onClick={() => safetyAction('report')}><Flag size={16} /></button><button type="button" aria-label="Block profile" onClick={() => safetyAction('block')}><Ban size={16} /></button><button type="button" onClick={() => safetyAction('unmatch')}>Unmatch</button></div>}
              </header>
              <div className="dating-chat-messages">
                {messages.length ? messages.map((message) => {
                  const own = String(message.sender_id) === currentUserId
                  return <div key={message.id} className={`dating-message ${own ? 'dating-message-own' : ''}`}><span>{message.body}</span><small>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(message.created_at))}</small></div>
                }) : <div className="dating-chat-intro"><Heart size={19} /><strong>You matched!</strong><span>Say hello and get to know each other.</span></div>}
                <div ref={bottomRef} />
              </div>
              <form className="dating-chat-composer" onSubmit={submitMessage}><input aria-label="Write a dating message" maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} placeholder="Write a message…" /><button type="submit" disabled={!text.trim() || sending} aria-label="Send message"><Send size={17} /></button></form>
            </>}
        </section>
      </section>
    </div>
  )
}
