export default {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest',
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '^konva$': '<rootDir>/src/mocks/konva.ts',
    '@/(.*)': '<rootDir>/src/$1',
    '@components/(.*)': '<rootDir>/src/components/$1',
    '@hooks/(.*)': '<rootDir>/src/hooks/$1',
    '@store/(.*)': '<rootDir>/src/store/$1',
    '@utils/(.*)': '<rootDir>/src/utils/$1',
    '@types/(.*)': '<rootDir>/src/types/$1',
    '@services/(.*)': '<rootDir>/src/services/$1',
    '@constants/(.*)': '<rootDir>/src/constants/$1',
    '@config/(.*)': '<rootDir>/src/config/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
};
