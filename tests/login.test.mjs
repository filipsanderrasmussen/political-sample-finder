import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {issueSession,validSession} from "../src/worker.js";

test("persistent login cookie is signed, HttpOnly and expires after 30 days",async()=>{
  const env={APP_PASSWORD:"a-long-private-secret-kept-in-cloudflare"};
  const cookie=await issueSession(env);
  assert.match(cookie,/^psf_session=v1\.\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64};/);
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/Secure/);
  assert.match(cookie,/SameSite=Strict/);
  assert.match(cookie,/Max-Age=2592000/);
  const value=cookie.split(";")[0];
  const request=new Request("https://example.org/api/session",{headers:{"Cookie":value}});
  assert.equal(await validSession(request,env),true);
  assert.equal(await validSession(request,{APP_PASSWORD:"a-different-secret-from-cloudflare"}),false);
  const tampered=value.replace(/.$/,c=>c==="a"?"b":"a");
  assert.equal(await validSession(new Request("https://example.org/api/session",{headers:{Cookie:tampered}}),env),false);
});

test("browser does not store the admin password",()=>{
 const s=readFileSync("public/app.js","utf8");
 assert.doesNotMatch(s,/sessionStorage\.setItem\(["']psf\.admin/);
 assert.doesNotMatch(s,/localStorage\.setItem\(["']psf\.admin/);
 assert.match(s,/api\/session/);
 assert.match(s,/api\/login/);
 assert.match(s,/adminLoginBtn/);
});

test("archive uses a single automatic status overview",()=>{
 const html=readFileSync("public/index.html","utf8");
 assert.match(html,/id="advancedImport"/);
 assert.match(html,/Manuel import og fejlfinding/);
 assert.match(html,/id="archiveState"/);
 assert.match(html,/id="adminLogoutBtn"/);
});
