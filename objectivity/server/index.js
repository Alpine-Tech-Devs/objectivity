const express = require('express');
const axios = require('axios');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.post('/api/chat', async (req, res) => {
	const { prompt } = req.body || {};

	if (!prompt || typeof prompt !== 'string') {
		return res.status(400).json({ error: 'Missing `prompt` in request body' });
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
					{ role: 'user', content: prompt }
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

