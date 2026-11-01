export function subscribeRealtime(onEvent) {
  let socket
  let reconnectTimer
  let reconnectDelay = 500
  let closed = false

  function connect() {
    if (closed) return
    const url = new URL('/api/realtime', window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    socket = new WebSocket(url)
    socket.addEventListener('open', () => {
      reconnectDelay = 500
    })
    socket.addEventListener('message', (message) => {
      let event
      try {
        event = JSON.parse(message.data)
      } catch {
        return
      }
      onEvent(event)
    })
    socket.addEventListener('close', () => {
      if (closed) return
      reconnectTimer = window.setTimeout(connect, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 15000)
    })
    socket.addEventListener('error', () => socket.close())
  }

  connect()

  return () => {
    closed = true
    window.clearTimeout(reconnectTimer)
    socket?.close()
  }
}
