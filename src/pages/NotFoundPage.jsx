import React from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import PageMeta from '../components/PageMeta.jsx'

export default function NotFoundPage() {
  return (
    <>
      <PageMeta title="Page not found" description="That iConnect page could not be found. Return home or explore the product." />
      <section className="not-found-page">
        <div className="not-found-number">404</div>
        <span className="section-kicker"><span>OOPS</span> THIS CORNER ISN'T HERE</span>
        <h1>Looks like a<br /><span className="serif-italic">wrong turn.</span></h1>
        <p>That page may have moved, or the link might be out of date.</p>
        <div className="not-found-actions">
          <Link className="button-primary" to="/"><ArrowLeft size={16} /> Go home</Link>
          <Link className="arrow-link" to="/product">Explore iConnect <span><ArrowRight size={17} /></span></Link>
        </div>
      </section>
    </>
  )
}
