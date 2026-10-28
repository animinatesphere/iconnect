import React from 'react'
import PageMeta from './PageMeta.jsx'

export default function AppPageHeader({ eyebrow, title, description, children }) {
  return (
    <>
      <PageMeta title={title} description={description ?? `Explore ${title} in the iConnect product preview.`} />
      <div className="app-page-header">
        <div>
          <span className="app-page-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          {description && <p>{description}</p>}
        </div>
        {children && <div className="app-page-header-actions">{children}</div>}
      </div>
    </>
  )
}
