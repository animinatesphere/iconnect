import { apiRequest } from './api.js'

export async function getLiveStreams() {
  const payload = await apiRequest('/api/live')
  return payload.streams
}

export async function createLiveStream(title) {
  return apiRequest('/api/live', {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}

export async function joinLiveStream(streamId) {
  return apiRequest(`/api/live/${encodeURIComponent(streamId)}/join`, {
    method: 'POST',
  })
}

export async function endLiveStream(streamId) {
  await apiRequest(`/api/live/${encodeURIComponent(streamId)}/end`, {
    method: 'POST',
  })
}

export async function heartbeatLiveStream(streamId) {
  await apiRequest(`/api/live/${encodeURIComponent(streamId)}/heartbeat`, {
    method: 'POST',
  })
}
