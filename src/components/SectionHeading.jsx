import React from 'react'

export default function SectionHeading({ number, eyebrow, title, emphasis, description, children }) {
  return (
    <div className="section-heading">
      <div>
        {number && <div className="section-kicker"><span>{number}</span> {eyebrow}</div>}
        <h1 className="page-title">
          {title}
          {emphasis && <><br /><span className="serif-italic">{emphasis}</span></>}
        </h1>
        {description && <p className="section-heading-description">{description}</p>}
      </div>
      {children}
    </div>
  )
}
