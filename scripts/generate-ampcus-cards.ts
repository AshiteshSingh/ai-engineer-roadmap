/**
 * Generate memorize flashcards for the Ampcus Full Stack Engineer – AI application.
 * Usage: pnpm tsx --env-file=.env.local scripts/generate-ampcus-cards.ts
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema";

const APP_ID = "73eea627-35b8-4f71-a209-a250df2fe591";

const db = drizzle(neon(process.env.DATABASE_URL!), { schema });

interface Item {
  id: string;
  term: string;
  description: string;
  details: { label: string; description: string }[];
  context?: string;
  relatedItems: string[];
  mnemonicHint?: string;
}

interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  items: Item[];
}

const categories: Category[] = [
  // ─── Frontend Frameworks ──────────────────────────────────────
  {
    id: "frontend-frameworks",
    name: "Frontend Frameworks",
    icon: "layout",
    color: "violet",
    items: [
      // React.js (primary — 8)
      {
        id: "react-virtual-dom",
        term: "Virtual DOM & Reconciliation",
        description:
          "React maintains a lightweight in-memory representation of the UI. On state change it diffs the new virtual tree against the previous one and batches the minimal set of real DOM mutations.",
        details: [
          { label: "Fiber", description: "Internal reconciliation engine that enables incremental rendering and priority-based scheduling" },
          { label: "Diffing heuristic", description: "O(n) tree diff assuming elements of different types produce different trees and keys identify stable children" },
          { label: "Batching", description: "Multiple setState calls within the same event handler are batched into a single re-render" },
        ],
        context: "Interviewers test whether you understand why React is fast and where it can be slow.",
        relatedItems: ["react-keys-lists"],
        mnemonicHint: "Virtual = blueprint, Reconciliation = comparing blueprints to find what changed.",
      },
      {
        id: "react-hooks-state",
        term: "useState & useReducer",
        description:
          "useState provides local component state as a [value, setter] pair. useReducer offers Redux-like dispatch for complex state transitions with an explicit reducer function.",
        details: [
          { label: "Lazy initializer", description: "Pass a function to useState(() => expensive()) to run it only on mount" },
          { label: "Functional updates", description: "setState(prev => prev + 1) ensures correct value when updates depend on previous state" },
          { label: "useReducer", description: "Best when next state depends on previous state plus an action type — keeps logic testable outside the component" },
          { label: "Stale closures", description: "Callbacks capture state at render time; functional updates or refs avoid reading stale values" },
        ],
        context: "Expect to be asked when to choose useReducer over useState and how to avoid stale-closure bugs.",
        relatedItems: ["react-memoization"],
        mnemonicHint: "useState = simple toggle, useReducer = state machine.",
      },
      {
        id: "react-effects",
        term: "useEffect & Lifecycle",
        description:
          "useEffect synchronizes a component with external systems (APIs, subscriptions, DOM). It runs after paint and its cleanup runs before the next effect or on unmount.",
        details: [
          { label: "Dependency array", description: "Controls when the effect re-runs; empty array = mount only, omitted = every render" },
          { label: "Cleanup function", description: "Returned function runs before re-execution and on unmount — essential for subscriptions and timers" },
          { label: "Strict Mode double-fire", description: "React 18 mounts, unmounts, then re-mounts in dev to surface missing cleanups" },
          { label: "useLayoutEffect", description: "Fires synchronously after DOM mutations but before paint — use for measuring layout" },
        ],
        context: "You'll be asked to debug infinite loops, race conditions, and missing cleanups in effects.",
        relatedItems: ["react-hooks-state"],
        mnemonicHint: "Effect = side quest after render. Cleanup = cancel the quest before starting a new one.",
      },
      {
        id: "react-memoization",
        term: "React.memo, useMemo & useCallback",
        description:
          "Performance primitives that skip unnecessary work. React.memo skips re-render if props are shallow-equal. useMemo caches computed values. useCallback caches function references.",
        details: [
          { label: "React.memo", description: "HOC that shallow-compares props; accepts custom comparator as second argument" },
          { label: "useMemo", description: "Caches expensive computation result; recalculates only when dependencies change" },
          { label: "useCallback", description: "Caches a function identity — critical when passing callbacks to memoized children" },
          { label: "Over-memoization", description: "Memoizing cheap operations adds overhead without benefit — profile before optimizing" },
        ],
        context: "Interviewers want to see you know when memoization helps vs. when it's premature optimization.",
        relatedItems: ["react-hooks-state", "react-virtual-dom"],
        mnemonicHint: "memo = skip re-render, useMemo = skip re-compute, useCallback = skip re-create function.",
      },
      {
        id: "react-context",
        term: "Context API",
        description:
          "React Context provides a way to pass data through the component tree without prop drilling. createContext defines a Provider that makes a value available to all descendants.",
        details: [
          { label: "Re-render scope", description: "All consumers re-render when context value changes — split contexts to limit blast radius" },
          { label: "useContext", description: "Hook that subscribes to the nearest Provider above in the tree" },
          { label: "Composition alternative", description: "Component composition (passing children/render props) often solves prop drilling without context overhead" },
        ],
        context: "Expect follow-ups on context performance pitfalls and when to reach for external state management.",
        relatedItems: ["react-hooks-state"],
        mnemonicHint: "Context = global variable for a subtree. Too broad a context = too many re-renders.",
      },
      {
        id: "react-error-boundaries",
        term: "Error Boundaries",
        description:
          "Class components that catch JavaScript errors in their child tree during rendering, lifecycle methods, and constructors. They display a fallback UI instead of crashing the whole app.",
        details: [
          { label: "getDerivedStateFromError", description: "Static method that updates state to render fallback UI on error" },
          { label: "componentDidCatch", description: "Instance method for logging errors to a reporting service" },
          { label: "Limitations", description: "Cannot catch errors in event handlers, async code, or server-side rendering" },
        ],
        context: "Tested in system design discussions about resilient UI and graceful degradation.",
        relatedItems: ["react-suspense"],
        mnemonicHint: "Error boundary = try/catch for your component tree.",
      },
      {
        id: "react-suspense",
        term: "Suspense & Lazy Loading",
        description:
          "Suspense lets components declaratively wait for async data or code. React.lazy enables code-splitting by loading components on demand with dynamic import().",
        details: [
          { label: "React.lazy", description: "Wraps dynamic import() to create a lazily-loaded component" },
          { label: "Suspense fallback", description: "Shows a loading UI while the lazy component or data source resolves" },
          { label: "Concurrent features", description: "In React 18+, Suspense integrates with startTransition to avoid blocking the UI" },
        ],
        context: "Expect questions on code-splitting strategy and how Suspense changes data fetching patterns.",
        relatedItems: ["react-error-boundaries", "nextjs-server-client"],
        mnemonicHint: "Suspense = 'hold on, loading…' boundary. Lazy = 'don't load until needed.'",
      },
      {
        id: "react-keys-lists",
        term: "Keys & List Rendering",
        description:
          "Keys help React identify which items in a list changed, were added, or removed. A stable, unique key allows the reconciler to reuse existing DOM nodes efficiently.",
        details: [
          { label: "Stable keys", description: "Use unique IDs from data, not array indices, to preserve component state across reorders" },
          { label: "Index as key", description: "Only safe when the list is static, never reordered, and has no component state" },
          { label: "Key reset trick", description: "Changing a component's key forces React to unmount and remount it — useful for resetting state" },
        ],
        context: "A classic interview question: 'What happens if you use array index as key with a reorderable list?'",
        relatedItems: ["react-virtual-dom"],
        mnemonicHint: "Key = name tag at a party. Wrong name tag = React can't tell who moved.",
      },
      // Next.js (primary — 8)
      {
        id: "nextjs-app-router",
        term: "App Router vs Pages Router",
        description:
          "Next.js 13+ introduced the App Router (app/ directory) with React Server Components, nested layouts, and streaming. The Pages Router (pages/) remains supported but uses client-only rendering by default.",
        details: [
          { label: "app/ directory", description: "File-system routing with layout.tsx, page.tsx, loading.tsx, error.tsx conventions" },
          { label: "Nested layouts", description: "Layouts persist across navigations and don't re-render — ideal for shells, navbars, sidebars" },
          { label: "Migration", description: "Both routers can coexist during incremental migration" },
        ],
        context: "Interviewers assess whether you understand the architectural shift and when the App Router is advantageous.",
        relatedItems: ["nextjs-server-client"],
        mnemonicHint: "App Router = layouts + server components. Pages Router = getServerSideProps era.",
      },
      {
        id: "nextjs-server-client",
        term: "Server Components vs Client Components",
        description:
          "Server Components render on the server and send zero JS to the client. Client Components (marked with 'use client') hydrate in the browser and support interactivity, hooks, and browser APIs.",
        details: [
          { label: "Default is Server", description: "Every component in app/ is a Server Component unless it has 'use client' at the top" },
          { label: "Serialization boundary", description: "Props passed from Server to Client components must be serializable (no functions, classes)" },
          { label: "Composition pattern", description: "Keep interactive leaves as Client Components; pass server-fetched data down as props" },
          { label: "Bundle size", description: "Server Components eliminate their JS from the client bundle entirely" },
        ],
        context: "Core Next.js 14+ concept — expect to design a page that mixes both types efficiently.",
        relatedItems: ["nextjs-app-router", "nextjs-rendering"],
        mnemonicHint: "Server = no JS shipped. Client = hydrated, interactive. Boundary = 'use client'.",
      },
      {
        id: "nextjs-rendering",
        term: "Static vs Dynamic Rendering",
        description:
          "Next.js decides at build time whether a route is static (pre-rendered HTML) or dynamic (rendered per-request). Using cookies(), headers(), or searchParams opts into dynamic rendering.",
        details: [
          { label: "Static (SSG)", description: "Default when no dynamic APIs are used; pages are cached at the CDN edge" },
          { label: "Dynamic (SSR)", description: "Triggered by reading request-specific data like cookies or search params" },
          { label: "ISR", description: "Incremental Static Regeneration revalidates cached pages on a time interval via revalidate option" },
          { label: "generateStaticParams", description: "Pre-renders dynamic route segments at build time for static generation" },
        ],
        context: "System design questions often ask you to choose the right rendering strategy for different page types.",
        relatedItems: ["nextjs-app-router", "nextjs-data-fetching"],
        mnemonicHint: "Static = baked at build. Dynamic = cooked per request. ISR = rebake on a timer.",
      },
      {
        id: "nextjs-route-handlers",
        term: "Route Handlers (API Routes)",
        description:
          "Files named route.ts in the app/ directory export HTTP method handlers (GET, POST, PUT, DELETE). They replace the pages/api/ pattern and support streaming, Web API Request/Response.",
        details: [
          { label: "HTTP methods", description: "Export named functions: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS" },
          { label: "Request/Response", description: "Use standard Web API Request object and NextResponse for headers, cookies, redirects" },
          { label: "Caching", description: "GET handlers are cached by default unless they read request data or use dynamic APIs" },
        ],
        context: "Expect to build a simple CRUD API using route handlers during a live coding interview.",
        relatedItems: ["nextjs-app-router", "rest-http-methods"],
        mnemonicHint: "route.ts = API endpoint. Export the HTTP verb you want to handle.",
      },
      {
        id: "nextjs-middleware",
        term: "Next.js Middleware",
        description:
          "Middleware runs before a request is completed, allowing you to rewrite, redirect, modify headers, or set cookies. It executes at the edge and applies to matched routes via a config matcher.",
        details: [
          { label: "middleware.ts", description: "Must be placed at the project root (next to app/); runs on every matched request" },
          { label: "Matcher config", description: "Use config.matcher to limit middleware to specific paths" },
          { label: "Edge runtime", description: "Runs in V8 isolates — no Node.js APIs, smaller subset of available modules" },
        ],
        context: "Common in auth flows and i18n — expect to implement an auth redirect in middleware.",
        relatedItems: ["nextjs-route-handlers"],
        mnemonicHint: "Middleware = bouncer at the door. Checks credentials before the page loads.",
      },
      {
        id: "nextjs-image-opt",
        term: "Image Optimization",
        description:
          "The next/image component automatically optimizes images: lazy loading, responsive sizing, format conversion (WebP/AVIF), and blur placeholders. Images are served through a built-in optimization API.",
        details: [
          { label: "width & height", description: "Required for remote images to prevent layout shift (CLS)" },
          { label: "fill prop", description: "Makes the image fill its parent container — useful when dimensions are unknown" },
          { label: "priority", description: "Disables lazy loading for above-the-fold images (LCP optimization)" },
        ],
        context: "Performance-focused interviews test your knowledge of Core Web Vitals and image optimization strategies.",
        relatedItems: ["nextjs-rendering"],
        mnemonicHint: "next/image = automatic WebP + lazy load + resize. Always set width/height or fill.",
      },
      {
        id: "nextjs-data-fetching",
        term: "Data Fetching & Caching",
        description:
          "In the App Router, data is fetched directly in Server Components using async/await. Next.js extends fetch() with caching and revalidation options (force-cache, no-store, next.revalidate).",
        details: [
          { label: "fetch cache", description: "Default is force-cache (static); use { cache: 'no-store' } for dynamic data" },
          { label: "Revalidation", description: "Time-based: { next: { revalidate: 60 } }. On-demand: revalidatePath() or revalidateTag()" },
          { label: "Parallel fetching", description: "Use Promise.all to fetch independent data sources in parallel, avoiding waterfalls" },
        ],
        context: "Expect to design a data fetching strategy that balances freshness with performance.",
        relatedItems: ["nextjs-rendering", "nextjs-server-client"],
        mnemonicHint: "fetch in Server Component = automatic caching. no-store = always fresh.",
      },
      {
        id: "nextjs-parallel-routes",
        term: "Parallel & Intercepting Routes",
        description:
          "Parallel routes (@slot) render multiple pages in the same layout simultaneously. Intercepting routes ((.)) catch navigations to show content in a different context (e.g., modal over feed).",
        details: [
          { label: "@slot convention", description: "Folders prefixed with @ create named slots rendered in parallel within a layout" },
          { label: "Intercepting (.) (..) (...)", description: "Relative path conventions that intercept navigation to render in the current layout" },
          { label: "Modal pattern", description: "Instagram-style: click photo in grid → modal overlay; direct URL → full page" },
        ],
        context: "Advanced Next.js feature — demonstrates deep framework knowledge in senior interviews.",
        relatedItems: ["nextjs-app-router"],
        mnemonicHint: "Parallel = multiple pages side by side. Intercept = hijack navigation for modals.",
      },
      // Svelte (primary — 8)
      {
        id: "svelte-reactivity",
        term: "Svelte Reactivity System",
        description:
          "Svelte's compiler turns reactive declarations into efficient imperative code. In Svelte 4, $: labels mark reactive statements. Svelte 5 introduces runes ($state, $derived, $effect) for fine-grained reactivity.",
        details: [
          { label: "$: reactive", description: "Svelte 4: any top-level $: statement re-runs when its dependencies change" },
          { label: "$state rune", description: "Svelte 5: declares reactive state with proxy-based fine-grained tracking" },
          { label: "$derived", description: "Svelte 5: computed values that automatically update when dependencies change" },
          { label: "Compile-time", description: "No virtual DOM — the compiler generates direct DOM update instructions" },
        ],
        context: "Interviewers compare Svelte's compile-time reactivity with React's runtime approach.",
        relatedItems: ["svelte-stores"],
        mnemonicHint: "Svelte compiles reactivity away. No runtime diffing — just surgical DOM updates.",
      },
      {
        id: "svelte-lifecycle",
        term: "Svelte Component Lifecycle",
        description:
          "Svelte components have onMount, onDestroy, beforeUpdate, and afterUpdate lifecycle functions. onMount is the most common — it runs after the component is first rendered to the DOM.",
        details: [
          { label: "onMount", description: "Runs after initial render; return a function for cleanup (like useEffect cleanup)" },
          { label: "onDestroy", description: "Runs when the component is removed from the DOM" },
          { label: "tick()", description: "Returns a promise that resolves after pending state changes are applied to the DOM" },
        ],
        context: "Compared with React's useEffect — know the differences in timing and mental model.",
        relatedItems: ["svelte-reactivity"],
        mnemonicHint: "onMount = component born. onDestroy = component dies. tick = wait for DOM update.",
      },
      {
        id: "svelte-stores",
        term: "Svelte Stores",
        description:
          "Stores are reactive containers for shared state. writable stores allow read/write, readable stores are read-only, and derived stores compute values from other stores.",
        details: [
          { label: "writable()", description: "Creates a store with set() and update() methods" },
          { label: "$ auto-subscription", description: "Prefix a store with $ in templates for automatic subscription and cleanup" },
          { label: "derived()", description: "Creates a computed store from one or more source stores" },
          { label: "Custom stores", description: "Any object with a subscribe method is a valid store — enables encapsulated logic" },
        ],
        context: "Key differentiator from React — no context wrappers or external libraries needed for shared state.",
        relatedItems: ["svelte-reactivity"],
        mnemonicHint: "$store = auto-subscribe in template. writable = read+write, readable = read-only.",
      },
      {
        id: "svelte-actions",
        term: "Svelte Actions",
        description:
          "Actions are functions applied to DOM elements via the use: directive. They run when the element is created and can return an update/destroy lifecycle for cleanup.",
        details: [
          { label: "use:action", description: "Directive syntax that attaches imperative behavior to a DOM element" },
          { label: "Parameters", description: "Actions receive the element and optional parameters; update() is called when params change" },
          { label: "Common uses", description: "Click-outside detection, tooltips, focus traps, intersection observers" },
        ],
        context: "Shows deep Svelte knowledge — actions are the idiomatic way to wrap imperative DOM libraries.",
        relatedItems: ["svelte-lifecycle"],
        mnemonicHint: "use:action = jQuery plugin for Svelte. Attach behavior, clean up on destroy.",
      },
      {
        id: "svelte-transitions",
        term: "Transitions & Animations",
        description:
          "Svelte provides built-in transition directives (transition:, in:, out:) that animate elements as they enter/leave the DOM. Custom transitions return CSS or tick functions.",
        details: [
          { label: "transition:fade", description: "Built-in transitions: fade, slide, scale, fly, draw, blur, crossfade" },
          { label: "in: / out:", description: "Separate enter and exit transitions for asymmetric animations" },
          { label: "animate:flip", description: "Animates list items when they change position (keyed each blocks)" },
        ],
        context: "Distinguishes Svelte's declarative animation from React's library-dependent approach.",
        relatedItems: ["svelte-reactivity"],
        mnemonicHint: "transition: = appear/disappear animation. animate: = movement within a list.",
      },
      {
        id: "svelte-slots",
        term: "Slots & Component Composition",
        description:
          "Slots allow parent components to inject content into child component templates. Named slots target specific insertion points. Slot props enable render-prop-like patterns.",
        details: [
          { label: "Default slot", description: "<slot /> renders whatever the parent passes between component tags" },
          { label: "Named slots", description: "<slot name='header' /> with parent using slot='header' attribute" },
          { label: "Slot props", description: "<slot {item} /> exposes data back to the parent via let:item directive" },
        ],
        context: "Compared with React's children prop and render props pattern.",
        relatedItems: ["svelte-actions"],
        mnemonicHint: "Slot = hole in a template that the parent fills. Named slot = labeled hole.",
      },
      {
        id: "svelte-events",
        term: "Event Dispatching",
        description:
          "Svelte components communicate upward using createEventDispatcher or callback props. Events bubble through the DOM and can be forwarded with on:event without a handler.",
        details: [
          { label: "createEventDispatcher", description: "Creates a dispatch function to fire custom events with optional detail payload" },
          { label: "Event forwarding", description: "on:click without a handler forwards the event to the parent component" },
          { label: "Event modifiers", description: "on:click|preventDefault|once — chainable modifiers for common patterns" },
        ],
        context: "Child-to-parent communication pattern — compared with React's callback props.",
        relatedItems: ["svelte-slots"],
        mnemonicHint: "dispatch('event', data) = emit up. on:click|once = handle once then stop.",
      },
      {
        id: "svelte-compiler",
        term: "Compiler-Based Approach",
        description:
          "Svelte is a compiler, not a runtime framework. It compiles .svelte files into optimized vanilla JavaScript at build time, eliminating the need for a virtual DOM diffing runtime.",
        details: [
          { label: "No runtime overhead", description: "Generated code directly manipulates the DOM — no framework runtime shipped to the browser" },
          { label: "Small bundles", description: "Compiled output only includes code for features actually used in the component" },
          { label: "Scoped CSS", description: "Styles in <style> blocks are automatically scoped to the component via generated class names" },
        ],
        context: "Fundamental architectural distinction — interviewers test whether you understand the tradeoffs vs. React.",
        relatedItems: ["svelte-reactivity"],
        mnemonicHint: "Svelte = disappearing framework. At runtime, it's just vanilla JS.",
      },
      // SvelteKit (secondary — 4)
      {
        id: "sveltekit-routing",
        term: "SvelteKit File-Based Routing",
        description:
          "SvelteKit uses the filesystem for routing: src/routes/about/+page.svelte maps to /about. Dynamic segments use [param], optional segments [[param]], and rest parameters [...rest].",
        details: [
          { label: "+page.svelte", description: "The UI component for a route" },
          { label: "+layout.svelte", description: "Persistent layout wrapping child routes — doesn't re-render on navigation" },
          { label: "(group)", description: "Parenthesized folders group routes without affecting the URL path" },
        ],
        context: "Compared with Next.js file-based routing — know the conventions for both.",
        relatedItems: ["nextjs-app-router"],
        mnemonicHint: "+page = the page. +layout = the frame. [param] = dynamic. (group) = invisible folder.",
      },
      {
        id: "sveltekit-load",
        term: "Load Functions",
        description:
          "SvelteKit load functions fetch data for pages before rendering. +page.server.ts runs only on the server (DB access, secrets). +page.ts runs on both server and client (universal).",
        details: [
          { label: "Server load", description: "+page.server.ts: access DB, env vars, set cookies — never exposed to client" },
          { label: "Universal load", description: "+page.ts: runs on server for SSR, then on client for SPA navigation" },
          { label: "depends() + invalidate()", description: "Fine-grained cache invalidation for load function data" },
        ],
        context: "Server vs. universal load is a key architectural decision — similar to Next.js server/client split.",
        relatedItems: ["sveltekit-routing", "nextjs-data-fetching"],
        mnemonicHint: "server.ts = secrets safe. ts = runs everywhere. Both feed data to the page.",
      },
      {
        id: "sveltekit-form-actions",
        term: "SvelteKit Form Actions",
        description:
          "Form actions handle form submissions server-side without client JS. Defined in +page.server.ts, they provide progressive enhancement — forms work even before JS loads.",
        details: [
          { label: "Default action", description: "Export actions = { default: async ({ request }) => { ... } } for single-action forms" },
          { label: "Named actions", description: "Multiple actions per page via ?/actionName in the form's action attribute" },
          { label: "use:enhance", description: "Svelte action that progressively enhances forms with client-side submission and optimistic UI" },
        ],
        context: "Progressive enhancement is a SvelteKit philosophy — expect comparison with React Server Actions.",
        relatedItems: ["sveltekit-load"],
        mnemonicHint: "Form actions = server functions triggered by <form>. Works without JavaScript.",
      },
      {
        id: "sveltekit-hooks",
        term: "SvelteKit Hooks",
        description:
          "hooks.server.ts exports handle(), which intercepts every request and can modify the response, add auth, set locals. handleError() processes unexpected errors.",
        details: [
          { label: "handle()", description: "Middleware-like function that wraps every request — can modify event.locals, redirect, or respond" },
          { label: "sequence()", description: "Composes multiple handle functions into a pipeline" },
          { label: "handleFetch()", description: "Intercepts fetch calls made in load functions — useful for rewriting URLs or adding auth headers" },
        ],
        context: "Equivalent to Next.js middleware — expect to implement auth guards in hooks.",
        relatedItems: ["nextjs-middleware"],
        mnemonicHint: "hooks.server.ts handle() = middleware for every request. sequence() = chain them.",
      },
    ],
  },

  // ─── Languages ────────────────────────────────────────────────
  {
    id: "languages",
    name: "Languages",
    icon: "code",
    color: "orange",
    items: [
      // TypeScript (primary — 8)
      {
        id: "typescript-union-intersection",
        term: "Union & Intersection Types",
        description:
          "Union types (A | B) represent values that can be one of several types. Intersection types (A & B) combine multiple types into one that has all properties of each.",
        details: [
          { label: "Union |", description: "Value is A or B — must narrow before accessing type-specific properties" },
          { label: "Intersection &", description: "Value is A and B — has all properties of both types" },
          { label: "Discriminated unions", description: "Add a literal 'type' field to each variant for type-safe switch/case narrowing" },
        ],
        context: "Foundation of TypeScript — expect to use discriminated unions in live coding.",
        relatedItems: ["typescript-type-guards", "typescript-discriminated-unions"],
        mnemonicHint: "Union = OR (one of these). Intersection = AND (all of these combined).",
      },
      {
        id: "typescript-generics",
        term: "Generics",
        description:
          "Generics let you write reusable functions, classes, and interfaces that work with any type while preserving type safety. The type parameter is specified at call/usage time.",
        details: [
          { label: "Type parameters", description: "function identity<T>(arg: T): T — T is inferred from the argument or explicitly provided" },
          { label: "Constraints", description: "<T extends HasLength> restricts T to types with a length property" },
          { label: "Default types", description: "<T = string> provides a fallback when no type argument is given" },
          { label: "Multiple params", description: "<K extends keyof T, V extends T[K]> for correlated type parameters" },
        ],
        context: "Expect to write a generic utility function or typed API response wrapper.",
        relatedItems: ["typescript-utility-types"],
        mnemonicHint: "Generic = type variable. Constraint = extends. Think of it as a function for types.",
      },
      {
        id: "typescript-type-guards",
        term: "Type Guards & Narrowing",
        description:
          "Type guards are expressions that narrow a variable's type within a conditional block. TypeScript's control flow analysis tracks these narrows automatically.",
        details: [
          { label: "typeof", description: "Narrows primitives: typeof x === 'string'" },
          { label: "instanceof", description: "Narrows class instances: x instanceof Date" },
          { label: "in operator", description: "Narrows by property existence: 'name' in obj" },
          { label: "Custom guards", description: "function isUser(x: unknown): x is User — user-defined type predicate" },
        ],
        context: "Essential for working with union types — expect to write custom type guards.",
        relatedItems: ["typescript-union-intersection"],
        mnemonicHint: "Type guard = if-check that teaches TypeScript what a variable really is.",
      },
      {
        id: "typescript-utility-types",
        term: "Utility Types",
        description:
          "Built-in generic types that transform existing types. Partial makes all props optional, Required makes all required, Pick/Omit select or exclude props, Record creates a map type.",
        details: [
          { label: "Partial<T>", description: "All properties of T become optional" },
          { label: "Pick<T, K>", description: "Extracts only the specified keys K from T" },
          { label: "Omit<T, K>", description: "Removes the specified keys K from T" },
          { label: "Record<K, V>", description: "Creates an object type with keys K and values V" },
          { label: "ReturnType<T>", description: "Extracts the return type of a function type T" },
        ],
        context: "Common in real codebases — expect to use Partial for update DTOs and Pick for API responses.",
        relatedItems: ["typescript-generics", "typescript-mapped-types"],
        mnemonicHint: "Partial = maybe. Required = must. Pick = cherry-pick. Omit = leave out. Record = map.",
      },
      {
        id: "typescript-conditional-types",
        term: "Conditional Types",
        description:
          "Conditional types select one of two types based on a condition: T extends U ? X : Y. They enable type-level programming and are the foundation of many utility types.",
        details: [
          { label: "Syntax", description: "T extends U ? TrueType : FalseType — like a ternary for types" },
          { label: "Distributive", description: "When T is a union, the conditional distributes over each member independently" },
          { label: "infer keyword", description: "Captures a type within the extends clause: T extends Promise<infer U> ? U : T" },
          { label: "NonNullable", description: "Built-in conditional type that removes null and undefined from a union" },
        ],
        context: "Advanced topic — demonstrates deep TypeScript expertise in senior-level interviews.",
        relatedItems: ["typescript-generics", "typescript-mapped-types"],
        mnemonicHint: "Conditional type = if-else for types. infer = capture the unknown type.",
      },
      {
        id: "typescript-mapped-types",
        term: "Mapped Types",
        description:
          "Mapped types iterate over the keys of a type to create a new type. They use the [K in keyof T] syntax and can add/remove readonly or optional modifiers.",
        details: [
          { label: "[K in keyof T]", description: "Iterates over each property key of T" },
          { label: "Modifiers", description: "+readonly, -readonly, +?, -? to add or remove modifiers" },
          { label: "Key remapping", description: "[K in keyof T as NewKey]: transforms keys using template literals or conditional types" },
        ],
        context: "Understanding mapped types explains how Partial, Required, and Readonly work internally.",
        relatedItems: ["typescript-utility-types", "typescript-conditional-types"],
        mnemonicHint: "Mapped type = for-loop over type keys. Modifiers = tweak each property.",
      },
      {
        id: "typescript-module-augmentation",
        term: "Declaration Merging & Module Augmentation",
        description:
          "TypeScript allows extending existing type declarations through declaration merging (interfaces auto-merge) and module augmentation (adding types to third-party packages).",
        details: [
          { label: "Interface merging", description: "Declaring the same interface name twice merges their members" },
          { label: "Module augmentation", description: "declare module 'library' { ... } adds types to an existing module" },
          { label: "Global augmentation", description: "declare global { ... } extends global scope (e.g., Window interface)" },
        ],
        context: "Practical skill for extending library types — Express request, Next.js page props, etc.",
        relatedItems: ["typescript-generics"],
        mnemonicHint: "Same interface name = auto-merge. declare module = patch someone else's types.",
      },
      {
        id: "typescript-discriminated-unions",
        term: "Discriminated Unions",
        description:
          "A pattern combining union types with a common literal discriminant property. TypeScript narrows the type in switch/case or if-checks based on the discriminant value.",
        details: [
          { label: "Discriminant", description: "A shared property with literal types: type: 'circle' | 'square'" },
          { label: "Exhaustiveness", description: "switch + never in default case ensures all variants are handled at compile time" },
          { label: "Pattern", description: "type Shape = Circle | Square; switch(shape.type) narrows shape to the correct variant" },
        ],
        context: "Industry-standard pattern for modeling domain states — API responses, FSMs, Redux actions.",
        relatedItems: ["typescript-union-intersection", "typescript-type-guards"],
        mnemonicHint: "Discriminated union = tagged union. The tag (type field) tells TypeScript which variant it is.",
      },
      // JavaScript ES6+ (primary — 8)
      {
        id: "javascript-closures",
        term: "Closures & Lexical Scope",
        description:
          "A closure is a function that retains access to variables from its enclosing scope even after the outer function has returned. JavaScript uses lexical scoping — scope is determined by where code is written, not where it's called.",
        details: [
          { label: "Lexical scope", description: "Inner functions can access outer variables; scope chain is fixed at definition time" },
          { label: "Data privacy", description: "Closures enable private variables — the module pattern and factory functions rely on this" },
          { label: "Common pitfall", description: "var in loops shares the same binding; let or IIFE creates a new binding per iteration" },
        ],
        context: "Classic interview question — expect to trace variable values through nested closures.",
        relatedItems: ["javascript-event-loop"],
        mnemonicHint: "Closure = function + its backpack of outer variables. The backpack travels with it.",
      },
      {
        id: "javascript-promises",
        term: "Promises & async/await",
        description:
          "Promises represent eventual completion or failure of an async operation. async/await is syntactic sugar over promises that makes asynchronous code read like synchronous code.",
        details: [
          { label: "States", description: "pending → fulfilled (resolve) or rejected (reject). Once settled, state is immutable" },
          { label: "Promise.all", description: "Runs promises in parallel; rejects if any one rejects" },
          { label: "Promise.allSettled", description: "Waits for all promises regardless of outcome — returns status and value/reason" },
          { label: "Error handling", description: "try/catch with await catches rejections; .catch() chains handle promise rejections" },
        ],
        context: "Expect to implement parallel data fetching and proper error handling with async/await.",
        relatedItems: ["javascript-event-loop"],
        mnemonicHint: "Promise = IOU for a future value. await = pause here until the IOU is paid.",
      },
      {
        id: "javascript-prototypes",
        term: "Prototypal Inheritance",
        description:
          "JavaScript objects inherit directly from other objects via the prototype chain. Every object has a hidden [[Prototype]] link. class syntax is sugar over this prototype-based system.",
        details: [
          { label: "Prototype chain", description: "Property lookup walks up the chain: obj → obj.__proto__ → ... → Object.prototype → null" },
          { label: "Object.create()", description: "Creates a new object with the specified object as its prototype" },
          { label: "class syntax", description: "Syntactic sugar: constructor, methods, extends, super — all compile to prototype assignments" },
          { label: "hasOwnProperty", description: "Checks if a property belongs to the object itself, not its prototype chain" },
        ],
        context: "Foundational JS concept — expect to explain what 'class' really does under the hood.",
        relatedItems: ["javascript-closures"],
        mnemonicHint: "Prototype chain = linked list of fallback objects. class = pretty syntax for the same thing.",
      },
      {
        id: "javascript-event-loop",
        term: "Event Loop & Task Queues",
        description:
          "JavaScript is single-threaded. The event loop continuously checks the call stack and, when empty, dequeues callbacks from the task queue. Microtasks (promises) have priority over macrotasks (setTimeout).",
        details: [
          { label: "Call stack", description: "LIFO structure for synchronous execution — must be empty before any queued callback runs" },
          { label: "Microtask queue", description: "Promise callbacks, queueMicrotask — processed fully after each macrotask" },
          { label: "Macrotask queue", description: "setTimeout, setInterval, I/O callbacks — one per event loop tick" },
          { label: "requestAnimationFrame", description: "Runs before repaint, after microtasks — ideal for visual updates at 60fps" },
        ],
        context: "Classic interview: 'In what order do these console.logs execute?' Requires event loop knowledge.",
        relatedItems: ["javascript-promises", "nodejs-event-loop"],
        mnemonicHint: "Microtask (Promise) always beats macrotask (setTimeout). Stack empty → drain micros → one macro.",
      },
      {
        id: "javascript-destructuring",
        term: "Destructuring & Spread/Rest",
        description:
          "Destructuring extracts values from arrays/objects into distinct variables. Spread (...) expands iterables. Rest (...) collects remaining elements into an array or object.",
        details: [
          { label: "Object destructuring", description: "const { name, age = 0 } = user — with defaults and renaming via colon" },
          { label: "Array destructuring", description: "const [first, , third] = arr — skip elements with commas" },
          { label: "Spread", description: "{ ...obj, newProp: 1 } creates a shallow copy with overrides" },
          { label: "Rest", description: "function fn(first, ...rest) collects remaining arguments into an array" },
        ],
        context: "Used everywhere in modern JS/TS — expect to use destructuring fluently in live coding.",
        relatedItems: ["javascript-closures"],
        mnemonicHint: "Destructure = unpack. Spread = expand. Rest = gather the leftovers.",
      },
      {
        id: "javascript-modules",
        term: "ES Modules vs CommonJS",
        description:
          "ESM (import/export) is the standard module system with static analysis and tree-shaking support. CommonJS (require/module.exports) is Node.js's original system with dynamic, synchronous loading.",
        details: [
          { label: "ESM static", description: "Imports are hoisted and analyzed at compile time — enables tree-shaking by bundlers" },
          { label: "CJS dynamic", description: "require() can be called conditionally at runtime; modules are cached after first load" },
          { label: "Interop", description: "ESM can import CJS; CJS cannot use require() on ESM without dynamic import()" },
          { label: "package.json type", description: "'type': 'module' makes .js files ESM by default; 'type': 'commonjs' is the Node default" },
        ],
        context: "Expect to explain why ESM enables tree-shaking and how to handle CJS/ESM interop issues.",
        relatedItems: ["nodejs-cjs-esm"],
        mnemonicHint: "ESM = import/export, static, tree-shakeable. CJS = require, dynamic, cached.",
      },
      {
        id: "javascript-proxy",
        term: "Proxy & Reflect",
        description:
          "Proxy wraps an object and intercepts fundamental operations (get, set, delete, etc.) via handler traps. Reflect provides default behavior for those operations.",
        details: [
          { label: "Handler traps", description: "get, set, has, deleteProperty, apply, construct — intercept any object operation" },
          { label: "Reflect", description: "Reflect.get(target, prop) performs the default operation — use inside traps for forwarding" },
          { label: "Use cases", description: "Reactive systems (Vue 3), validation, logging, access control, virtual properties" },
        ],
        context: "Advanced topic — demonstrates deep JS knowledge. Vue 3's reactivity is built on Proxy.",
        relatedItems: ["javascript-prototypes"],
        mnemonicHint: "Proxy = wiretap on an object. Every read/write/delete goes through your handler.",
      },
      {
        id: "javascript-weakmap-weakset",
        term: "WeakMap & WeakSet",
        description:
          "WeakMap holds weak references to object keys, allowing garbage collection when no other reference exists. WeakSet does the same for values. Neither is iterable.",
        details: [
          { label: "Weak references", description: "Keys (WeakMap) or values (WeakSet) can be garbage collected if unreferenced elsewhere" },
          { label: "No size/iteration", description: "Cannot iterate, get size, or clear — by design, to maintain GC guarantees" },
          { label: "Use cases", description: "Private data storage, caching computed values per object, tracking DOM nodes without leaks" },
        ],
        context: "Shows understanding of memory management — relevant for performance-sensitive applications.",
        relatedItems: ["javascript-proxy"],
        mnemonicHint: "Weak = 'I won't keep you alive.' If nobody else holds a reference, it gets garbage collected.",
      },
      // HTML5 (primary — 8)
      {
        id: "html5-semantic",
        term: "Semantic HTML Elements",
        description:
          "Semantic elements (header, nav, main, article, section, aside, footer) convey meaning about the document structure. They improve accessibility, SEO, and code readability.",
        details: [
          { label: "header/footer", description: "Introductory content or navigation / closing content for a section or page" },
          { label: "nav", description: "Navigation links — screen readers use this to offer a navigation shortcut" },
          { label: "main", description: "Dominant content of the body — only one per page, assists skip-navigation" },
          { label: "article vs section", description: "article = self-contained, redistributable. section = thematic grouping within a page" },
        ],
        context: "Accessibility interviews test whether you use div soup vs. semantic structure.",
        relatedItems: ["html5-accessibility"],
        mnemonicHint: "Semantic = meaningful tags. article = standalone content. section = chapter.",
      },
      {
        id: "html5-web-storage",
        term: "Web Storage API",
        description:
          "localStorage persists key-value string data across browser sessions. sessionStorage persists only for the tab's session. Both are synchronous and limited to ~5-10MB.",
        details: [
          { label: "localStorage", description: "Persists until explicitly cleared; shared across tabs on the same origin" },
          { label: "sessionStorage", description: "Cleared when the tab closes; not shared across tabs" },
          { label: "Limitations", description: "String-only (use JSON.stringify/parse), synchronous (blocks main thread), no expiry" },
        ],
        context: "Compared with cookies and IndexedDB — know when each storage mechanism is appropriate.",
        relatedItems: ["html5-semantic"],
        mnemonicHint: "localStorage = permanent notepad. sessionStorage = sticky note (gone when tab closes).",
      },
      {
        id: "html5-canvas-svg",
        term: "Canvas vs SVG",
        description:
          "Canvas provides a bitmap drawing API for pixel-level control (games, charts). SVG is a vector format with DOM elements that can be styled and animated with CSS.",
        details: [
          { label: "Canvas", description: "Immediate mode — draw pixels, no DOM nodes. Better for many objects, animations, games" },
          { label: "SVG", description: "Retained mode — each shape is a DOM element. Better for interactive diagrams, accessibility" },
          { label: "Performance", description: "Canvas wins with 10K+ objects; SVG wins with few interactive, styled elements" },
        ],
        context: "System design question: 'How would you build an interactive diagram editor?' SVG vs Canvas tradeoffs.",
        relatedItems: [],
        mnemonicHint: "Canvas = painting (pixels, fast). SVG = paper cutouts (DOM elements, interactive).",
      },
      {
        id: "html5-web-workers",
        term: "Web Workers",
        description:
          "Web Workers run JavaScript in a background thread, keeping the main thread responsive. They communicate with the main thread via postMessage and cannot access the DOM.",
        details: [
          { label: "Dedicated Worker", description: "new Worker('worker.js') — runs in a separate thread, communicates via postMessage" },
          { label: "SharedWorker", description: "Shared across multiple tabs/windows on the same origin — uses MessagePort" },
          { label: "Transferable objects", description: "ArrayBuffers can be transferred (zero-copy) instead of cloned for performance" },
        ],
        context: "Performance optimization for CPU-intensive tasks — expect to know when to offload work.",
        relatedItems: ["javascript-event-loop"],
        mnemonicHint: "Worker = background helper. Can't touch DOM. Talks via postMessage walkie-talkie.",
      },
      {
        id: "html5-accessibility",
        term: "Accessibility & ARIA",
        description:
          "ARIA (Accessible Rich Internet Applications) attributes add semantic information to HTML for assistive technologies. Use native HTML elements first; add ARIA only when native semantics are insufficient.",
        details: [
          { label: "Roles", description: "role='button', role='dialog' — tell screen readers what an element does" },
          { label: "aria-label/labelledby", description: "Provide accessible names for elements that lack visible text" },
          { label: "aria-live", description: "Announces dynamic content changes to screen readers: polite (queued) or assertive (immediate)" },
          { label: "First rule of ARIA", description: "Don't use ARIA if a native HTML element or attribute provides the semantics" },
        ],
        context: "Accessibility is a legal requirement (WCAG) and a common interview topic.",
        relatedItems: ["html5-semantic"],
        mnemonicHint: "ARIA = accessibility metadata. Native HTML first, ARIA only for custom widgets.",
      },
      {
        id: "html5-forms",
        term: "HTML Forms & Validation",
        description:
          "HTML5 form validation uses attributes like required, pattern, min/max, and type (email, url, number) for client-side validation without JavaScript. The Constraint Validation API enables custom validation.",
        details: [
          { label: "Built-in types", description: "type='email', 'url', 'number', 'date' — browser validates format automatically" },
          { label: "pattern attribute", description: "Regex validation: pattern='[A-Za-z]{3,}' with title for error message" },
          { label: "Custom validity", description: "input.setCustomValidity('message') + reportValidity() for programmatic validation" },
          { label: "novalidate", description: "Disables built-in validation on form submit — use when handling validation in JS" },
        ],
        context: "Progressive enhancement question: 'How do you handle validation without JavaScript?'",
        relatedItems: ["html5-semantic"],
        mnemonicHint: "required = must fill. pattern = must match regex. type = must be valid format.",
      },
      {
        id: "html5-web-components",
        term: "Shadow DOM & Web Components",
        description:
          "Web Components are custom HTML elements built from Custom Elements API, Shadow DOM (encapsulated DOM/CSS), HTML templates, and ES modules. They work across frameworks.",
        details: [
          { label: "Custom Elements", description: "class MyEl extends HTMLElement + customElements.define('my-el', MyEl)" },
          { label: "Shadow DOM", description: "this.attachShadow({mode: 'open'}) creates an encapsulated DOM tree with scoped styles" },
          { label: "Lifecycle callbacks", description: "connectedCallback, disconnectedCallback, attributeChangedCallback" },
        ],
        context: "Design system interviews ask about framework-agnostic component strategies.",
        relatedItems: ["html5-semantic"],
        mnemonicHint: "Web Component = custom HTML tag. Shadow DOM = private room with its own CSS.",
      },
      {
        id: "html5-responsive-images",
        term: "Responsive Images",
        description:
          "srcset and sizes attributes let the browser choose the optimal image resolution based on viewport and device pixel ratio. The <picture> element enables art direction with media query sources.",
        details: [
          { label: "srcset", description: "List of image sources with width descriptors (400w) or pixel density (2x)" },
          { label: "sizes", description: "Tells the browser the rendered size at each breakpoint: sizes='(max-width: 600px) 100vw, 50vw'" },
          { label: "<picture>", description: "Wraps <source> elements with media/type attributes for art direction and format fallback" },
        ],
        context: "Performance optimization — Core Web Vitals (LCP) depend on correct image loading strategy.",
        relatedItems: ["nextjs-image-opt"],
        mnemonicHint: "srcset = resolution menu. sizes = how big it'll display. picture = art direction.",
      },
      // CSS3 (primary — 8)
      {
        id: "css3-flexbox",
        term: "Flexbox Layout",
        description:
          "Flexbox is a one-dimensional layout model for distributing space along a row or column. Items flex to fill available space or shrink to prevent overflow.",
        details: [
          { label: "flex-direction", description: "row (default) or column — sets the main axis" },
          { label: "justify-content", description: "Distributes items along the main axis: center, space-between, space-around, space-evenly" },
          { label: "align-items", description: "Aligns items along the cross axis: stretch (default), center, flex-start, flex-end" },
          { label: "flex shorthand", description: "flex: 1 0 auto = flex-grow: 1, flex-shrink: 0, flex-basis: auto" },
        ],
        context: "Expect to center elements, build nav bars, and distribute space using flexbox in live coding.",
        relatedItems: ["css3-grid"],
        mnemonicHint: "justify = main axis. align = cross axis. flex: 1 = grow to fill.",
      },
      {
        id: "css3-grid",
        term: "CSS Grid Layout",
        description:
          "Grid is a two-dimensional layout system for rows and columns simultaneously. It enables complex layouts without nested flexbox or float hacks.",
        details: [
          { label: "grid-template", description: "grid-template-columns: repeat(3, 1fr) — three equal columns using fractional units" },
          { label: "grid-area", description: "Name grid areas for semantic layout: grid-template-areas: 'header header' 'sidebar main'" },
          { label: "auto-fill/auto-fit", description: "repeat(auto-fill, minmax(250px, 1fr)) creates responsive grids without media queries" },
          { label: "gap", description: "Sets gutters between rows and columns — replaces margin hacks" },
        ],
        context: "Expect to build a responsive card grid or dashboard layout using CSS Grid.",
        relatedItems: ["css3-flexbox"],
        mnemonicHint: "Grid = rows + columns. fr = fraction of free space. auto-fill = responsive magic.",
      },
      {
        id: "css3-custom-properties",
        term: "CSS Custom Properties (Variables)",
        description:
          "Custom properties (--color: blue) are inherited, cascading variables declared on elements. They can be updated dynamically with JavaScript and respond to media queries.",
        details: [
          { label: "Declaration", description: "--primary: #3b82f6 on :root for global scope or on any element for local scope" },
          { label: "Usage", description: "color: var(--primary, fallback) — the fallback is used if the property is undefined" },
          { label: "Dynamic", description: "Unlike preprocessor variables, custom properties update at runtime and cascade normally" },
        ],
        context: "Theming and design systems rely on custom properties — expect to implement dark mode.",
        relatedItems: ["css3-specificity"],
        mnemonicHint: "-- prefix = CSS variable. var(--name, fallback). Lives in the cascade, not the build step.",
      },
      {
        id: "css3-specificity",
        term: "Specificity & Cascade",
        description:
          "Specificity determines which CSS rule wins when multiple rules target the same element. It's calculated as (inline, ID, class/attr/pseudo-class, element/pseudo-element).",
        details: [
          { label: "Specificity order", description: "!important > inline > #id > .class/[attr]/:pseudo-class > element/::pseudo-element" },
          { label: "Cascade layers", description: "@layer allows controlling specificity ordering between groups of styles" },
          { label: ":where()", description: "Specificity-free selector wrapper — :where(.card) has zero specificity" },
          { label: ":is()", description: "Takes the highest specificity of its arguments — unlike :where which is zero" },
        ],
        context: "Debugging CSS requires understanding specificity — expect to resolve conflicting styles.",
        relatedItems: ["css3-custom-properties"],
        mnemonicHint: "Specificity = ID beats class beats element. :where() = zero weight. @layer = ordering.",
      },
      {
        id: "css3-animations",
        term: "CSS Animations & Transitions",
        description:
          "Transitions animate property changes between states (hover, focus). Animations use @keyframes for multi-step sequences that can loop, reverse, and run independently of state changes.",
        details: [
          { label: "transition", description: "transition: opacity 0.3s ease-in-out — animates between two states" },
          { label: "@keyframes", description: "Define named animation steps: @keyframes slide { from { ... } to { ... } }" },
          { label: "animation shorthand", description: "animation: slide 1s ease infinite — name, duration, timing, iteration" },
          { label: "will-change", description: "Hints the browser to optimize: will-change: transform, opacity — use sparingly" },
        ],
        context: "Performance: only animate transform and opacity — they're GPU-composited, no layout/paint.",
        relatedItems: ["css3-flexbox"],
        mnemonicHint: "Transition = A to B. Animation = A to B to C to ... with @keyframes.",
      },
      {
        id: "css3-media-queries",
        term: "Media Queries & Container Queries",
        description:
          "Media queries apply styles based on viewport characteristics (width, prefers-color-scheme). Container queries (@container) apply styles based on a parent container's size.",
        details: [
          { label: "Media query", description: "@media (max-width: 768px) — viewport-based responsive design" },
          { label: "Container query", description: "@container (min-width: 400px) — component-based responsive design" },
          { label: "container-type", description: "Parent must declare container-type: inline-size to enable container queries" },
          { label: "prefers-*", description: "prefers-color-scheme, prefers-reduced-motion — user preference queries" },
        ],
        context: "Container queries are the modern answer to 'how do you make a component responsive to its parent?'",
        relatedItems: ["css3-grid"],
        mnemonicHint: "Media query = page responsive. Container query = component responsive.",
      },
      {
        id: "css3-pseudo",
        term: "Pseudo-classes & Pseudo-elements",
        description:
          "Pseudo-classes (:hover, :focus, :nth-child) select elements by state or position. Pseudo-elements (::before, ::after) create virtual elements for decorative content.",
        details: [
          { label: ":hover/:focus/:active", description: "Interactive states — :focus-visible only shows for keyboard navigation" },
          { label: ":nth-child()", description: "Pattern matching: :nth-child(2n) for even, :nth-child(3n+1) for every third starting at 1" },
          { label: "::before/::after", description: "Insert generated content — require content: '' even if empty. Not in the DOM" },
          { label: ":has()", description: "Parent selector: .card:has(img) styles cards that contain images" },
        ],
        context: ":has() is the most-requested CSS feature — know its capabilities and browser support.",
        relatedItems: ["css3-specificity"],
        mnemonicHint: "Single colon = state/position (:hover). Double colon = generated content (::before).",
      },
      {
        id: "css3-logical",
        term: "CSS Logical Properties",
        description:
          "Logical properties use flow-relative directions (inline-start, block-end) instead of physical ones (left, bottom). They enable layouts that work correctly in RTL and vertical writing modes.",
        details: [
          { label: "inline/block", description: "inline = text direction (left→right in LTR). block = perpendicular (top→bottom)" },
          { label: "margin-inline-start", description: "Replaces margin-left — becomes margin-right in RTL automatically" },
          { label: "inset", description: "Shorthand for top/right/bottom/left: inset: 0 = position all edges at 0" },
        ],
        context: "Internationalization topic — shows awareness of RTL/LTR layout considerations.",
        relatedItems: ["css3-flexbox"],
        mnemonicHint: "Logical = flow-aware. inline = text direction. block = stack direction. Works in any language.",
      },
    ],
  },

  // ─── Backend Frameworks ───────────────────────────────────────
  {
    id: "backend-frameworks",
    name: "Backend Frameworks",
    icon: "server",
    color: "green",
    items: [
      // Node.js (primary — 8)
      {
        id: "nodejs-event-loop",
        term: "Node.js Event Loop & Non-Blocking I/O",
        description:
          "Node.js uses a single-threaded event loop backed by libuv. I/O operations are delegated to the OS or thread pool, and callbacks are queued when they complete, keeping the main thread non-blocking.",
        details: [
          { label: "Phases", description: "timers → pending callbacks → idle/prepare → poll → check (setImmediate) → close callbacks" },
          { label: "libuv thread pool", description: "Default 4 threads handle file I/O, DNS lookups, and crypto — configurable via UV_THREADPOOL_SIZE" },
          { label: "process.nextTick", description: "Fires before any I/O event and before microtasks — use with caution to avoid starving I/O" },
        ],
        context: "Core Node.js question — expect to explain the event loop phases and why Node is 'single-threaded but concurrent.'",
        relatedItems: ["javascript-event-loop", "nodejs-streams"],
        mnemonicHint: "Event loop = traffic cop. Delegates I/O to background workers, runs callbacks when they report back.",
      },
      {
        id: "nodejs-streams",
        term: "Node.js Streams",
        description:
          "Streams process data in chunks instead of loading entire payloads into memory. Four types: Readable, Writable, Duplex, and Transform. They're the backbone of efficient I/O in Node.",
        details: [
          { label: "Readable", description: "Source of data (fs.createReadStream, http request). Events: data, end, error" },
          { label: "Writable", description: "Destination for data (fs.createWriteStream, http response). Methods: write(), end()" },
          { label: "pipe()", description: "Connects readable to writable: readStream.pipe(writeStream) — handles backpressure automatically" },
          { label: "pipeline()", description: "stream.pipeline() with error handling — preferred over pipe() for production code" },
        ],
        context: "Performance question: 'How would you process a 10GB file without running out of memory?'",
        relatedItems: ["nodejs-event-loop", "nodejs-buffers"],
        mnemonicHint: "Stream = garden hose (data flows through). pipe() = connect hoses. No bucket (memory) needed.",
      },
      {
        id: "nodejs-cluster-workers",
        term: "Cluster & Worker Threads",
        description:
          "Cluster module forks multiple processes sharing the same port for load balancing. Worker threads run JS in parallel threads sharing memory via SharedArrayBuffer — for CPU-intensive tasks.",
        details: [
          { label: "cluster.fork()", description: "Creates child processes — each has its own event loop, V8 instance, and memory" },
          { label: "Worker threads", description: "new Worker('task.js') — shares process memory via SharedArrayBuffer and MessageChannel" },
          { label: "Use cases", description: "Cluster = scale HTTP servers across CPU cores. Workers = offload CPU-heavy computation" },
        ],
        context: "Scaling Node.js question: 'How do you utilize all CPU cores?'",
        relatedItems: ["nodejs-event-loop"],
        mnemonicHint: "Cluster = multiple copies of your server. Worker = background thread for heavy math.",
      },
      {
        id: "nodejs-buffers",
        term: "Buffer & Binary Data",
        description:
          "Buffer is Node's fixed-size binary data container, backed by off-heap V8 memory. Essential for working with TCP streams, file I/O, and binary protocols.",
        details: [
          { label: "Buffer.from()", description: "Create from string, array, or another buffer — Buffer.from('hello', 'utf-8')" },
          { label: "Encoding", description: "Supports utf-8, base64, hex, ascii — used when converting between Buffer and string" },
          { label: "TypedArrays", description: "Buffer extends Uint8Array — can use ArrayBuffer interop for Web API compatibility" },
        ],
        context: "Relevant when working with file uploads, WebSocket binary frames, or crypto operations.",
        relatedItems: ["nodejs-streams"],
        mnemonicHint: "Buffer = raw bytes in memory. Not a string — must encode/decode to read as text.",
      },
      {
        id: "nodejs-cjs-esm",
        term: "CommonJS vs ESM in Node.js",
        description:
          "Node.js supports both CommonJS (require/module.exports) and ES Modules (import/export). ESM is the modern standard but CJS remains widely used. Interop requires care.",
        details: [
          { label: ".mjs / .cjs", description: "File extensions that force ESM or CJS regardless of package.json type field" },
          { label: "Top-level await", description: "Available only in ESM — await at module scope without wrapping in async function" },
          { label: "__dirname", description: "Not available in ESM — use import.meta.url with fileURLToPath instead" },
        ],
        context: "Practical Node.js problem — expect to troubleshoot ESM/CJS interop errors.",
        relatedItems: ["javascript-modules"],
        mnemonicHint: "CJS = require (sync). ESM = import (async). type: 'module' in package.json = ESM default.",
      },
      {
        id: "nodejs-error-handling",
        term: "Error Handling Patterns",
        description:
          "Node.js errors flow through callbacks (err-first), promises (reject/catch), EventEmitter ('error' event), and process-level handlers (uncaughtException, unhandledRejection).",
        details: [
          { label: "Error-first callback", description: "Convention: callback(err, result) — check err before using result" },
          { label: "Promise rejection", description: "Unhandled rejections crash Node 15+ — always add .catch() or try/catch with await" },
          { label: "process.on('uncaughtException')", description: "Last resort — log the error and exit gracefully, don't try to continue" },
          { label: "Operational vs programmer", description: "Operational errors (network timeout) = handle. Programmer errors (TypeError) = crash and fix" },
        ],
        context: "Production Node.js question: 'How do you ensure your server doesn't silently swallow errors?'",
        relatedItems: ["nodejs-event-loop"],
        mnemonicHint: "err-first callback = Node tradition. unhandledRejection = your safety net. Crash on programmer bugs.",
      },
      {
        id: "nodejs-express-middleware",
        term: "Express Middleware Pattern",
        description:
          "Express middleware functions have access to (req, res, next). They execute in order, can modify req/res, end the cycle, or call next() to pass control. This pattern is used across many Node frameworks.",
        details: [
          { label: "app.use()", description: "Registers middleware for all routes or a specific path prefix" },
          { label: "Error middleware", description: "Four-argument signature (err, req, res, next) catches errors from preceding middleware" },
          { label: "Execution order", description: "Middleware runs in registration order — auth before route handlers before error handlers" },
          { label: "Router", description: "express.Router() creates modular, mountable route handlers as mini-applications" },
        ],
        context: "Express is still the most popular Node.js framework — middleware pattern appears everywhere.",
        relatedItems: ["nodejs-event-loop", "nextjs-middleware"],
        mnemonicHint: "Middleware = chain of functions. Each either responds or calls next(). Error handler has 4 args.",
      },
      {
        id: "nodejs-child-process",
        term: "process & child_process",
        description:
          "The process object provides info about the running Node process (env, argv, exit). child_process spawns system commands and other processes for parallel execution.",
        details: [
          { label: "process.env", description: "Environment variables — process.env.NODE_ENV for runtime configuration" },
          { label: "exec()", description: "Buffers output in memory — good for short commands. Shell interpreted." },
          { label: "spawn()", description: "Streams output — good for long-running processes. No shell by default (safer)." },
          { label: "fork()", description: "Spawns a new Node process with IPC channel — parent and child communicate via messages" },
        ],
        context: "System integration question: 'How do you run a shell command from Node.js safely?'",
        relatedItems: ["nodejs-cluster-workers"],
        mnemonicHint: "exec = short command, buffered. spawn = long process, streamed. fork = new Node with IPC.",
      },
    ],
  },

  // ─── Databases & Storage ──────────────────────────────────────
  {
    id: "databases-storage",
    name: "Databases & Storage",
    icon: "db",
    color: "cyan",
    items: [
      // PostgreSQL (secondary — 4)
      {
        id: "postgresql-indexes",
        term: "PostgreSQL Indexes",
        description:
          "B-tree is the default index type for equality and range queries. GIN indexes handle full-text search and JSONB containment. GiST indexes support geometric and range types.",
        details: [
          { label: "B-tree", description: "Default; optimal for =, <, >, BETWEEN, ORDER BY, and IS NULL" },
          { label: "GIN", description: "Generalized Inverted Index — for arrays, JSONB @>, and tsvector full-text search" },
          { label: "Partial index", description: "CREATE INDEX ... WHERE active = true — indexes only rows matching the predicate" },
          { label: "EXPLAIN ANALYZE", description: "Shows actual execution plan with timing — essential for query optimization" },
        ],
        context: "Performance optimization: 'This query is slow — how would you improve it?'",
        relatedItems: ["postgresql-jsonb"],
        mnemonicHint: "B-tree = sorted phonebook. GIN = word index in a textbook. EXPLAIN = X-ray your query.",
      },
      {
        id: "postgresql-transactions",
        term: "Transactions & Isolation Levels",
        description:
          "PostgreSQL transactions guarantee ACID properties. Isolation levels control how concurrent transactions see each other's uncommitted changes, trading consistency for performance.",
        details: [
          { label: "Read Committed", description: "Default: sees only committed data at statement start. Prevents dirty reads." },
          { label: "Repeatable Read", description: "Snapshot at transaction start. Prevents non-repeatable reads and phantom rows." },
          { label: "Serializable", description: "Full isolation — transactions appear to execute sequentially. Highest consistency, lowest throughput." },
          { label: "FOR UPDATE", description: "SELECT ... FOR UPDATE locks selected rows until transaction commits — prevents lost updates" },
        ],
        context: "Concurrency question: 'Two users update the same row — what happens?'",
        relatedItems: ["postgresql-indexes"],
        mnemonicHint: "Read Committed = each query sees latest. Repeatable Read = frozen snapshot. Serializable = one at a time.",
      },
      {
        id: "postgresql-jsonb",
        term: "JSONB Operations",
        description:
          "PostgreSQL JSONB stores binary JSON with indexing support. Operators: -> (get key as JSON), ->> (get key as text), @> (contains), #> (path access). GIN indexes make JSONB queries fast.",
        details: [
          { label: "-> vs ->>", description: "-> returns JSON type, ->> returns text — important for comparisons and casting" },
          { label: "@> containment", description: "data @> '{\"type\": \"user\"}' — checks if JSONB contains the given structure" },
          { label: "jsonb_set()", description: "Updates a value at a path without replacing the entire JSONB column" },
          { label: "GIN index", description: "CREATE INDEX ON t USING gin(data) — enables fast @>, ?, and ?& operators" },
        ],
        context: "Schema design: 'When should you use JSONB vs. normalized columns?'",
        relatedItems: ["postgresql-indexes"],
        mnemonicHint: "-> = get as JSON. ->> = get as text. @> = contains. GIN index = fast JSONB search.",
      },
      {
        id: "postgresql-window-functions",
        term: "Window Functions",
        description:
          "Window functions perform calculations across a set of rows related to the current row without collapsing them (unlike GROUP BY). They use OVER() to define the window frame.",
        details: [
          { label: "ROW_NUMBER()", description: "Sequential number for each row within the partition — no duplicates" },
          { label: "RANK() / DENSE_RANK()", description: "Ranking with gaps (RANK) or without gaps (DENSE_RANK) for ties" },
          { label: "LAG() / LEAD()", description: "Access previous/next row values without self-join" },
          { label: "PARTITION BY", description: "Divides rows into groups for the window function — like GROUP BY but keeps all rows" },
        ],
        context: "SQL question: 'Get the top 3 most recent orders per customer' — ROW_NUMBER with PARTITION.",
        relatedItems: ["postgresql-indexes"],
        mnemonicHint: "Window function = GROUP BY that keeps all rows. OVER(PARTITION BY x ORDER BY y).",
      },
      // MongoDB (secondary — 4)
      {
        id: "mongodb-aggregation",
        term: "MongoDB Aggregation Pipeline",
        description:
          "A sequence of stages ($match, $group, $project, $sort, $lookup) that process documents. Each stage transforms the document stream. The pipeline is the MongoDB equivalent of SQL JOINs and GROUP BY.",
        details: [
          { label: "$match", description: "Filters documents early — place first to reduce data flowing through the pipeline" },
          { label: "$group", description: "Groups by _id field and applies accumulators: $sum, $avg, $push, $first" },
          { label: "$lookup", description: "Left outer join with another collection — MongoDB's version of SQL JOIN" },
          { label: "$unwind", description: "Deconstructs an array field into one document per element" },
        ],
        context: "Data processing: 'Aggregate sales by month with the top product per month.'",
        relatedItems: ["mongodb-indexes"],
        mnemonicHint: "Pipeline = assembly line. $match = filter. $group = combine. $lookup = join. Order matters.",
      },
      {
        id: "mongodb-indexes",
        term: "MongoDB Indexing Strategies",
        description:
          "MongoDB uses B-tree indexes. Compound indexes follow the ESR rule (Equality, Sort, Range) for field order. Covered queries return results entirely from the index without touching documents.",
        details: [
          { label: "Compound index", description: "{ a: 1, b: 1 } — supports queries on a, and a+b, but not b alone (left prefix rule)" },
          { label: "ESR rule", description: "Order fields: Equality first, then Sort, then Range for optimal index usage" },
          { label: "explain()", description: "Shows query plan: look for IXSCAN (using index) vs COLLSCAN (full collection scan)" },
          { label: "TTL index", description: "Automatically deletes documents after a time period — useful for sessions, logs" },
        ],
        context: "Performance: 'This MongoDB query is slow — analyze with explain and fix.'",
        relatedItems: ["mongodb-aggregation"],
        mnemonicHint: "ESR = Equality, Sort, Range. Left prefix rule = compound index reads left to right.",
      },
      {
        id: "mongodb-schema-design",
        term: "MongoDB Schema Design Patterns",
        description:
          "MongoDB favors embedding related data for read performance and referencing for write-heavy or large subdocuments. Key patterns: subset, bucket, computed, and polymorphic.",
        details: [
          { label: "Embed vs reference", description: "Embed if data is read together and 1:few. Reference if data is shared, large, or 1:many" },
          { label: "Subset pattern", description: "Embed only the most-used subset of a large array; store full data in a separate collection" },
          { label: "Bucket pattern", description: "Group time-series data into fixed-size buckets (e.g., hourly) to reduce document count" },
          { label: "16MB limit", description: "Maximum BSON document size — embedding unbounded arrays will eventually hit this" },
        ],
        context: "Schema design: 'How would you model a social media feed with posts and comments?'",
        relatedItems: ["mongodb-aggregation"],
        mnemonicHint: "Embed = fast reads, data locality. Reference = normalized, flexible. 16MB doc limit = embedding ceiling.",
      },
      {
        id: "mongodb-transactions",
        term: "MongoDB Transactions",
        description:
          "MongoDB 4.0+ supports multi-document ACID transactions within a replica set. MongoDB 4.2+ extends this across sharded clusters. Transactions add latency — use only when atomicity across documents is required.",
        details: [
          { label: "Session-based", description: "const session = client.startSession(); session.withTransaction(async () => { ... })" },
          { label: "Performance cost", description: "Transactions hold locks and are slower — design schemas to minimize their need" },
          { label: "Single-doc atomicity", description: "Operations on a single document are always atomic — no transaction needed" },
        ],
        context: "Design question: 'When do you need transactions in MongoDB?' — transfer funds, order + inventory.",
        relatedItems: ["postgresql-transactions"],
        mnemonicHint: "Single doc = atomic free. Multi doc = need transaction. Transactions have overhead — avoid if possible.",
      },
    ],
  },

  // ─── Cloud & DevOps ───────────────────────────────────────────
  {
    id: "cloud-devops",
    name: "Cloud & DevOps",
    icon: "cloud",
    color: "blue",
    items: [
      // AWS (primary — 8)
      {
        id: "aws-lambda",
        term: "AWS Lambda & Serverless",
        description:
          "Lambda runs code without provisioning servers. You pay per invocation and duration. Functions are triggered by events (API Gateway, S3, SQS) and scale automatically from zero to thousands.",
        details: [
          { label: "Cold start", description: "First invocation provisions a new container — adds latency. Provisioned Concurrency eliminates this" },
          { label: "Execution limits", description: "15 min timeout, 10GB memory, 512MB /tmp storage, 6MB payload (sync)" },
          { label: "Layers", description: "Reusable packages of libraries/runtimes shared across functions" },
          { label: "Event sources", description: "API Gateway, S3, DynamoDB Streams, SQS, EventBridge, CloudWatch Events" },
        ],
        context: "Architecture: 'When would you choose Lambda over a container service?'",
        relatedItems: ["aws-api-gateway", "aws-sqs-sns"],
        mnemonicHint: "Lambda = function as a service. Event in → code runs → result out. No servers to manage.",
      },
      {
        id: "aws-s3-cloudfront",
        term: "S3 & CloudFront",
        description:
          "S3 provides virtually unlimited object storage with 99.999999999% durability. CloudFront is a CDN that caches S3 content at edge locations worldwide for low-latency delivery.",
        details: [
          { label: "Storage classes", description: "Standard, IA (Infrequent Access), Glacier (archive) — tiered pricing by access pattern" },
          { label: "Pre-signed URLs", description: "Temporary URLs granting time-limited access to private objects without making them public" },
          { label: "CloudFront invalidation", description: "Purges cached content at edge locations — use versioned filenames instead for instant updates" },
          { label: "Bucket policies", description: "JSON policies controlling access at the bucket level — combine with IAM for defense in depth" },
        ],
        context: "Static hosting, file uploads, CDN setup — fundamental AWS services in any full-stack role.",
        relatedItems: ["aws-iam"],
        mnemonicHint: "S3 = infinite hard drive in the cloud. CloudFront = copies at every airport (edge location).",
      },
      {
        id: "aws-iam",
        term: "IAM Policies & Roles",
        description:
          "IAM controls who can do what in AWS. Users have permanent credentials. Roles provide temporary credentials assumed by services or users. Policies are JSON documents defining allow/deny permissions.",
        details: [
          { label: "Least privilege", description: "Grant only the minimum permissions needed — never use * for actions or resources in production" },
          { label: "Role assumption", description: "Services (Lambda, EC2) assume roles to get temporary credentials via STS" },
          { label: "Policy evaluation", description: "Explicit deny > explicit allow > implicit deny. Evaluated across all attached policies" },
          { label: "Resource-based", description: "S3 bucket policies, SQS queue policies — attached to the resource, not the identity" },
        ],
        context: "Security: 'Your Lambda can't read from S3 — how do you debug permissions?'",
        relatedItems: ["aws-lambda"],
        mnemonicHint: "IAM = who can do what. Role = temporary hat. Policy = rules. Deny always wins.",
      },
      {
        id: "aws-api-gateway",
        term: "API Gateway",
        description:
          "Managed service for creating REST, HTTP, and WebSocket APIs. Handles routing, throttling, auth (Cognito, Lambda authorizer), and request/response transformation in front of Lambda or HTTP backends.",
        details: [
          { label: "REST vs HTTP API", description: "HTTP API is cheaper and faster; REST API has more features (caching, request validation, WAF)" },
          { label: "Stages", description: "Deploy to stages (dev, prod) with stage variables for environment-specific configuration" },
          { label: "Throttling", description: "Default 10K requests/sec with 5K burst — protects backends from traffic spikes" },
          { label: "CORS", description: "Configure allowed origins, methods, headers — common source of debugging pain" },
        ],
        context: "API design: 'How would you expose your Lambda functions as a REST API?'",
        relatedItems: ["aws-lambda", "rest-http-methods"],
        mnemonicHint: "API Gateway = front door for your APIs. Routes requests, enforces auth, throttles traffic.",
      },
      {
        id: "aws-dynamodb",
        term: "DynamoDB",
        description:
          "Fully managed NoSQL key-value and document database. Single-digit millisecond latency at any scale. Requires careful key design — partition key determines data distribution.",
        details: [
          { label: "Partition key", description: "Hash key that determines which partition stores the item — must be high cardinality" },
          { label: "Sort key", description: "Optional range key for ordering within a partition — enables BETWEEN and begins_with queries" },
          { label: "GSI", description: "Global Secondary Index — alternate partition/sort key pair for different access patterns" },
          { label: "On-demand vs provisioned", description: "On-demand scales automatically (pay per request); provisioned is cheaper for predictable workloads" },
        ],
        context: "NoSQL design: 'Model a user → orders relationship in DynamoDB with efficient queries.'",
        relatedItems: ["aws-lambda"],
        mnemonicHint: "DynamoDB = key-value at scale. Partition key = address. Sort key = apartment number. GSI = alternate address.",
      },
      {
        id: "aws-ecs-fargate",
        term: "ECS & Fargate",
        description:
          "ECS orchestrates Docker containers on AWS. Fargate is the serverless compute engine — no EC2 instances to manage. Tasks define containers; Services maintain desired task count.",
        details: [
          { label: "Task Definition", description: "Blueprint specifying container image, CPU/memory, port mappings, env vars, IAM role" },
          { label: "Service", description: "Maintains desired count of tasks, handles rolling deployments, integrates with ALB" },
          { label: "Fargate vs EC2", description: "Fargate = no servers, per-task billing. EC2 = more control, cheaper at scale" },
          { label: "ECR", description: "Elastic Container Registry — private Docker image repository integrated with ECS" },
        ],
        context: "Containerization: 'When do you choose Fargate over Lambda for your workload?'",
        relatedItems: ["docker-dockerfile", "aws-lambda"],
        mnemonicHint: "ECS = container orchestration. Fargate = serverless containers. ECR = Docker Hub for AWS.",
      },
      {
        id: "aws-sqs-sns",
        term: "SQS & SNS",
        description:
          "SQS is a message queue for decoupling services (point-to-point). SNS is a pub/sub notification service (fan-out). Together they enable reliable, scalable event-driven architectures.",
        details: [
          { label: "SQS Standard", description: "At-least-once delivery, best-effort ordering — nearly unlimited throughput" },
          { label: "SQS FIFO", description: "Exactly-once processing, guaranteed ordering — 300 msg/sec (3000 with batching)" },
          { label: "Dead Letter Queue", description: "Captures messages that fail processing after maxReceiveCount attempts" },
          { label: "SNS fan-out", description: "One message → multiple subscribers (SQS queues, Lambda, HTTP endpoints, email)" },
        ],
        context: "System design: 'How do you decouple your order processing from payment processing?'",
        relatedItems: ["aws-lambda"],
        mnemonicHint: "SQS = line at a store (one consumer). SNS = megaphone (many listeners). DLQ = lost & found.",
      },
      {
        id: "aws-cloudformation",
        term: "CloudFormation & CDK",
        description:
          "CloudFormation defines AWS infrastructure as YAML/JSON templates (IaC). CDK (Cloud Development Kit) lets you define infrastructure using TypeScript, Python, etc. that synthesizes into CloudFormation.",
        details: [
          { label: "Stacks", description: "Unit of deployment — all resources in a stack are created/updated/deleted together" },
          { label: "Change sets", description: "Preview infrastructure changes before applying — shows adds, modifies, deletes" },
          { label: "CDK constructs", description: "L1 (raw CFN), L2 (opinionated defaults), L3 (patterns) — increasing abstraction" },
          { label: "Drift detection", description: "Detects manual changes to resources that differ from the template definition" },
        ],
        context: "Infrastructure as Code: 'How do you manage reproducible, version-controlled AWS environments?'",
        relatedItems: ["aws-iam", "cicd-github-actions"],
        mnemonicHint: "CloudFormation = infrastructure recipe (YAML). CDK = write the recipe in real code.",
      },
      // GCP (secondary — 4)
      {
        id: "gcp-cloud-functions",
        term: "Google Cloud Functions",
        description:
          "GCP's serverless compute for event-driven functions. Similar to AWS Lambda. Supports HTTP triggers, Pub/Sub, Cloud Storage events, and Firestore triggers.",
        details: [
          { label: "Gen 2", description: "Built on Cloud Run — longer timeouts (60 min), more memory (32GB), concurrency per instance" },
          { label: "Cold starts", description: "Min instances setting keeps functions warm — eliminates cold start latency" },
          { label: "Idempotency", description: "Pub/Sub may deliver duplicates — design functions to be idempotent" },
        ],
        context: "Multi-cloud: compare with Lambda — know the differences in limits and pricing model.",
        relatedItems: ["aws-lambda"],
        mnemonicHint: "Cloud Functions = GCP's Lambda. Gen 2 = built on Cloud Run, more powerful.",
      },
      {
        id: "gcp-cloud-run",
        term: "Google Cloud Run",
        description:
          "Fully managed container platform that scales to zero. Deploy any container that listens on a port. Supports HTTP and gRPC, auto-scales based on concurrent requests.",
        details: [
          { label: "Scale to zero", description: "No cost when no traffic — instances spin down automatically" },
          { label: "Concurrency", description: "Multiple requests per container instance (up to 1000) — unlike Lambda's 1:1 model" },
          { label: "Any language", description: "Any container that listens on $PORT — not limited to specific runtimes" },
        ],
        context: "Container deployment: 'How would you deploy a Next.js app on GCP?'",
        relatedItems: ["docker-dockerfile", "aws-ecs-fargate"],
        mnemonicHint: "Cloud Run = serverless containers. Give it a Docker image, it handles the rest.",
      },
      {
        id: "gcp-bigquery",
        term: "BigQuery",
        description:
          "Serverless data warehouse for analytics at petabyte scale. Uses SQL syntax. Separates storage from compute — you pay for data scanned per query, not idle compute.",
        details: [
          { label: "Columnar storage", description: "Stores data by column, not row — extremely fast for aggregate queries on specific columns" },
          { label: "Partitioning", description: "Partition by date/timestamp to limit data scanned — critical for cost control" },
          { label: "Streaming inserts", description: "Real-time data ingestion — available for querying within seconds" },
        ],
        context: "Analytics architecture: 'Where do you store and query terabytes of event data?'",
        relatedItems: [],
        mnemonicHint: "BigQuery = SQL on massive data. Pay per bytes scanned. Partition = smaller bills.",
      },
      {
        id: "gcp-pubsub",
        term: "Google Cloud Pub/Sub",
        description:
          "Fully managed messaging service for event-driven architectures. Publishers send messages to topics; subscribers receive via push (webhook) or pull. Guarantees at-least-once delivery.",
        details: [
          { label: "Topic/Subscription", description: "Topic = channel. Subscription = listener. Multiple subscriptions = fan-out" },
          { label: "Push vs Pull", description: "Push delivers to an HTTPS endpoint. Pull lets consumers request messages at their own pace" },
          { label: "Ordering", description: "Optional ordering keys ensure messages with the same key are delivered in order" },
        ],
        context: "Event-driven: compare with AWS SNS/SQS — Pub/Sub combines both into one service.",
        relatedItems: ["aws-sqs-sns"],
        mnemonicHint: "Pub/Sub = newspaper delivery. Publisher writes articles, subscribers get copies.",
      },
      // Azure (secondary — 4)
      {
        id: "azure-functions",
        term: "Azure Functions",
        description:
          "Azure's serverless compute platform. Supports multiple triggers (HTTP, Timer, Queue, Blob) and bindings (input/output) that declaratively connect to Azure services without boilerplate.",
        details: [
          { label: "Bindings", description: "Declarative input/output connections — e.g., Queue trigger → Cosmos DB output, no SDK code needed" },
          { label: "Durable Functions", description: "Orchestrate stateful workflows — chaining, fan-out/fan-in, human interaction patterns" },
          { label: "Consumption plan", description: "Pay-per-execution with auto-scale. Premium plan eliminates cold starts" },
        ],
        context: "Multi-cloud: unique feature is bindings — simpler than Lambda's event source mappings.",
        relatedItems: ["aws-lambda", "gcp-cloud-functions"],
        mnemonicHint: "Azure Functions = Lambda + magic bindings. Durable Functions = long-running orchestrations.",
      },
      {
        id: "azure-cosmos-db",
        term: "Azure Cosmos DB",
        description:
          "Globally distributed, multi-model database with guaranteed single-digit millisecond latency. Supports multiple APIs: SQL (Core), MongoDB, Cassandra, Gremlin, and Table.",
        details: [
          { label: "Partition key", description: "Determines data distribution — choose high-cardinality field for even distribution" },
          { label: "Consistency levels", description: "Five levels: Strong → Bounded Staleness → Session → Consistent Prefix → Eventual" },
          { label: "Request Units", description: "RU/s measure throughput — each operation costs RUs based on size, complexity, consistency" },
        ],
        context: "Global scale: 'How do you serve users on every continent with low latency?'",
        relatedItems: ["mongodb-schema-design", "aws-dynamodb"],
        mnemonicHint: "Cosmos DB = globally replicated, pick your consistency. RU = currency for database operations.",
      },
      {
        id: "azure-devops",
        term: "Azure DevOps & Pipelines",
        description:
          "Integrated platform for planning (Boards), version control (Repos), CI/CD (Pipelines), testing (Test Plans), and package management (Artifacts).",
        details: [
          { label: "YAML pipelines", description: "Define CI/CD as code in azure-pipelines.yml — version-controlled, reviewable" },
          { label: "Stages/Jobs/Steps", description: "Pipeline hierarchy: stages (environments) → jobs (parallel units) → steps (individual tasks)" },
          { label: "Service connections", description: "Securely connect to external services (AWS, GCP, Docker Hub) without exposing credentials" },
        ],
        context: "Enterprise CI/CD: compare with GitHub Actions — Azure DevOps is common in enterprise environments.",
        relatedItems: ["cicd-github-actions"],
        mnemonicHint: "Azure DevOps = GitHub + Jira in one. Pipelines = GitHub Actions equivalent.",
      },
      {
        id: "azure-app-service",
        term: "Azure App Service",
        description:
          "PaaS for hosting web apps, REST APIs, and mobile backends. Supports Node.js, Python, .NET, Java, and custom containers. Includes auto-scaling, SSL, custom domains, and deployment slots.",
        details: [
          { label: "Deployment slots", description: "Staging environments that can be swapped with production — zero-downtime deployments" },
          { label: "Auto-scale", description: "Scale out based on metrics (CPU, memory, HTTP queue) or schedule" },
          { label: "App Service Plan", description: "Defines compute resources — Free, Basic, Standard, Premium tiers with increasing capabilities" },
        ],
        context: "PaaS comparison: 'How does App Service compare to Heroku, Vercel, or Cloud Run?'",
        relatedItems: ["gcp-cloud-run"],
        mnemonicHint: "App Service = managed hosting. Deployment slots = test before you swap to production.",
      },
      // Docker (secondary — 4)
      {
        id: "docker-dockerfile",
        term: "Dockerfile & Multi-Stage Builds",
        description:
          "A Dockerfile defines how to build a container image layer by layer. Multi-stage builds use multiple FROM statements to separate build dependencies from the final runtime image, drastically reducing size.",
        details: [
          { label: "Layer caching", description: "Each instruction creates a layer — order instructions from least to most changing for cache hits" },
          { label: "Multi-stage", description: "FROM node AS build ... FROM node:alpine COPY --from=build — build artifacts without dev dependencies" },
          { label: ".dockerignore", description: "Excludes files from the build context — essential for node_modules, .git, .env" },
          { label: "COPY vs ADD", description: "COPY is simpler and preferred. ADD can extract archives and fetch URLs — use only when needed" },
        ],
        context: "Containerization: 'Optimize this Dockerfile for smaller images and faster builds.'",
        relatedItems: ["docker-compose"],
        mnemonicHint: "Multi-stage = cook in one kitchen, serve from another. Final image has only what's needed.",
      },
      {
        id: "docker-compose",
        term: "Docker Compose",
        description:
          "Docker Compose defines and runs multi-container applications with a YAML file. Services, networks, and volumes are declared together. docker compose up starts everything.",
        details: [
          { label: "Services", description: "Each service defines a container — image, ports, volumes, environment, depends_on" },
          { label: "depends_on", description: "Controls startup order — but doesn't wait for readiness (use healthchecks for that)" },
          { label: "Volumes", description: "Persist data across container restarts — named volumes for databases, bind mounts for development" },
        ],
        context: "Local development: 'Set up a dev environment with app + database + redis using Compose.'",
        relatedItems: ["docker-dockerfile"],
        mnemonicHint: "Compose = recipe for running multiple containers together. One YAML, one command.",
      },
      {
        id: "docker-networking",
        term: "Docker Networking & Volumes",
        description:
          "Docker networks isolate container communication. Bridge (default) connects containers on the same host. Volumes persist data outside container lifecycle.",
        details: [
          { label: "Bridge network", description: "Default — containers communicate by name within the same bridge network" },
          { label: "Host network", description: "Container shares host's network stack — no port mapping needed, no isolation" },
          { label: "Named volumes", description: "docker volume create — managed by Docker, persisted independently of containers" },
          { label: "Bind mounts", description: "Map host directory into container — useful for development with live code reload" },
        ],
        context: "Debugging: 'Container A can't connect to Container B — what do you check?'",
        relatedItems: ["docker-compose"],
        mnemonicHint: "Bridge = containers talk by name. Volume = persistent storage. Bind mount = shared folder with host.",
      },
      {
        id: "docker-image-optimization",
        term: "Docker Image Optimization",
        description:
          "Smaller images mean faster pulls, less storage, and reduced attack surface. Key techniques: minimal base images, multi-stage builds, layer ordering, and removing unnecessary files.",
        details: [
          { label: "Alpine base", description: "node:alpine is ~50MB vs node:bookworm at ~350MB — smaller attack surface" },
          { label: "Distroless", description: "Google's distroless images contain only the app and runtime — no shell, no package manager" },
          { label: "Layer ordering", description: "COPY package.json → npm install → COPY . — npm install layer is cached unless dependencies change" },
        ],
        context: "Performance: 'Your Docker image is 2GB — how do you shrink it?'",
        relatedItems: ["docker-dockerfile"],
        mnemonicHint: "Smaller image = faster deploy + smaller attack surface. Alpine > Debian. Multi-stage > single stage.",
      },
      // CI/CD (primary — 8)
      {
        id: "cicd-github-actions",
        term: "GitHub Actions",
        description:
          "GitHub's built-in CI/CD platform. Workflows are YAML files triggered by events (push, PR, schedule). Jobs run on GitHub-hosted or self-hosted runners with marketplace actions for common tasks.",
        details: [
          { label: "Workflow syntax", description: "on → jobs → steps structure. Steps use 'uses' for marketplace actions or 'run' for shell commands" },
          { label: "Matrix strategy", description: "Run jobs across multiple configurations: OS versions, Node versions, etc." },
          { label: "Secrets", description: "Encrypted environment variables — accessed via ${{ secrets.NAME }}, never logged" },
          { label: "Caching", description: "actions/cache speeds up builds by caching dependencies (node_modules, pip cache)" },
        ],
        context: "Practical DevOps: 'Set up a CI pipeline that runs tests and deploys on merge to main.'",
        relatedItems: ["cicd-pipeline-stages"],
        mnemonicHint: "Workflow = recipe. Job = kitchen. Step = instruction. Trigger = what starts cooking.",
      },
      {
        id: "cicd-pipeline-stages",
        term: "CI/CD Pipeline Stages",
        description:
          "A typical pipeline: Build → Test (unit, integration, e2e) → Static Analysis (lint, type-check) → Security Scan → Deploy to Staging → Approval Gate → Deploy to Production.",
        details: [
          { label: "Build", description: "Compile code, install dependencies, create artifacts (Docker image, bundle)" },
          { label: "Test", description: "Unit tests (fast, isolated) → integration tests (with dependencies) → e2e tests (full stack)" },
          { label: "Approval gate", description: "Manual approval before production deploy — required for regulated environments" },
          { label: "Artifact promotion", description: "Same build artifact moves through environments — never rebuild for production" },
        ],
        context: "DevOps maturity: 'Walk me through your ideal CI/CD pipeline.'",
        relatedItems: ["cicd-github-actions", "cicd-blue-green"],
        mnemonicHint: "Pipeline = assembly line. Build once, test many ways, deploy the same artifact everywhere.",
      },
      {
        id: "cicd-blue-green",
        term: "Blue/Green Deployment",
        description:
          "Run two identical production environments. Deploy new version to the idle environment (green), test it, then switch traffic from blue to green. Instant rollback by switching back.",
        details: [
          { label: "Zero downtime", description: "Traffic switches atomically — users never see a deployment in progress" },
          { label: "Instant rollback", description: "Point traffic back to blue environment if green has issues" },
          { label: "Cost", description: "Requires double the infrastructure during deployment — more expensive than rolling updates" },
        ],
        context: "Deployment strategy: 'How do you deploy with zero downtime and instant rollback?'",
        relatedItems: ["cicd-canary", "cicd-pipeline-stages"],
        mnemonicHint: "Blue = current. Green = new. Test green, switch traffic. Problem? Switch back to blue.",
      },
      {
        id: "cicd-canary",
        term: "Canary Releases",
        description:
          "Route a small percentage of traffic (1-5%) to the new version while monitoring error rates and latency. Gradually increase traffic if metrics are healthy. Roll back if anomalies are detected.",
        details: [
          { label: "Traffic splitting", description: "Load balancer routes a percentage of requests to the canary — weight-based routing" },
          { label: "Monitoring", description: "Compare canary metrics (error rate, latency, CPU) against baseline — automated analysis" },
          { label: "Progressive", description: "1% → 5% → 25% → 50% → 100% with automated gates between each step" },
        ],
        context: "Risk management: 'How do you safely deploy a risky change to millions of users?'",
        relatedItems: ["cicd-blue-green", "cicd-feature-flags"],
        mnemonicHint: "Canary = coal mine bird. Send a few users first. If they're fine, send more.",
      },
      {
        id: "cicd-feature-flags",
        term: "Feature Flags",
        description:
          "Runtime toggles that control feature visibility without deploying new code. Enable gradual rollouts, A/B testing, kill switches, and decoupling deployment from release.",
        details: [
          { label: "Boolean flags", description: "Simple on/off toggle — enable for internal users, then gradually expand" },
          { label: "Percentage rollout", description: "Show feature to X% of users — increase over time based on metrics" },
          { label: "Kill switch", description: "Instantly disable a feature in production without a deployment" },
          { label: "Tech debt", description: "Remove flags after full rollout — abandoned flags become confusing dead code" },
        ],
        context: "Release management: 'How do you release a feature to 10% of users for testing?'",
        relatedItems: ["cicd-canary"],
        mnemonicHint: "Feature flag = light switch for features. Deploy dark, turn on when ready.",
      },
      {
        id: "cicd-iac",
        term: "Infrastructure as Code",
        description:
          "Define infrastructure in version-controlled files (Terraform, CloudFormation, Pulumi) instead of manual console clicks. Enables reproducibility, review, and automated provisioning.",
        details: [
          { label: "Terraform", description: "Multi-cloud IaC using HCL — plan shows changes before apply, state tracks resources" },
          { label: "Declarative", description: "Describe desired state, tool figures out how to get there — idempotent operations" },
          { label: "State management", description: "Remote state (S3 + DynamoDB lock) prevents conflicts in team environments" },
        ],
        context: "DevOps maturity: 'How do you ensure your staging environment matches production?'",
        relatedItems: ["aws-cloudformation", "cicd-gitops"],
        mnemonicHint: "IaC = infrastructure recipe in git. Plan = preview. Apply = execute. State = memory.",
      },
      {
        id: "cicd-gitops",
        term: "GitOps Principles",
        description:
          "Git is the single source of truth for infrastructure and application state. Changes are made via pull requests. Automated agents reconcile the desired state in git with the actual state in the cluster.",
        details: [
          { label: "Pull-based", description: "Agents (ArgoCD, Flux) pull desired state from git and apply to cluster — no push access needed" },
          { label: "Reconciliation loop", description: "Continuously compares actual vs desired state and fixes drift automatically" },
          { label: "Audit trail", description: "Every change is a git commit — who changed what, when, and why" },
        ],
        context: "Kubernetes deployment: 'How do you manage deployments to a Kubernetes cluster?'",
        relatedItems: ["cicd-iac", "cicd-pipeline-stages"],
        mnemonicHint: "GitOps = git commit = deploy. Agent watches repo, applies changes. Git history = audit log.",
      },
      {
        id: "cicd-rollback",
        term: "Rollback Strategies",
        description:
          "Techniques for reverting a bad deployment: re-deploy previous version, database migration rollback, feature flag kill switch, or traffic switching (blue/green). Speed of rollback determines incident duration.",
        details: [
          { label: "Redeploy previous", description: "Deploy the last known good version — requires immutable artifacts and fast pipelines" },
          { label: "Database rollback", description: "Backward-compatible migrations enable rollback — never drop columns in the same deploy" },
          { label: "Forward fix", description: "Sometimes faster to fix and deploy forward than roll back — depends on complexity" },
          { label: "Monitoring", description: "Automated rollback triggered by error rate thresholds — no human intervention needed" },
        ],
        context: "Incident response: 'Production is down after a deploy — what's your recovery plan?'",
        relatedItems: ["cicd-blue-green", "cicd-canary"],
        mnemonicHint: "Rollback = undo button. Previous artifact + backward-compatible DB = safe rollback.",
      },
    ],
  },

  // ─── Testing & Quality ────────────────────────────────────────
  {
    id: "testing-quality",
    name: "Testing & Quality",
    icon: "check",
    color: "red",
    items: [
      // Webpack (secondary — 4)
      {
        id: "webpack-loaders-plugins",
        term: "Webpack Loaders & Plugins",
        description:
          "Loaders transform individual files (babel-loader for JS, css-loader for CSS) during the build. Plugins operate on the entire compilation (HtmlWebpackPlugin, MiniCssExtractPlugin) for broader transformations.",
        details: [
          { label: "Loaders", description: "Chained right-to-left: use: ['style-loader', 'css-loader', 'sass-loader']" },
          { label: "Plugins", description: "Tap into webpack lifecycle hooks — broader scope than loaders" },
          { label: "test/include/exclude", description: "Rules target files by regex: test: /\\.tsx?$/ with include for performance" },
        ],
        context: "Build tooling: 'Explain the difference between loaders and plugins in webpack.'",
        relatedItems: ["webpack-code-splitting"],
        mnemonicHint: "Loader = file transformer (one at a time). Plugin = build process modifier (whole pipeline).",
      },
      {
        id: "webpack-code-splitting",
        term: "Webpack Code Splitting",
        description:
          "Splits the bundle into smaller chunks loaded on demand. Entry points, dynamic import(), and SplitChunksPlugin extract shared dependencies into separate files for better caching.",
        details: [
          { label: "Dynamic import()", description: "import('./module') creates a separate chunk loaded asynchronously at runtime" },
          { label: "SplitChunksPlugin", description: "Automatically extracts common dependencies shared between chunks" },
          { label: "Bundle analysis", description: "webpack-bundle-analyzer visualizes chunk sizes to identify optimization targets" },
        ],
        context: "Performance: 'Your app's initial bundle is 2MB — how do you reduce it?'",
        relatedItems: ["webpack-tree-shaking"],
        mnemonicHint: "Code splitting = don't load everything upfront. import() = load when needed.",
      },
      {
        id: "webpack-tree-shaking",
        term: "Tree Shaking",
        description:
          "Eliminates unused exports from the final bundle. Relies on ES module static structure (import/export) to determine which exports are referenced. Dead code is removed during minification.",
        details: [
          { label: "ESM required", description: "Only works with import/export — CommonJS require() is too dynamic to analyze" },
          { label: "sideEffects", description: "package.json sideEffects: false tells webpack it's safe to remove unused re-exports" },
          { label: "Minification", description: "Terser/esbuild removes the unreferenced code marked by tree shaking" },
        ],
        context: "Bundle optimization: 'Why is your lodash import pulling in the entire library?'",
        relatedItems: ["webpack-code-splitting"],
        mnemonicHint: "Tree shaking = shake the import tree, dead leaves (unused code) fall off.",
      },
      {
        id: "webpack-module-federation",
        term: "Module Federation",
        description:
          "Webpack 5 feature that allows multiple independently-built applications to share code at runtime. Enables micro-frontend architectures where apps load components from each other dynamically.",
        details: [
          { label: "Remote/Host", description: "Remote exposes modules; Host consumes them at runtime — no build-time dependency" },
          { label: "Shared dependencies", description: "Declare shared libraries (React) to avoid loading duplicates across federated apps" },
          { label: "Micro-frontends", description: "Each team builds and deploys independently; shell app composes them at runtime" },
        ],
        context: "Architecture: 'How do you split a monolithic frontend across multiple teams?'",
        relatedItems: ["webpack-code-splitting"],
        mnemonicHint: "Module Federation = apps sharing code at runtime. Like npm install but at runtime.",
      },
      // Vite (secondary — 4)
      {
        id: "vite-esm-dev",
        term: "Vite ESM-Based Dev Server",
        description:
          "Vite serves source files as native ES modules during development. The browser loads imports on demand via HTTP. No bundling during dev — only individual file transformation via esbuild.",
        details: [
          { label: "No bundling", description: "Files are served individually as ESM — the browser resolves imports itself" },
          { label: "esbuild", description: "Pre-bundles dependencies (node_modules) with esbuild — 10-100x faster than webpack" },
          { label: "Instant start", description: "Dev server starts in milliseconds regardless of app size — transforms on demand" },
        ],
        context: "Build tool comparison: 'Why is Vite's dev server faster than webpack's?'",
        relatedItems: ["vite-rollup-build"],
        mnemonicHint: "Vite dev = no bundling. Browser loads ESM directly. esbuild pre-bundles only node_modules.",
      },
      {
        id: "vite-rollup-build",
        term: "Vite Rollup-Based Production Build",
        description:
          "Vite uses Rollup for production builds, producing optimized, tree-shaken bundles with code splitting. Rollup's plugin ecosystem enables advanced transformations.",
        details: [
          { label: "Rollup", description: "Mature bundler optimized for library and application output — excellent tree shaking" },
          { label: "Automatic code splitting", description: "Dynamic import() and shared chunks are automatically handled" },
          { label: "CSS code splitting", description: "CSS is extracted per async chunk — loaded only when the chunk is needed" },
        ],
        context: "Build pipeline: 'How does Vite's production build differ from its dev server?'",
        relatedItems: ["vite-esm-dev"],
        mnemonicHint: "Dev = ESM + esbuild (fast). Prod = Rollup (optimized). Best of both worlds.",
      },
      {
        id: "vite-plugins",
        term: "Vite Plugin System",
        description:
          "Vite plugins extend Rollup's plugin interface with Vite-specific hooks. They can transform code, inject HTML, configure the dev server, and hook into the build pipeline.",
        details: [
          { label: "Rollup compatible", description: "Most Rollup plugins work in Vite — huge existing ecosystem" },
          { label: "Vite-specific hooks", description: "configureServer, transformIndexHtml, handleHotUpdate — dev server integration" },
          { label: "Official plugins", description: "@vitejs/plugin-react, @vitejs/plugin-vue — framework-specific optimizations" },
        ],
        context: "Extensibility: 'How would you add a custom code transformation to your Vite build?'",
        relatedItems: ["vite-rollup-build"],
        mnemonicHint: "Vite plugin = Rollup plugin + dev server hooks. Same interface, more capabilities.",
      },
      {
        id: "vite-hmr",
        term: "Vite Hot Module Replacement",
        description:
          "Vite's HMR updates modules in the browser without full page reload. Changes propagate instantly because Vite only needs to re-transform the changed file, not re-bundle the entire app.",
        details: [
          { label: "Granular updates", description: "Only the changed module and its direct importers are updated — not the entire bundle" },
          { label: "Framework integration", description: "React Fast Refresh, Vue HMR — preserve component state during edits" },
          { label: "CSS HMR", description: "Style changes apply instantly without any JavaScript re-execution" },
        ],
        context: "Developer experience: 'Why does Vite's HMR stay fast as the project grows?'",
        relatedItems: ["vite-esm-dev"],
        mnemonicHint: "HMR = live editing. Change a file → browser updates instantly. State preserved.",
      },
      // Testing Frameworks (primary — 8)
      {
        id: "testing-pyramid",
        term: "Unit vs Integration vs E2E Tests",
        description:
          "The testing pyramid: many unit tests (fast, isolated), fewer integration tests (modules together), fewest E2E tests (full user flows). Higher levels catch different bugs but are slower and more brittle.",
        details: [
          { label: "Unit", description: "Test a single function/component in isolation — milliseconds, deterministic" },
          { label: "Integration", description: "Test modules working together (API + DB, component + state) — seconds" },
          { label: "E2E", description: "Test full user flows in a real browser (Playwright, Cypress) — slow, but high confidence" },
          { label: "Testing trophy", description: "Kent C. Dodds' alternative: emphasize integration tests over unit tests" },
        ],
        context: "Testing strategy: 'What's your approach to testing a new feature?'",
        relatedItems: ["testing-jest", "testing-rtl"],
        mnemonicHint: "Pyramid = many unit (base), fewer integration (middle), few E2E (top). Trophy = integration-heavy.",
      },
      {
        id: "testing-jest",
        term: "Jest Matchers & Mocking",
        description:
          "Jest provides a batteries-included test runner with matchers (expect().toBe()), mocking (jest.fn(), jest.mock()), and assertion utilities for testing JavaScript applications.",
        details: [
          { label: "Matchers", description: "toBe (===), toEqual (deep), toContain, toThrow, toHaveBeenCalledWith" },
          { label: "jest.fn()", description: "Creates a mock function that records calls, arguments, and return values" },
          { label: "jest.mock()", description: "Replaces an entire module with a mock — auto-mocks all exports" },
          { label: "jest.spyOn()", description: "Wraps an existing method to track calls while preserving original implementation" },
        ],
        context: "Live coding: expect to write tests with proper assertions and mocking strategies.",
        relatedItems: ["testing-pyramid", "testing-doubles"],
        mnemonicHint: "toBe = same reference. toEqual = same shape. jest.fn = fake function. jest.mock = fake module.",
      },
      {
        id: "testing-rtl",
        term: "React Testing Library",
        description:
          "Tests React components the way users interact with them — by text, role, label, not implementation details. Encourages accessible markup and user-centric testing.",
        details: [
          { label: "Queries", description: "getByRole, getByText, getByLabelText — prioritize accessible queries over test IDs" },
          { label: "User events", description: "userEvent.click(), userEvent.type() — simulates real user interactions" },
          { label: "Async utilities", description: "waitFor(), findBy* — handle async state updates and data loading" },
          { label: "Philosophy", description: "Test behavior, not implementation. Don't test component internals or state values" },
        ],
        context: "Component testing: 'Test a form that validates on submit and shows error messages.'",
        relatedItems: ["testing-jest", "testing-pyramid"],
        mnemonicHint: "RTL = test like a user. getByRole > getByTestId. If the user can't find it, neither should your test.",
      },
      {
        id: "testing-doubles",
        term: "Test Doubles: Mocks, Stubs, Spies",
        description:
          "Test doubles replace real dependencies in tests. Stubs return canned data. Mocks verify interactions. Spies wrap real implementations to observe behavior without changing it.",
        details: [
          { label: "Stub", description: "Returns predetermined data — apiClient.get = () => Promise.resolve(fakeData)" },
          { label: "Mock", description: "Verifies it was called correctly — expect(mock).toHaveBeenCalledWith(expected)" },
          { label: "Spy", description: "Wraps the real implementation — records calls but executes original code" },
          { label: "Fake", description: "Lightweight working implementation — in-memory database instead of real PostgreSQL" },
        ],
        context: "Testing fundamentals: 'When do you use a mock vs. a stub?'",
        relatedItems: ["testing-jest"],
        mnemonicHint: "Stub = canned answer. Mock = checks behavior. Spy = watches without interfering. Fake = simple replacement.",
      },
      {
        id: "testing-coverage",
        term: "Coverage Metrics",
        description:
          "Code coverage measures how much code is exercised by tests: line, branch, function, and statement coverage. High coverage doesn't guarantee good tests — it's a necessary but not sufficient metric.",
        details: [
          { label: "Line coverage", description: "Percentage of source code lines executed during tests" },
          { label: "Branch coverage", description: "Percentage of conditional branches (if/else, ternary) taken — more meaningful than line" },
          { label: "100% myth", description: "100% coverage doesn't mean bug-free — tests might execute code without meaningful assertions" },
          { label: "Mutation testing", description: "Introduces bugs (mutations) and checks if tests catch them — measures test effectiveness" },
        ],
        context: "Quality metrics: 'What coverage threshold do you aim for and why?'",
        relatedItems: ["testing-pyramid"],
        mnemonicHint: "Coverage = how much code your tests touch. Branch > line. Mutation testing = testing your tests.",
      },
      {
        id: "testing-snapshot",
        term: "Snapshot Testing",
        description:
          "Captures rendered output (HTML, JSON) and compares against a stored snapshot. Fails when output changes, forcing review. Good for catching unintended changes; bad as the sole testing strategy.",
        details: [
          { label: "Jest snapshots", description: "expect(component).toMatchSnapshot() — creates/updates .snap files" },
          { label: "Inline snapshots", description: "toMatchInlineSnapshot() — stores the snapshot directly in the test file" },
          { label: "Pitfalls", description: "Large snapshots become noise — developers blindly update without reviewing changes" },
        ],
        context: "Testing trade-offs: 'When are snapshot tests valuable vs. harmful?'",
        relatedItems: ["testing-jest", "testing-rtl"],
        mnemonicHint: "Snapshot = photograph of output. Compare photos to catch changes. Too big = useless.",
      },
      {
        id: "testing-async",
        term: "Async Testing Patterns",
        description:
          "Testing asynchronous code requires handling promises, timers, and callbacks. Jest provides async/await support, fake timers (jest.useFakeTimers), and utilities for testing resolved/rejected promises.",
        details: [
          { label: "async/await", description: "test('name', async () => { const result = await fetchData(); expect(result)... })" },
          { label: "Fake timers", description: "jest.useFakeTimers() + jest.advanceTimersByTime(1000) — control setTimeout/setInterval" },
          { label: "resolves/rejects", description: "expect(promise).resolves.toBe(value) or expect(promise).rejects.toThrow()" },
          { label: "waitFor", description: "RTL's waitFor(() => expect(el).toBeVisible()) retries until assertion passes or timeout" },
        ],
        context: "Practical testing: 'How do you test a component that fetches data on mount?'",
        relatedItems: ["testing-jest", "testing-rtl"],
        mnemonicHint: "async test = await the result. Fake timers = control time. waitFor = retry until true.",
      },
      {
        id: "testing-tdd-bdd",
        term: "TDD vs BDD",
        description:
          "TDD (Test-Driven Development): write a failing test → make it pass → refactor. BDD (Behavior-Driven Development): describe behavior in Given/When/Then scenarios using natural language.",
        details: [
          { label: "TDD cycle", description: "Red (fail) → Green (pass) → Refactor. Short cycles, tests drive design" },
          { label: "BDD syntax", description: "describe/it/expect pattern: describe('Cart') → it('should add items') → expect(...)" },
          { label: "Given/When/Then", description: "Given (setup), When (action), Then (assertion) — readable by non-developers" },
          { label: "Practical blend", description: "Most teams use BDD-style syntax (describe/it) with TDD-style workflow" },
        ],
        context: "Process question: 'Do you write tests before or after code? Why?'",
        relatedItems: ["testing-pyramid"],
        mnemonicHint: "TDD = test first, code second. BDD = behavior first, test second. Both = test before ship.",
      },
    ],
  },

  // ─── API & Communication ──────────────────────────────────────
  {
    id: "api-communication",
    name: "API & Communication",
    icon: "plug",
    color: "indigo",
    items: [
      // OpenAI API (primary — 8)
      {
        id: "openai-chat-completions",
        term: "Chat Completions API",
        description:
          "The core OpenAI endpoint for generating text. Accepts an array of messages (system, user, assistant) and returns a completion. Supports temperature, max_tokens, and response_format parameters.",
        details: [
          { label: "Messages array", description: "Conversation history: [{role: 'system', content: '...'}, {role: 'user', content: '...'}]" },
          { label: "Temperature", description: "0 = deterministic, 1 = creative. Lower for factual tasks, higher for creative tasks" },
          { label: "Response format", description: "response_format: { type: 'json_object' } ensures valid JSON output" },
          { label: "Models", description: "gpt-4o (multimodal), gpt-4o-mini (fast, cheap), o1 (reasoning) — choose by task" },
        ],
        context: "AI integration: expect to design a chat feature using the completions API with proper prompting.",
        relatedItems: ["openai-function-calling", "openai-streaming"],
        mnemonicHint: "Messages array = conversation. System = rules. User = question. Assistant = answer. Temperature = creativity dial.",
      },
      {
        id: "openai-function-calling",
        term: "Function Calling / Tool Use",
        description:
          "The model can decide to call functions you define. You provide function schemas (name, description, parameters as JSON Schema). The model returns a function call with arguments; you execute it and return the result.",
        details: [
          { label: "Tools array", description: "Define tools with type: 'function', name, description, and parameters JSON Schema" },
          { label: "tool_choice", description: "'auto' (model decides), 'required' (must call), or specific function name" },
          { label: "Multi-turn", description: "Model calls function → you run it → send result as tool message → model generates final response" },
          { label: "Parallel calls", description: "Model can call multiple functions in a single response for efficiency" },
        ],
        context: "Agent architecture: 'How do you let an AI book a meeting or query a database?'",
        relatedItems: ["openai-chat-completions", "langchain-agents"],
        mnemonicHint: "Function calling = AI picks which tool to use. You define tools as JSON Schema. AI calls, you execute.",
      },
      {
        id: "openai-embeddings",
        term: "Embeddings API",
        description:
          "Converts text into dense vectors (1536 or 3072 dimensions) capturing semantic meaning. Similar texts have high cosine similarity. Used for search, clustering, recommendation, and RAG.",
        details: [
          { label: "text-embedding-3-small", description: "1536 dimensions, cheap — good for most use cases" },
          { label: "Cosine similarity", description: "Measures angle between vectors: 1 = identical meaning, 0 = unrelated" },
          { label: "Batch embedding", description: "Send up to 2048 texts in one request for efficiency" },
          { label: "RAG pipeline", description: "Embed documents → store in vector DB → embed query → find similar docs → send to LLM" },
        ],
        context: "Semantic search: 'How would you build a search feature that understands meaning, not just keywords?'",
        relatedItems: ["openai-chat-completions", "langchain-rag"],
        mnemonicHint: "Embedding = text → number array. Similar meaning → similar numbers. Cosine similarity = closeness.",
      },
      {
        id: "openai-streaming",
        term: "Streaming Responses",
        description:
          "Stream completions token-by-token using Server-Sent Events (SSE). The response arrives incrementally, reducing perceived latency. Each chunk contains a delta with the next token.",
        details: [
          { label: "stream: true", description: "Enable in the API request — response becomes an SSE stream of chunk objects" },
          { label: "Delta content", description: "Each chunk has choices[0].delta.content — concatenate to build the full response" },
          { label: "ReadableStream", description: "In browsers, use ReadableStream + TextDecoder to process SSE chunks" },
          { label: "Finish reason", description: "Last chunk has finish_reason: 'stop' (complete) or 'length' (truncated)" },
        ],
        context: "UX pattern: 'How do you show the AI response as it types, like ChatGPT?'",
        relatedItems: ["openai-chat-completions"],
        mnemonicHint: "Streaming = typewriter effect. Token by token via SSE. Don't wait for the whole answer.",
      },
      {
        id: "openai-tokens",
        term: "Token Counting & Context Windows",
        description:
          "LLMs process text as tokens (roughly 4 chars in English). Each model has a context window limit (input + output tokens). Managing token budget is critical for cost and functionality.",
        details: [
          { label: "Token estimation", description: "~4 chars per token in English. tiktoken library for exact counts" },
          { label: "Context window", description: "gpt-4o: 128K tokens. o1: 200K tokens. Includes system prompt + history + response" },
          { label: "Cost", description: "Billed per input and output token — prompt caching reduces input costs for repeated prefixes" },
          { label: "Truncation", description: "Trim oldest messages to fit context window while preserving system prompt and recent messages" },
        ],
        context: "Cost optimization: 'Your AI feature costs $500/day — how do you reduce token usage?'",
        relatedItems: ["openai-chat-completions"],
        mnemonicHint: "Token ≈ 4 characters. Context window = memory limit. More tokens = more cost. Trim history to fit.",
      },
      {
        id: "openai-system-prompts",
        term: "System Prompts & Few-Shot Learning",
        description:
          "System messages set the AI's behavior, tone, and constraints. Few-shot examples (user/assistant pairs before the real question) demonstrate the desired output format and reasoning pattern.",
        details: [
          { label: "System prompt", description: "First message with role: 'system' — defines persona, rules, and output format" },
          { label: "Few-shot", description: "Include 2-5 example user/assistant pairs to demonstrate the expected behavior" },
          { label: "Chain-of-thought", description: "Ask the model to 'think step by step' for better reasoning on complex tasks" },
          { label: "Guardrails", description: "System prompt constraints: 'Only answer questions about X. If unsure, say so.'" },
        ],
        context: "Prompt engineering: 'How do you ensure consistent, high-quality AI output?'",
        relatedItems: ["openai-chat-completions"],
        mnemonicHint: "System prompt = AI's job description. Few-shot = showing examples. Chain-of-thought = think out loud.",
      },
      {
        id: "openai-fine-tuning",
        term: "Fine-Tuning API",
        description:
          "Train a custom model on your data to learn specific patterns, tone, or domain knowledge. Upload training data (JSONL format), create a fine-tuning job, and use the resulting model ID.",
        details: [
          { label: "Training data", description: "JSONL file of {messages: [{role, content}]} conversations — at least 10, ideally 50-100+" },
          { label: "When to fine-tune", description: "When few-shot prompting doesn't reliably produce the desired format, tone, or domain accuracy" },
          { label: "Hyperparameters", description: "n_epochs, learning_rate_multiplier, batch_size — usually defaults work well" },
          { label: "Evaluation", description: "Split data into train/validation — monitor validation loss to detect overfitting" },
        ],
        context: "AI product: 'When should you fine-tune vs. use prompt engineering?'",
        relatedItems: ["openai-chat-completions", "openai-system-prompts"],
        mnemonicHint: "Fine-tune = teach the model your style. JSONL examples in → custom model out. Expensive but powerful.",
      },
      {
        id: "openai-rate-limiting",
        term: "Rate Limiting & Retry Logic",
        description:
          "OpenAI enforces rate limits on requests per minute (RPM) and tokens per minute (TPM). Implement exponential backoff with jitter for retries. Use batch API for non-real-time workloads.",
        details: [
          { label: "429 status", description: "Rate limited — retry with exponential backoff: wait 1s, 2s, 4s, 8s..." },
          { label: "Jitter", description: "Add random delay to backoff to prevent thundering herd when many clients retry simultaneously" },
          { label: "Batch API", description: "Submit batch requests for 50% cost reduction — results available within 24 hours" },
          { label: "Tier limits", description: "Limits increase with usage tier — Tier 1 starts at 500 RPM, Tier 5 is 10,000 RPM" },
        ],
        context: "Production AI: 'How do you handle OpenAI rate limits in a high-traffic application?'",
        relatedItems: ["openai-tokens", "rest-rate-limiting"],
        mnemonicHint: "429 = slow down. Exponential backoff = wait longer each time. Jitter = don't all retry together.",
      },
      // Google AI (secondary — 4)
      {
        id: "google-ai-gemini",
        term: "Gemini API",
        description:
          "Google's multimodal AI model family accessed via the Gemini API or Vertex AI. Supports text, image, video, and audio inputs. Models: Gemini 2.0 Flash (fast), Gemini 2.0 Pro (capable).",
        details: [
          { label: "Multimodal native", description: "Process text, images, audio, and video in a single request — no separate vision model" },
          { label: "Long context", description: "Up to 2M token context window — process entire codebases or books" },
          { label: "Google AI Studio", description: "Free playground for prototyping prompts and generating API keys" },
        ],
        context: "Multi-cloud AI: compare with OpenAI's models — know the strengths of each.",
        relatedItems: ["openai-chat-completions"],
        mnemonicHint: "Gemini = Google's GPT. Natively multimodal. 2M tokens = huge context. Flash = fast, Pro = capable.",
      },
      {
        id: "google-ai-vertex",
        term: "Vertex AI Platform",
        description:
          "Google Cloud's ML platform for training, deploying, and managing models. Includes Gemini API, Model Garden (100+ models), AutoML, and managed endpoints for custom models.",
        details: [
          { label: "Model Garden", description: "Pre-trained models (Gemini, Llama, Mistral) deployable with one click" },
          { label: "Pipelines", description: "Orchestrate ML workflows: data prep → training → evaluation → deployment" },
          { label: "Feature Store", description: "Managed storage for ML features with online/offline serving" },
        ],
        context: "Enterprise AI: 'How do you deploy and manage ML models at scale?'",
        relatedItems: ["google-ai-gemini"],
        mnemonicHint: "Vertex AI = Google's ML factory. Train, deploy, manage. Model Garden = model marketplace.",
      },
      {
        id: "google-ai-multimodal",
        term: "Multimodal AI Input",
        description:
          "Sending multiple input types (text + images, text + video) in a single API call. Models process all modalities together for richer understanding than text-only.",
        details: [
          { label: "Image input", description: "Base64-encoded or URL reference. Model can describe, analyze, OCR, or reason about images" },
          { label: "Video input", description: "Upload to API or provide Cloud Storage URI. Model analyzes frames and audio together" },
          { label: "Structured output", description: "Combine multimodal input with JSON response format for structured data extraction" },
        ],
        context: "AI features: 'Build a feature that extracts data from uploaded receipts.'",
        relatedItems: ["google-ai-gemini", "openai-chat-completions"],
        mnemonicHint: "Multimodal = feed text + images + video together. AI sees and reads simultaneously.",
      },
      {
        id: "google-ai-safety",
        term: "AI Safety Settings",
        description:
          "Google AI APIs include configurable safety filters for harmful content categories: harassment, hate speech, sexually explicit, and dangerous content. Each can be set to block at different thresholds.",
        details: [
          { label: "Categories", description: "HARM_CATEGORY_HARASSMENT, HATE_SPEECH, SEXUALLY_EXPLICIT, DANGEROUS_CONTENT" },
          { label: "Thresholds", description: "BLOCK_NONE, BLOCK_LOW_AND_ABOVE, BLOCK_MEDIUM_AND_ABOVE, BLOCK_ONLY_HIGH" },
          { label: "Safety ratings", description: "Response includes per-category probability ratings — NEGLIGIBLE, LOW, MEDIUM, HIGH" },
        ],
        context: "Responsible AI: 'How do you ensure your AI feature doesn't generate harmful content?'",
        relatedItems: ["google-ai-gemini"],
        mnemonicHint: "Safety settings = content filter knobs. Set thresholds per harm category. BLOCK_NONE = no filter.",
      },
      // TensorFlow.js (secondary — 4)
      {
        id: "tensorflowjs-tensors",
        term: "Tensors & Operations",
        description:
          "Tensors are multi-dimensional arrays — the fundamental data structure of TF.js. Operations (add, matMul, conv2d) run on WebGL GPU backend for hardware-accelerated computation in the browser.",
        details: [
          { label: "Tensor creation", description: "tf.tensor([1, 2, 3]), tf.zeros([3, 3]), tf.randomNormal([100, 10])" },
          { label: "Operations", description: "tf.add(), tf.matMul(), tf.relu() — chainable and GPU-accelerated" },
          { label: "Memory management", description: "tf.dispose() and tf.tidy(() => {...}) prevent GPU memory leaks" },
        ],
        context: "Browser ML: 'How do you run neural network inference without a server?'",
        relatedItems: ["tensorflowjs-pretrained"],
        mnemonicHint: "Tensor = n-dimensional array. tf.tidy = auto-cleanup. WebGL = GPU power in the browser.",
      },
      {
        id: "tensorflowjs-pretrained",
        term: "Pre-trained Models (tfjs-models)",
        description:
          "Ready-to-use models for common tasks: object detection (COCO-SSD), pose estimation (MoveNet), image classification (MobileNet), text toxicity, and natural language processing.",
        details: [
          { label: "COCO-SSD", description: "Object detection — identifies and locates 80 object categories in images/video" },
          { label: "MoveNet", description: "Real-time pose estimation — tracks 17 body keypoints at 30+ FPS" },
          { label: "Universal Sentence Encoder", description: "Text embeddings in the browser — semantic search without a server" },
        ],
        context: "Browser AI: 'Add real-time object detection to a webcam feed using only JavaScript.'",
        relatedItems: ["tensorflowjs-tensors"],
        mnemonicHint: "tfjs-models = pre-trained ML in a npm package. Load model → feed data → get predictions.",
      },
      {
        id: "tensorflowjs-transfer-learning",
        term: "Transfer Learning in Browser",
        description:
          "Take a pre-trained model (like MobileNet) and retrain the final layers on your own data, in the browser. Enables custom classification with just a few examples, no server needed.",
        details: [
          { label: "Base model", description: "Load MobileNet, freeze early layers (feature extraction), replace final layer" },
          { label: "Few examples", description: "Webcam-based: capture 10-50 examples per class, train in seconds in the browser" },
          { label: "model.fit()", description: "Train in browser using WebGL — small datasets train in seconds, larger ones in minutes" },
        ],
        context: "Custom ML: 'Build a custom image classifier that learns from user examples in real time.'",
        relatedItems: ["tensorflowjs-pretrained"],
        mnemonicHint: "Transfer learning = reuse big model's knowledge. Retrain the last layer. Works in the browser.",
      },
      {
        id: "tensorflowjs-webgl",
        term: "TF.js WebGL Backend",
        description:
          "TF.js uses WebGL shaders to run tensor operations on the GPU. This provides 10-100x speedup over CPU for matrix operations. WebGPU backend (experimental) offers even better performance.",
        details: [
          { label: "WebGL", description: "Default backend — uses GPU shaders for parallel computation. 10-100x faster than CPU" },
          { label: "WASM backend", description: "Fallback for devices without WebGL — uses WebAssembly SIMD for decent performance" },
          { label: "WebGPU", description: "Next-gen GPU API — more efficient than WebGL, direct compute shader access" },
        ],
        context: "Performance: 'How does ML inference run fast in the browser without a GPU server?'",
        relatedItems: ["tensorflowjs-tensors"],
        mnemonicHint: "WebGL = GPU in the browser. TF.js turns math into shader programs. WASM = CPU fallback.",
      },
      // LangChain (secondary — 4)
      {
        id: "langchain-lcel",
        term: "LangChain Chains & LCEL",
        description:
          "LCEL (LangChain Expression Language) composes components using the pipe operator. Chains connect prompts → models → output parsers into reusable, streamable pipelines.",
        details: [
          { label: "Pipe operator", description: "prompt | model | parser — data flows left to right through components" },
          { label: "Runnable interface", description: "Every component implements invoke(), stream(), batch() — uniform API" },
          { label: "RunnablePassthrough", description: "Passes input through unchanged — useful for injecting context alongside user input" },
        ],
        context: "LLM application architecture: 'How do you compose reusable AI pipelines?'",
        relatedItems: ["langchain-agents", "langchain-rag"],
        mnemonicHint: "LCEL = pipe operator for AI. prompt | model | parser. Each piece is a Runnable.",
      },
      {
        id: "langchain-agents",
        term: "LangChain Agents & Tools",
        description:
          "Agents use LLMs to decide which tools to call and in what order to accomplish a task. The agent loop: observe → think → act → repeat until the task is complete.",
        details: [
          { label: "ReAct pattern", description: "Reasoning + Acting: model generates thought, decides action, observes result, repeats" },
          { label: "Tools", description: "Functions the agent can call — search, calculator, database query, API calls" },
          { label: "AgentExecutor", description: "Orchestrates the agent loop — handles tool execution, error recovery, and max iterations" },
          { label: "LangGraph", description: "State machine framework for building more complex, controllable agent workflows" },
        ],
        context: "AI agents: 'How do you build an AI that can search the web and answer questions from results?'",
        relatedItems: ["langchain-lcel", "openai-function-calling"],
        mnemonicHint: "Agent = AI that uses tools. Think → Act → Observe → Repeat. LangGraph = agent as state machine.",
      },
      {
        id: "langchain-rag",
        term: "RAG Pattern (Retrieval-Augmented Generation)",
        description:
          "Augment LLM responses with retrieved context from a knowledge base. Pipeline: embed query → search vector DB → inject top-K results into prompt → generate answer with citations.",
        details: [
          { label: "Indexing", description: "Split documents into chunks → embed with embedding model → store in vector database" },
          { label: "Retrieval", description: "Embed user query → cosine similarity search → return top-K most relevant chunks" },
          { label: "Generation", description: "Inject retrieved context into system prompt → LLM generates grounded answer" },
          { label: "Evaluation", description: "Measure retrieval precision/recall and answer faithfulness (no hallucination)" },
        ],
        context: "AI product: 'How would you build a chatbot that answers questions about company documentation?'",
        relatedItems: ["openai-embeddings", "langchain-lcel"],
        mnemonicHint: "RAG = search then answer. Embed → retrieve → generate. The model reads your docs before answering.",
      },
      {
        id: "langchain-memory",
        term: "LangChain Memory & Chat History",
        description:
          "Memory persists conversation context across turns. Buffer memory stores raw messages. Summary memory condenses history to save tokens. Window memory keeps only the last N messages.",
        details: [
          { label: "ConversationBufferMemory", description: "Stores all messages — simple but grows unbounded with long conversations" },
          { label: "ConversationSummaryMemory", description: "Periodically summarizes history to save tokens — loses detail" },
          { label: "ConversationBufferWindowMemory", description: "Keeps last K messages — balances context and token cost" },
          { label: "Vector store memory", description: "Embeds and retrieves relevant past messages — scalable for long conversations" },
        ],
        context: "Chat applications: 'How do you maintain conversation context without exceeding the token limit?'",
        relatedItems: ["openai-tokens", "langchain-lcel"],
        mnemonicHint: "Buffer = remember everything. Summary = remember the gist. Window = remember recent. Vector = remember relevant.",
      },
      // REST APIs (primary — 8)
      {
        id: "rest-http-methods",
        term: "HTTP Methods & Idempotency",
        description:
          "REST APIs map CRUD operations to HTTP methods: GET (read), POST (create), PUT (full update), PATCH (partial update), DELETE (remove). Idempotent methods produce the same result on repeated calls.",
        details: [
          { label: "GET", description: "Read-only, cacheable, idempotent — never modify data on GET" },
          { label: "POST", description: "Create a resource — NOT idempotent (each call may create a new resource)" },
          { label: "PUT", description: "Replace entire resource — idempotent (same result whether called 1 or 100 times)" },
          { label: "PATCH", description: "Partial update — may or may not be idempotent depending on implementation" },
        ],
        context: "API design fundamental — expect to choose the right method for each operation.",
        relatedItems: ["rest-status-codes", "rest-versioning"],
        mnemonicHint: "GET = read. POST = create. PUT = replace. PATCH = update. DELETE = remove. Idempotent = repeatable safely.",
      },
      {
        id: "rest-status-codes",
        term: "HTTP Status Codes",
        description:
          "Status codes communicate the result: 2xx (success), 3xx (redirect), 4xx (client error), 5xx (server error). Using correct codes makes APIs self-documenting and debuggable.",
        details: [
          { label: "200/201/204", description: "OK / Created / No Content (successful DELETE)" },
          { label: "400/401/403/404", description: "Bad Request / Unauthorized (no auth) / Forbidden (no permission) / Not Found" },
          { label: "409/422", description: "Conflict (duplicate) / Unprocessable Entity (validation failed)" },
          { label: "429/500/503", description: "Too Many Requests (rate limit) / Internal Error / Service Unavailable" },
        ],
        context: "API design: 'What status code do you return when a user tries to create a duplicate username?'",
        relatedItems: ["rest-http-methods"],
        mnemonicHint: "2xx = success. 4xx = your fault. 5xx = our fault. 401 = who are you? 403 = you can't do that.",
      },
      {
        id: "rest-auth",
        term: "Authentication: JWT & OAuth 2.0",
        description:
          "JWT (JSON Web Token) is a self-contained token with encoded claims, signed for integrity. OAuth 2.0 is an authorization framework where users grant limited access to third-party apps.",
        details: [
          { label: "JWT structure", description: "header.payload.signature — base64url encoded, signed with secret or RSA key" },
          { label: "Access + Refresh", description: "Short-lived access token (15 min) + long-lived refresh token (7 days) — rotate securely" },
          { label: "OAuth 2.0 flows", description: "Authorization Code (web), PKCE (SPA/mobile), Client Credentials (server-to-server)" },
          { label: "JWT pitfalls", description: "Can't be revoked without a blocklist. Don't store sensitive data in payload (it's not encrypted)" },
        ],
        context: "Security: 'How do you implement secure authentication in a REST API?'",
        relatedItems: ["rest-http-methods"],
        mnemonicHint: "JWT = passport (self-contained, signed). OAuth = 'Login with Google' (delegated access). Refresh = renew without re-login.",
      },
      {
        id: "rest-versioning",
        term: "API Versioning Strategies",
        description:
          "API versioning enables backward-incompatible changes without breaking existing clients. Strategies: URL path (/v1/), query parameter (?version=1), or custom header (Accept: application/vnd.api+v1).",
        details: [
          { label: "URL path", description: "/api/v1/users — most common, explicit, easy to route. Creates URL duplication" },
          { label: "Header-based", description: "Accept: application/vnd.myapp.v2+json — cleaner URLs but harder to test in browser" },
          { label: "Semantic versioning", description: "Major version in URL for breaking changes. Minor/patch changes are backward compatible" },
        ],
        context: "API evolution: 'How do you introduce a breaking change without affecting existing mobile app users?'",
        relatedItems: ["rest-http-methods"],
        mnemonicHint: "URL versioning = simple, visible. Header versioning = clean URLs. Version on breaking changes only.",
      },
      {
        id: "rest-hateoas",
        term: "HATEOAS",
        description:
          "Hypermedia As The Engine Of Application State — responses include links to related actions and resources. Clients discover API capabilities by following links rather than hardcoding URLs.",
        details: [
          { label: "Links in response", description: '{ "data": {...}, "links": { "self": "/orders/123", "cancel": "/orders/123/cancel" } }' },
          { label: "Discoverability", description: "Client doesn't need to construct URLs — just follow links from responses" },
          { label: "Richardson Maturity", description: "Level 3 of REST maturity model — most APIs stop at Level 2 (HTTP verbs + resources)" },
        ],
        context: "API design: advanced REST concept — shows understanding of REST beyond basic CRUD.",
        relatedItems: ["rest-http-methods"],
        mnemonicHint: "HATEOAS = API responses include menu of next actions. Like web pages with clickable links.",
      },
      {
        id: "rest-rate-limiting",
        term: "Rate Limiting Strategies",
        description:
          "Protect APIs from abuse by limiting request frequency. Common algorithms: token bucket (smooth, bursty), sliding window (accurate), and fixed window (simple). Return 429 with Retry-After header.",
        details: [
          { label: "Token bucket", description: "Tokens added at fixed rate, consumed per request. Allows bursts up to bucket capacity" },
          { label: "Sliding window", description: "Counts requests in a rolling time window — more accurate than fixed window" },
          { label: "Rate limit headers", description: "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset — inform clients" },
          { label: "Keying", description: "Rate limit by IP, API key, or user ID — different limits for different tiers" },
        ],
        context: "System design: 'How do you protect your API from a misbehaving client sending 10K req/sec?'",
        relatedItems: ["rest-status-codes", "openai-rate-limiting"],
        mnemonicHint: "Token bucket = dripping faucet fills a bucket. Each request drains one token. Empty = 429.",
      },
      {
        id: "rest-pagination",
        term: "Pagination Strategies",
        description:
          "Break large result sets into pages. Offset-based (page + limit) is simple but slow for deep pages. Cursor-based (after=id) is efficient and consistent. Keyset pagination uses indexed columns.",
        details: [
          { label: "Offset", description: "?page=3&limit=20 — simple but slow for page 10,000 (scans all previous rows)" },
          { label: "Cursor", description: "?after=abc123&limit=20 — uses last item's ID as cursor. O(1) for any page depth" },
          { label: "Response format", description: "Include total, hasMore/nextCursor, pageSize in response metadata" },
          { label: "Trade-off", description: "Offset allows jumping to any page. Cursor is faster but sequential only" },
        ],
        context: "API design: 'How do you paginate a feed with millions of items?'",
        relatedItems: ["rest-http-methods"],
        mnemonicHint: "Offset = page number (slow for deep pages). Cursor = bookmark (fast, always O(1)). Use cursor for feeds.",
      },
      {
        id: "rest-openapi",
        term: "OpenAPI / Swagger",
        description:
          "OpenAPI Specification (formerly Swagger) is a standard for describing REST APIs in YAML/JSON. Enables auto-generated documentation, client SDKs, request validation, and API testing.",
        details: [
          { label: "Specification", description: "Define paths, methods, parameters, request/response schemas, and auth in one document" },
          { label: "Swagger UI", description: "Auto-generated interactive API documentation from the OpenAPI spec" },
          { label: "Code generation", description: "Generate client SDKs, server stubs, and TypeScript types from the spec" },
          { label: "Design-first", description: "Write the spec before code — ensures API design is reviewed and agreed upon" },
        ],
        context: "API documentation: 'How do you keep API documentation in sync with the code?'",
        relatedItems: ["rest-http-methods", "rest-versioning"],
        mnemonicHint: "OpenAPI = API blueprint. YAML/JSON spec → docs + SDKs + validation. Single source of truth.",
      },
    ],
  },
];

async function main() {
  console.log("Generating memorize cards for Ampcus Full Stack Engineer – AI\n");

  // Count items
  let total = 0;
  for (const cat of categories) {
    console.log(`  ${cat.name}: ${cat.items.length} items`);
    total += cat.items.length;
  }
  console.log(`  Total: ${total} items\n`);

  // Save categories to application row
  await db
    .update(schema.applications)
    .set({ aiMemorizeCategories: JSON.stringify(categories) })
    .where(eq(schema.applications.id, APP_ID));

  console.log("  ✓ Saved categories to application row\n");

  // Upsert concepts
  let conceptCount = 0;
  for (const cat of categories) {
    for (const item of cat.items) {
      const conceptName = `app:${APP_ID}:${item.id}`;
      await db
        .insert(schema.concepts)
        .values({
          name: conceptName,
          description: item.description,
          conceptType: "skill",
          metadata: {
            term: item.term,
            details: item.details,
            context: item.context,
            relatedItems: item.relatedItems,
            mnemonicHint: item.mnemonicHint,
          },
        })
        .onConflictDoUpdate({
          target: schema.concepts.name,
          set: {
            description: item.description,
            metadata: {
              term: item.term,
              details: item.details,
              context: item.context,
              relatedItems: item.relatedItems,
              mnemonicHint: item.mnemonicHint,
            },
          },
        });
      conceptCount++;
    }
  }

  console.log(`  ✓ Upserted ${conceptCount} concepts\n`);
  console.log("Done. Reload the memorize page to see the cards.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
