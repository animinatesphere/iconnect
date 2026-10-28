import React from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import Brand from './Brand.jsx'

export default function SiteFooter() {
  return (
    <footer className="footer mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-5 px-6 py-6 md:px-10 xl:px-14">
      <Brand className="footer-brand" />
      <span className="footer-note">Made for humans, by humans <span>♡</span></span>
      <div className="footer-links">
        <Link to="/product">Product</Link>
        <Link to="/roadmap">Roadmap</Link>
        <Link to="/early-access">Get updates <ArrowUpRight size={12} /></Link>
        <span>© {new Date().getFullYear()} iConnect</span>
      </div>
    </footer>
  )
}
