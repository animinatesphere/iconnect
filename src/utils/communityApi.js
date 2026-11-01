import { apiRequest } from './api.js'

export async function getCommunities({ query = '', limit = 50 } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (query.trim()) params.set('query', query.trim())
  const payload = await apiRequest(`/api/communities?${params}`)
  return payload.communities
}

export async function createCommunity({ name, description, imageUrl = null }) {
  const payload = await apiRequest('/api/communities', {
    method: 'POST',
    body: JSON.stringify({ name, description, image_url: imageUrl }),
  })
  return payload.community
}

export async function setCommunityJoined(communityId, joined) {
  const payload = await apiRequest(`/api/communities/${encodeURIComponent(communityId)}/membership`, {
    method: 'PUT',
    body: JSON.stringify({ joined }),
  })
  return payload.community
}
