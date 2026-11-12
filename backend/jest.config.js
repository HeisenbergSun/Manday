/** jest 配置 — ts-jest + NestJS 装饰器支持 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        target: 'ES2022',
        strict: false,
      },
    }],
  },
};
