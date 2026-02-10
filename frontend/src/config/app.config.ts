/**
 * Application Configuration
 * Central place for app name, metadata, and branding
 */

export const APP_CONFIG = {
  // App Identity
  name: 'CodeViz',
  fullName: 'CodeViz - C/C++ Execution Visualizer',
  tagline: 'Visualize Every Step of Your Code',
  version: '1.0.0',
  
  // Description
  description: 'An interactive educational platform that visualizes C/C++ program execution with real-time animation of memory, control flow, and data structures.',
  
  // URLs
  websiteUrl: 'https://codeviz.dev',
  githubUrl: 'https://github.com/your-org/codeviz',
  docsUrl: 'https://docs.codeviz.dev',
  
  // Contact
  supportEmail: 'support@codeviz.dev',
  
  // Social
  twitter: '@codeviz',
  discord: 'https://discord.gg/codeviz',
  
  // Features
  features: [
    'Real-time execution visualization',
    'Memory state tracking (Stack, Heap, Globals)',
    'Interactive canvas with pan/zoom',
    'Step-by-step debugging',
    'Loop compression for better understanding',
    'User input handling (scanf/cin)',
    'Optimization comparison (-O0 vs -O3)',
    'Multi-file project support'
  ],
  
  // Credits
  credits: {
    developer: 'Your Name',
    organization: 'Your Organization',
    year: new Date().getFullYear()
  },
  
  // Limits (synced with backend)
  limits: {
    maxCodeSize: 1000000, // 1MB
    maxExecutionSteps: 10000,
    maxLoopIterationsShown: 10,
    maxArraySizeShown: 100
  }
} as const;

export default APP_CONFIG;