import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Server
  port: process.env.PORT || 5000,
  env: process.env.NODE_ENV || 'development',
  
  // GCC
  gccInstallDir: process.env.GCC_INSTALL_DIR || './tools/gcc',
  gccVersion: process.env.GCC_VERSION || '13.2.0',
  
  // CORS
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  
  // Paths
  tempDir: './temp',
  logsDir: './logs',
  
  // Limits
  maxCodeSize: 1000000, // 1MB
  maxExecutionTime: 30000, // 30s
  
  // Features
  enableGCCDownload: process.env.ENABLE_GCC_DOWNLOAD !== 'false',
  enableOptimization: process.env.ENABLE_OPTIMIZATION !== 'false',
};

export default config;