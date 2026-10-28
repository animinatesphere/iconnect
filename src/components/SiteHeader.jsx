import React, { useState } from 'react'
import { ArrowRight, ArrowUpRight, Menu, X } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'
import Brand from './Brand.jsx'

const links = [
  { to: '/product', label: 'Product' },
  { to: '/communities', label: 'Communities' },
  { to: '/roadmap', label: 'Our approach' },
]

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false)

  function closeMenu() {
    setMenuOpen(false)
  }

  return (
    <header className="site-header">
      <nav className="nav-wrap mx-auto flex max-w-[1320px] items-center justify-between px-6 md:px-10 xl:px-14" aria-label="Main navigation">
        <Brand />
        <div className={`nav-links ${menuOpen ? 'nav-links-open' : ''}`}>
          {links.map(({ to, label }) => (
            <NavLink key={to} to={to} onClick={closeMenu} className={({ isActive }) => isActive ? 'nav-active' : ''}>
              {label}
            </NavLink>
          ))}
          <Link to="/app/login" onClick={closeMenu}>Log in</Link>
          <Link className="nav-mobile-cta" to="/app/onboarding" onClick={closeMenu}>Sign up <ArrowRight size={15} /></Link>
        </div>
        <div className="nav-auth-actions">
          <Link className="nav-login-link" to="/app/login">Log in</Link>
          <Link className="nav-cta" to="/app/onboarding">Sign up <ArrowUpRight size={15} /></Link>
        </div>
        <button className="menu-toggle" onClick={() => setMenuOpen((open) => !open)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen}>
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
      </nav>
    </header>
  )
}
