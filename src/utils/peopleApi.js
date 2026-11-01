import { apiRequest } from './api.js'

export async function getPeople({ query = '', followingOnly = false } = {}) {
  const params = new URLSearchParams()
  if (query.trim()) params.set('query', query.trim())
  if (followingOnly) params.set('following_only', 'true')
  const search = params.toString()
  const payload = await apiRequest(`/api/people${search ? `?${search}` : ''}`)
  return payload.people.map((person) => ({
    id: person.id,
    name: person.name,
    username: person.username,
    handle: `@${person.username}`,
    avatar: person.avatar ?? '',
    note: person.bio || 'A member of the iConnect community.',
    interests: person.interests.join(' · ') || 'Finding my interests',
    followerCount: person.followerCount,
    followingCount: person.followingCount,
    followedByMe: person.followedByMe,
    isPersistent: true,
  }))
}

export async function setPersonFollow(personId, following) {
  return apiRequest(`/api/people/${encodeURIComponent(personId)}/follow`, {
    method: 'PUT',
    body: JSON.stringify({ following }),
  })
}
