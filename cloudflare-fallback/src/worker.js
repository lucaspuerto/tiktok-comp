const REPO = "lucaspuerto/tiktok-comp";
const PAGES_BACKUP = "https://tiktok-comp.pages.dev";
const GITHUB_PAGES_BACKUP = "https://lucaspuerto.github.io/tiktok-comp";

export default {
  async fetch(request, env, ctx) {
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    }

    const url = new URL(request.url);
    let path = decodeURIComponent(url.pathname);
    if (path === '/' || path === '') path = '/index.html';
    if (path === '/admin') path = '/admin.html';
    if (path.includes('..') || path.includes('\0')) {
      return new Response('Bad Request', { status: 400 });
    }

    const cache = caches.default;
    const cacheKey = new Request(
      new URL(`${path}?worker-cache=v4`, 'https://tiktok-comp-cache.internal'),
      { method: 'GET' },
    );
    const cached = await cache.match(cacheKey);
    if (cached) return headAware(request, cached);

    let response;
    try {
      const commitResponse = await fetch(
        `https://api.github.com/repos/${REPO}/commits/main`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'cloudflare-tiktok-comp-fallback',
          },
          cf: { cacheTtl: 60, cacheEverything: true },
        },
      );
      if (!commitResponse.ok) {
        throw new Error(`GitHub commit API: ${commitResponse.status}`);
      }

      const { sha } = await commitResponse.json();
      const rawResponse = await fetch(
        `https://raw.githubusercontent.com/${REPO}/${sha}${path}`,
        {
          headers: { 'User-Agent': 'cloudflare-tiktok-comp-fallback' },
          cf: { cacheTtl: 120, cacheEverything: true },
        },
      );
      if (!rawResponse.ok) {
        throw new Error(`GitHub raw: ${rawResponse.status}`);
      }

      response = safeResponse(rawResponse);
      response.headers.set('X-Tiktok-Comp-Source', 'github-raw');
      response.headers.set('X-Tiktok-Comp-Commit', sha);
    } catch {
      response = await fetch(`${PAGES_BACKUP}${path}${url.search}`);
      if (!response.ok) {
        response = await fetch(`${GITHUB_PAGES_BACKUP}${path}${url.search}`);
      }
      response = safeResponse(response);
      response.headers.set('X-Tiktok-Comp-Source', 'backup');
    }

    response.headers.set(
      'Cache-Control',
      'public, max-age=60, s-maxage=120, stale-while-revalidate=300',
    );
    if (path.endsWith('.html')) {
      response.headers.set('Content-Type', 'text/html; charset=utf-8');
    }
    response.headers.set('X-Content-Type-Options', 'nosniff');
    if (response.ok) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return headAware(request, response);
  },
};

function headAware(request, response) {
  return request.method === 'HEAD'
    ? new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    : response;
}

function safeResponse(upstream) {
  const headers = new Headers();
  for (const name of ['content-type', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
