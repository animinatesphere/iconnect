const storageKey = 'iconnect.demo.feed'

export function emptyDemoFeedState() {
  return {
    posts: [],
    likedPostIds: [],
    savedPostIds: [],
    hiddenPostIds: [],
    followedHandles: [],
    likedReplyIds: [],
    replies: {},
  }
}

export function readDemoFeedState() {
  const serialized = window.localStorage.getItem(storageKey)
  if (!serialized) return emptyDemoFeedState()

  const state = JSON.parse(serialized)
  if (
    !state ||
    !Array.isArray(state.posts) ||
    !Array.isArray(state.likedPostIds) ||
    !Array.isArray(state.savedPostIds) ||
    !Array.isArray(state.hiddenPostIds) ||
    !Array.isArray(state.followedHandles) ||
    !Array.isArray(state.likedReplyIds) ||
    !state.replies ||
    typeof state.replies !== 'object' ||
    Array.isArray(state.replies)
  ) {
    throw new Error('Saved demo feed data is invalid. Clear this browser’s iConnect demo data to continue.')
  }

  return { ...emptyDemoFeedState(), ...state }
}

export function writeDemoFeedState(state) {
  window.localStorage.setItem(storageKey, JSON.stringify(state))
}

export function addDemoPost(state, { name, email, text, image = null }) {
  const timestamp = Date.now()
  const handle = `@${email.split('@')[0].replace(/[^a-z0-9._]/gi, '').toLowerCase() || 'you'}`

  return {
    ...state,
    posts: [{
      id: `demo-${timestamp}`,
      name,
      handle,
      avatar: 'photo-1544005313-94ddf0286df2',
      location: 'Your iConnect feed',
      time: 'just now',
      text,
      image,
      likes: 0,
      comments: 0,
      tag: 'A little moment',
    }, ...state.posts],
  }
}
