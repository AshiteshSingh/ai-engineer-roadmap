module.exports=[658569,(e,t,s)=>{"use strict";t.exports=e.r(48770).vendored["react-rsc"].ReactServerDOMTurbopackServer},720349,(e,t,s)=>{"use strict";Object.defineProperty(s,"__esModule",{value:!0}),Object.defineProperty(s,"registerServerReference",{enumerable:!0,get:function(){return n.registerServerReference}});let n=e.r(658569)},1865,(e,t,s)=>{"use strict";function n(e){for(let t=0;t<e.length;t++){let s=e[t];if("function"!=typeof s)throw Object.defineProperty(Error(`A "use server" file can only export async functions, found ${typeof s}.
Read more: https://nextjs.org/docs/messages/invalid-use-server-value`),"__NEXT_ERROR_CODE",{value:"E352",enumerable:!1,configurable:!0})}}Object.defineProperty(s,"__esModule",{value:!0}),Object.defineProperty(s,"ensureServerEntryExports",{enumerable:!0,get:function(){return n}})},395679,e=>{"use strict";var t=e.i(832621),s=e.i(571943),n=e.i(511043),l=e.i(207928),r=e.i(878982),o=e.i(423782),i=e.i(747028),a=e.i(336322),c=e.i(546909),d=e.i(413297),u=e.i(432943),p=e.i(949312),f=e.i(625230),g=e.i(270231),h=e.i(227069),m=e.i(193695);e.i(218521);var _=e.i(616976),E=e.i(230050),R=e.i(934685),S=e.i(76870),b=e.i(664339),v=e.i(960795),y=e.i(720349),A=e.i(337935),O=e.i(1865);async function w(e){let t=e.trim();if(t.length<2)return[];try{return R.contentDb.all(A.sql`
      SELECT * FROM (
        SELECT
          'lesson' AS result_type,
          l.title,
          snippet(lessons_fts, 2, '**', '**', '...', 40) AS snippet,
          lessons_fts.rank AS rank,
          l.slug AS lesson_slug,
          l.title AS lesson_title
        FROM lessons_fts
        JOIN lessons l ON l.rowid = lessons_fts.rowid
        WHERE lessons_fts MATCH ${t}

        UNION ALL

        SELECT
          'section' AS result_type,
          ls.heading AS title,
          snippet(lesson_sections_fts, 1, '**', '**', '...', 40) AS snippet,
          lesson_sections_fts.rank AS rank,
          l.slug AS lesson_slug,
          l.title AS lesson_title
        FROM lesson_sections_fts
        JOIN lesson_sections ls ON ls.rowid = lesson_sections_fts.rowid
        JOIN lessons l ON l.id = ls.lesson_id
        WHERE lesson_sections_fts MATCH ${t}

        UNION ALL

        SELECT
          'concept' AS result_type,
          c.name AS title,
          snippet(concepts_fts, 1, '**', '**', '...', 40) AS snippet,
          concepts_fts.rank AS rank,
          NULL AS lesson_slug,
          NULL AS lesson_title
        FROM concepts_fts
        JOIN concepts c ON c.rowid = concepts_fts.rowid
        WHERE concepts_fts MATCH ${t}
      )
      ORDER BY rank
      LIMIT 20
    `).map(e=>({resultType:e.result_type,title:e.title,snippet:e.snippet,rank:Math.abs(e.rank),lessonSlug:e.lesson_slug??null,lessonTitle:e.lesson_title??null}))}catch(e){return console.error("Search error:",e),[]}}async function N(e){let t=await fetch(`${process.env.EMBED_URL||"http://localhost:9999"}/embed`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({input:e})});if(!t.ok){let e=await t.text();throw Error(`Embed server error (${t.status}): ${e}`)}return(await t.json()).data[0].embedding}function T(e,t){let s=0,n=0,l=0;for(let r=0;r<e.length;r++)s+=e[r]*t[r],n+=e[r]*e[r],l+=t[r]*t[r];return s/(Math.sqrt(n)*Math.sqrt(l))}(0,O.ensureServerEntryExports)([w]),(0,y.registerServerReference)(w,"40e0dc0faee56b26214fa914da31d11d0b64cbaef6",null);let M=null,C=null;async function I(e){let t=e.trim();if(t.length<2)return[];let s=null;try{s=await N(t)}catch(e){console.warn("Embedding failed, falling back to FTS-only:",e)}if(!s)return k(t);try{let e=R.contentDb.all(A.sql`
      SELECT
        l.id AS lesson_id,
        l.slug,
        l.title,
        c.name AS category_name,
        snippet(lessons_fts, 2, '**', '**', '...', 40) AS snippet,
        lessons_fts.rank AS rank
      FROM lessons_fts
      JOIN lessons l ON l.rowid = lessons_fts.rowid
      JOIN categories c ON c.id = l.category_id
      WHERE lessons_fts MATCH ${t}
      LIMIT 20
    `),n=(M||(M=R.contentDb.select({lessonId:S.lessonEmbeddings.lessonId,embedding:S.lessonEmbeddings.embedding}).from(S.lessonEmbeddings).all().map(e=>({lessonId:e.lessonId,vec:(0,S.deserializeEmbedding)(e.embedding)}))),M),l=new Map;for(let e of n){let t=T(s,e.vec);t>.2&&l.set(e.lessonId,t)}let r=Math.max(...e.map(e=>Math.abs(e.rank)),1),o=new Map;for(let t of e){let e=Math.abs(t.rank)/r,s=l.get(t.lesson_id)??0,n=.3*e+.7*s;o.set(t.lesson_id,{slug:t.slug,title:t.title,categoryName:t.category_name,snippet:t.snippet,ftsRank:e,vectorSim:s,combined:n})}for(let[e,t]of l)if(!o.has(e)){let s=R.contentDb.all(A.sql`
          SELECT l.slug, l.title, c.name AS category_name
          FROM lessons l
          JOIN categories c ON c.id = l.category_id
          WHERE l.id = ${e}
        `)[0];s&&o.set(e,{slug:s.slug,title:s.title,categoryName:s.category_name,snippet:"",ftsRank:0,vectorSim:t,combined:.7*t})}let i=[];for(let e of o.values())i.push({resultType:"lesson",title:e.title,snippet:e.snippet,rank:e.combined,lessonSlug:e.slug,lessonTitle:e.title,similarity:e.vectorSim,ftsRank:e.ftsRank,combinedScore:e.combined});let a=(!C&&(C=R.contentDb.select({sectionId:S.sectionEmbeddings.sectionId,lessonId:S.sectionEmbeddings.lessonId,embedding:S.sectionEmbeddings.embedding}).from(S.sectionEmbeddings).all().map(e=>({sectionId:e.sectionId,lessonId:e.lessonId,vec:(0,S.deserializeEmbedding)(e.embedding)}))),C).map(e=>({...e,sim:T(s,e.vec)})).filter(e=>e.sim>.3).sort((e,t)=>t.sim-e.sim).slice(0,10);if(a.length>0){let e=a.map(e=>e.sectionId),t=R.contentDb.all(A.sql`
        SELECT ls.id, ls.heading, l.slug AS lesson_slug, l.title AS lesson_title
        FROM lesson_sections ls
        JOIN lessons l ON l.id = ls.lesson_id
        WHERE ls.id IN (${A.sql.join(e.map(e=>A.sql`${e}`),A.sql`, `)})
      `),s=new Map(t.map(e=>[e.id,e]));for(let e of a){let t=s.get(e.sectionId);t&&i.push({resultType:"section",title:t.heading,snippet:"",rank:e.sim,lessonSlug:t.lesson_slug,lessonTitle:t.lesson_title,similarity:e.sim,ftsRank:0,combinedScore:e.sim})}}let c=new Map;for(let e of i.sort((e,t)=>t.combinedScore-e.combinedScore)){let t=`${e.resultType}-${e.title}-${e.lessonSlug}`;c.has(t)||c.set(t,e)}return[...c.values()].slice(0,15)}catch(e){return console.error("Deep search error:",e),k(t)}}async function k(e){try{return R.contentDb.all(A.sql`
      SELECT * FROM (
        SELECT
          'lesson' AS result_type,
          l.title,
          snippet(lessons_fts, 2, '**', '**', '...', 40) AS snippet,
          lessons_fts.rank AS rank,
          l.slug AS lesson_slug,
          l.title AS lesson_title
        FROM lessons_fts
        JOIN lessons l ON l.rowid = lessons_fts.rowid
        WHERE lessons_fts MATCH ${e}

        UNION ALL

        SELECT
          'section' AS result_type,
          ls.heading AS title,
          snippet(lesson_sections_fts, 1, '**', '**', '...', 40) AS snippet,
          lesson_sections_fts.rank AS rank,
          l.slug AS lesson_slug,
          l.title AS lesson_title
        FROM lesson_sections_fts
        JOIN lesson_sections ls ON ls.rowid = lesson_sections_fts.rowid
        JOIN lessons l ON l.id = ls.lesson_id
        WHERE lesson_sections_fts MATCH ${e}
      )
      ORDER BY rank
      LIMIT 15
    `).map(e=>({resultType:e.result_type,title:e.title,snippet:e.snippet,rank:Math.abs(e.rank),lessonSlug:e.lesson_slug??null,lessonTitle:e.lesson_title??null,similarity:0,ftsRank:Math.abs(e.rank),combinedScore:Math.abs(e.rank)}))}catch(e){return console.error("FTS fallback error:",e),[]}}(0,O.ensureServerEntryExports)([I]),(0,y.registerServerReference)(I,"40824bcd11e20198d12eee4ffe5eafb7371b7cb571",null);var x=e.i(338294);async function P(e){let t,s=await e.json(),n=s.message,l=s.thread_id||crypto.randomUUID();if(!n)return E.NextResponse.json({error:"message is required"},{status:400});let[r,o,i]=await Promise.all([R.contentDb.select({role:S.chatMessages.role,content:S.chatMessages.content}).from(S.chatMessages).where((0,b.eq)(S.chatMessages.threadId,l)).orderBy((0,v.asc)(S.chatMessages.createdAt)).limit(50).all(),w(n).catch(()=>[]),I(n).catch(()=>[])]),a=[];if(o.length>0)for(let e of o.slice(0,4)){let t=e.lessonTitle&&e.lessonTitle!==e.title?`[${e.lessonTitle} > ${e.title}]`:`[${e.title}]`;a.push(`${t}
${e.snippet}`)}if(i.length>0)for(let e of i.slice(0,4))a.some(t=>t.includes(e.title))||a.push(`[${e.title}] (relevance: ${(100*e.combinedScore).toFixed(0)}%)`);try{t=(await (0,x.chat)({message:n,history:r.map(e=>({role:e.role,content:e.content})),contextSnippets:a})).response}catch(e){return E.NextResponse.json({error:"LangGraph chat failed",details:e instanceof Error?e.message:String(e)},{status:502})}return R.contentDb.insert(S.chatMessages).values([{threadId:l,role:"user",content:n},{threadId:l,role:"assistant",content:t}]).run(),E.NextResponse.json({response:t,thread_id:l})}e.s(["POST",0,P],479897);var $=e.i(479897);let H=new t.AppRouteRouteModule({definition:{kind:s.RouteKind.APP_ROUTE,page:"/api/chat/route",pathname:"/api/chat",filename:"route",bundlePath:""},distDir:".next",relativeProjectDir:"",resolvedPagePath:"[project]/apps/ai-engineer-roadmap/app/api/chat/route.ts",nextConfigOutput:"",userland:$,...{}}),{workAsyncStorage:q,workUnitAsyncStorage:L,serverHooks:D}=H;async function U(e,t,n){n.requestMeta&&(0,l.setRequestMeta)(e,n.requestMeta),H.isDev&&(0,l.addRequestMeta)(e,"devRequestTimingInternalsEnd",process.hrtime.bigint());let E="/api/chat/route";E=E.replace(/\/index$/,"")||"/";let R=await H.prepare(e,t,{srcPage:E,multiZoneDraftMode:!1});if(!R)return t.statusCode=400,t.end("Bad Request"),null==n.waitUntil||n.waitUntil.call(n,Promise.resolve()),null;let{buildId:S,deploymentId:b,params:v,nextConfig:y,parsedUrl:A,isDraftMode:O,prerenderManifest:w,routerServerContext:N,isOnDemandRevalidate:T,revalidateOnlyGenerated:M,resolvedPathname:C,clientReferenceManifest:I,serverActionsManifest:k}=R,x=(0,i.normalizeAppPath)(E),P=!!(w.dynamicRoutes[x]||w.routes[C]),$=async()=>((null==N?void 0:N.render404)?await N.render404(e,t,A,!1):t.end("This page could not be found"),null);if(P&&!O){let e=!!w.routes[C],t=w.dynamicRoutes[x];if(t&&!1===t.fallback&&!e){if(y.adapterPath)return await $();throw new m.NoFallbackError}}let q=null;!P||H.isDev||O||(q="/index"===(q=C)?"/":q);let L=!0===H.isDev||!P,D=P&&!L;k&&I&&(0,o.setManifestsSingleton)({page:E,clientReferenceManifest:I,serverActionsManifest:k});let U=e.method||"GET",F=(0,r.getTracer)(),j=F.getActiveScopeSpan(),J=!!(null==N?void 0:N.isWrappedByNextServer),W=!!(0,l.getRequestMeta)(e,"minimalMode"),B=(0,l.getRequestMeta)(e,"incrementalCache")||await H.getIncrementalCache(e,y,w,W);null==B||B.resetRequestCache(),globalThis.__incrementalCache=B;let K={params:v,previewProps:w.preview,renderOpts:{experimental:{authInterrupts:!!y.experimental.authInterrupts},cacheComponents:!!y.cacheComponents,supportsDynamicResponse:L,incrementalCache:B,cacheLifeProfiles:y.cacheLife,waitUntil:n.waitUntil,onClose:e=>{t.on("close",e)},onAfterTaskError:void 0,onInstrumentationRequestError:(t,s,n,l)=>H.onRequestError(e,t,n,l,N)},sharedContext:{buildId:S,deploymentId:b}},G=new a.NodeNextRequest(e),X=new a.NodeNextResponse(t),z=c.NextRequestAdapter.fromNodeNextRequest(G,(0,c.signalFromNodeResponse)(t));try{let l,o=async e=>H.handle(z,K).finally(()=>{if(!e)return;e.setAttributes({"http.status_code":t.statusCode,"next.rsc":!1});let s=F.getRootSpanAttributes();if(!s)return;if(s.get("next.span_type")!==d.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${s.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let n=s.get("next.route");if(n){let t=`${U} ${n}`;e.setAttributes({"next.route":n,"http.route":n,"next.span_name":t}),e.updateName(t),l&&l!==e&&(l.setAttribute("http.route",n),l.updateName(t))}else e.updateName(`${U} ${E}`)}),i=async l=>{var r,i;let a=async({previousCacheEntry:s})=>{try{if(!W&&T&&M&&!s)return t.statusCode=404,t.setHeader("x-nextjs-cache","REVALIDATED"),t.end("This page could not be found"),null;let r=await o(l);e.fetchMetrics=K.renderOpts.fetchMetrics;let i=K.renderOpts.pendingWaitUntil;i&&n.waitUntil&&(n.waitUntil(i),i=void 0);let a=K.renderOpts.collectedTags;if(!P)return await (0,p.sendResponse)(G,X,r,K.renderOpts.pendingWaitUntil),null;{let e=await r.blob(),t=(0,f.toNodeOutgoingHttpHeaders)(r.headers);a&&(t[h.NEXT_CACHE_TAGS_HEADER]=a),!t["content-type"]&&e.type&&(t["content-type"]=e.type);let s=void 0!==K.renderOpts.collectedRevalidate&&!(K.renderOpts.collectedRevalidate>=h.INFINITE_CACHE)&&K.renderOpts.collectedRevalidate,n=void 0===K.renderOpts.collectedExpire||K.renderOpts.collectedExpire>=h.INFINITE_CACHE?void 0:K.renderOpts.collectedExpire;return{value:{kind:_.CachedRouteKind.APP_ROUTE,status:r.status,body:Buffer.from(await e.arrayBuffer()),headers:t},cacheControl:{revalidate:s,expire:n}}}}catch(t){throw(null==s?void 0:s.isStale)&&await H.onRequestError(e,t,{routerKind:"App Router",routePath:E,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:D,isOnDemandRevalidate:T})},!1,N),t}},c=await H.handleResponse({req:e,nextConfig:y,cacheKey:q,routeKind:s.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:w,isRoutePPREnabled:!1,isOnDemandRevalidate:T,revalidateOnlyGenerated:M,responseGenerator:a,waitUntil:n.waitUntil,isMinimalMode:W});if(!P)return null;if((null==c||null==(r=c.value)?void 0:r.kind)!==_.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==c||null==(i=c.value)?void 0:i.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});W||t.setHeader("x-nextjs-cache",T?"REVALIDATED":c.isMiss?"MISS":c.isStale?"STALE":"HIT"),O&&t.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let d=(0,f.fromNodeOutgoingHttpHeaders)(c.value.headers);return W&&P||d.delete(h.NEXT_CACHE_TAGS_HEADER),!c.cacheControl||t.getHeader("Cache-Control")||d.get("Cache-Control")||d.set("Cache-Control",(0,g.getCacheControlHeader)(c.cacheControl)),await (0,p.sendResponse)(G,X,new Response(c.value.body,{headers:d,status:c.value.status||200})),null};J&&j?await i(j):(l=F.getActiveScopeSpan(),await F.withPropagatedContext(e.headers,()=>F.trace(d.BaseServerSpan.handleRequest,{spanName:`${U} ${E}`,kind:r.SpanKind.SERVER,attributes:{"http.method":U,"http.target":e.url}},i),void 0,!J))}catch(t){if(t instanceof m.NoFallbackError||await H.onRequestError(e,t,{routerKind:"App Router",routePath:x,routeType:"route",revalidateReason:(0,u.getRevalidateReason)({isStaticGeneration:D,isOnDemandRevalidate:T})},!1,N),P)throw t;return await (0,p.sendResponse)(G,X,new Response(null,{status:500})),null}}e.s(["handler",0,U,"patchFetch",0,function(){return(0,n.patchFetch)({workAsyncStorage:q,workUnitAsyncStorage:L})},"routeModule",0,H,"serverHooks",0,D,"workAsyncStorage",0,q,"workUnitAsyncStorage",0,L],395679)}];

//# sourceMappingURL=10ye_next_dist_0u97ii9._.js.map