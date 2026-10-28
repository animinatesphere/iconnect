const profileKeys = {
  name: 'iconnect.demo.name',
  email: 'iconnect.demo.email',
  bio: 'iconnect.demo.bio',
  interests: 'iconnect.demo.interests',
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
    bio: window.localStorage.getItem(profileKeys.bio) ?? '',
    interests: interests ? interests.split('\n') : [],
  }
}

export function saveDemoProfile({ name, email, bio = '', interests = [] }) {
  window.localStorage.setItem(profileKeys.name, name.trim())
  window.localStorage.setItem(profileKeys.email, email.trim().toLowerCase())
  window.localStorage.setItem(profileKeys.bio, bio)
  window.localStorage.setItem(profileKeys.interests, interests.join('\n'))
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
