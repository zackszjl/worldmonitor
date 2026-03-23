export const config = { runtime: 'edge' };

export default async function handler() {
  try {
    const upstream = await fetch('https://maps.worldmonitor.app/countries.geojson', {
      headers: { Accept: 'application/geo+json, application/json;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(15000),
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch countries geojson', status: upstream.status }), {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300, stale-if-error=86400',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const body = await upstream.text();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('content-type') || 'application/geo+json; charset=utf-8',
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600, stale-if-error=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'countries geojson proxy failed', details: error?.message || String(error) }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
