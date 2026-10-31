import { apiRequest } from './api.js'

function relativeTime(value) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (elapsedSeconds < 60) return 'just now'
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)} min`
  if (elapsedSeconds < 86400) return `${Math.floor(elapsedSeconds / 3600)} hr`
  return `${Math.floor(elapsedSeconds / 86400)} d`
}

export function toFeedPost(post) {
  return {
    id: post.id,
    name: post.author.name,
    handle: `@${post.author.username}`,
    avatar: '',
    location: 'iConnect Social',
    time: relativeTime(post.createdAt),
    createdAt: post.createdAt,
    text: post.text,
    image: null,
    likes: post.likeCount,
    comments: post.commentCount,
    tag: 'Text update',
    isPersistent: true,
    likedByMe: post.likedByMe,
  }
}

export function toFeedComment(comment) {
  return {
    id: comment.id,
    name: comment.author.name,
    handle: `@${comment.author.username}`,
    avatar: '',
    time: relativeTime(comment.createdAt),
    text: comment.text,
    isPersistent: true,
  }
}

export async function getSocialPosts({ followingOnly = false } = {}) {
  const query = followingOnly ? '?following_only=true' : ''
  const payload = await apiRequest(`/api/social/posts${query}`)
  return payload.posts.map(toFeedPost)
}

export async function getSocialPost(postId) {
  const payload = await apiRequest(`/api/social/posts/${encodeURIComponent(postId)}`)
  return toFeedPost(payload.post)
}

export async function createSocialPost(text) {
  const payload = await apiRequest('/api/social/posts', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
  return toFeedPost(payload.post)
}

export async function setSocialPostLike(postId, liked) {
  const payload = await apiRequest(`/api/social/posts/${encodeURIComponent(postId)}/like`, {
    method: 'PUT',
    body: JSON.stringify({ liked }),
  })
  return toFeedPost(payload.post)
}

export async function getSocialComments(postId) {
  const payload = await apiRequest(`/api/social/posts/${encodeURIComponent(postId)}/comments`)
  return payload.comments.map(toFeedComment)
}

export async function createSocialComment(postId, text) {
  const payload = await apiRequest(`/api/social/posts/${encodeURIComponent(postId)}/comments`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
  return toFeedComment(payload.comment)
}
