// R2 notification preview privacy is server-authoritative.
//
// The worker resolves the account-backed preference at Web Push delivery time and emits only
// content-free routing types. Keeping a browser-global service-worker mirror would allow one
// account's preference to affect another account that later uses the same browser.
//
// This module remains as a historical import boundary only so stale branches fail clearly if they
// try to restore the removed local-mirror API.
export {};
