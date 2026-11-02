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

export async function getCommunity(communityId) {
  const payload = await apiRequest(`/api/communities/${encodeURIComponent(communityId)}`)
  return payload.community
}

export async function updateCommunity(communityId, settings) {
  const payload = await apiRequest(`/api/communities/${encodeURIComponent(communityId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: settings.name,
      description: settings.description,
      image_url: settings.imageUrl,
      rules: settings.rules,
      members_can_post: settings.membersCanPost,
      membership_mode: settings.membershipMode,
    }),
  })
  return payload.community
}

export async function getCommunityPosts(communityId) {
  const payload = await apiRequest(`/api/communities/${encodeURIComponent(communityId)}/posts`)
  return payload.posts
}

export async function createCommunityPost(communityId, text, imageUrls = []) {
  const payload = await apiRequest(`/api/communities/${encodeURIComponent(communityId)}/posts`, {
    method: 'POST',
    body: JSON.stringify({ text, image_urls: imageUrls }),
  })
  return payload.post
}

export async function deleteCommunityPost(communityId, postId) {
  return apiRequest(
    `/api/communities/${encodeURIComponent(communityId)}/posts/${encodeURIComponent(postId)}`,
    { method: 'DELETE' },
  )
}

export async function getCommunityMembers(communityId) {
  const payload = await apiRequest(`/api/communities/${encodeURIComponent(communityId)}/members`)
  return payload.members
}

export async function getCommunityJoinRequests(communityId) {
  const payload = await apiRequest(`/api/communities/${encodeURIComponent(communityId)}/join-requests`)
  return payload.requests
}

export async function reviewCommunityJoinRequest(communityId, memberId, approved) {
  const payload = await apiRequest(
    `/api/communities/${encodeURIComponent(communityId)}/join-requests/${encodeURIComponent(memberId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ approved }),
    },
  )
  return payload
}

export async function removeCommunityMember(communityId, memberId) {
  return apiRequest(
    `/api/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(memberId)}`,
    { method: 'DELETE' },
  )
}

export async function setCommunityJoined(communityId, joined) {
  const payload = await apiRequest(`/api/communities/${encodeURIComponent(communityId)}/membership`, {
    method: 'PUT',
    body: JSON.stringify({ joined }),
  })
  return payload.community
}
