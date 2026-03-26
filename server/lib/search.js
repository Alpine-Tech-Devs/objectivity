const axios = require("axios");

// Centralize bad hosts so ALL functions can use it
const BAD_HOSTS = new Set([
  "webcache.googleusercontent.com",
  "policies.google.com",
  "duckduckgo.com",
  "search.yahoo.com",
  "bing.com",
  "ask.com",
  "archive.org",
  "web.archive.org",
  "pinterest.com",
  "reddit.com",
  "quora.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "youtube.com",
  "wikipedia.org",
]);

// Search with Tavily API
async function searchTavily(query, opts = { limit: 6 }) {
  const { limit } = opts;
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];

  try {
    const response = await axios.post(
      "https://api.tavily.com/search",
      {
        api_key: key,
        query: query,
        max_results: limit,
        include_answer: false,
      },
      { timeout: 10_000 }
    );

    const results = response.data?.results || [];
    console.log(`[TAVILY] Query: "${query}" returned ${results.length} results`);

    const cleaned = results
      .map((r) => ({
        title: r.title || "Untitled",
        url: r.url || null,
        snippet: r.content || r.snippet || "",
      }))
      .filter((r) => {
        if (!r.url) {
          console.log(`[TAVILY] Filtered out: no URL`);
          return false;
        }
        if (isLikelyBadUrl(r.url)) {
          console.log(`[TAVILY] Filtered out bad URL: ${r.url}`);
          return false;
        }
        return true;
      });

    console.log(`[TAVILY] After filtering: ${cleaned.length} results remain`);

    // De-dupe by hostname + pathname
    const seen = new Set();
    const deduped = [];
    for (const r of cleaned) {
      try {
        const u = new URL(r.url);
        const key = `${u.hostname}${u.pathname}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(r);
        console.log(`[TAVILY] Keeping: ${r.url}`);
      } catch {
        console.log(`[TAVILY] Failed to parse URL: ${r.url}`);
      }
      if (deduped.length >= limit) break;
    }

    console.log(`[TAVILY] Final results: ${deduped.length}`);
    return deduped;
  } catch (e) {
    console.warn(
      "[TAVILY] Search failed:",
      e?.response?.data || e.message || e
    );
    return [];
  }
}

// Search with fallback: try Tavily first, then SerpAPI
async function searchWithFallback(query, opts = { limit: 6 }) {
  // Try Tavily first (primary source)
  if (process.env.TAVILY_API_KEY) {
    const tavilyResults = await searchTavily(query, opts);
    if (tavilyResults.length > 0) {
      console.log("[SEARCH] Using Tavily results");
      return tavilyResults;
    }
    console.log("[SEARCH] Tavily returned no results, falling back to SerpAPI");
  }

  // Fallback to SerpAPI
  return await search(query, opts);
}


function isLikelyBadUrl(raw) {
  if (!raw || typeof raw !== "string") return true;
  if (!raw.startsWith("http")) return true;
  try {
    const u = new URL(raw);
    const host = (u.hostname || "").toLowerCase();
    if (!host) return true;
    if (BAD_HOSTS.has(host)) return true;
    // block obvious redirectors / tracking wrappers
    if (host.endsWith("google.com") && u.pathname.startsWith("/url")) return true;
    return false;
  } catch {
    return true;
  }
}

// Search helper (SerpAPI Google)
async function search(query, opts = { limit: 6 }) {
  const { limit } = opts;
  const key = process.env.SERPAPI_KEY;
  if (!key) return [];

  try {
    const params = new URLSearchParams({
      engine: "google",
      q: query,
      api_key: key,
      num: String(limit),
    });

    const url = `https://serpapi.com/search.json?${params.toString()}`;
    const resp = await axios.get(url, { timeout: 10_000 });

    const results = resp.data?.organic_results || [];
    console.log(`[SEARCH] Query: "${query}" returned ${results.length} results`);

    // Pull more than we need then filter hard
    const cleaned = results
      .slice(0, limit * 3)
      .map((r) => ({
        title: r.title || r.snippet || "Untitled",
        url: r.link || r.url || null,
        snippet: r.snippet || "",
      }))
      .filter((r) => {
        if (!r.url) {
          console.log(`[SEARCH] Filtered out: no URL`);
          return false;
        }
        if (isLikelyBadUrl(r.url)) {
          console.log(`[SEARCH] Filtered out bad URL: ${r.url}`);
          return false;
        }
        return true;
      });

    console.log(`[SEARCH] After filtering: ${cleaned.length} results remain`);

    // De-dupe by hostname + pathname to reduce near duplicates
    const seen = new Set();
    const deduped = [];
    for (const r of cleaned) {
      try {
        const u = new URL(r.url);
        const key = `${u.hostname}${u.pathname}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(r);
        console.log(`[SEARCH] Keeping: ${r.url}`);
      } catch {
        console.log(`[SEARCH] Failed to parse URL: ${r.url}`);
      }
      if (deduped.length >= limit) break;
    }

    console.log(`[SEARCH] Final results: ${deduped.length}`);
    return deduped;
  } catch (e) {
    console.warn("Search failed:", e?.response?.data || e.message || e);
    return [];
  }
}

// Best-effort: find 1–2 candidate links for a specific claim
async function getValidLinksOrRetry(topic, claim, maxTries = 2) {
  let tries = 0;
  let links = [];

  // progressively broaden search query
  const queries = [
    `${topic} ${claim}`,
    `${topic} evidence ${claim}`,
    `${topic} study report ${claim}`,
  ];

  while (tries < maxTries && links.length === 0) {
    const q = queries[Math.min(tries, queries.length - 1)];
    const hits = await searchWithFallback(q, { limit: 8 });

    links = hits
      .filter((h) => h.url && !isLikelyBadUrl(h.url))
      .slice(0, 2)
      .map((h) => ({ title: h.title, url: h.url }));

    tries += 1;
  }

  return links;
}

module.exports = {
  search,
  searchTavily,
  searchWithFallback,
  getValidLinksOrRetry,
  BAD_HOSTS,
  isLikelyBadUrl,
};

