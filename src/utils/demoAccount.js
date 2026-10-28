const profileKeys = {
  name: 'iconnect.demo.name',
  email: 'iconnect.demo.email',
  username: 'iconnect.demo.username',
  bio: 'iconnect.demo.bio',
  avatar: 'iconnect.demo.avatar',
  interests: 'iconnect.demo.interests',
  preferences: 'iconnect.demo.preferences',
  session: 'iconnect.demo.session',
}

export const demoAvatar = 'photo-1544005313-94ddf0286df2'

export function getDemoProfile() {
  const name = window.localStorage.getItem(profileKeys.name)
  const email = window.localStorage.getItem(profileKeys.email)

  if (!name || !email) return null

  const interests = window.localStorage.getItem(profileKeys.interests)

  return {
    name,
    email,
    username: window.localStorage.getItem(profileKeys.username) ?? email.split('@')[0],
    bio: window.localStorage.getItem(profileKeys.bio) ?? '',
    avatar: window.localStorage.getItem(profileKeys.avatar) ?? demoAvatar,
    interests: interests ? interests.split('\n') : [],
  }
}

export function saveDemoProfile({ name, email, username, bio = '', interests = [], avatar = demoAvatar }) {
  window.localStorage.setItem(profileKeys.name, name.trim())
  window.localStorage.setItem(profileKeys.email, email.trim().toLowerCase())
  window.localStorage.setItem(profileKeys.username, (username ?? email.split('@')[0]).trim().replace(/^@/, ''))
  window.localStorage.setItem(profileKeys.bio, bio)
  window.localStorage.setItem(profileKeys.avatar, avatar)
  window.localStorage.setItem(profileKeys.interests, interests.join('\n'))
}

export function getDemoPreferences() {
  const saved = window.localStorage.getItem(profileKeys.preferences)
  return saved ? JSON.parse(saved) : { notifications: true, profileVisible: true, discoverable: true }
}

export function saveDemoPreferences(preferences) {
  window.localStorage.setItem(profileKeys.preferences, JSON.stringify(preferences))
}

export function startDemoSession() {
  window.localStorage.setItem(profileKeys.session, 'active')
}

export function endDemoSession() {
  window.localStorage.removeItem(profileKeys.session)
}

export function isDemoSessionActive() {
  return window.localStorage.getItem(profileKeys.session) === 'active'
}
