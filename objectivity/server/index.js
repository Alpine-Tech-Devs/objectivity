const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const { set: cacheSet, get: cacheGet } = require('./lib/cache');
const { search } = require('./lib/search');
const { callChatCompletion } = require('./lib/openai');

app.post('/api/chat', async (req, res) => {
	// Two modes supported:
	// 1) Chat mode: { prompt: string } (legacy)
	// 2) Topic mode: { topic: string } -> returns { pro: [], con: [] }

	const { prompt, topic, messages } = req.body || {};

	// Topic mode: return pros/cons structured JSON
	if (topic && typeof topic === 'string') {
		try {
			const normalized = topic.trim().toLowerCase();
			const cacheKey = `args:${normalized}`;
			const cached = cacheGet(cacheKey);
			if (cached) return res.json({ ok: true, cached: true, ...cached });

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
				content:
					'You produce a JSON object with shape { pro: [..], con: [..] }. Each item must have { claim, summary, sources } where sources is an array of { title, url }. Return JSON only, no surrounding text.'
			};

			const userParts = [];
			userParts.push(`Topic: ${topic}`);
			userParts.push('Pro search results:');
			proResults.forEach((r, i) => userParts.push(`${i + 1}. ${r.title} | ${r.url || ''} | ${r.snippet}`));
			userParts.push('Con search results:');
			conResults.forEach((r, i) => userParts.push(`${i + 1}. ${r.title} | ${r.url || ''} | ${r.snippet}`));

			let user = { role: 'user', content: userParts.join('\n') };

			// If no search results were available (no SERPAPI_KEY), fall back to a
			// direct prompt requesting 3 pro and 3 con arguments. Instruct the model
			// to set `url` to null if it cannot provide a verifiable link.
			if ((!proResults || proResults.length === 0) && (!conResults || conResults.length === 0)) {
				user = {
					role: 'user',
					content: `Topic: ${topic}\n\nProvide exactly 3 Pro arguments and 3 Con arguments for the topic. Return only JSON with shape { pro:[{claim,summary,sources:[{title,url}]}], con:[...] }. For each source, include a title and a url. If you cannot provide a real URL, set url to null. Keep summaries concise (1-2 sentences).`,
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
						content: 'You are a JSON extractor. Given arbitrary text, extract and return only the JSON object embedded in it. Return valid JSON only.'
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

			const result = { pro: parsed.pro || [], con: parsed.con || [] };
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

