const axios = require('axios');

// Search helper. If SERPAPI_KEY is provided, uses SerpAPI (Google results).
// Otherwise returns an empty array; replace with your preferred search provider.
async function search(query, opts = { limit: 6 }) {
  const { limit } = opts;
  const key = process.env.SERPAPI_KEY;
  if (!key) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      engine: 'google',
      q: query,
      api_key: key,
      num: String(limit),
    });
    const url = `https://serpapi.com/search.json?${params.toString()}`;
    const resp = await axios.get(url, { timeout: 10_000 });
    const results = resp.data?.organic_results || [];
    const badHosts = ["webcache.googleusercontent.com", "policies.google.com"];
    const cleaned = results.slice(0, limit * 2).map(r => ({
      title: r.title || r.snippet || 'Untitled',
      url: r.link || r.url || null,
      snippet: r.snippet || ''
    })).filter(r => {
      if (!r.url) return false;
      try {
        const u = new URL(r.url);
        if (badHosts.includes(u.hostname)) return false;
        return true;
      } catch {
        return false;
      }
    });
    return cleaned.slice(0, limit).map(r => ({
      title: r.title || r.snippet || 'Untitled',
      url: r.link || r.url || null,
      snippet: r.snippet || ''
    }));
  } catch (e) {
    console.warn('Search failed:', e?.response?.data || e.message || e);
    return [];
  }
}

module.exports = { search };
