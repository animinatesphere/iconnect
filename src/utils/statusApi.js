import { apiRequest } from './api.js'

export async function getStatuses(userId) {
  const params = new URLSearchParams()
  if (userId) params.set('user_id', userId)
  const query = params.toString()
  const payload = await apiRequest(`/api/statuses${query ? `?${query}` : ''}`)
  return payload.statuses
}

export async function createStatus(imageUrl, caption) {
  const payload = await apiRequest('/api/statuses', {
    method: 'POST',
    body: JSON.stringify({ image_url: imageUrl, caption }),
  })
  return payload.status
}

export async function getStatus(statusId) {
  const payload = await apiRequest(`/api/statuses/${encodeURIComponent(statusId)}`)
  return payload.status
}

export async function deleteStatus(statusId) {
  return apiRequest(`/api/statuses/${encodeURIComponent(statusId)}`, {
    method: 'DELETE',
  })
}
