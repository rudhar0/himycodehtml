export const socketConfig = {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        origin.startsWith('http://127.0.0.1:') ||
        origin.startsWith('http://localhost:')
      ) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000
};

export default socketConfig;
