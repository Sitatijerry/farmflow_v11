import express from 'express';
import { createHTTPServer } from '@trpc/server/adapters/standalone';
import { appRouter } from './routers';

const app = express();

// Middleware
app.use(express.json());

// Create HTTP server with tRPC
const server = createHTTPServer({
  router: appRouter,
  createContext: () => ({}),
});

// Mount tRPC routes
app.use('/trpc', server);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}` );
  console.log(`📡 tRPC endpoint: http://localhost:${PORT}/trpc` );
});
