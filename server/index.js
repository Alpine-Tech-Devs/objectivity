const express = require("express");
const axios = require("axios");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const axiosValidate = require("axios");
const { set: cacheSet, get: cacheGet } = require("./lib/cache");
const { search, getValidLinksOrRetry } = require("./lib/search");
const { callChatCompletion } = require("./lib/openai");

/** -------------------------
 * URL normalize + validate
 * ------------------------*/
async function normalizeUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    const hostname = (u.hostname || "").toLowerCase();
    if (
      (hostname.includes("google.") || hostname.includes("bing.")) &&
      u.searchParams.get("q")
    ) {
      rawUrl = u.searchParams.get("q");
    }
  } catch {
    // rawUrl might be missing protocol; continue
  }

  if (!/^https?:\/\//i.test(rawUrl)) rawUrl = "https://" + rawUrl;

  try {
    const u = new URL(rawUrl);
    return u.toString();
  } catch {
    return null;
  }
}

async function validateUrl(url) {
  if (!url) return null;
  try {
    // Prefer GET (many sites block HEAD)
    const resp = await axiosValidate.get(url, {
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: null,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ObjectivityBot/1.0)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (resp.status >= 200 && resp.status < 400) return url;

    // fallback to HEAD
    const head = await axiosValidate.head(url, {
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: null,
    });
    if (head.status >= 200 && head.status < 400) return url;

    return null;
  } catch {
    return null;
  }
}

async function normalizeAndValidateSourcesForItems(items) {
  if (!Array.isArray(items)) return items;
  return Promise.all(
    items.map(async (it) => {
      const sources = Array.isArray(it.sources) ? it.sources : [];
      const validated = await Promise.all(
        sources.map(async (s) => {
          const title = s && s.title ? s.title : null;
          const raw = s && s.url ? s.url : null;
          const norm = await normalizeUrl(raw);
          if (!norm) {
            console.log(`[VALIDATE] normalizeUrl failed for: ${raw}`);
            return { title, url: null, available: false };
          }
          const ok = await validateUrl(norm);
          if (!ok) {
            console.log(`[VALIDATE] validateUrl failed for: ${norm}`);
            return { title, url: null, available: false };
          }
          console.log(`[VALIDATE] URL valid: ${norm}`);
          return { title, url: norm, available: true };
        })
      );
      // keep only valid urls (your UI will show only those)
      const usable = validated.filter((x) => x.url);
      return { ...it, sources: usable };
    })
  );
}

/** -------------------------
 * Retrieval ID mapping
 * ------------------------*/
function buildRetrievals(proResults, conResults, limit = 10) {
  const pro = (proResults || []).slice(0, limit).map((r, i) => ({
    id: `pro-${i + 1}`,
    title: r.title || "Untitled",
    url: r.url || null,
    snippet: r.snippet || "",
  }));
  const con = (conResults || []).slice(0, limit).map((r, i) => ({
    id: `con-${i + 1}`,
    title: r.title || "Untitled",
    url: r.url || null,
    snippet: r.snippet || "",
  }));
  console.log(`[BUILD_RETRIEVALS] Pro results: ${pro.length}, with URLs: ${pro.filter(p => p.url).length}`);
  console.log(`[BUILD_RETRIEVALS] Con results: ${con.length}, with URLs: ${con.filter(c => c.url).length}`);
  pro.slice(0, 3).forEach((p, i) => console.log(`  [PRO-${i+1}] ${p.title} -> ${p.url}`));
  con.slice(0, 3).forEach((c, i) => console.log(`  [CON-${i+1}] ${c.title} -> ${c.url}`));
  return { pro, con };
}

function mapSourceIdsToSources(items, retrievals) {
  const map = new Map();
  [...(retrievals?.pro || []), ...(retrievals?.con || [])].forEach((r) => {
    if (r?.id) map.set(r.id, { title: r.title || null, url: r.url || null });
  });

  return (items || []).map((it) => {
    const src = Array.isArray(it.sources) ? it.sources : [];
    const mapped = src
      .map((s) => (s && s.id ? map.get(s.id) : null))
      .filter(Boolean);
    return { ...it, sources: mapped };
  });
}

/** -------------------------
 * Link repair (best-effort - GUARANTEE at least one valid link)
 * ------------------------*/
async function ensureValidLinksForItems(topic, items) {
  if (!Array.isArray(items)) return items;

  return Promise.all(
    items.map(async (it) => {
      const hasAny = Array.isArray(it.sources) && it.sources.some((s) => s?.url);
      if (hasAny) {
        console.log(`[REPAIR] Argument already has valid links: ${it.claim}`);
        return it;
      }

      const claim = it.claim || "";
      console.log(`[REPAIR] Attempting to repair links for: ${claim}`);
      
      // Try multiple times with different search queries to find at least one valid link
      let links = [];
      const queries = [
        `${topic} ${claim}`,
        `${topic} evidence ${claim}`,
        `${claim} research study`,
      ];

      for (const q of queries) {
        if (links.length > 0) break;
        console.log(`[REPAIR] Searching: ${q}`);
        const hits = await getValidLinksOrRetry(topic, claim, 1);
        if (hits && hits.length > 0) {
          links = hits;
          break;
        }
      }

      if (!links || links.length === 0) {
        console.log(`[REPAIR] No links found after all attempts for: ${claim}`);
        return { ...it, sources: [] };
      }

      // validate the repaired links
      const validated = await Promise.all(
        links.map(async (s) => {
          const norm = await normalizeUrl(s.url);
          if (!norm) {
            console.log(`[REPAIR] normalizeUrl failed: ${s.url}`);
            return { title: s.title || null, url: null, available: false };
          }
          const ok = await validateUrl(norm);
          if (!ok) {
            console.log(`[REPAIR] validateUrl failed: ${norm}`);
            return { title: s.title || null, url: null, available: false };
          }
          console.log(`[REPAIR] Valid link found: ${norm}`);
          return { title: s.title || null, url: norm, available: true };
        })
      );

      const usable = validated.filter((x) => x.url);
      if (usable.length === 0) {
        console.log(`[REPAIR] All validated links failed for: ${claim}`);
      }
      return { ...it, sources: usable.length ? usable : [] };
    })
  );
}

/** -------------------------
 * JSON parsing helper
 * ------------------------*/
function tryParseJsonCandidate(str) {
  if (!str) return null;
  const first = str.indexOf("{");
  if (first === -1) return null;
  let candidate = str.slice(first).trim();
  try {
    return JSON.parse(candidate);
  } catch {}
  const m = candidate.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  return null;
}

function modelText(resp) {
  return (
    (resp?.choices &&
      resp.choices[0] &&
      resp.choices[0].message &&
      resp.choices[0].message.content) ||
    ""
  );
}

/** -------------------------
 * Main route
 * ------------------------*/
app.post("/api/chat", async (req, res) => {
  const { prompt, topic, messages, targetClaim, targetSide, history } =
    req.body || {};
  const { mode } = req.body || {};

  // ---------- Topic mode ----------
  if (topic && typeof topic === "string") {
    try {
      const normalized = topic.trim().toLowerCase();
      const cacheKey = `args:${normalized}`;
      const cached = cacheGet(cacheKey);
      if (cached && !targetClaim && !mode) {
        return res.json({ ok: true, cached: true, ...cached });
      }

      // ---------- DIVE mode ----------
      if (targetClaim && mode === "dive") {
        // Do a fresh search for dive so we can cite real sources (optional but recommended)
        const [r1, r2] = await Promise.all([
          search(`${topic} ${targetClaim} evidence`, { limit: 20 }),
          search(`${topic} ${targetClaim} study report`, { limit: 20 }),
        ]);
        const retrievals = buildRetrievals(r1, r2, 10);

        const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
        const maxTokens = Number(process.env.MAX_TOKENS) || 900;

        const system = {
          role: "system",
          content: [
            "You are Objective Debate Assistant. Return VALID JSON ONLY. No markdown. No commentary.",
            "",
            'Schema: { "detail": { "claim": string, "long_summary": string, "sources": [{ "id": string }] } }',
            "",
            "Rules:",
            "- claim <= 20 words",
            "- long_summary = 2–3 short paragraphs",
            "- SOURCES: cite ONLY by id from provided retrievals; never invent ids; never include URLs",
            "- If none fit, sources: [] and long_summary must include: 'No reliable sources found.'",
            "",
            "STYLE (Defense Attorney Mode):",
            "- Explain like counsel: element-by-element reasoning, alternative explanations, and preemption of the best counterpoint.",
          ].join("\n"),
        };

        const userParts = [];
        userParts.push(`Topic: ${topic}`);
        userParts.push(`Target claim: ${targetClaim}`);
        userParts.push("Retrievals (use only these ids when citing):");
        userParts.push(JSON.stringify(retrievals, null, 2));
        userParts.push(
          "Produce JSON only in the required schema. Provide 1–2 source ids if possible."
        );

        const user = { role: "user", content: userParts.join("\n") };

        const aiResp = await callChatCompletion({
          messages: [system, user],
          model,
          max_tokens: maxTokens,
          temperature: 0.2,
          // If your model supports it, JSON mode helps:
          response_format: { type: "json_object" },
        });

        const text = modelText(aiResp);
        let parsed = tryParseJsonCandidate(text);

        if (!parsed) {
          // recovery extractor for DIVE (correct schema!)
          const recoverySystem = {
            role: "system",
            content:
              "Extract and return ONLY the JSON object embedded in the text. Return valid JSON only.",
          };
          const recoveryUser = {
            role: "user",
            content: `Extract JSON from:\n\n${text}`,
          };
          const recoveryResp = await callChatCompletion({
            messages: [recoverySystem, recoveryUser],
            model,
            max_tokens: 1200,
            temperature: 0,
            response_format: { type: "json_object" },
          });
          parsed = tryParseJsonCandidate(modelText(recoveryResp));
        }

        if (!parsed) {
          return res.status(502).json({ error: "Model did not return valid JSON for dive", raw: text });
        }

        let detail = parsed.detail || parsed;

        // map ids -> urls
        detail.sources = mapSourceIdsToSources(
          [{ sources: detail.sources || [] }],
          retrievals
        )[0].sources;

        // validate and strip bad urls
        const detailItems = await normalizeAndValidateSourcesForItems([
          { ...detail, sources: detail.sources || [] },
        ]);
        detail = detailItems[0];

        // attempt repair if no links
        if (!detail.sources || detail.sources.length === 0) {
          const repaired = await ensureValidLinksForItems(topic, [
            { claim: detail.claim || targetClaim, sources: [] },
          ]);
          detail.sources = repaired[0].sources || [];
        }

        return res.json({ ok: true, detail });
      }

      // ---------- Counterargument mode ----------
      if (targetClaim && typeof targetClaim === "string") {
        const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
        const maxTokens = Number(process.env.MAX_TOKENS) || 900;

        // Build retrievals for counterarguments (fixes your undefined retrievals bug)
        const opposite = targetSide === "pro" ? "con" : "pro";
        const [r1, r2] = await Promise.all([
          search(`${topic} rebuttal ${targetClaim}`, { limit: 20 }),
          search(`${topic} arguments ${opposite === "pro" ? "for" : "against"}`, {
            limit: 20,
          }),
        ]);
        const retrievals = buildRetrievals(r1, r2, 10);

        const system = {
          role: "system",
          content: [
            "You are Objective Debate Assistant. Return VALID JSON ONLY. No markdown. No commentary.",
            "",
            'Schema: { "pro": [{ "claim": string, "summary": string, "sources": [{ "id": string }] }], "con": [{ "claim": string, "summary": string, "sources": [{ "id": string }] }] }',
            "",
            "Rules:",
            "- Generate 1–2 rebuttal arguments on the opposite side only; still return both keys pro and con (one will be empty).",
            "- claim <= 20 words; summary 1–3 sentences.",
            "- SOURCES: cite ONLY by id from provided retrievals; never invent ids; never include URLs.",
            "",
            "STYLE (Defense Attorney Mode):",
            "- Cross-examine the target claim; identify missing premises, weaker causation, alternative explanations.",
          ].join("\n"),
        };

        const userParts = [];
        userParts.push(`Topic: ${topic}`);
        userParts.push(`Target claim to rebut: ${targetClaim}`);
        userParts.push(`Target side: ${targetSide}`);
        userParts.push("Retrievals (use only these ids when citing):");
        userParts.push(JSON.stringify(retrievals, null, 2));
        if (history && (history.pro || history.con)) {
          userParts.push("Conversation history (avoid repeating):");
          (history.pro || []).forEach((p, i) =>
            userParts.push(`Pro ${i + 1}: ${p.claim} — ${p.summary}`)
          );
          (history.con || []).forEach((c, i) =>
            userParts.push(`Con ${i + 1}: ${c.claim} — ${c.summary}`)
          );
        }

        userParts.push(
          `Generate 1–2 ${opposite} rebuttals. Return JSON only. Cite 1–2 retrieval ids per rebuttal if possible.`
        );

        const user = { role: "user", content: userParts.join("\n") };

        const aiResp = await callChatCompletion({
          messages: [system, user],
          model,
          max_tokens: maxTokens,
          temperature: 0.2,
          response_format: { type: "json_object" },
        });

        const text = modelText(aiResp);
        let parsed = tryParseJsonCandidate(text);

        if (!parsed) {
          const recoverySystem = {
            role: "system",
            content:
              "Extract and return ONLY the JSON object embedded in the text. Return valid JSON only.",
          };
          const recoveryUser = {
            role: "user",
            content: `Extract JSON from:\n\n${text}`,
          };
          const recoveryResp = await callChatCompletion({
            messages: [recoverySystem, recoveryUser],
            model,
            max_tokens: 1200,
            temperature: 0,
            response_format: { type: "json_object" },
          });
          parsed = tryParseJsonCandidate(modelText(recoveryResp));
        }

        if (!parsed) {
          return res.status(502).json({ error: "Model did not return valid JSON", raw: text });
        }

        let result = { pro: parsed.pro || [], con: parsed.con || [] };

        // map ids -> urls
        result.pro = mapSourceIdsToSources(result.pro, retrievals);
        result.con = mapSourceIdsToSources(result.con, retrievals);

        // validate/strip bad urls
        result.pro = await normalizeAndValidateSourcesForItems(result.pro);
        result.con = await normalizeAndValidateSourcesForItems(result.con);

        // repair if missing
        const missing = [...result.pro, ...result.con].some(
          (it) => !it.sources || it.sources.length === 0
        );
        if (missing) {
          result.pro = await ensureValidLinksForItems(topic, result.pro);
          result.con = await ensureValidLinksForItems(topic, result.con);
        }

        return res.json({ ok: true, cached: false, ...result });
      }

      // ---------- Base topic pros/cons ----------
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
      const maxTokens = Number(process.env.MAX_TOKENS) || 900;

      const proQuery = `${topic} arguments for`;
      const conQuery = `${topic} arguments against`;

      const [proResults, conResults] = await Promise.all([
        search(proQuery, { limit: 20 }),
        search(conQuery, { limit: 20 }),
      ]);

      const retrievals = buildRetrievals(proResults, conResults, 10);

      const system = {
        role: "system",
        content: [
          "You are Objective Debate Assistant. Return VALID JSON ONLY. No markdown. No commentary.",
          "",
          'Schema: { "pro": [{ "claim": string, "summary": string, "sources": [{ "id": string }] }], "con": [{ "claim": string, "summary": string, "sources": [{ "id": string }] }] }',
          "",
          "Rules:",
          "- Output exactly 3 pro and 3 con arguments.",
          "- claim <= 20 words.",
          "- summary = 1–3 sentences.",
          "- SOURCES: cite ONLY by id from provided retrievals; never invent ids; never include URLs.",
          "- Each argument should cite 1–2 source ids if possible. If none fit, sources: [] and summary includes: 'No reliable sources found.'",
          "",
          "STYLE (Defense Attorney Mode):",
          "- Argue each side like counsel zealously advocating that position.",
          "- Use burden of proof, elements, alternative explanations, reasonable doubt.",
          "- Preempt the strongest counterpoint briefly.",
        ].join("\n"),
      };

      const userParts = [];
      userParts.push(`Topic: ${topic}`);
      userParts.push("Retrievals (use only these ids when citing):");
      userParts.push(JSON.stringify(retrievals, null, 2));
      userParts.push(
        "Return JSON only. Cite 1–2 retrieval ids per argument if possible."
      );

      let user = { role: "user", content: userParts.join("\n") };

      // If no SERPAPI results, we can still generate arguments but sources will be empty
      if (
        (!proResults || proResults.length === 0) &&
        (!conResults || conResults.length === 0)
      ) {
        user = {
          role: "user",
          content: [
            `Topic: ${topic}`,
            "No retrievals available.",
            "Provide exactly 3 Pro and 3 Con arguments.",
            'Return ONLY JSON with shape { "pro":[{claim,summary,sources:[]}], "con":[...] }.',
            "Do not invent URLs. sources must be [] in this mode.",
          ].join("\n"),
        };
      }

      const aiResp = await callChatCompletion({
        messages: [system, user],
        model,
        max_tokens: maxTokens,
        temperature: 0.2,
        response_format: { type: "json_object" },
      });

      const text = modelText(aiResp);
      let parsed = tryParseJsonCandidate(text);

      if (!parsed) {
        const recoverySystem = {
          role: "system",
          content:
            "Extract and return ONLY the JSON object embedded in the text. Return valid JSON only.",
        };
        const recoveryUser = {
          role: "user",
          content: `Extract JSON from:\n\n${text}`,
        };
        const recoveryResp = await callChatCompletion({
          messages: [recoverySystem, recoveryUser],
          model,
          max_tokens: 1200,
          temperature: 0,
          response_format: { type: "json_object" },
        });
        parsed = tryParseJsonCandidate(modelText(recoveryResp));
      }

      if (!parsed) {
        return res.status(502).json({ error: "Model did not return valid JSON", raw: text });
      }

      let result = { pro: parsed.pro || [], con: parsed.con || [] };

      // map ids -> urls
      result.pro = mapSourceIdsToSources(result.pro, retrievals);
      result.con = mapSourceIdsToSources(result.con, retrievals);

      // validate/strip bad urls
      result.pro = await normalizeAndValidateSourcesForItems(result.pro);
      result.con = await normalizeAndValidateSourcesForItems(result.con);

      // repair missing links if possible
      const missing = [...result.pro, ...result.con].some(
        (it) => !it.sources || it.sources.length === 0
      );
      if (missing) {
        result.pro = await ensureValidLinksForItems(topic, result.pro);
        result.con = await ensureValidLinksForItems(topic, result.con);
      }

      cacheSet(cacheKey, result, 60 * 10);
      return res.json({ ok: true, cached: false, ...result });
    } catch (err) {
      console.error("Arguments pipeline error:", err?.response?.data || err.message || err);
      const status = err?.response?.status || 500;
      return res.status(status).json({ error: err?.response?.data || err.message || "Server error" });
    }
  }

  // ---------- Legacy prompt mode ----------
  const textPrompt =
    prompt ||
    (Array.isArray(messages) ? messages.map((m) => m.content).join("\n") : undefined);

  if (!textPrompt || typeof textPrompt !== "string") {
    return res.status(400).json({ error: "Missing `prompt` or `topic` in request body" });
  }

  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return res.status(500).json({ error: "Server missing OPENAI_API_KEY" });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const maxTokens = Number(process.env.MAX_TOKENS) || 200;

    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model,
        messages: [{ role: "user", content: textPrompt }],
        max_tokens: maxTokens,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
      }
    );

    const result = response.data;
    const text =
      (result?.choices &&
        result.choices[0] &&
        result.choices[0].message &&
        result.choices[0].message.content) ||
      null;

    res.json({ ok: true, model, text, raw: result });
  } catch (err) {
    console.error("OpenAI request error:", err?.response?.data || err.message || err);
    const status = err?.response?.status || 500;
    const data = err?.response?.data || { message: "OpenAI request failed" };
    res.status(status).json({ error: data });
  }
});

if (require.main === module) {
  // Important for mobile devices on your LAN:
  app.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

module.exports = app;

