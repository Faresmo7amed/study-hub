// Forwards /api/* on your Pages site to the Study Hub Worker.
// The browser only talks to pages.dev (not blocked); Cloudflare talks to the Worker inside its own network.
// Optional: set WORKER_URL in Pages > Settings > Environment variables to point somewhere else.
const DEFAULT_WORKER = 'https://studyhub-worker.farsmohamed122.workers.dev'

export async function onRequest({ request, env }) {
    const url = new URL(request.url)
    const target = new URL(url.pathname.replace(/^\/api/, '') || '/', env.WORKER_URL || DEFAULT_WORKER)
    target.search = url.search
    return fetch(new Request(target, request))
}
