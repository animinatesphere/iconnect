import { useEffect } from 'react'

const SITE_URL = 'https://www.iconnectdworld.com'

function setMeta(selector, attribute, key, value) {
  let element = document.head.querySelector(selector)
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.setAttribute('content', value)
}

// Keeps the title, description, canonical URL and share tags in step with the
// current page, so each public page is indexed and shared with its own details.
export default function PageMeta({ title, description }) {
  useEffect(() => {
    const fullTitle = `${title} | iConnect`
    const url = SITE_URL + (window.location.pathname === '/' ? '/' : window.location.pathname.replace(/\/$/, ''))
    document.title = fullTitle
    setMeta('meta[name="description"]', 'name', 'description', description)
    setMeta('meta[property="og:title"]', 'property', 'og:title', fullTitle)
    setMeta('meta[property="og:description"]', 'property', 'og:description', description)
    setMeta('meta[property="og:url"]', 'property', 'og:url', url)
    setMeta('meta[name="twitter:title"]', 'name', 'twitter:title', fullTitle)
    setMeta('meta[name="twitter:description"]', 'name', 'twitter:description', description)
    let canonical = document.head.querySelector('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.setAttribute('rel', 'canonical')
      document.head.appendChild(canonical)
    }
    canonical.setAttribute('href', url)
  }, [title, description])

  return null
}
