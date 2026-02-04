const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Normalize and validate URLs before returning to client.
const axiosValidate = require('axios');
async function normalizeUrl(rawUrl) {
	if (!rawUrl) return null;
	try {
		// unwrap common redirect wrappers (google/bing)
		const u = new URL(rawUrl);
		const hostname = (u.hostname || '').toLowerCase();
		if ((hostname.includes('google.') || hostname.includes('bing.')) && u.searchParams.get('q')) {
			rawUrl = u.searchParams.get('q');
		}
	} catch (e) {
		// rawUrl might be missing protocol; continue
	}
	// ensure protocol
	if (!/^https?:\/\//i.test(rawUrl)) rawUrl = 'https://' + rawUrl;
	try {
		const u = new URL(rawUrl);
		return u.toString();
	} catch (e) {
		return null;
	}
}

async function validateUrl(url) {
	if (!url) return null;
	try {
		const head = await axiosValidate.head(url, { timeout: 3000, maxRedirects: 5, validateStatus: null });
		if (head.status >= 200 && head.status < 400) return url;
		// fallback to GET for servers that block HEAD
		const get = await axiosValidate.get(url, { timeout: 3000, maxRedirects: 5, validateStatus: null });
		if (get.status >= 200 && get.status < 400) return url;
		return null;
	} catch (e) {
		return null;
	}
}

async function normalizeAndValidateSourcesForItems(items) {
	if (!Array.isArray(items)) return items;
	return Promise.all(items.map(async it => {
		const sources = Array.isArray(it.sources) ? it.sources : [];
		const validated = await Promise.all(sources.map(async s => {
			const title = s && s.title ? s.title : null;
			const raw = s && s.url ? s.url : null;
			const norm = await normalizeUrl(raw);
			if (!norm) return { title, url: null, available: false };
			const ok = await validateUrl(norm);
			if (!ok) return { title, url: null, available: false };
			return { title, url: norm, available: true };
		}));
		return { ...it, sources: validated };
	}));
}

const { set: cacheSet, get: cacheGet } = require('./lib/cache');
const { search } = require('./lib/search');
const { callChatCompletion } = require('./lib/openai');

app.post('/api/chat', async (req, res) => {
	// Two modes supported:
	// 1) Chat mode: { prompt: string } (legacy)
	// 2) Topic mode: { topic: string } -> returns { pro: [], con: [] }

	const { prompt, topic, messages, targetClaim, targetSide, history } = req.body || {};
	const { mode } = req.body || {};

	// Topic mode: return pros/cons structured JSON
	if (topic && typeof topic === 'string') {
		try {
			const normalized = topic.trim().toLowerCase();
			const cacheKey = `args:${normalized}`;
			const cached = cacheGet(cacheKey);
			// If this is a counter-argument request (has targetClaim), do not return the cached
			// topic result — we need to generate a fresh rebuttal.
			if (cached && !targetClaim) return res.json({ ok: true, cached: true, ...cached });

			// Support counter-argument requests: client may send targetClaim, targetSide, and history
			if (targetClaim && mode === 'dive') {
				try {
					const model = process.env.OPENAI_MODEL || 'gpt-40-mini';
					const maxTokens = Number(process.env.MAX_TOKENS) || 800;
					const system = {
						role: 'system',
						content: [
							'You are Objective Debate Assistant. Produce JSON ONLY, matching the response schema exactly.',
							"Schema: { detail: { claim: string, long_summary: string, sources: [{ title?: string, url?: string }] } }",
							"Rules: claim ≤ 20 words; long_summary = 2–3 short paragraphs; sources must be from provided retrievals when available; do NOT invent URLs. If no reliable sources, set sources: [] and long_summary to 'No reliable sources found.'",
							"Return valid JSON only, no surrounding commentary."
						].join(' ')
					};
					const userParts = [];
					userParts.push(`Topic: ${topic}`);
					userParts.push(`Target claim: ${targetClaim}`);
					userParts.push('Produce a detailed explanation of this claim (2-3 short paragraphs), and provide exactly 3 supporting or relevant sources with title and URL. Return JSON only with shape { detail: { claim: string, long_summary: string, sources: [{title,url}] } }');
					if (history && (history.pro || history.con)) {
						userParts.push('Conversation history:');
						(history.pro || []).forEach((p, i) => userParts.push(`Pro ${i + 1}: ${p.claim} — ${p.summary}`));
						(history.con || []).forEach((c, i) => userParts.push(`Con ${i + 1}: ${c.claim} — ${c.summary}`));
					}
					const user = { role: 'user', content: userParts.join('\n') };

					const aiResp = await callChatCompletion({ messages: [system, user], model, max_tokens: maxTokens, temperature: 0.2 });
					const raw = aiResp;
					const text = (raw?.choices && raw.choices[0] && raw.choices[0].message && raw.choices[0].message.content) || '';

					function tryParseJsonCandidate(str) {
						if (!str) return null;
						const first = str.indexOf('{');
						if (first === -1) return null;
						let candidate = str.slice(first).trim();
						try { return JSON.parse(candidate); } catch (e) {}
						const m = candidate.match(/\{[\s\S]*\}/);
						if (m) {
							try { return JSON.parse(m[0]); } catch (e) {}
						}
						return null;
					}

					let parsed = tryParseJsonCandidate(text);
					if (!parsed) {
						try {
							const recoverySystem = {
								role: 'system',
								content: [
									'You are a JSON extractor. Given arbitrary text, extract and return ONLY the JSON object embedded in it.',
									"Ensure the extracted JSON matches schema: { pro:[...], con:[...] } and return valid JSON only."
								].join(' ')
							};
							const recoveryUser = { role: 'user', content: `Extract JSON from the following text:\n\n${text}` };
							const recoveryResp = await callChatCompletion({ messages: [recoverySystem, recoveryUser], model, max_tokens: 1200, temperature: 0 });
							const recoveryText = (recoveryResp?.choices && recoveryResp.choices[0] && recoveryResp.choices[0].message && recoveryResp.choices[0].message.content) || '';
							const recoveryParsed = tryParseJsonCandidate(recoveryText);
							if (recoveryParsed) parsed = recoveryParsed;
						} catch (reErr) {
							console.warn('Recovery attempt failed for dive:', reErr?.message || reErr);
						}
					}

					if (!parsed) return res.status(502).json({ error: 'Model did not return valid JSON for dive', raw: text });
					let detail = parsed.detail || parsed;
					if (detail && Array.isArray(detail.sources)) {
						// normalize/validate each source
						detail.sources = await Promise.all(detail.sources.map(async s => {
							const title = s && s.title ? s.title : null;
							const norm = await normalizeUrl(s && s.url);
							if (!norm) return { title, url: null, available: false };
							const ok = await validateUrl(norm);
							return ok ? { title, url: norm, available: true } : { title, url: null, available: false };
						}));
					}
					return res.json({ ok: true, detail });
				} catch (err) {
					console.error('Dive pipeline error:', err?.response?.data || err.message || err);
					return res.status(500).json({ error: 'Server error' });
				}
			}
			if (targetClaim && typeof targetClaim === 'string') {
				try {
					const model = process.env.OPENAI_MODEL || 'gpt-40-mini';
					const maxTokens = Number(process.env.MAX_TOKENS) || 800;

					const system = {
						role: 'system',
						content: [
							'You are Objective Debate Assistant. Produce JSON ONLY, matching the response schema exactly.',
							"Schema: { pro: [{ claim: string, summary: string, sources: [{ title?: string, url?: string }] }], con: [...] }",
							"Rules: claim ≤ 20 words; summary = 1–3 short sentences; sources must reference provided retrievals when available; do NOT invent URLs. If unsure, set sources: [] and summary: 'No reliable sources found.'",
							"Return valid JSON only, no surrounding commentary."
						].join(' ')
					};

					const opposite = targetSide === 'pro' ? 'con' : 'pro';
					const userParts = [];
					userParts.push(`Topic: ${topic}`);
					userParts.push(`Target claim to rebut: ${targetClaim}`);
					userParts.push(`Generate 1-2 ${opposite} arguments that directly respond to and rebut the target claim. Return only JSON with shape { pro: [...], con: [...] } and include sources (title,url) where possible. If you cannot provide a real URL, set url to null.`);
					userParts.push('Do not repeat claims that already appear in the conversation history or the target claim. Produce novel rebuttals (different wording and different claims).');
					if (history && (history.pro || history.con)) {
						userParts.push('Conversation history:');
						(history.pro || []).forEach((p, i) => userParts.push(`Pro ${i + 1}: ${p.claim} — ${p.summary}`));
						(history.con || []).forEach((c, i) => userParts.push(`Con ${i + 1}: ${c.claim} — ${c.summary}`));
					}

					const user = { role: 'user', content: userParts.join('\n') };

					// robust parse helper
					function tryParseJsonCandidate(str) {
						if (!str) return null;
						const first = str.indexOf('{');
						if (first === -1) return null;
						let candidate = str.slice(first).trim();
						try { return JSON.parse(candidate); } catch (e) {}
						const m = candidate.match(/\{[\s\S]*\}/);
						if (m) {
							try { return JSON.parse(m[0]); } catch (e) {}
						}
						const openBraces = (candidate.match(/\{/g) || []).length;
						const closeBraces = (candidate.match(/\}/g) || []).length;
						const openBrackets = (candidate.match(/\[/g) || []).length;
						const closeBrackets = (candidate.match(/\]/g) || []).length;
						let needBraces = openBraces - closeBraces;
						let needBrackets = openBrackets - closeBrackets;
						if (needBraces < 0) needBraces = 0;
						if (needBrackets < 0) needBrackets = 0;
						const fixed = candidate + (']'.repeat(needBrackets)) + ('}'.repeat(needBraces));
						try { return JSON.parse(fixed); } catch (e) {}
						return null;
					}

					function norm(s) { return (s||'').toString().trim().toLowerCase().replace(/[\s\W_]+/g,' '); }
					const existingClaimsSet = new Set();
					if (history) {
						(history.pro || []).forEach(p => existingClaimsSet.add(norm(p.claim)));
						(history.con || []).forEach(c => existingClaimsSet.add(norm(c.claim)));
					}
					existingClaimsSet.add(norm(targetClaim));

					let parsed = null;
					let parsedOpposite = [];
					let lastText = '';

					// Attempt up to 3 tries with increasing creativity to get novel rebuttals
					const temps = [0.0, 0.35, 0.7];
					for (let attempt = 0; attempt < temps.length; attempt++) {
						const temp = temps[attempt];
						try {
							const instructExtra = attempt === 0 ? '' : '\n\nTry to rephrase and produce different claims than earlier responses.';
							const user = { role: 'user', content: userParts.join('\n') + instructExtra };
							const aiResp = await callChatCompletion({ messages: [system, user], model, max_tokens: maxTokens, temperature: temp });
							const raw = aiResp;
							const text = (raw?.choices && raw.choices[0] && raw.choices[0].message && raw.choices[0].message.content) || '';
							lastText = text;
							const candidate = tryParseJsonCandidate(text);
							if (candidate) {
								parsed = candidate;
								const oppItems = (candidate[opposite] || []).filter(it => !existingClaimsSet.has(norm(it.claim)));
								if (oppItems && oppItems.length > 0) {
									parsedOpposite = oppItems;
									break;
								}
							}
						} catch (e) {
							console.warn('Attempt', attempt, 'failed:', e?.message || e);
						}
					}

					// If we didn't get novel items, fall back to any parsed items (deduped)
					if ((!parsedOpposite || parsedOpposite.length === 0) && parsed) {
						parsedOpposite = (parsed[opposite] || []).filter(it => !existingClaimsSet.has(norm(it.claim)));
					}

					if (!parsed && (!parsedOpposite || parsedOpposite.length === 0)) {
						try {
							const recoverySystem = {
								role: 'system',
								content: 'You are a JSON extractor. Given arbitrary text, extract and return only the JSON object embedded in it. Return valid JSON only.'
							};
							const recoveryUser = { role: 'user', content: `Extract JSON from the following text:\n\n${lastText}` };
							const recoveryResp = await callChatCompletion({ messages: [recoverySystem, recoveryUser], model, max_tokens: 1200, temperature: 0 });
							const recoveryText = (recoveryResp?.choices && recoveryResp.choices[0] && recoveryResp.choices[0].message && recoveryResp.choices[0].message.content) || '';
							const recoveryParsed = tryParseJsonCandidate(recoveryText);

							if (recoveryParsed) {
								const result = { pro: recoveryParsed.pro || [], con: recoveryParsed.con || [] };
								return res.json({ ok: true, cached: false, ...result });
							}
						} catch (reErr) {
							console.warn('Recovery attempt failed:', reErr?.message || reErr);
						}
						return res.status(502).json({ error: 'Model did not return valid JSON', raw: text });
					}

					let result = { pro: parsed.pro || [], con: parsed.con || [] };
					// normalize and validate sources for returned items
					result.pro = await normalizeAndValidateSourcesForItems(result.pro);
					result.con = await normalizeAndValidateSourcesForItems(result.con);
					return res.json({ ok: true, cached: false, ...result });
				} catch (err) {
					console.error('Counter pipeline error:', err?.response?.data || err.message || err);
					const status = err?.response?.status || 500;
					return res.status(status).json({ error: err?.response?.data || err.message || 'Server error' });
				}
			}

			const model = process.env.OPENAI_MODEL || 'gpt-40-mini';
			const maxTokens = Number(process.env.MAX_TOKENS) || 800;

			// Attempt searches (SERPAPI_KEY optional)
			const proQuery = `${topic} arguments for`;
			const conQuery = `${topic} arguments against`;
			const [proResults, conResults] = await Promise.all([
				search(proQuery, { limit: 6 }),
				search(conQuery, { limit: 6 }),
			]);

			const system = {
				role: 'system',
				content: [
					'You are Objective Debate Assistant. Produce JSON ONLY, matching the response schema exactly.',
					"Schema: { pro: [{ claim: string, summary: string, sources: [{ title?: string, url?: string }] }], con: [...] }",
					"Rules: claim ≤ 20 words; summary = 1–3 short sentences; sources must reference provided retrievals when available; do NOT invent URLs. If unsure, set sources: [] and summary: 'No reliable sources found.'",
					"Return valid JSON only, no surrounding commentary."
				].join(' ')
			};

			// Build retrieval payload (will be attached for the model to cite from)
			const retrievals = {
				pro: proResults.map(r => ({ title: r.title, url: r.url || null, snippet: r.snippet })),
				con: conResults.map(r => ({ title: r.title, url: r.url || null, snippet: r.snippet })),
			};

			const userParts = [];
			userParts.push(`Topic: ${topic}`);
			userParts.push('Retrievals (use only these when citing):');
			userParts.push(JSON.stringify(retrievals, null, 2));

			let user = { role: 'user', content: userParts.join('\n') };

			// If no search results were available (no SERPAPI_KEY), fall back to a
			// direct prompt requesting 3 pro and 3 con arguments. Instruct the model
			// to set `url` to null if it cannot provide a verifiable link.
			if ((!proResults || proResults.length === 0) && (!conResults || conResults.length === 0)) {
				user = {
					role: 'user',
					content: [
						`Topic: ${topic}`,
						'No retrievals available. Provide exactly 3 Pro arguments and 3 Con arguments for the topic.',
						"Return only JSON with shape { pro:[{claim,summary,sources:[{title,url}]}], con:[...] }.",
						"Rules: claim ≤ 20 words; summary = 1–3 short sentences; if you cannot provide a real URL, set url to null; if unsure, set sources: [] and summary: 'No reliable sources found.'"
					].join(' ')
				};
			}

			const aiResp = await callChatCompletion({ messages: [system, user], model, max_tokens: maxTokens, temperature: 0 });
			const raw = aiResp;
			const text = (raw?.choices && raw.choices[0] && raw.choices[0].message && raw.choices[0].message.content) || '';

			function tryParseJsonCandidate(str) {
				if (!str) return null;
				const first = str.indexOf('{');
				if (first === -1) return null;
				let candidate = str.slice(first).trim();
				try { return JSON.parse(candidate); } catch (e) {}
				const m = candidate.match(/\{[\s\S]*\}/);
				if (m) {
					try { return JSON.parse(m[0]); } catch (e) {}
				}
				const openBraces = (candidate.match(/\{/g) || []).length;
				const closeBraces = (candidate.match(/\}/g) || []).length;
				const openBrackets = (candidate.match(/\[/g) || []).length;
				const closeBrackets = (candidate.match(/\]/g) || []).length;
				let needBraces = openBraces - closeBraces;
				let needBrackets = openBrackets - closeBrackets;
				if (needBraces < 0) needBraces = 0;
				if (needBrackets < 0) needBrackets = 0;
				const fixed = candidate + (']'.repeat(needBrackets)) + ('}'.repeat(needBraces));
				try { return JSON.parse(fixed); } catch (e) {}
				return null;
			}

			let parsed = tryParseJsonCandidate(text);

			if (!parsed) {
				try {
					const recoverySystem = {
						role: 'system',
						content: [
							'You are a JSON extractor. Given arbitrary text, extract and return ONLY the JSON object embedded in it.',
							"Ensure the extracted JSON matches schema: { detail: { claim, long_summary, sources } } and return valid parsable JSON only."
						].join(' ')
					};
					const recoveryUser = { role: 'user', content: `Extract JSON from the following text:\n\n${text}` };
					const recoveryResp = await callChatCompletion({ messages: [recoverySystem, recoveryUser], model, max_tokens: 1200, temperature: 0 });
					const recoveryText = (recoveryResp?.choices && recoveryResp.choices[0] && recoveryResp.choices[0].message && recoveryResp.choices[0].message.content) || '';
					const recoveryParsed = tryParseJsonCandidate(recoveryText);

					if (recoveryParsed) {
						const result = { pro: recoveryParsed.pro || [], con: recoveryParsed.con || [] };
						cacheSet(cacheKey, result, 60 * 10);
						return res.json({ ok: true, cached: false, ...result });
					}
				} catch (reErr) {
					console.warn('Recovery attempt failed:', reErr?.message || reErr);
				}

				return res.status(502).json({ error: 'Model did not return valid JSON', raw: text });
			}

			let result = { pro: parsed.pro || [], con: parsed.con || [] };
			// normalize/validate sources
			result.pro = await normalizeAndValidateSourcesForItems(result.pro);
			result.con = await normalizeAndValidateSourcesForItems(result.con);
			cacheSet(cacheKey, result, 60 * 10);
			return res.json({ ok: true, cached: false, ...result });
		} catch (err) {
			console.error('Arguments pipeline error:', err?.response?.data || err.message || err);
			const status = err?.response?.status || 500;
			return res.status(status).json({ error: err?.response?.data || err.message || 'Server error' });
		}
	}

	// Legacy chat mode: support prompt or messages
	const textPrompt = prompt || (Array.isArray(messages) ? messages.map(m => m.content).join('\n') : undefined);
	if (!textPrompt || typeof textPrompt !== 'string') {
		return res.status(400).json({ error: 'Missing `prompt` or `topic` in request body' });
	}

	try {
		const openaiKey = process.env.OPENAI_API_KEY;
		if (!openaiKey) {
			return res.status(500).json({ error: 'Server missing OPENAI_API_KEY' });
		}

		const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
		const maxTokens = Number(process.env.MAX_TOKENS) || 200;

		const response = await axios.post(
			'https://api.openai.com/v1/chat/completions',
			{
				model,
				messages: [
					{ role: 'user', content: textPrompt }
				],
				max_tokens: maxTokens
			},
			{
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${openaiKey}`,
				},
			}
		);

		const result = response.data;
		const text = (result?.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) || null;

		res.json({ ok: true, model, text, raw: result });
	} catch (err) {
		console.error('OpenAI request error:', err?.response?.data || err.message || err);
		const status = err?.response?.status || 500;
		const data = err?.response?.data || { message: 'OpenAI request failed' };
		res.status(status).json({ error: data });
	}
});

app.listen(port, () => {
	console.log(`Server listening on http://localhost:${port}`);
});

