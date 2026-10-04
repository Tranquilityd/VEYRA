export async function authorizeSiteEntryTransition(fetchImpl=fetch){
 try{
  const response=await fetchImpl('/api/site-entry',{method:'GET',credentials:'same-origin',cache:'no-store'});
  if(!response?.ok)return false;
  const state=await response.json();
  return state?.verified===true&&Number.isFinite(Number(state.expiresAt))&&Number(state.expiresAt)>Date.now();
 }catch{return false;}
}
