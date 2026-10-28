import React from 'react'

export default function Avatar({ person, className = '' }) {
  const image = person.image ?? person.avatar

  return (
    <img
      className={`avatar ${className}`}
      src={image ? `https://images.unsplash.com/${image}?auto=format&fit=crop&w=120&h=120&q=80` : undefined}
      alt={`${person.name}'s profile`}
      loading="lazy"
    />
  )
}
