const axios = require('axios');

async function callChatCompletion({ messages, model, max_tokens, apiKey, ...rest }) {
  const openaiKey = apiKey || process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error('Missing OpenAI API key');

  const body = Object.assign({}, rest, { model, messages });
  if (max_tokens) body.max_tokens = max_tokens;

  const resp = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    body,
    { headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 }
  );

  return resp.data;
}

module.exports = { callChatCompletion };
