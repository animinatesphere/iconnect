import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Camera, CameraOff, LoaderCircle, Mic, MicOff, Radio, Send, Users, Video, X } from 'lucide-react'
import Avatar from '../../components/Avatar.jsx'
import { createLiveStream, endLiveStream, getLiveStreams, heartbeatLiveStream, joinLiveStream } from '../../utils/liveApi.js'

function AttachedTrack({ track, label }) {
  const containerRef = useRef(null)

  useEffect(() => {
    const element = track.attach()
    element.autoplay = true
    element.playsInline = true
    if (track.kind === 'video') {
      element.className = 'live-track-video'
      element.setAttribute('aria-label', label)
    } else {
      element.className = 'live-track-audio'
      element.setAttribute('aria-label', `${label} audio`)
    }
    containerRef.current?.appendChild(element)
    return () => {
      track.detach(element)
      element.remove()
    }
  }, [label, track])

  return <div className={`live-track-frame ${track.kind === 'audio' ? 'live-audio-frame' : ''}`} ref={containerRef} />
}

function LiveRoomView({ session, onLeave, onError }) {
  const roomRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [cameraOn, setCameraOn] = useState(session.isHost)
  const [microphoneOn, setMicrophoneOn] = useState(session.isHost)
  const [localVideoTrack, setLocalVideoTrack] = useState(null)
  const [remoteTracks, setRemoteTracks] = useState([])
  const [viewerCount, setViewerCount] = useState(0)
  const [comments, setComments] = useState([])
  const [comment, setComment] = useState('')
  const [sendingComment, setSendingComment] = useState(false)
  const [roomError, setRoomError] = useState('')
  const commentListRef = useRef(null)

  const refreshParticipants = useCallback((room) => {
    const tracks = []
    room.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((publication) => {
        if (publication.track) {
          tracks.push({
            id: `${participant.identity}-${publication.trackSid}`,
            name: participant.name || 'Live guest',
            track: publication.track,
          })
        }
      })
    })
    setRemoteTracks(tracks)
    setViewerCount(room.remoteParticipants.size)
  }, [])

  useEffect(() => {
    let active = true
    let room = null

    async function connect() {
      try {
        const { Room, RoomEvent } = await import('livekit-client')
        if (!active) return
        room = new Room({ adaptiveStream: true, dynacast: true })
        roomRef.current = room
        const updateParticipants = () => refreshParticipants(room)
        room.on(RoomEvent.TrackSubscribed, updateParticipants)
        room.on(RoomEvent.TrackUnsubscribed, updateParticipants)
        room.on(RoomEvent.ParticipantConnected, updateParticipants)
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
          updateParticipants()
          if (!session.isHost && participant.identity === session.stream.host.id) {
            setRoomError('The host disconnected from this live stream.')
            room.disconnect()
          }
        })
        room.on(RoomEvent.DataReceived, (payload, participant) => {
          try {
            const data = JSON.parse(new TextDecoder().decode(payload))
            if (data.type === 'comment' && typeof data.text === 'string') {
              setComments((current) => [...current.slice(-99), {
                id: `${Date.now()}-${Math.random()}`,
                name: participant?.name || 'iConnect member',
                text: data.text.slice(0, 250),
              }])
            } else if (data.type === 'ended') {
              setRoomError('The host ended this live stream.')
              room.disconnect()
            }
          } catch {
            setRoomError('A live chat message could not be read.')
          }
        })
        room.on(RoomEvent.Disconnected, () => {
          if (active) setConnected(false)
        })

        await room.connect(session.serverUrl, session.token)
        if (!active) {
          room.disconnect()
          return
        }
        setConnected(true)
        refreshParticipants(room)
        if (session.isHost) {
          const publication = await room.localParticipant.setCameraEnabled(true)
          await room.localParticipant.setMicrophoneEnabled(true)
          if (active && publication?.track) setLocalVideoTrack(publication.track)
        }
      } catch (connectError) {
        if (active) {
          const message = connectError instanceof Error
            ? connectError.message
            : 'Could not connect to the live room.'
          setRoomError(message)
          onError(message)
        }
        room?.disconnect()
      }
    }
    connect()
    return () => {
      active = false
      room?.removeAllListeners()
      room?.disconnect()
      roomRef.current = null
    }
  }, [onError, refreshParticipants, session.isHost, session.serverUrl, session.token])

  useEffect(() => {
    commentListRef.current?.scrollTo({ top: commentListRef.current.scrollHeight, behavior: 'smooth' })
  }, [comments])

  useEffect(() => {
    if (!session.isHost) return undefined
    let active = true
    const timer = window.setInterval(() => {
      heartbeatLiveStream(session.stream.id).catch((heartbeatError) => {
        if (active) {
          setRoomError(heartbeatError instanceof Error ? heartbeatError.message : 'The live connection could not be refreshed.')
        }
      })
    }, 25000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [session.isHost, session.stream.id])

  async function toggleCamera() {
    const room = roomRef.current
    if (!room || !session.isHost) return
    try {
      const nextState = !cameraOn
      const publication = await room.localParticipant.setCameraEnabled(nextState)
      setCameraOn(nextState)
      setLocalVideoTrack(nextState ? publication?.track ?? null : null)
    } catch (cameraError) {
      setRoomError(cameraError instanceof Error ? cameraError.message : 'Camera access failed.')
    }
  }

  async function toggleMicrophone() {
    const room = roomRef.current
    if (!room || !session.isHost) return
    try {
      const nextState = !microphoneOn
      await room.localParticipant.setMicrophoneEnabled(nextState)
      setMicrophoneOn(nextState)
    } catch (microphoneError) {
      setRoomError(microphoneError instanceof Error ? microphoneError.message : 'Microphone access failed.')
    }
  }

  async function sendComment(event) {
    event.preventDefault()
    const text = comment.trim().slice(0, 250)
    if (!text || !roomRef.current || sendingComment) return
    setSendingComment(true)
    try {
      await roomRef.current.localParticipant.publishData(
        new TextEncoder().encode(JSON.stringify({ type: 'comment', text })),
        { reliable: true, topic: 'live-chat' },
      )
      setComment('')
    } catch (publishError) {
      setRoomError(publishError instanceof Error ? publishError.message : 'Your comment could not be sent.')
    } finally {
      setSendingComment(false)
    }
  }

  async function leaveRoom() {
    if (session.isHost) {
      try {
        await roomRef.current?.localParticipant.publishData(
          new TextEncoder().encode(JSON.stringify({ type: 'ended' })),
          { reliable: true, topic: 'live-chat' },
        )
        await endLiveStream(session.stream.id)
      } catch (endError) {
        onError(endError instanceof Error ? endError.message : 'Could not end the live stream.')
        return
      }
    }
    roomRef.current?.disconnect()
    onLeave()
  }

  return (
    <main className="live-room-page">
      <header className="live-room-topbar">
        <button type="button" className="live-quiet-button" onClick={leaveRoom}><ArrowLeft size={17} /> Back to live</button>
        <span className="live-room-title">{session.stream.title}</span>
        <span className="live-viewer-count"><Users size={15} /> {viewerCount + (session.isHost ? 0 : 1)}</span>
      </header>
      <div className="live-room-layout">
        <section className="live-stage">
          <div className="live-stage-video">
            {session.isHost && localVideoTrack
              ? <AttachedTrack track={localVideoTrack} label="Your live camera" />
              : remoteTracks.some((item) => item.track.kind === 'video')
                ? remoteTracks.filter((item) => item.track.kind === 'video').map((item) => <AttachedTrack key={item.id} track={item.track} label={`${item.name} live video`} />)
                : <div className="live-stage-placeholder"><Video size={40} /><strong>{connected ? 'Waiting for the live video…' : 'Connecting to the live stream…'}</strong></div>}
            {!session.isHost && remoteTracks.filter((item) => item.track.kind === 'audio').map((item) => <AttachedTrack key={item.id} track={item.track} label={item.name} />)}
            <div className="live-broadcast-badge"><i /> LIVE</div>
            <div className="live-host-label"><Avatar person={session.stream.host} /><span><strong>{session.stream.host.name}</strong><small>@{session.stream.host.username}</small></span></div>
          </div>
          {session.isHost && <div className="live-host-controls">
            <button type="button" onClick={toggleMicrophone} aria-label={microphoneOn ? 'Mute microphone' : 'Turn microphone on'}>{microphoneOn ? <Mic size={18} /> : <MicOff size={18} />}{microphoneOn ? 'Mute' : 'Unmute'}</button>
            <button type="button" onClick={toggleCamera} aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}>{cameraOn ? <Camera size={18} /> : <CameraOff size={18} />}{cameraOn ? 'Camera on' : 'Camera off'}</button>
            <button type="button" className="live-end-button" onClick={leaveRoom}><X size={17} /> End live</button>
          </div>}
          {roomError && <p className="live-room-error" role="alert">{roomError}</p>}
        </section>
        <aside className="live-chat-panel">
          <h2>Live chat <span>{comments.length}</span></h2>
          <div className="live-chat-messages" ref={commentListRef} aria-live="polite">
            {comments.map((item) => <p key={item.id}><strong>{item.name}</strong><span>{item.text}</span></p>)}
            {!comments.length && <div className="live-chat-empty">Say hello to the host and everyone watching.</div>}
          </div>
          <form className="live-chat-form" onSubmit={sendComment}>
            <input value={comment} onChange={(event) => setComment(event.target.value)} maxLength={250} placeholder="Write a comment…" aria-label="Write a live comment" disabled={!connected} />
            <button type="submit" aria-label="Send comment" disabled={!connected || !comment.trim() || sendingComment}><Send size={16} /></button>
          </form>
        </aside>
      </div>
    </main>
  )
}

export default function LiveVideoPage() {
  const { streamId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [streams, setStreams] = useState([])
  const [session, setSession] = useState(null)
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    if (!streamId) {
      async function refreshLiveStreams() {
        try {
          const items = await getLiveStreams()
          if (active) {
            setStreams(items)
            setError('')
          }
        } catch (loadError) {
          if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load live streams.')
        } finally {
          if (active) setLoading(false)
        }
      }
      setLoading(true)
      refreshLiveStreams()
      const interval = window.setInterval(refreshLiveStreams, 15000)
      return () => {
        active = false
        window.clearInterval(interval)
      }
    }
    setLoading(true)
    setError('')
    if (location.state?.liveSession?.stream?.id === streamId) {
      setSession(location.state.liveSession)
      setLoading(false)
      return () => { active = false }
    }
    setSession(null)
    joinLiveStream(streamId)
      .then((result) => { if (active) setSession(result) })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Could not join this live stream.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [location.state, streamId])

  async function startLive(event) {
    event.preventDefault()
    if (!title.trim() || starting) return
    setStarting(true)
    setError('')
    try {
      const result = await createLiveStream(title.trim())
      navigate(`/app/live/${result.stream.id}`, { state: { liveSession: { ...result, isHost: true } } })
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not start your live stream.')
    } finally {
      setStarting(false)
    }
  }

  const showError = useCallback((message) => setError(message), [])

  if (streamId && session) {
    return <LiveRoomView
      key={session.stream.id}
      session={session}
      onLeave={() => navigate('/app/live', { replace: true })}
      onError={showError}
    />
  }

  if (streamId && loading) {
    return <div className="live-page-loading" role="status"><LoaderCircle size={21} /> Joining live stream…</div>
  }

  if (streamId && error) {
    return <div className="app-content-width live-page-wrap"><p className="video-error-message" role="alert">{error}</p><button className="app-secondary-button" type="button" onClick={() => navigate('/app/live')}>Browse live videos</button></div>
  }

  return (
    <div className="app-content-width live-page-wrap">
      <header className="live-page-heading">
        <div><span className="app-page-eyebrow">REAL-TIME VIDEO</span><h1>Live video</h1><p>Go live with your camera, invite the community, and chat while people watch.</p></div>
        <span className="live-page-icon"><Radio size={22} /></span>
      </header>
      <div className="live-page-grid">
        <form className="live-start-card" onSubmit={startLive}>
          <div className="live-card-icon"><Video size={20} /></div>
          <span className="app-page-eyebrow">CREATE A BROADCAST</span>
          <h2>Start your live</h2>
          <p>Allow camera and microphone access when your broadcast opens. Anyone signed in can join and watch.</p>
          <label htmlFor="live-title">What are you going live about?</label>
          <input id="live-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} placeholder="Add a title for your live" required />
          {error && <p className="live-room-error" role="alert">{error}</p>}
          <button type="submit" className="live-start-button" disabled={!title.trim() || starting}>{starting ? <LoaderCircle size={16} className="live-spin" /> : <Radio size={16} />}{starting ? 'Starting…' : 'Go live now'}</button>
          <small>Live streaming requires a camera, microphone, and a stable internet connection.</small>
        </form>
        <section className="live-browse-card">
          <div className="live-browse-heading"><div><span className="app-page-eyebrow">JOIN THE COMMUNITY</span><h2>Live now</h2></div><span>{streams.length}</span></div>
          {loading ? <div className="live-list-empty"><LoaderCircle size={19} className="live-spin" /> Checking for live streams…</div>
            : streams.length ? <div className="live-stream-list">{streams.map((stream) => <article key={stream.id}>
              <Avatar person={stream.host} />
              <div><strong>{stream.title}</strong><small>{stream.host.name} · @{stream.host.username}</small></div>
              <button type="button" onClick={() => navigate(`/app/live/${stream.id}`)}>Join <Users size={14} /></button>
            </article>)}</div>
              : <div className="live-list-empty"><Radio size={22} /><strong>No one is live yet</strong><span>Start a broadcast and invite members to join.</span></div>}
        </section>
      </div>
      <p className="live-service-note">Live streams run on iConnect’s self-hosted media server. Camera video is sent directly to the live room and is not saved as a recording.</p>
    </div>
  )
}
