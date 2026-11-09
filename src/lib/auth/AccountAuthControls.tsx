import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useAuth } from './AuthProvider'

export default function DevelopmentAuthControls() {
  const auth = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [registering, setRegistering] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError('')
    try {
      if (registering) await auth.register(email, password)
      else await auth.signIn(email, password)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Authentication failed.')
    }
  }

  return <>{auth.session ? <><span className="signed-in-label" title={`${auth.session.identity.tenantId} · ${auth.session.identity.role}`}>{auth.session.identity.label}<small>{auth.session.identity.role}</small></span><button className="auth-button" onClick={auth.signOut}>Sign out</button></> : <details className="auth-popover"><summary className="auth-button sign-in">Sign in</summary><section className="auth-dialog auth-inline"><span className="auth-dialog-mark"><ShieldCheck size={20}/></span><div className="eyebrow">SITEPILOT ACCOUNT</div><h2>{registering ? 'Create account' : 'Sign in'}</h2><form onSubmit={event => void submit(event)}><label htmlFor="sitepilot-email">Email</label><input id="sitepilot-email" type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)}/><label htmlFor="sitepilot-password">Password</label><div className="password-input-wrap"><input id="sitepilot-password" type={showPassword ? 'text' : 'password'} required minLength={registering ? 12 : 1} autoComplete={registering ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)}/><button type="button" className="password-visibility" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button primary auth-submit" disabled={auth.signingIn}>{auth.signingIn ? <><LoaderCircle className="spin" size={15}/> Please wait…</> : <>{registering ? 'Create account' : 'Sign in'} <ArrowRight size={15}/></>}</button></form><button className="text-link" type="button" onClick={() => { setRegistering(!registering); setError('') }}>{registering ? 'Already have an account? Sign in' : 'Create an account'}</button><small>Access tokens stay in memory. Refresh tokens are held by the backend in an HttpOnly cookie.</small></section></details>}</>
}
