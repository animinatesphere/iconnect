import React from 'react'
import { Link } from 'react-router-dom'
import iconnectLogo from '../iconnect-symbol-transparent.png'

export default function Brand({ className = '', to = '/' }) {
  return (
    <Link className={`brand ${className}`} to={to} aria-label="iConnect home">
      <img className="brand-symbol" src={iconnectLogo} alt="" />
      iconnect<span className="brand-period">.</span>
    </Link>
  )
}
