import express from 'express';
import cors from 'cors';
import codeRoutes from './routes/code.routes.js';
import { toolchainService } from './services/toolchain.service.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Routes
app.use('/api', codeRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ 
    success: false, 
    error: err.message || 'Internal Server Error' 
  });
});

(async () => {
  // Validate bundled toolchain before starting
  try {
    const res = await toolchainService.verify();
    if (!res.compiler || !res.headers) {
      console.error('Bundled toolchain validation failed:', res);
      process.exit(1);
    }
    console.log('Bundled toolchain validated.');
  } catch (e) {
    console.error('Toolchain validation error:', e.message);
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
})();