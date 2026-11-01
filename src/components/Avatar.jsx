import React from 'react'

export default function Avatar({ person, className = '' }) {
  const image = person.image ?? person.avatar
  const source = image?.startsWith('data:')
    ? image
    : image?.startsWith('/') || image?.startsWith('https://')
      ? image
      : image ? `https://images.unsplash.com/${image}?auto=format&fit=crop&w=120&h=120&q=80` : undefined

  return (
    <img
      className={`avatar ${className}`}
      src={source}
      alt={`${person.name}'s profile`}
      loading="lazy"
    />
  )
}
