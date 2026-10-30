export class ApiError extends Error {
  constructor(message, code) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

export async function apiRequest(path, { headers, ...options } = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  })

  if (response.status === 204) return null

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new Error('The server returned an invalid response. Try again later.')
  }
  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message ?? 'The request could not be completed.',
      payload?.error?.code,
    )
  }
  return payload
}
