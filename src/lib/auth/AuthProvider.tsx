import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { http, refreshSession } from '../api/client'
import { session, type AuthResponse, type MemorySession, type SessionIdentity } from './session'

interface AuthContextValue { session:MemorySession|null; restoringSession:boolean; identities:SessionIdentity[]; loadingIdentities:boolean; identityError:string; signingIn:boolean; devAuthEnabled:boolean; refreshIdentities:()=>Promise<void>; signIn:(email:string,password?:string)=>Promise<void>; signOut:()=>void; register:(email:string,password:string,displayName?:string)=>Promise<void> }
const AuthContext=createContext<AuthContextValue|null>(null)
const devAuthEnabled=import.meta.env.DEV
let restoreInFlight:Promise<boolean>|null=null
function acceptAuth(data:AuthResponse){if(!data?.accessToken||data.tokenType!=='Bearer'||!data.user?.id||!data.tenant?.id)throw new Error('Authentication response did not match the SitePilot contract.');session.setAuth(data)}
export function AuthProvider({children}:{children:ReactNode}){const qc=useQueryClient();const[current,setCurrent]=useState(session.getState());const[restoringSession,setRestoringSession]=useState(!session.getState());const[identityError,setIdentityError]=useState('');const[signingIn,setSigningIn]=useState(false)
 useEffect(()=>session.subscribe(value=>{setCurrent(value);if(!value)qc.clear()}),[qc])
 useEffect(()=>{if(!session.getState()){const task=refreshSession();restoreInFlight=task;void task.finally(()=>{if(restoreInFlight===task)restoreInFlight=null;setRestoringSession(false)})}else setRestoringSession(false)},[])
 useEffect(()=>{if(!current)return;const timer=window.setTimeout(()=>void refreshSession(),Math.max(0,current.expiresAt-Date.now()-30_000));return()=>window.clearTimeout(timer)},[current])
 const refreshIdentities=useCallback(async()=>{},[])
 const signIn=useCallback(async(email:string,password='')=>{setSigningIn(true);setIdentityError('');try{if(restoreInFlight)await restoreInFlight;const{data}=await http.post<AuthResponse>('/api/auth/login',{email,password},{withCredentials:true});acceptAuth(data)}catch(e){const msg=e instanceof Error?e.message:'Sign in failed.';setIdentityError(msg);throw e}finally{setSigningIn(false)}},[])
 const register=useCallback(async(email:string,password:string,displayName?:string)=>{setSigningIn(true);try{if(restoreInFlight)await restoreInFlight;const{data}=await http.post<AuthResponse>('/api/auth/register',{email,password,...(displayName?{displayName}:{})},{withCredentials:true});acceptAuth(data)}finally{setSigningIn(false)}},[])
 const signOut=useCallback(()=>{void http.post('/api/auth/logout',undefined,{withCredentials:true}).catch(()=>undefined).finally(()=>{session.clear();for(let i=sessionStorage.length-1;i>=0;i--){const key=sessionStorage.key(i);if(key?.startsWith('sitepilot:'))sessionStorage.removeItem(key)}})},[])
 const value=useMemo(()=>({session:current,restoringSession,identities:[],loadingIdentities:false,identityError,signingIn,devAuthEnabled,refreshIdentities,signIn,signOut,register}),[current,restoringSession,identityError,signingIn,refreshIdentities,signIn,signOut,register])
 return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
export function useAuth(){const value=useContext(AuthContext);if(!value)throw new Error('useAuth must be used inside AuthProvider');return value}
