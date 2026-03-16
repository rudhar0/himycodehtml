
export const corsConfig = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    // Allow all local origins (localhost and 127.0.0.1) with any port.
    // This is critical for Neutralino as the frontend port is random,
    // and for the backend if it needs to switch ports due to conflicts.
    if (
      /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
    ) {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

export default corsConfig;
