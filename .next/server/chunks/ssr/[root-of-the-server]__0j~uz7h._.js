module.exports=[111406,(a,b,c)=>{b.exports=a.x("better-sqlite3-bbe410e732a55b62",()=>require("better-sqlite3-bbe410e732a55b62"))},273196,(a,b,c)=>{"use strict";Object.defineProperty(c,"__esModule",{value:!0}),Object.defineProperty(c,"registerServerReference",{enumerable:!0,get:function(){return d.registerServerReference}});let d=a.r(907756)},322724,(a,b,c)=>{"use strict";function d(a){for(let b=0;b<a.length;b++){let c=a[b];if("function"!=typeof c)throw Object.defineProperty(Error(`A "use server" file can only export async functions, found ${typeof c}.
Read more: https://nextjs.org/docs/messages/invalid-use-server-value`),"__NEXT_ERROR_CODE",{value:"E352",enumerable:!1,configurable:!0})}}Object.defineProperty(c,"__esModule",{value:!0}),Object.defineProperty(c,"ensureServerEntryExports",{enumerable:!0,get:function(){return d}})},314499,a=>{"use strict";a.s(["cosineSimilarity",0,function(a,b){let c=0,d=0,e=0;for(let f=0;f<a.length;f++)c+=a[f]*b[f],d+=a[f]*a[f],e+=b[f]*b[f];return c/(Math.sqrt(d)*Math.sqrt(e))}])},426889,a=>{"use strict";var b=a.i(273196),c=a.i(640448),d=a.i(703103),e=a.i(322724);async function f(a){let b=a.trim();if(b.length<2)return[];try{return d.contentDb.all(c.sql`
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
        WHERE lessons_fts MATCH ${b}

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
        WHERE lesson_sections_fts MATCH ${b}

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
        WHERE concepts_fts MATCH ${b}
      )
      ORDER BY rank
      LIMIT 20
    `).map(a=>({resultType:a.result_type,title:a.title,snippet:a.snippet,rank:Math.abs(a.rank),lessonSlug:a.lesson_slug??null,lessonTitle:a.lesson_title??null}))}catch(a){return console.error("Search error:",a),[]}}(0,e.ensureServerEntryExports)([f]),(0,b.registerServerReference)(f,"40e0dc0faee56b26214fa914da31d11d0b64cbaef6",null);var g=a.i(754859);async function h(a){let b=await fetch(`${process.env.EMBED_URL||"http://localhost:9999"}/embed`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({input:a})});if(!b.ok){let a=await b.text();throw Error(`Embed server error (${b.status}): ${a}`)}return(await b.json()).data[0].embedding}var i=a.i(314499);let j=null,k=null;async function l(a){let b=a.trim();if(b.length<2)return[];let e=null;try{e=await h(b)}catch(a){console.warn("Embedding failed, falling back to FTS-only:",a)}if(!e)return m(b);try{let a=d.contentDb.all(c.sql`
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
      WHERE lessons_fts MATCH ${b}
      LIMIT 20
    `),f=(j||(j=d.contentDb.select({lessonId:g.lessonEmbeddings.lessonId,embedding:g.lessonEmbeddings.embedding}).from(g.lessonEmbeddings).all().map(a=>({lessonId:a.lessonId,vec:(0,g.deserializeEmbedding)(a.embedding)}))),j),h=new Map;for(let a of f){let b=(0,i.cosineSimilarity)(e,a.vec);b>.2&&h.set(a.lessonId,b)}let l=Math.max(...a.map(a=>Math.abs(a.rank)),1),m=new Map;for(let b of a){let a=Math.abs(b.rank)/l,c=h.get(b.lesson_id)??0,d=.3*a+.7*c;m.set(b.lesson_id,{slug:b.slug,title:b.title,categoryName:b.category_name,snippet:b.snippet,ftsRank:a,vectorSim:c,combined:d})}for(let[a,b]of h)if(!m.has(a)){let e=d.contentDb.all(c.sql`
          SELECT l.slug, l.title, c.name AS category_name
          FROM lessons l
          JOIN categories c ON c.id = l.category_id
          WHERE l.id = ${a}
        `)[0];e&&m.set(a,{slug:e.slug,title:e.title,categoryName:e.category_name,snippet:"",ftsRank:0,vectorSim:b,combined:.7*b})}let n=[];for(let a of m.values())n.push({resultType:"lesson",title:a.title,snippet:a.snippet,rank:a.combined,lessonSlug:a.slug,lessonTitle:a.title,similarity:a.vectorSim,ftsRank:a.ftsRank,combinedScore:a.combined});let o=(!k&&(k=d.contentDb.select({sectionId:g.sectionEmbeddings.sectionId,lessonId:g.sectionEmbeddings.lessonId,embedding:g.sectionEmbeddings.embedding}).from(g.sectionEmbeddings).all().map(a=>({sectionId:a.sectionId,lessonId:a.lessonId,vec:(0,g.deserializeEmbedding)(a.embedding)}))),k).map(a=>({...a,sim:(0,i.cosineSimilarity)(e,a.vec)})).filter(a=>a.sim>.3).sort((a,b)=>b.sim-a.sim).slice(0,10);if(o.length>0){let a=o.map(a=>a.sectionId),b=d.contentDb.all(c.sql`
        SELECT ls.id, ls.heading, l.slug AS lesson_slug, l.title AS lesson_title
        FROM lesson_sections ls
        JOIN lessons l ON l.id = ls.lesson_id
        WHERE ls.id IN (${c.sql.join(a.map(a=>c.sql`${a}`),c.sql`, `)})
      `),e=new Map(b.map(a=>[a.id,a]));for(let a of o){let b=e.get(a.sectionId);b&&n.push({resultType:"section",title:b.heading,snippet:"",rank:a.sim,lessonSlug:b.lesson_slug,lessonTitle:b.lesson_title,similarity:a.sim,ftsRank:0,combinedScore:a.sim})}}let p=new Map;for(let a of n.sort((a,b)=>b.combinedScore-a.combinedScore)){let b=`${a.resultType}-${a.title}-${a.lessonSlug}`;p.has(b)||p.set(b,a)}return[...p.values()].slice(0,15)}catch(a){return console.error("Deep search error:",a),m(b)}}async function m(a){try{return d.contentDb.all(c.sql`
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
        WHERE lessons_fts MATCH ${a}

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
        WHERE lesson_sections_fts MATCH ${a}
      )
      ORDER BY rank
      LIMIT 15
    `).map(a=>({resultType:a.result_type,title:a.title,snippet:a.snippet,rank:Math.abs(a.rank),lessonSlug:a.lesson_slug??null,lessonTitle:a.lesson_title??null,similarity:0,ftsRank:Math.abs(a.rank),combinedScore:Math.abs(a.rank)}))}catch(a){return console.error("FTS fallback error:",a),[]}}(0,e.ensureServerEntryExports)([l]),(0,b.registerServerReference)(l,"40824bcd11e20198d12eee4ffe5eafb7371b7cb571",null),a.s([],114548),a.i(114548),a.s(["40824bcd11e20198d12eee4ffe5eafb7371b7cb571",0,l,"40e0dc0faee56b26214fa914da31d11d0b64cbaef6",0,f],426889)}];

//# sourceMappingURL=%5Broot-of-the-server%5D__0j~uz7h._.js.map