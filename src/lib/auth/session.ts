export type TenantRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER' | 'READ_ONLY'
export interface AuthResponse { accessToken:string; tokenType:'Bearer'; expiresIn:number; user:{id:string}; tenant:{id:string;role:TenantRole} }
export interface SessionIdentity { id:string; label:string; tenantId:string; userId:string; groupId:string; role?:TenantRole }
export interface MemorySession { accessToken:string; expiresAt:number; identity:SessionIdentity }
let current:MemorySession|null=null
const subscribers=new Set<(value:MemorySession|null)=>void>()
function publish(){subscribers.forEach(listener=>listener(current))}
export const session={
 getState:()=>current,
 getAccessToken:()=>{if(current&&Date.now()>=current.expiresAt){current=null;publish()}return current?.accessToken??null},
 setAuth:(auth:AuthResponse)=>{current={accessToken:auth.accessToken,expiresAt:Date.now()+auth.expiresIn*1000,identity:{id:auth.user.id,label:auth.user.id,tenantId:auth.tenant.id,userId:auth.user.id,groupId:'',role:auth.tenant.role}};publish()},
 setSession:(value:MemorySession)=>{current=value;publish()},
 setAccessToken:(token:string|null)=>{if(!token){current=null;publish();return}current={accessToken:token,expiresAt:Date.now()+60_000,identity:{id:'test',label:'Test',tenantId:'',userId:'',groupId:''}};publish()},
 subscribe:(listener:(value:MemorySession|null)=>void)=>{subscribers.add(listener);return()=>{subscribers.delete(listener)}},
 clear:()=>{current=null;publish()},
}
