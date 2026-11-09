import {afterEach,describe,expect,it,vi} from 'vitest'
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {QueryClient,QueryClientProvider} from '@tanstack/react-query'
import {AuthProvider} from './AuthProvider'
import AccountAuthControls from './AccountAuthControls'
import {session} from './session'
import {http} from '../api/client'
const adapter=http.defaults.adapter
afterEach(()=>{cleanup();http.defaults.adapter=adapter;session.clear();vi.restoreAllMocks()})
describe('credential auth flow',()=>{
 it('submits credentials to backend, stores only access token in memory, then logs out with cookie credentials',async()=>{const calls:string[]=[];http.defaults.adapter=async config=>{calls.push(`${config.method} ${config.url}`);if(config.url==='/api/auth/login')return{data:{accessToken:'memory-access-token',tokenType:'Bearer',expiresIn:300,user:{id:'user-1'},tenant:{id:'tenant-1',role:'MEMBER'}},status:200,statusText:'OK',headers:{},config};return{data:'',status:204,statusText:'No Content',headers:{},config}};const qc=new QueryClient();render(<QueryClientProvider client={qc}><AuthProvider><AccountAuthControls/></AuthProvider></QueryClientProvider>);fireEvent.click(screen.getByText('Sign in',{selector:'summary'}));fireEvent.change(screen.getByLabelText('Email'),{target:{value:'dev@example.test'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'safe-password'}});fireEvent.click(screen.getByRole('button',{name:'Sign in'}));await waitFor(()=>expect(session.getAccessToken()).toBe('memory-access-token'));expect(session.getState()?.identity).toMatchObject({tenantId:'tenant-1',userId:'user-1',role:'MEMBER'});expect(sessionStorage.getItem('memory-access-token')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Sign out'}));await waitFor(()=>expect(session.getAccessToken()).toBeNull());expect(calls).toEqual(['post /api/auth/login','post /api/auth/logout']);qc.clear()})
 it('expires access tokens held in memory',()=>{session.setSession({accessToken:'expired',expiresAt:Date.now()-1,identity:{id:'u',label:'U',tenantId:'t',userId:'u',groupId:'',role:'MEMBER'}});expect(session.getAccessToken()).toBeNull()})
})
