import { apiRequest } from './api.js'

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatRelativeTime(value) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (elapsedMinutes < 1) return 'just now'
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  if (elapsedHours < 24) return `${elapsedHours}h`
  return `${Math.floor(elapsedHours / 24)}d`
}

export function toConversation(conversation) {
  return {
    id: conversation.id,
    recipientId: conversation.recipient.id,
    name: conversation.recipient.name,
    username: conversation.recipient.username,
    handle: `@${conversation.recipient.username}`,
    avatar: conversation.recipient.avatar ?? '',
    message: conversation.lastMessage,
    time: formatRelativeTime(conversation.lastMessageAt),
    unreadCount: conversation.unreadCount,
    isBlockedByMe: conversation.isBlockedByMe,
    isMuted: conversation.isMuted,
    isArchived: conversation.isArchived,
    isPersistent: true,
  }
}

export function toDirectMessage(message) {
  return {
    id: message.id,
    from: message.isMine ? 'me' : 'them',
    text: message.text,
    imageUrl: message.imageUrl ?? '',
    time: formatTime(message.createdAt),
    relativeTime: formatRelativeTime(message.createdAt),
    createdAt: message.createdAt,
    readAt: message.readAt,
  }
}

export async function searchMessageUsers(query) {
  const params = new URLSearchParams({ query })
  const payload = await apiRequest(`/api/messages/users?${params}`)
  return payload.users
}

export async function getConversations() {
  const payload = await apiRequest('/api/messages/conversations')
  return payload.conversations.map(toConversation)
}

export async function openConversation(recipientId) {
  const payload = await apiRequest('/api/messages/conversations', {
    method: 'POST',
    body: JSON.stringify({ recipient_id: recipientId }),
  })
  return payload.conversationId
}

export async function getDirectMessages(conversationId, query = '') {
  const params = new URLSearchParams()
  if (query.trim()) params.set('query', query.trim())
  const queryString = params.toString()
  const payload = await apiRequest(`/api/messages/conversations/${encodeURIComponent(conversationId)}/messages${queryString ? `?${queryString}` : ''}`)
  return payload.messages.map(toDirectMessage)
}

export async function sendDirectMessage(conversationId, text, imageUrl = null) {
  const payload = await apiRequest(`/api/messages/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text, image_url: imageUrl }),
  })
  return toDirectMessage(payload.message)
}

export async function setConversationBlocked(conversationId, blocked) {
  const payload = await apiRequest(`/api/messages/conversations/${encodeURIComponent(conversationId)}/block`, {
    method: 'PUT',
    body: JSON.stringify({ blocked }),
  })
  return payload.isBlockedByMe
}

export async function updateConversationPreferences(conversationId, preferences) {
  const payload = await apiRequest(`/api/messages/conversations/${encodeURIComponent(conversationId)}/preferences`, {
    method: 'PUT',
    body: JSON.stringify({
      is_muted: preferences.isMuted,
      is_archived: preferences.isArchived,
    }),
  })
  return {
    isMuted: payload.isMuted,
    isArchived: payload.isArchived,
  }
}
