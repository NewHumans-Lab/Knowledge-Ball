# Knowledge-Ball

Knowledge-Ball is a shared knowledge graph. User-created nodes are persisted by the bundled HTTP service and loaded by every browser when the app starts.

## Run locally

```bash
npm install
npm run build
npm run server
```

Open `http://localhost:8787/Knowledge-Ball/`. Data is stored in `data/knowledge.json`; set `KNOWLEDGE_DATA_FILE` to place it on a persistent volume and `PORT` to change the listening port.

For frontend development, run `npm run server` and `npm run dev` in separate terminals. Vite proxies `/api/knowledge` to the service on port 8787.

## Deployment

Deploy the application as the Node service (`npm start`) with a persistent volume for `data/`. A static-only host such as GitHub Pages cannot accept user writes, so it cannot provide cross-user node sharing by itself. Put authentication and rate limiting at the hosting platform or reverse proxy before opening submissions to untrusted traffic.
