# objectivity - server

Small Express proxy that forwards `/api/chat` requests to the OpenAI Chat Completions API.

Getting started

1. Copy the example env and add your OpenAI API key:

```bash
cp .env.example .env
# edit .env and set OPENAI_API_KEY
```

2. Install dependencies and start the server:

```bash
npm install
npm run start
```

Development

```bash
npm run dev
```

How it works

- The mobile app posts JSON `{ prompt }` to `http://localhost:3000/api/chat`.
- The server sends that `prompt` to OpenAI and returns the completion result.

Notes & recommendations

- Keep `OPENAI_API_KEY` on the server only — never embed it in client code.
- For production, add authentication, rate limiting, and error handling.
- To run the client on a device, replace `localhost` with your machine's LAN IP or use Expo tunneling.
